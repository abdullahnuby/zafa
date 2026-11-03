import { getPool } from "../../../lib/db.js";
import { requireRole, sendApiError } from "../../../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  try {
    await requireRole(req, ["admin", "operations_admin"]);

    const pool = getPool();
    const [owners, drivers, vehicles, rules, blocks, packages] = await Promise.all([
      pool.query(`
        SELECT o.id, o.kind, o.legal_name, o.onboarding_status, o.contract_version,
               o.created_at, u.id AS user_id, u.display_name, u.phone_e164,
               u.email, u.is_active,
               count(DISTINCT v.id)::int AS vehicle_count
          FROM public.owners o
          JOIN public.users u ON u.id = o.user_id
          LEFT JOIN public.vehicles v ON v.owner_id = o.id
         GROUP BY o.id, u.id
         ORDER BY o.created_at DESC
      `),
      pool.query(`
        SELECT d.id, d.user_id, d.verification_status, d.active, d.created_at,
               u.display_name, u.phone_e164, u.email, u.is_active,
               count(DISTINCT dd.id)::int AS document_count,
               count(DISTINCT dd.id) FILTER (WHERE dd.review_status = 'pending')::int AS pending_documents
          FROM public.drivers d
          JOIN public.users u ON u.id = d.user_id
          LEFT JOIN public.driver_documents dd ON dd.driver_id = d.id
         GROUP BY d.id, u.id
         ORDER BY d.created_at DESC
      `),
      pool.query(`
        SELECT v.id, v.owner_id, v.make, v.model, v.model_year, v.plate_number,
               v.seats, v.transmission, v.service_zones, v.approval_status,
               v.driver_included, v.created_at, v.updated_at,
               o.legal_name AS owner_name, o.kind AS owner_kind, o.onboarding_status AS owner_status,
               COALESCE((
                 SELECT jsonb_object_agg(p.code, round(vp.amount_minor::numeric / 100, 2))
                   FROM public.vehicle_prices vp
                   JOIN public.packages p ON p.id = vp.package_id AND p.active = true
                  WHERE vp.vehicle_id = v.id
                    AND vp.valid_from <= now()
                    AND (vp.valid_to IS NULL OR vp.valid_to > now())
               ), '{}'::jsonb) AS package_prices,
               (SELECT vm.storage_key FROM public.vehicle_media vm
                 WHERE vm.vehicle_id = v.id AND vm.approved = true
                 ORDER BY vm.sort_order, vm.id LIMIT 1) AS image_url,
               (SELECT count(*)::int FROM public.vehicle_documents vd WHERE vd.vehicle_id = v.id) AS document_count,
               (SELECT count(*)::int FROM public.vehicle_documents vd
                 WHERE vd.vehicle_id = v.id AND vd.review_status = 'pending') AS pending_documents
          FROM public.vehicles v
          JOIN public.owners o ON o.id = v.owner_id
         ORDER BY v.created_at DESC
         LIMIT 250
      `),
      pool.query(`
        SELECT r.id, r.vehicle_id, r.weekday, r.start_time, r.end_time, r.timezone,
               r.valid_from, r.valid_to, r.active, v.make, v.model, v.plate_number
          FROM public.vehicle_availability_rules r
          JOIN public.vehicles v ON v.id = r.vehicle_id
         ORDER BY r.weekday, r.start_time
      `),
      pool.query(`
        SELECT b.id, b.vehicle_id, lower(b.period) AS starts_at, upper(b.period) AS ends_at,
               b.reason, b.created_by, v.make, v.model, v.plate_number
          FROM public.availability_blocks b
          JOIN public.vehicles v ON v.id = b.vehicle_id
         WHERE upper(b.period) > now()
         ORDER BY lower(b.period)
         LIMIT 250
      `),
      pool.query(`
        SELECT id, code, name_ar, duration_minutes
          FROM public.packages
         WHERE active = true
         ORDER BY duration_minutes, code
      `)
    ]);

    return res.status(200).json({
      ok: true,
      owners: owners.rows,
      drivers: drivers.rows,
      vehicles: vehicles.rows,
      availabilityRules: rules.rows,
      availabilityBlocks: blocks.rows,
      packages: packages.rows
    });
  } catch (error) {
    return sendApiError(res, error, "ADMIN_FLEET_LOAD_FAILED");
  }
}
