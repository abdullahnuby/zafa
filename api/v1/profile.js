import { getPool } from "../../lib/db.js";
import { requireIdentity, sendApiError } from "../../lib/auth.js";

export function normalizeEgyptianPhone(value) {
  const raw = String(value || "").replace(/\D/g, "");
  let digits = raw;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20")) {}
  else if (digits.startsWith("0")) digits = "2" + digits;
  else digits = "20" + digits;
  const normalized = "+" + digits;
  return /^\+201[0125]\d{8}$/.test(normalized) ? normalized : null;
}
function response(row) {
  return { id: row.id, displayName: row.display_name, phone: row.phone_e164, email: row.email?.endsWith("@phone.zaffa.invalid") ? null : row.email, roles: row.roles || ["customer"] };
}
async function loadProfile(authUserId) {
  const { rows } = await getPool().query(
    `SELECT u.id, u.display_name, u.phone_e164, u.email,
            COALESCE(array_agg(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
       FROM public.users u LEFT JOIN public.user_roles ur ON ur.user_id = u.id
      WHERE u.auth_user_id = $1::uuid AND u.is_active = true GROUP BY u.id LIMIT 1`,
    [authUserId]
  );
  return rows[0] || null;
}
export function phoneFromInternalAuthEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const suffix = "@phone.zaffa.invalid";
  if (!value.endsWith(suffix)) return null;
  const phoneDigits = value.slice(0, -suffix.length);
  return normalizeEgyptianPhone(phoneDigits);
}
async function bootstrapProfileFromAuthIdentity(identity) {
  if (!identity.authUserId) return null;
  const authUser = await getPool().query(
    `SELECT id, email, name FROM neon_auth."user" WHERE id = $1::uuid LIMIT 1`,
    [identity.authUserId]
  );
  if (!authUser.rows.length) return null;
  const email = String(authUser.rows[0].email || "").trim().toLowerCase();
  if (identity.email && identity.email.toLowerCase() !== email) return null;
  const phone = phoneFromInternalAuthEmail(email);
  const displayName = String(identity.name || authUser.rows[0].name || "").trim();
  if (!phone || displayName.length < 2 || displayName.length > 80) return null;
  await getPool().query(
    `INSERT INTO public.users (auth_user_id, phone_e164, display_name, email)
     VALUES ($1::uuid,$2,$3,$4)
     ON CONFLICT (auth_user_id) DO NOTHING`,
    [identity.authUserId, phone, displayName, email]
  );
  const profile = await loadProfile(identity.authUserId);
  if (!profile) return null;
  await getPool().query(
    `INSERT INTO public.user_roles (user_id,role) VALUES ($1,'customer'::public.user_role)
     ON CONFLICT (user_id,role) DO NOTHING`,
    [profile.id]
  );
  return await loadProfile(identity.authUserId);
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const identity = await requireIdentity(req);
    if (req.method === "GET") {
      let profile = await loadProfile(identity.authUserId);
      if (!profile) profile = await bootstrapProfileFromAuthIdentity(identity);
      return res.status(200).json({ ok: true, profile: profile ? response(profile) : null });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const displayName = String(req.body?.displayName || "").trim();
    const phone = normalizeEgyptianPhone(req.body?.phone);
    if (displayName.length < 2 || displayName.length > 80) return res.status(400).json({ ok: false, code: "INVALID_DISPLAY_NAME" });
    if (!phone) return res.status(400).json({ ok: false, code: "INVALID_EGYPTIAN_PHONE" });
    const authUser = await getPool().query(
      `SELECT id, email FROM neon_auth."user" WHERE id = $1::uuid LIMIT 1`,
      [identity.authUserId]
    );
    if (!authUser.rows.length) return res.status(403).json({ ok: false, code: "ACCOUNT_NOT_ALLOWED" });
    const { rows } = await getPool().query(
      `INSERT INTO public.users (auth_user_id, phone_e164, display_name, email)
       VALUES ($1::uuid,$2,$3,$4)
       ON CONFLICT (auth_user_id) DO UPDATE
         SET phone_e164=EXCLUDED.phone_e164, display_name=EXCLUDED.display_name,
             email=COALESCE(EXCLUDED.email,public.users.email), updated_at=now()
       RETURNING id,display_name,phone_e164,email`,
      [identity.authUserId, phone, displayName, authUser.rows[0].email || identity.email]
    );
    await getPool().query(
      `INSERT INTO public.user_roles (user_id,role) VALUES ($1,'customer'::public.user_role)
       ON CONFLICT (user_id,role) DO NOTHING`,
      [rows[0].id]
    );
    return res.status(200).json({ ok: true, profile: response(await loadProfile(identity.authUserId)) });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ ok: false, code: "PHONE_ALREADY_LINKED" });
    return sendApiError(res, error);
  }
}
