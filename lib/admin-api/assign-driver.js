import { getPool } from "../db.js";
import { requireRole, sendApiError, ApiError } from "../auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  let client;
  try {
    const actor = await requireRole(req, ["admin", "operations_admin"]);
    const bookingItemId = String(req.body?.bookingItemId || "");
    const driverId = String(req.body?.driverId || "");
    const reason = String(req.body?.reason || "").trim().slice(0, 300) || null;
    if (!UUID.test(bookingItemId) || !UUID.test(driverId)) throw new ApiError(400, "INVALID_ASSIGNMENT_INPUT");

    client = await getPool().connect();
    await client.query("BEGIN");

    const itemResult = await client.query(
      `SELECT bi.id, bi.booking_id, bi.vehicle_id, bi.service_period, bi.driver_id,
              b.status AS booking_status, b.booking_code
         FROM public.booking_items bi
         JOIN public.bookings b ON b.id=bi.booking_id
        WHERE bi.id=$1::uuid
        FOR UPDATE OF bi,b`,
      [bookingItemId]
    );
    if (!itemResult.rows.length) throw new ApiError(404, "BOOKING_ITEM_NOT_FOUND");
    const item = itemResult.rows[0];
    if (!["confirmed", "driver_assigned", "ready"].includes(item.booking_status)) {
      throw new ApiError(409, "BOOKING_NOT_READY_FOR_DRIVER_ASSIGNMENT");
    }

    const driverResult = await client.query(
      `SELECT d.id, d.user_id, d.active, d.verification_status, u.is_active
         FROM public.drivers d JOIN public.users u ON u.id=d.user_id
        WHERE d.id=$1::uuid FOR UPDATE OF d,u`,
      [driverId]
    );
    if (!driverResult.rows.length) throw new ApiError(404, "DRIVER_NOT_FOUND");
    const driver = driverResult.rows[0];
    if (!driver.active || !driver.is_active || driver.verification_status !== "verified") {
      throw new ApiError(409, "DRIVER_NOT_VERIFIED_OR_INACTIVE");
    }

    const conflict = await client.query(
      `SELECT 1
         FROM public.driver_assignments da
         JOIN public.booking_items other_item ON other_item.id=da.booking_item_id
         JOIN public.bookings other_booking ON other_booking.id=other_item.booking_id
        WHERE da.driver_id=$1::uuid
          AND da.unassigned_at IS NULL
          AND other_item.id <> $2::uuid
          AND other_booking.status IN ('confirmed','driver_assigned','ready','in_progress')
          AND other_item.service_period && $3::tstzrange
        LIMIT 1`,
      [driverId, bookingItemId, item.service_period]
    );
    if (conflict.rows.length) throw new ApiError(409, "DRIVER_SCHEDULE_CONFLICT");

    await client.query(
      "UPDATE public.driver_assignments SET unassigned_at=now(), reason=COALESCE(reason,'إعادة تعيين') WHERE booking_item_id=$1::uuid AND unassigned_at IS NULL",
      [bookingItemId]
    );
    await client.query(
      "UPDATE public.booking_items SET driver_id=$2::uuid WHERE id=$1::uuid",
      [bookingItemId, driverId]
    );
    const assignment = await client.query(
      `INSERT INTO public.driver_assignments (booking_item_id,driver_id,assigned_by,reason)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4)
       RETURNING id, booking_item_id, driver_id, assigned_at`,
      [bookingItemId, driverId, actor.id, reason]
    );

    const remaining = await client.query(
      "SELECT count(*)::int AS count FROM public.booking_items WHERE booking_id=$1::uuid AND driver_id IS NULL",
      [item.booking_id]
    );
    let bookingStatus = item.booking_status;
    if (remaining.rows[0].count === 0 && ["confirmed", "driver_assigned"].includes(bookingStatus)) {
      await client.query("UPDATE public.bookings SET status='driver_assigned',updated_at=now() WHERE id=$1::uuid", [item.booking_id]);
      if (bookingStatus !== "driver_assigned") {
        await client.query(
          `INSERT INTO public.booking_events (booking_id,from_status,to_status,actor_user_id,reason)
           VALUES ($1::uuid,$2::booking_status,'driver_assigned',$3::uuid,'اكتمل إسناد السائق من لوحة الإدارة')`,
          [item.booking_id, bookingStatus, actor.id]
        );
      }
      bookingStatus = "driver_assigned";
    }

    await client.query(
      `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'admin.assign_driver','driver_assignments',$2,$3::jsonb)`,
      [actor.id, assignment.rows[0].id, JSON.stringify({
        bookingItemId, bookingCode: item.booking_code, driverId, bookingStatus, reason
      })]
    );

    await client.query("COMMIT");
    return res.status(200).json({ ok: true, assignment: assignment.rows[0], bookingStatus });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return sendApiError(res, error, "DRIVER_ASSIGNMENT_FAILED");
  } finally {
    client?.release();
  }
}
