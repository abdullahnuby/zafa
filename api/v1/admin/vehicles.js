import { getPool } from "../../../lib/db.js";
import { requireRole, sendApiError, ApiError } from "../../../lib/auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKAGE_CODES = ["mini", "classic", "wedding", "royal"];

function text(value, max) {
  const v = String(value ?? "").trim();
  return v.length <= max ? v : v.slice(0, max);
}

function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
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
      const make = text(req.body?.make, 80);
      const model = text(req.body?.model, 100);
      const plate = text(req.body?.plateNumber, 40).toUpperCase();
      const year = Number(req.body?.modelYear);
      const seats = Number(req.body?.seats);
      const transmission = text(req.body?.transmission, 40) || null;
      const zones = Array.isArray(req.body?.serviceZones)
        ? [...new Set(req.body.serviceZones.map(x => text(x, 60)).filter(Boolean))].slice(0, 12)
        : [];
      const prices = req.body?.prices && typeof req.body.prices === "object" ? req.body.prices : {};
      const imageUrl = safeHttpsUrl(req.body?.imageUrl);
      const schedule = Array.isArray(req.body?.schedule) ? req.body.schedule : [];
      const submitForReview = req.body?.submitForReview === true;
      const ownerId = String(req.body?.ownerId || "");
      const companyFleet = req.body?.companyFleet === true;

      if (make.length < 2 || model.length < 1 || !plate || plate.length > 40) {
        throw new ApiError(400, "INVALID_VEHICLE_DETAILS");
      }
      if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new ApiError(400, "INVALID_MODEL_YEAR");
      if (!Number.isInteger(seats) || seats < 2 || seats > 12) throw new ApiError(400, "INVALID_SEAT_COUNT");
      if (!zones.length) throw new ApiError(400, "SERVICE_ZONES_REQUIRED");
      const parsedPrices = {};
      for (const code of PACKAGE_CODES) {
        const amount = prices[code] === undefined || prices[code] === null || prices[code] === ""
          ? 0
          : Number(prices[code]);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
          throw new ApiError(400, "INVALID_VEHICLE_PRICE");
        }
        parsedPrices[code] = Math.round(amount * 100);
      }
      if (parsedPrices.classic < 1) throw new ApiError(400, "CLASSIC_PRICE_REQUIRED");

      let selectedOwnerId = ownerId;
      if (companyFleet) {
        const ownerResult = await client.query(
          `INSERT INTO public.owners (user_id, kind, legal_name, onboarding_status)
           VALUES ($1, 'fleet_partner'::public.owner_kind, 'أسطول زفّة', 'approved')
           ON CONFLICT (user_id) DO UPDATE
             SET kind='fleet_partner'::public.owner_kind,
                 onboarding_status='approved'
           RETURNING id`,
          [actor.id]
        );
        selectedOwnerId = ownerResult.rows[0].id;
      } else if (!UUID.test(selectedOwnerId)) {
        throw new ApiError(400, "VEHICLE_OWNER_REQUIRED");
      }

      const ownerResult = await client.query(
        "SELECT id, onboarding_status FROM public.owners WHERE id=$1::uuid FOR SHARE",
        [selectedOwnerId]
      );
      if (!ownerResult.rows.length) throw new ApiError(404, "OWNER_NOT_FOUND");

      const status = submitForReview ? "pending" : "draft";
      const inserted = await client.query(
        `INSERT INTO public.vehicles
          (owner_id, make, model, model_year, plate_number, seats, transmission,
           service_zones, approval_status, driver_included)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,'${status}'::public.vehicle_approval,true)
         RETURNING id, owner_id, make, model, model_year, plate_number, seats,
                   transmission, service_zones, approval_status, created_at`,
        [selectedOwnerId, make, model, year, plate, seats, transmission, zones]
      );
      const vehicle = inserted.rows[0];

      const packageRows = await client.query(
        "SELECT id, code FROM public.packages WHERE code = ANY($1::text[]) AND active = true",
        [PACKAGE_CODES]
      );
      const packageIds = Object.fromEntries(packageRows.rows.map(row => [row.code, row.id]));
      for (const code of PACKAGE_CODES) {
        if (parsedPrices[code] > 0 && packageIds[code]) {
          await client.query(
            "INSERT INTO public.vehicle_prices (vehicle_id, package_id, amount_minor, currency) VALUES ($1::uuid,$2::uuid,$3,'EGP')",
            [vehicle.id, packageIds[code], parsedPrices[code]]
          );
        }
      }

      if (req.body?.imageUrl && !imageUrl) throw new ApiError(400, "INVALID_IMAGE_URL");
      if (imageUrl) {
        await client.query(
          "INSERT INTO public.vehicle_media (vehicle_id, storage_key, media_type, sort_order, approved) VALUES ($1::uuid,$2,'photo',0,true)",
          [vehicle.id, imageUrl]
        );
      }

      const documents = Array.isArray(req.body?.documents) ? req.body.documents.slice(0, 8) : [];
      for (const document of documents) {
        const documentType = text(document?.documentType, 80);
        const documentUrl = safeHttpsUrl(document?.url);
        const expiresOn = document?.expiresOn || null;
        if (!documentType || !documentUrl || (expiresOn && !/^\\d{4}-\\d{2}-\\d{2}$/.test(expiresOn))) {
          throw new ApiError(400, "INVALID_VEHICLE_DOCUMENT");
        }
        await client.query(
          `INSERT INTO public.vehicle_documents
            (vehicle_id,document_type,storage_key,expires_on,review_status)
           VALUES ($1::uuid,$2,$3,$4::date,'pending')`,
          [vehicle.id, documentType, documentUrl, expiresOn]
        );
      }

      for (const rule of schedule.slice(0, 7)) {
        const weekday = Number(rule.weekday);
        const startTime = String(rule.startTime || "");
        const endTime = String(rule.endTime || "");
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
            !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startTime) ||
            !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endTime) ||
            startTime >= endTime) {
          throw new ApiError(400, "INVALID_AVAILABILITY_RULE");
        }
        await client.query(
          `INSERT INTO public.vehicle_availability_rules
            (vehicle_id, weekday, start_time, end_time, timezone, active)
           VALUES ($1::uuid,$2,$3::time,$4::time,'Africa/Cairo',true)`,
          [vehicle.id, weekday, startTime, endTime]
        );
      }

      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1,'admin.create_vehicle','vehicles',$2,$3::jsonb)`,
        [actor.id, vehicle.id, JSON.stringify({
          ownerId: selectedOwnerId, make, model, year, plateNumber: plate,
          seats, zones, approvalStatus: status, prices: parsedPrices,
          hasImage: Boolean(imageUrl), weeklyRules: schedule.length
        })]
      );

      await client.query("COMMIT");
      return res.status(201).json({ ok: true, vehicle });
    }

    const action = String(req.body?.action || "");
    const vehicleId = String(req.body?.vehicleId || "");
    if (!UUID.test(vehicleId)) throw new ApiError(400, "INVALID_VEHICLE_ID");

    const currentResult = await client.query(
      `SELECT v.*, o.onboarding_status AS owner_status
         FROM public.vehicles v JOIN public.owners o ON o.id=v.owner_id
        WHERE v.id=$1::uuid FOR UPDATE OF v`,
      [vehicleId]
    );
    if (!currentResult.rows.length) throw new ApiError(404, "VEHICLE_NOT_FOUND");
    const before = currentResult.rows[0];

    if (action === "decision") {
      const decision = String(req.body?.decision || "");
      const reason = text(req.body?.reason, 500) || null;
      if (!["approved", "rejected", "suspended", "pending"].includes(decision)) {
        throw new ApiError(400, "INVALID_VEHICLE_DECISION");
      }
      if (decision === "approved") {
        if (before.owner_status !== "approved" && before.owner_kind !== "fleet_partner") {
          throw new ApiError(409, "OWNER_NOT_APPROVED");
        }
        const pendingDocs = await client.query(
          "SELECT count(*)::int AS count FROM public.vehicle_documents WHERE vehicle_id=$1::uuid AND review_status='pending'",
          [vehicleId]
        );
        if (pendingDocs.rows[0].count > 0) throw new ApiError(409, "VEHICLE_DOCUMENTS_PENDING");
        const mediaCheck = await client.query(
          "SELECT count(*)::int AS count FROM public.vehicle_media WHERE vehicle_id=$1::uuid AND approved=true",
          [vehicleId]
        );
        if (mediaCheck.rows[0].count < 1) throw new ApiError(409, "VEHICLE_PHOTO_REQUIRED");
      }
      const updated = await client.query(
        "UPDATE public.vehicles SET approval_status=$2::public.vehicle_approval, updated_at=now() WHERE id=$1::uuid RETURNING *",
        [vehicleId, decision]
      );
      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1,$2,'vehicles',$3,$4::jsonb,$5::jsonb)`,
        [actor.id, `admin.vehicle_${decision}`, vehicleId,
          JSON.stringify({ approvalStatus: before.approval_status, reason }),
          JSON.stringify({ approvalStatus: updated.rows[0].approval_status, reason })]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, vehicle: updated.rows[0] });
    }

    if (action === "update") {
      const make = req.body?.make === undefined ? before.make : text(req.body.make, 80);
      const model = req.body?.model === undefined ? before.model : text(req.body.model, 100);
      const year = req.body?.modelYear === undefined ? before.model_year : Number(req.body.modelYear);
      const plate = req.body?.plateNumber === undefined ? before.plate_number : text(req.body.plateNumber, 40).toUpperCase();
      const seats = req.body?.seats === undefined ? before.seats : Number(req.body.seats);
      const transmission = req.body?.transmission === undefined ? before.transmission : text(req.body.transmission, 40);
      const zones = req.body?.serviceZones === undefined ? before.service_zones :
        [...new Set((req.body.serviceZones || []).map(x => text(x,60)).filter(Boolean))].slice(0,12);
      if (!make || !model || !plate || !Number.isInteger(year) || year < 1990 || year > 2100 ||
          !Number.isInteger(seats) || seats < 2 || seats > 12 || !zones.length) {
        throw new ApiError(400, "INVALID_VEHICLE_DETAILS");
      }
      const updated = await client.query(
        `UPDATE public.vehicles
            SET make=$2, model=$3, model_year=$4, plate_number=$5, seats=$6,
                transmission=$7, service_zones=$8, updated_at=now()
          WHERE id=$1::uuid RETURNING *`,
        [vehicleId, make, model, year, plate, seats, transmission, zones]
      );

      if (req.body?.prices && typeof req.body.prices === "object") {
        const packageRows = await client.query("SELECT id, code FROM public.packages WHERE code=ANY($1::text[]) AND active=true", [PACKAGE_CODES]);
        const packageIds = Object.fromEntries(packageRows.rows.map(row => [row.code,row.id]));
        for (const code of PACKAGE_CODES) {
          if (req.body.prices[code] === undefined || req.body.prices[code] === "") continue;
          const amount = Number(req.body.prices[code]);
          if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new ApiError(400, "INVALID_VEHICLE_PRICE");
          const minor = Math.round(amount * 100);
          const existing = await client.query(
            "SELECT id FROM public.vehicle_prices WHERE vehicle_id=$1::uuid AND package_id=$2::uuid AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1 FOR UPDATE",
            [vehicleId, packageIds[code]]
          );
          if (existing.rows.length) {
            await client.query("UPDATE public.vehicle_prices SET amount_minor=$2 WHERE id=$1::uuid", [existing.rows[0].id, minor]);
          } else if (minor > 0 && packageIds[code]) {
            await client.query("INSERT INTO public.vehicle_prices (vehicle_id,package_id,amount_minor,currency) VALUES ($1::uuid,$2::uuid,$3,'EGP')", [vehicleId, packageIds[code], minor]);
          }
        }
      }

      if (req.body?.imageUrl !== undefined) {
        const imageUrl = safeHttpsUrl(req.body.imageUrl);
        if (req.body.imageUrl && !imageUrl) throw new ApiError(400, "INVALID_IMAGE_URL");
        await client.query("DELETE FROM public.vehicle_media WHERE vehicle_id=$1::uuid", [vehicleId]);
        if (imageUrl) {
          await client.query(
            "INSERT INTO public.vehicle_media (vehicle_id,storage_key,media_type,sort_order,approved) VALUES ($1::uuid,$2,'photo',0,true)",
            [vehicleId, imageUrl]
          );
        }
      }

      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1,'admin.update_vehicle','vehicles',$2,$3::jsonb,$4::jsonb)`,
        [actor.id, vehicleId,
          JSON.stringify({ make: before.make, model: before.model, modelYear: before.model_year, plateNumber: before.plate_number, approvalStatus: before.approval_status }),
          JSON.stringify({ make, model, modelYear: year, plateNumber: plate, approvalStatus: before.approval_status })]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, vehicle: updated.rows[0] });
    }

    throw new ApiError(400, "INVALID_VEHICLE_ACTION");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return res.status(409).json({ ok: false, code: "DUPLICATE_PLATE_NUMBER" });
    if (error?.code === "23P01") return res.status(409).json({ ok: false, code: "AVAILABILITY_CONFLICT" });
    return sendApiError(res, error, "ADMIN_VEHICLE_SAVE_FAILED");
  } finally {
    client?.release();
  }
}
