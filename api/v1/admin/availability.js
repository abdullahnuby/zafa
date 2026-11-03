import { getPool } from "../../../lib/db.js";
import { requireRole, sendApiError, ApiError } from "../../../lib/auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME = /^([01]\\d|2[0-3]):[0-5]\\d$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  let client;

  try {
    const actor = await requireRole(req, ["admin", "operations_admin"]);
    if (req.method !== "POST" && req.method !== "DELETE") {
      res.setHeader("Allow", "POST, DELETE");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }

    client = await getPool().connect();
    await client.query("BEGIN");

    if (req.method === "POST") {
      const kind = String(req.body?.kind || "");
      const vehicleId = String(req.body?.vehicleId || "");
      if (!UUID.test(vehicleId)) throw new ApiError(400, "INVALID_VEHICLE_ID");
      const vehicle = await client.query("SELECT id FROM public.vehicles WHERE id=$1::uuid FOR SHARE", [vehicleId]);
      if (!vehicle.rows.length) throw new ApiError(404, "VEHICLE_NOT_FOUND");

      if (kind === "rule") {
        const weekdays = Array.isArray(req.body?.weekdays)
          ? [...new Set(req.body.weekdays.map(Number))]
          : [Number(req.body?.weekday)];
        const startTime = String(req.body?.startTime || "");
        const endTime = String(req.body?.endTime || "");
        const validFrom = req.body?.validFrom || null;
        const validTo = req.body?.validTo || null;
        if (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
          throw new ApiError(400, "INVALID_WEEKDAYS");
        }
        if (!TIME.test(startTime) || !TIME.test(endTime) || startTime >= endTime) {
          throw new ApiError(400, "INVALID_TIME_RANGE");
        }
        if (validFrom && !/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom)) throw new ApiError(400, "INVALID_VALID_FROM");
        if (validTo && !/^\\d{4}-\\d{2}-\\d{2}$/.test(validTo)) throw new ApiError(400, "INVALID_VALID_TO");
        if (validFrom && validTo && validTo < validFrom) throw new ApiError(400, "INVALID_VALIDITY_PERIOD");

        const rows = [];
        for (const weekday of weekdays) {
          const inserted = await client.query(
            `INSERT INTO public.vehicle_availability_rules
              (vehicle_id, weekday, start_time, end_time, timezone, valid_from, valid_to, active)
             VALUES ($1::uuid,$2,$3::time,$4::time,'Africa/Cairo',$5::date,$6::date,true)
             RETURNING *`,
            [vehicleId, weekday, startTime, endTime, validFrom, validTo]
          );
          rows.push(inserted.rows[0]);
        }
        await client.query(
          `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
           VALUES($1,'admin.create_availability_rule','vehicles',$2,$3::jsonb)`,
          [actor.id, vehicleId, JSON.stringify({ weekdays, startTime, endTime, validFrom, validTo })]
        );
        await client.query("COMMIT");
        return res.status(201).json({ ok: true, rules: rows });
      }

      if (kind === "block") {
        const start = new Date(req.body?.startsAt);
        const end = new Date(req.body?.endsAt);
        const reason = String(req.body?.reason || "").trim().slice(0, 240);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
            end.getTime() <= start.getTime() || !reason) {
          throw new ApiError(400, "INVALID_AVAILABILITY_BLOCK");
        }
        const inserted = await client.query(
          `INSERT INTO public.availability_blocks (vehicle_id, period, reason, created_by)
           VALUES ($1::uuid, tstzrange($2::timestamptz,$3::timestamptz,'[)'), $4, $5)
           RETURNING id, vehicle_id, lower(period) AS starts_at, upper(period) AS ends_at, reason`,
          [vehicleId, start.toISOString(), end.toISOString(), reason, actor.id]
        );
        await client.query(
          `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
           VALUES($1,'admin.create_availability_block','availability_blocks',$2,$3::jsonb)`,
          [actor.id, inserted.rows[0].id, JSON.stringify(inserted.rows[0])]
        );
        await client.query("COMMIT");
        return res.status(201).json({ ok: true, block: inserted.rows[0] });
      }

      throw new ApiError(400, "INVALID_AVAILABILITY_KIND");
    }

    const kind = String(req.body?.kind || "");
    const id = String(req.body?.id || "");
    if (!UUID.test(id) || !["rule", "block"].includes(kind)) {
      throw new ApiError(400, "INVALID_AVAILABILITY_ID");
    }
    const table = kind === "rule" ? "vehicle_availability_rules" : "availability_blocks";
    const selected = await client.query(`SELECT * FROM public.${table} WHERE id=$1::uuid FOR UPDATE`, [id]);
    if (!selected.rows.length) throw new ApiError(404, "AVAILABILITY_RECORD_NOT_FOUND");
    await client.query(`DELETE FROM public.${table} WHERE id=$1::uuid`, [id]);
    await client.query(
      `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [actor.id, `admin.delete_availability_${kind}`, table, id, JSON.stringify(selected.rows[0])]
    );
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, deleted: id });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23P01") return res.status(409).json({ ok: false, code: "AVAILABILITY_CONFLICT" });
    return sendApiError(res, error, "ADMIN_AVAILABILITY_SAVE_FAILED");
  } finally {
    client?.release();
  }
}
