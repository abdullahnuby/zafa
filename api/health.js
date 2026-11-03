import { getPool } from "../lib/db.js";

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
        current_database() AS database,
        (SELECT count(*)::int FROM public.packages WHERE active = true) AS active_packages,
        (SELECT count(*)::int FROM public.vehicles WHERE approval_status = 'approved') AS approved_vehicles
    `);
    return res.status(200).json({
      ok: true,
      service: "zaffa-api",
      database: rows[0].database,
      activePackages: rows[0].active_packages,
      approvedVehicles: rows[0].approved_vehicles,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("[ZAFFA API] Neon health check failed", {
      code: error?.code || "UNKNOWN"
    });
    return res.status(503).json({
      ok: false,
      code: error?.code === "DATABASE_URL_MISSING"
        ? "DATABASE_URL_MISSING"
        : "DATABASE_UNAVAILABLE"
    });
  }
}
