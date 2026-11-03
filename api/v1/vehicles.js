import { getPool } from "../../lib/db.js";
import { getPublicVehiclePhotoUrl } from "../../lib/storage.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  try {
    const { rows } = await getPool().query(`
      SELECT
        v.id,
        o.id AS owner_id,
        v.make AS brand,
        v.model,
        v.model_year AS year,
        v.seats,
        v.transmission,
        v.service_zones,
        v.driver_included,
        o.kind AS owner_type,
        (SELECT COALESCE(jsonb_agg(photo.storage_key ORDER BY photo.sort_order,photo.id),'[]'::jsonb)
           FROM (
             SELECT vm.id,vm.storage_key,vm.sort_order
               FROM public.vehicle_media vm
              WHERE vm.vehicle_id=v.id AND vm.approved=true
              ORDER BY vm.sort_order,vm.id
              LIMIT 3
           ) photo) AS image_keys,
        COALESCE((
          SELECT jsonb_object_agg(p.code, round(vp.amount_minor::numeric / 100, 2))
          FROM public.vehicle_prices vp
          JOIN public.packages p ON p.id = vp.package_id AND p.active = true
          WHERE vp.vehicle_id = v.id
            AND vp.valid_from <= now()
            AND (vp.valid_to IS NULL OR vp.valid_to > now())
        ), '{}'::jsonb) AS package_prices
      FROM public.vehicles v
      JOIN public.owners o ON o.id = v.owner_id
      WHERE v.approval_status = 'approved'
        AND o.onboarding_status = 'approved'
        AND v.driver_included = true
      ORDER BY v.created_at DESC
      LIMIT 100
    `);

    const vehicles = rows.map(vehicle => {
      const imageUrls = (vehicle.image_keys || [])
        .map(getPublicVehiclePhotoUrl)
        .filter(Boolean);
      return {
        ...vehicle,
        image_urls: imageUrls,
        image_url: imageUrls[0] || null
      };
    });

    return res.status(200).json({
      ok: true,
      count: vehicles.length,
      vehicles
    });
  } catch (error) {
    console.error("[ZAFFA API] public vehicle query failed", {
      code: error?.code || "UNKNOWN"
    });
    return res.status(503).json({ ok: false, code: "CATALOG_UNAVAILABLE" });
  }
}
