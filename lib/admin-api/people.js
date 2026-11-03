import { getPool } from "../db.js";
import { requireRole, sendApiError, ApiError } from "../auth.js";

function normalizeEgyptianPhone(value) {
  const raw = String(value || "").replace(/\\D/g, "");
  let digits = raw;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20")) {
    // Already in international format.
  } else if (digits.startsWith("0")) {
    digits = "2" + digits;
  } else {
    digits = "20" + digits;
  }
  return /^201[0125]\\d{8}$/.test(digits) ? "+" + digits : null;
}

function phoneFromInternalEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const suffix = "@phone.zaffa.invalid";
  if (!value.endsWith(suffix)) return null;
  return normalizeEgyptianPhone(value.slice(0, -suffix.length));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  let client;
  try {
    const actor = await requireRole(req, ["admin"]);
    if (req.method !== "POST" && req.method !== "PATCH") {
      res.setHeader("Allow", "POST, PATCH");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }

    client = await getPool().connect();
    await client.query("BEGIN");

    if (req.method === "POST") {
      const kind = String(req.body?.kind || "");
      const authUserId = String(req.body?.authUserId || "");
      const phone = normalizeEgyptianPhone(req.body?.phone);
      const displayName = String(req.body?.displayName || "").trim();
      const legalName = String(req.body?.legalName || displayName).trim();

      if (!["owner", "driver"].includes(kind)) throw new ApiError(400, "INVALID_PERSON_KIND");
      if (!UUID.test(authUserId)) throw new ApiError(400, "INVALID_AUTH_USER_ID");
      if (!phone) throw new ApiError(400, "INVALID_EGYPTIAN_PHONE");
      if (displayName.length < 2 || displayName.length > 80) throw new ApiError(400, "INVALID_DISPLAY_NAME");
      if (kind === "owner" && (legalName.length < 2 || legalName.length > 150)) {
        throw new ApiError(400, "INVALID_LEGAL_NAME");
      }

      const authResult = await client.query(
        'SELECT id, email, name FROM neon_auth."user" WHERE id = $1::uuid FOR SHARE',
        [authUserId]
      );
      if (!authResult.rows.length) throw new ApiError(404, "AUTH_USER_NOT_FOUND");
      const authUser = authResult.rows[0];
      if (phoneFromInternalEmail(authUser.email) !== phone) {
        throw new ApiError(409, "AUTH_PHONE_IDENTITY_MISMATCH");
      }

      const profileResult = await client.query(
        "SELECT id, auth_user_id, phone_e164 FROM public.users WHERE phone_e164 = $1 OR auth_user_id = $2::uuid FOR UPDATE",
        [phone, authUserId]
      );
      let profile;
      if (profileResult.rows.length) {
        if (profileResult.rows.length > 1) throw new ApiError(409, "PROFILE_IDENTITY_CONFLICT");
        profile = profileResult.rows[0];
        if (profile.phone_e164 !== phone) throw new ApiError(409, "PROFILE_IDENTITY_CONFLICT");
        if (profile.auth_user_id && profile.auth_user_id !== authUserId) {
          throw new ApiError(409, "PHONE_ALREADY_LINKED");
        }
        await client.query(
          `UPDATE public.users
              SET auth_user_id = $2::uuid, display_name = $3, email = $4,
                  is_active = true, updated_at = now()
            WHERE id = $1`,
          [profile.id, authUserId, displayName, authUser.email]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO public.users (auth_user_id, phone_e164, display_name, email)
           VALUES ($1::uuid, $2, $3, $4)
           RETURNING id`,
          [authUserId, phone, displayName, authUser.email]
        );
        profile = { id: inserted.rows[0].id };
      }

      await client.query(
        "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, $2::public.user_role) ON CONFLICT DO NOTHING",
        [profile.id, kind]
      );

      let entity;
      if (kind === "owner") {
        const ownerKind = String(req.body?.ownerKind || "independent_owner");
        if (!["fleet_partner", "independent_owner", "premium_partner"].includes(ownerKind)) {
          throw new ApiError(400, "INVALID_OWNER_KIND");
        }
        const ownerResult = await client.query(
          `INSERT INTO public.owners (user_id, kind, legal_name, onboarding_status)
           VALUES ($1::uuid, $2::public.owner_kind, $3, 'pending')
           ON CONFLICT (user_id) DO UPDATE
             SET kind = EXCLUDED.kind, legal_name = EXCLUDED.legal_name
           RETURNING id, user_id, kind, legal_name, onboarding_status, created_at`,
          [profile.id, ownerKind, legalName]
        );
        entity = ownerResult.rows[0];
      } else {
        const driverResult = await client.query(
          `INSERT INTO public.drivers (user_id, verification_status, active)
           VALUES ($1::uuid, 'pending', true)
           ON CONFLICT (user_id) DO UPDATE
             SET active = true
           RETURNING id, user_id, verification_status, active, created_at`,
          [profile.id]
        );
        entity = driverResult.rows[0];
      }

      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [actor.id, `admin.create_${kind}`, kind === "owner" ? "owners" : "drivers", entity.id,
          JSON.stringify({ userId: profile.id, authUserId, phone, displayName, status: kind === "owner" ? entity.onboarding_status : entity.verification_status })]
      );

      await client.query("COMMIT");
      return res.status(201).json({ ok: true, kind, person: entity, userId: profile.id });
    }

    const kind = String(req.body?.kind || "");
    const id = String(req.body?.id || "");
    const status = String(req.body?.status || "");
    const active = req.body?.active;
    if (!["owner", "driver"].includes(kind) || !UUID.test(id)) {
      throw new ApiError(400, "INVALID_PERSON_INPUT");
    }

    let before;
    let after;
    let userId;
    if (kind === "owner") {
      if (!["pending", "approved", "rejected", "suspended"].includes(status)) {
        throw new ApiError(400, "INVALID_OWNER_STATUS");
      }
      if (status === "approved") {
        const contract = await client.query(
          "SELECT 1 FROM public.owner_contracts WHERE owner_id=$1::uuid AND status='approved' AND (valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date) LIMIT 1",
          [id]
        );
        if (!contract.rows.length) throw new ApiError(409, "OWNER_CONTRACT_REQUIRED");
      }
      const selected = await client.query("SELECT * FROM public.owners WHERE id = $1::uuid FOR UPDATE", [id]);
      if (!selected.rows.length) throw new ApiError(404, "OWNER_NOT_FOUND");
      before = selected.rows[0];
      userId = before.user_id;
      const updated = await client.query(
        "UPDATE public.owners SET onboarding_status=$2 WHERE id=$1::uuid RETURNING *",
        [id, status]
      );
      after = updated.rows[0];
    } else {
      if (status && !["pending", "verified", "rejected", "suspended"].includes(status)) {
        throw new ApiError(400, "INVALID_DRIVER_STATUS");
      }
      if (status === "verified") {
        const docs = await client.query(
          `SELECT document_type, expires_on, review_status,
                  (expires_on IS NULL OR expires_on >= current_date) AS not_expired
             FROM public.driver_documents
            WHERE driver_id=$1::uuid`,
          [id]
        );
        const valid = docs.rows.filter(doc => doc.review_status === "approved" && doc.not_expired);
        const types = new Set(valid.map(doc => doc.document_type));
        if (!types.has("driving_license") || !types.has("national_id")) {
          throw new ApiError(409, "DRIVER_DOCUMENTS_REQUIRED");
        }
      }
      const selected = await client.query("SELECT * FROM public.drivers WHERE id = $1::uuid FOR UPDATE", [id]);
      if (!selected.rows.length) throw new ApiError(404, "DRIVER_NOT_FOUND");
      before = selected.rows[0];
      userId = before.user_id;
      const updated = await client.query(
        `UPDATE public.drivers
            SET verification_status = COALESCE(NULLIF($2, ''), verification_status),
                active = COALESCE($3::boolean, active)
          WHERE id = $1::uuid RETURNING *`,
        [id, status, typeof active === "boolean" ? active : null]
      );
      after = updated.rows[0];
    }

    if (typeof active === "boolean") {
      await client.query("UPDATE public.users SET is_active=$2, updated_at=now() WHERE id=$1", [userId, active]);
    }

    await client.query(
      `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [actor.id, `admin.update_${kind}`, kind === "owner" ? "owners" : "drivers", id,
        JSON.stringify(before), JSON.stringify(after)]
    );
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, kind, person: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return res.status(409).json({ ok: false, code: "PHONE_ALREADY_LINKED" });
    return sendApiError(res, error, "ADMIN_PERSON_SAVE_FAILED");
  } finally {
    client?.release();
  }
}
