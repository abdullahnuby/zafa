import { getPool } from "../db.js";
import { requireRole, sendApiError } from "../auth.js";
import { getPublicVehiclePhotoUrl } from "../storage.js";

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
               o.created_at, u.id AS user_id, u.auth_user_id, u.display_name, u.phone_e164,
               u.email, u.is_active,
               count(DISTINCT v.id)::int AS vehicle_count,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id',oc.id,'contractVersion',oc.contract_version,'url',oc.storage_key,
                  'validFrom',oc.valid_from,'validTo',oc.valid_to,'status',oc.status
                ) ORDER BY oc.created_at DESC),'[]'::jsonb)
                  FROM public.owner_contracts oc WHERE oc.owner_id=o.id) AS contracts
          FROM public.owners o
          JOIN public.users u ON u.id = o.user_id
          LEFT JOIN public.vehicles v ON v.owner_id = o.id
         GROUP BY o.id, u.id
         ORDER BY o.created_at DESC
      `),
      pool.query(`
        SELECT d.id, d.user_id, d.verification_status, d.active, d.created_at,
               u.auth_user_id, u.display_name, u.phone_e164, u.email, u.is_active,
               count(DISTINCT dd.id)::int AS document_count,
               count(DISTINCT dd.id) FILTER (WHERE dd.review_status = 'pending')::int AS pending_documents,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id',dd2.id,'documentType',dd2.document_type,'url',dd2.storage_key,
                  'expiresOn',dd2.expires_on,'reviewStatus',dd2.review_status
                ) ORDER BY dd2.created_at DESC),'[]'::jsonb)
                  FROM public.driver_documents dd2 WHERE dd2.driver_id=d.id) AS documents
          FROM public.drivers d
          JOIN public.users u ON u.id = d.user_id
          LEFT JOIN public.driver_documents dd ON dd.driver_id = d.id
         GROUP BY d.id, u.id
         ORDER BY d.created_at DESC
      `),
      pool.query(`
        SELECT v.id, v.owner_id, v.default_driver_id, v.make, v.model, v.model_year, v.plate_number,
               v.seats, v.transmission, v.service_zones, v.approval_status,
               v.driver_included, v.created_at, v.updated_at,
               assigned_driver.display_name AS default_driver_name,
               assigned_driver.phone_e164 AS default_driver_phone,
               assigned_driver.auth_user_id AS default_driver_auth_user_id,
               assigned_driver.is_active AS default_driver_user_active,
               driver_profile.verification_status AS default_driver_status,
               driver_profile.active AS default_driver_active,
               o.legal_name AS owner_name, o.kind AS owner_kind, o.onboarding_status AS owner_status,
               COALESCE((
                 SELECT jsonb_object_agg(p.code, round(vp.amount_minor::numeric / 100, 2))
                   FROM public.vehicle_prices vp
                   JOIN public.packages p ON p.id = vp.package_id AND p.active = true
                  WHERE vp.vehicle_id = v.id
                    AND vp.valid_from <= now()
                    AND (vp.valid_to IS NULL OR vp.valid_to > now())
               ), '{}'::jsonb) AS package_prices,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', photo.id,
                  'storageKey', photo.storage_key,
                  'sortOrder', photo.sort_order,
                  'approved', photo.approved
                ) ORDER BY photo.sort_order, photo.id),'[]'::jsonb)
                  FROM (
                    SELECT vm.id,vm.storage_key,vm.sort_order,vm.approved
                      FROM public.vehicle_media vm
                     WHERE vm.vehicle_id=v.id
                     ORDER BY vm.sort_order,vm.id
                     LIMIT 3
                  ) photo) AS images,
               (SELECT count(*)::int FROM public.vehicle_documents vd WHERE vd.vehicle_id = v.id) AS document_count,
               (SELECT count(*)::int FROM public.vehicle_documents vd
                 WHERE vd.vehicle_id = v.id AND vd.review_status = 'pending') AS pending_documents,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id',vd2.id,'documentType',vd2.document_type,'url',vd2.storage_key,
                  'expiresOn',vd2.expires_on,'reviewStatus',vd2.review_status
                ) ORDER BY vd2.created_at DESC),'[]'::jsonb)
                  FROM public.vehicle_documents vd2 WHERE vd2.vehicle_id=v.id) AS documents
          FROM public.vehicles v
          JOIN public.owners o ON o.id = v.owner_id
          LEFT JOIN public.drivers driver_profile ON driver_profile.id=v.default_driver_id
          LEFT JOIN public.users assigned_driver ON assigned_driver.id=driver_profile.user_id
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
      vehicles: vehicles.rows.map(vehicle => {
        const images = (vehicle.images || []).map(photo => ({
          ...photo,
          url: getPublicVehiclePhotoUrl(photo.storageKey)
        }));
        return {
          ...vehicle,
          images,
          image_url: images.find(photo => photo.approved)?.url || null
        };
      }),
      availabilityRules: rules.rows,
      availabilityBlocks: blocks.rows,
      packages: packages.rows
    });
  } catch (error) {
    return sendApiError(res, error, "ADMIN_FLEET_LOAD_FAILED");
  }
}
