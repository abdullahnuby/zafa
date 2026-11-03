import { getPool } from "../db.js";
import { requireRole, sendApiError, ApiError } from "../auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function secureUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  let client;
  try {
    const actor = await requireRole(req, ["admin", "operations_admin"]);
    if (req.method !== "POST" && req.method !== "PATCH") {
      res.setHeader("Allow", "POST, PATCH");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    client = await getPool().connect();
    await client.query("BEGIN");

    if (req.method === "POST") {
      const entityType = String(req.body?.entityType || "");
      const entityId = String(req.body?.entityId || "");
      const documentType = String(req.body?.documentType || "").trim().slice(0, 80);
      const url = secureUrl(req.body?.url);
      const expiresOn = req.body?.expiresOn || null;
      if (!UUID.test(entityId) || !documentType || !url) throw new ApiError(400, "INVALID_DOCUMENT_INPUT");
      if (expiresOn && !/^\\d{4}-\\d{2}-\\d{2}$/.test(expiresOn)) throw new ApiError(400, "INVALID_DOCUMENT_EXPIRY");

      let row;
      let table;
      if (entityType === "vehicle") {
        const result = await client.query(
          `INSERT INTO public.vehicle_documents (vehicle_id,document_type,storage_key,expires_on,review_status)
           VALUES ($1::uuid,$2,$3,$4::date,'pending') RETURNING id,document_type,storage_key,expires_on,review_status`,
          [entityId, documentType, url, expiresOn]
        );
        row = result.rows[0]; table = "vehicle_documents";
      } else if (entityType === "driver") {
        const result = await client.query(
          `INSERT INTO public.driver_documents (driver_id,document_type,storage_key,expires_on,review_status)
           VALUES ($1::uuid,$2,$3,$4::date,'pending') RETURNING id,document_type,storage_key,expires_on,review_status`,
          [entityId, documentType, url, expiresOn]
        );
        row = result.rows[0]; table = "driver_documents";
      } else if (entityType === "owner") {
        const contractVersion = String(req.body?.contractVersion || "ZAFFA-OWNER-1").trim().slice(0, 80);
        const validFrom = req.body?.validFrom || null;
        const validTo = req.body?.validTo || null;
        const result = await client.query(
          `INSERT INTO public.owner_contracts
            (owner_id,contract_version,storage_key,valid_from,valid_to,status)
           VALUES ($1::uuid,$2,$3,$4::date,$5::date,'pending')
           RETURNING id,owner_id,contract_version,storage_key,valid_from,valid_to,status`,
          [entityId, contractVersion, url, validFrom, validTo]
        );
        row = result.rows[0]; table = "owner_contracts";
      } else {
        throw new ApiError(400, "INVALID_DOCUMENT_ENTITY");
      }

      await client.query(
        `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
         VALUES($1,'admin.add_document',$2,$3,$4::jsonb)`,
        [actor.id, table, row.id, JSON.stringify({ documentType, expiresOn, reviewStatus: "pending" })]
      );
      await client.query("COMMIT");
      return res.status(201).json({ ok: true, document: row });
    }

    const entityType = String(req.body?.entityType || "");
    const documentId = String(req.body?.documentId || "");
    const decision = String(req.body?.decision || "");
    if (!UUID.test(documentId) || !["approve", "reject"].includes(decision)) {
      throw new ApiError(400, "INVALID_DOCUMENT_REVIEW");
    }
    const table = entityType === "vehicle" ? "vehicle_documents" :
      entityType === "driver" ? "driver_documents" :
      entityType === "owner" ? "owner_contracts" : null;
    if (!table) throw new ApiError(400, "INVALID_DOCUMENT_ENTITY");

    const selected = await client.query(`SELECT * FROM public.${table} WHERE id=$1::uuid FOR UPDATE`, [documentId]);
    if (!selected.rows.length) throw new ApiError(404, "DOCUMENT_NOT_FOUND");
    const before = selected.rows[0];
    const reviewStatus = decision === "approve" ? "approved" : "rejected";
    const updated = table === "owner_contracts"
      ? await client.query(
          `UPDATE public.owner_contracts SET status=$2, signed_at=CASE WHEN $2='approved' THEN COALESCE(signed_at,now()) ELSE signed_at END
            WHERE id=$1::uuid RETURNING *`,
          [documentId, reviewStatus]
        )
      : await client.query(
          `UPDATE public.${table}
              SET review_status=$2, reviewed_by=$3, reviewed_at=now()
            WHERE id=$1::uuid RETURNING *`,
          [documentId, reviewStatus, actor.id]
        );
    await client.query(
      `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [actor.id, `admin.document_${decision}`, table, documentId,
        JSON.stringify({ reviewStatus: before.review_status }),
        JSON.stringify({ reviewStatus })]
    );
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, document: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return sendApiError(res, error, "ADMIN_DOCUMENT_SAVE_FAILED");
  } finally {
    client?.release();
  }
}
