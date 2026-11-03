import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { requireRole, sendApiError, ApiError } from "../auth.js";
import {
  createVehiclePhotoUploadUrl,
  inspectVehiclePhoto,
  deleteVehiclePhoto,
  getPublicVehiclePhotoUrl,
  ensureVehiclePhotoBucketCors
} from "../storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

function uniqueIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}

function vehicleImage(row) {
  return {
    id: row.id,
    storageKey: row.storage_key,
    sortOrder: row.sort_order,
    approved: row.approved,
    url: getPublicVehiclePhotoUrl(row.storage_key)
  };
}

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
    const action = String(req.body?.action || "");
    const vehicleId = String(req.body?.vehicleId || "");
    if (!UUID.test(vehicleId)) throw new ApiError(400, "INVALID_VEHICLE_ID");

    if (action === "presign") await ensureVehiclePhotoBucketCors();

    client = await getPool().connect();
    await client.query("BEGIN");

    const vehicle = await client.query(
      "SELECT id FROM public.vehicles WHERE id=$1::uuid FOR UPDATE",
      [vehicleId]
    );
    if (!vehicle.rows.length) throw new ApiError(404, "VEHICLE_NOT_FOUND");

    if (action === "presign") {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      if (!files.length || files.length > MAX_PHOTOS) throw new ApiError(400, "INVALID_PHOTO_COUNT");

      const current = await client.query(
        "SELECT count(*)::int AS count, COALESCE(max(sort_order),-1)::int AS max_order FROM public.vehicle_media WHERE vehicle_id=$1::uuid",
        [vehicleId]
      );
      if (current.rows[0].count + files.length > MAX_PHOTOS) {
        throw new ApiError(409, "VEHICLE_PHOTO_LIMIT_REACHED");
      }

      const prepared = files.map((file, index) => {
        const contentType = String(file?.contentType || "");
        const extension = TYPES.get(contentType);
        const size = Number(file?.size);
        if (!extension || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) {
          throw new ApiError(400, "INVALID_VEHICLE_PHOTO_FILE");
        }
        return {
          id: randomUUID(),
          key: `vehicles/${vehicleId}/${randomUUID()}.${extension}`,
          contentType,
          sortOrder: current.rows[0].max_order + index + 1,
          size
        };
      });

      const uploads = [];
      for (const file of prepared) {
        const uploadUrl = await createVehiclePhotoUploadUrl(file.key, file.contentType, 300);
        await client.query(
          `INSERT INTO public.vehicle_media (id,vehicle_id,storage_key,media_type,sort_order,approved)
           VALUES ($1::uuid,$2::uuid,$3,'photo',$4,false)`,
          [file.id, vehicleId, file.key, file.sortOrder]
        );
        uploads.push({
          id: file.id,
          storageKey: file.key,
          uploadUrl,
          contentType: file.contentType,
          maxBytes: MAX_BYTES
        });
      }

      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,'admin.vehicle_photo_upload_started','vehicles',$2,$3::jsonb)`,
        [actor.id, vehicleId, JSON.stringify({ count: uploads.length, mediaIds: uploads.map(x => x.id) })]
      );
      await client.query("COMMIT");
      return res.status(201).json({ ok: true, uploads, remaining: MAX_PHOTOS - current.rows[0].count - uploads.length });
    }

    if (action === "complete") {
      const ids = uniqueIds(req.body?.mediaIds);
      if (!ids.length || ids.length > MAX_PHOTOS || ids.some(id => !UUID.test(id))) {
        throw new ApiError(400, "INVALID_PHOTO_COMPLETION");
      }
      const selected = await client.query(
        `SELECT id,storage_key,sort_order,approved
           FROM public.vehicle_media
          WHERE vehicle_id=$1::uuid AND id=ANY($2::uuid[])
          ORDER BY sort_order,id
          FOR UPDATE`,
        [vehicleId, ids]
      );
      if (selected.rows.length !== ids.length) throw new ApiError(404, "VEHICLE_PHOTO_NOT_FOUND");

      for (const photo of selected.rows) {
        if (!photo.storage_key.startsWith(`vehicles/${vehicleId}/`)) {
          throw new ApiError(400, "INVALID_VEHICLE_PHOTO_KEY");
        }
        const head = await inspectVehiclePhoto(photo.storage_key);
        const contentType = String(head.ContentType || "").toLowerCase();
        if (!TYPES.has(contentType) || !Number.isSafeInteger(Number(head.ContentLength)) ||
            Number(head.ContentLength) < 1 || Number(head.ContentLength) > MAX_BYTES) {
          await deleteVehiclePhoto(photo.storage_key).catch(() => {});
          throw new ApiError(400, "INVALID_UPLOADED_VEHICLE_PHOTO");
        }
        await client.query(
          "UPDATE public.vehicle_media SET approved=true, media_type='photo' WHERE id=$1::uuid AND vehicle_id=$2::uuid",
          [photo.id, vehicleId]
        );
      }

      const images = await client.query(
        "SELECT id,storage_key,sort_order,approved FROM public.vehicle_media WHERE vehicle_id=$1::uuid ORDER BY sort_order,id",
        [vehicleId]
      );
      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,'admin.vehicle_photos_uploaded','vehicles',$2,$3::jsonb)`,
        [actor.id, vehicleId, JSON.stringify({ mediaIds: ids, totalPhotos: images.rows.length })]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, images: images.rows.map(vehicleImage), count: images.rows.length });
    }

    if (action === "cancel") {
      const ids = uniqueIds(req.body?.mediaIds);
      if (!ids.length || ids.length > MAX_PHOTOS || ids.some(id => !UUID.test(id))) {
        throw new ApiError(400, "INVALID_PHOTO_CANCELLATION");
      }
      const selected = await client.query(
        "SELECT id,storage_key FROM public.vehicle_media WHERE vehicle_id=$1::uuid AND id=ANY($2::uuid[]) AND approved=false FOR UPDATE",
        [vehicleId, ids]
      );
      if (selected.rows.length !== ids.length) throw new ApiError(409, "PHOTO_ALREADY_COMPLETED");
      for (const photo of selected.rows) {
        if (photo.storage_key.startsWith(`vehicles/${vehicleId}/`)) {
          await deleteVehiclePhoto(photo.storage_key).catch(() => {});
        }
        await client.query("DELETE FROM public.vehicle_media WHERE id=$1::uuid", [photo.id]);
      }
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, cancelled: selected.rows.length });
    }

    if (action === "delete") {
      const mediaId = String(req.body?.mediaId || "");
      if (!UUID.test(mediaId)) throw new ApiError(400, "INVALID_MEDIA_ID");
      const selected = await client.query(
        `SELECT vm.id,vm.storage_key,v.approval_status
           FROM public.vehicle_media vm
           JOIN public.vehicles v ON v.id=vm.vehicle_id
          WHERE vm.id=$1::uuid AND vm.vehicle_id=$2::uuid
          FOR UPDATE OF vm,v`,
        [mediaId, vehicleId]
      );
      if (!selected.rows.length) throw new ApiError(404, "VEHICLE_PHOTO_NOT_FOUND");
      const photo = selected.rows[0];
      if (photo.approval_status === "approved") {
        const count = await client.query(
          "SELECT count(*)::int AS count FROM public.vehicle_media WHERE vehicle_id=$1::uuid AND approved=true",
          [vehicleId]
        );
        if (count.rows[0].count <= 1) throw new ApiError(409, "APPROVED_VEHICLE_NEEDS_PHOTO");
      }
      if (photo.storage_key.startsWith(`vehicles/${vehicleId}/`)) {
        await deleteVehiclePhoto(photo.storage_key);
      }
      await client.query("DELETE FROM public.vehicle_media WHERE id=$1::uuid", [mediaId]);
      await client.query(
        `WITH ranked AS (
           SELECT id,row_number() OVER (ORDER BY sort_order,id)-1 AS position
             FROM public.vehicle_media
            WHERE vehicle_id=$1::uuid
         )
         UPDATE public.vehicle_media vm
            SET sort_order=ranked.position
           FROM ranked
          WHERE vm.id=ranked.id`,
        [vehicleId]
      );
      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,'admin.vehicle_photo_deleted','vehicles',$2,$3::jsonb)`,
        [actor.id, vehicleId, JSON.stringify({ mediaId })]
      );
      const remaining = await client.query(
        "SELECT id,storage_key,sort_order,approved FROM public.vehicle_media WHERE vehicle_id=$1::uuid ORDER BY sort_order,id",
        [vehicleId]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, images: remaining.rows.map(vehicleImage) });
    }

    if (action === "primary") {
      const mediaId = String(req.body?.mediaId || "");
      if (!UUID.test(mediaId)) throw new ApiError(400, "INVALID_MEDIA_ID");
      const selected = await client.query(
        "SELECT id FROM public.vehicle_media WHERE id=$1::uuid AND vehicle_id=$2::uuid AND approved=true FOR UPDATE",
        [mediaId, vehicleId]
      );
      if (!selected.rows.length) throw new ApiError(404, "VEHICLE_PHOTO_NOT_FOUND");
      await client.query(
        `WITH ranked AS (
           SELECT id,
                  row_number() OVER (
                    ORDER BY CASE WHEN id=$2::uuid THEN 0 ELSE 1 END, sort_order, id
                  )-1 AS position
             FROM public.vehicle_media
            WHERE vehicle_id=$1::uuid
         )
         UPDATE public.vehicle_media vm
            SET sort_order=ranked.position
           FROM ranked
          WHERE vm.id=ranked.id`,
        [vehicleId, mediaId]
      );
      await client.query(
        `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,'admin.vehicle_photo_primary_changed','vehicles',$2,$3::jsonb)`,
        [actor.id, vehicleId, JSON.stringify({ primaryMediaId: mediaId })]
      );
      const images = await client.query(
        "SELECT id,storage_key,sort_order,approved FROM public.vehicle_media WHERE vehicle_id=$1::uuid ORDER BY sort_order,id",
        [vehicleId]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, images: images.rows.map(vehicleImage) });
    }

    throw new ApiError(400, "INVALID_VEHICLE_PHOTO_ACTION");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return sendApiError(res, error, "ADMIN_VEHICLE_PHOTO_FAILED");
  } finally {
    client?.release();
  }
}
