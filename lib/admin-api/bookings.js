import { getPool } from "../db.js";
import { requireRole, sendApiError } from "../auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  try {
    await requireRole(req, ["admin", "operations_admin"]);
    const result = await getPool().query(
      `SELECT
         b.id, b.booking_code, b.status, b.occasion, b.pickup_address,
         b.destination_address, b.scheduled_start, b.quote_total_minor,
         b.quote_currency, b.payment_method, b.created_at,
         customer.display_name AS customer_name,
         customer.phone_e164 AS customer_phone,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id', bi.id,
               'vehicleId', bi.vehicle_id,
               'vehicleMake', v.make,
               'vehicleModel', v.model,
               'plateNumber', v.plate_number,
               'ownerId', bi.owner_id,
               'ownerName', o.legal_name,
               'driverId', bi.driver_id,
               'driverName', driver_user.display_name,
               'packageName', p.name_ar,
               'serviceStartsAt', lower(bi.service_period),
               'serviceEndsAt', upper(bi.service_period),
               'itemTotalMinor', bi.item_total_minor,
               'commissionMinor', bi.commission_minor
             ) ORDER BY bi.id
           ) FILTER (WHERE bi.id IS NOT NULL),
           '[]'::jsonb
         ) AS items
       FROM public.bookings b
       JOIN public.users customer ON customer.id=b.customer_id
       LEFT JOIN public.booking_items bi ON bi.booking_id=b.id
       LEFT JOIN public.vehicles v ON v.id=bi.vehicle_id
       LEFT JOIN public.owners o ON o.id=bi.owner_id
       LEFT JOIN public.packages p ON p.id=bi.package_id
       LEFT JOIN public.drivers d ON d.id=bi.driver_id
       LEFT JOIN public.users driver_user ON driver_user.id=d.user_id
       GROUP BY b.id, customer.id
       ORDER BY b.scheduled_start DESC, b.created_at DESC
       LIMIT 150`
    );

    return res.status(200).json({ ok: true, bookings: result.rows });
  } catch (error) {
    return sendApiError(res, error, "ADMIN_BOOKINGS_LOAD_FAILED");
  }
}
