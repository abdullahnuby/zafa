import { getPool } from "../../lib/db.js";
import { requireRole, sendApiError, ApiError } from "../../lib/auth.js";
import { putVehiclePhotoObject } from "../../lib/storage.js";

export const config = { api: { bodyParser: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageMatchesSignature(buffer, contentType) {
  if (contentType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === "image/png") {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  }
  if (contentType === "image/webp") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

async function readUpload(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BYTES) throw new ApiError(413, "VEHICLE_PHOTO_TOO_LARGE");
    chunks.push(part);
  }
  if (size < 1) throw new ApiError(400, "EMPTY_VEHICLE_PHOTO");
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength && declaredLength !== size) throw new ApiError(400, "VEHICLE_PHOTO_SIZE_MISMATCH");
  return Buffer.concat(chunks, size);
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
    const url = new URL(req.url || "/", "https://" + (req.headers?.host || "localhost"));
    const vehicleId = String(url.searchParams.get("vehicleId") || "");
    const mediaId = String(url.searchParams.get("mediaId") || "");
    if (!UUID.test(vehicleId) || !UUID.test(mediaId)) {
      throw new ApiError(400, "INVALID_VEHICLE_PHOTO_UPLOAD");
    }

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!MIME_TYPES.has(contentType)) throw new ApiError(400, "INVALID_VEHICLE_PHOTO_TYPE");
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (declaredLength > MAX_BYTES) throw new ApiError(413, "VEHICLE_PHOTO_TOO_LARGE");

    const bytes = await readUpload(req);
    if (!imageMatchesSignature(bytes, contentType)) throw new ApiError(400, "INVALID_VEHICLE_PHOTO_CONTENT");

    client = await getPool().connect();
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT vm.id,vm.storage_key,vm.approved
         FROM public.vehicle_media vm
         JOIN public.vehicles v ON v.id=vm.vehicle_id
        WHERE vm.id=$1::uuid AND vm.vehicle_id=$2::uuid
        FOR UPDATE OF vm,v`,
      [mediaId, vehicleId]
    );
    if (!selected.rows.length) throw new ApiError(404, "VEHICLE_PHOTO_NOT_FOUND");
    const photo = selected.rows[0];
    if (photo.approved) throw new ApiError(409, "VEHICLE_PHOTO_ALREADY_COMPLETED");
    if (!photo.storage_key.startsWith(`vehicles/${vehicleId}/`)) {
      throw new ApiError(400, "INVALID_VEHICLE_PHOTO_KEY");
    }

    await putVehiclePhotoObject(photo.storage_key, bytes, contentType);
    await client.query(
      `INSERT INTO public.audit_logs (actor_user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'admin.vehicle_photo_bytes_uploaded','vehicles',$2,$3::jsonb)`,
      [actor.id, vehicleId, JSON.stringify({ mediaId, size: bytes.length, contentType })]
    );
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, mediaId, size: bytes.length });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return sendApiError(res, error, "ADMIN_VEHICLE_PHOTO_UPLOAD_FAILED");
  } finally {
    client?.release();
  }
}
