import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const RECEIPTS_BUCKET = "payment-receipts";
const VEHICLE_PHOTOS_BUCKET = "vehicle-photos";
let client;

export function getStorageClient() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !AWS_REGION) {
    throw Object.assign(new Error("STORAGE_NOT_CONFIGURED"), {
      status: 503,
      code: "STORAGE_NOT_CONFIGURED"
    });
  }
  if (!client) {
    client = new S3Client({
      region: AWS_REGION,
      endpoint: AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

export async function putPrivateReceipt(key, body, contentType, sha256) {
  return getStorageClient().send(new PutObjectCommand({
    Bucket: RECEIPTS_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: { sha256 },
    CacheControl: "private, no-store"
  }));
}

export async function deletePrivateReceipt(key) {
  return getStorageClient().send(new DeleteObjectCommand({
    Bucket: RECEIPTS_BUCKET,
    Key: key
  }));
}

export async function createPrivateReceiptUrl(key, expiresIn = 300) {
  return getSignedUrl(getStorageClient(), new GetObjectCommand({
    Bucket: RECEIPTS_BUCKET,
    Key: key
  }), { expiresIn });
}

export function getPublicVehiclePhotoUrl(key) {
  if (!key) return null;
  const value = String(key);
  if (/^https:\/\//i.test(value)) return value;
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  if (!endpoint) return null;
  const encodedKey = value.split("/").map(encodeURIComponent).join("/");
  return `${endpoint.replace(/\/$/, "")}/${VEHICLE_PHOTOS_BUCKET}/${encodedKey}`;
}

export async function createVehiclePhotoUploadUrl(key, contentType, expiresIn = 300) {
  return getSignedUrl(getStorageClient(), new PutObjectCommand({
    Bucket: VEHICLE_PHOTOS_BUCKET,
    Key: key,
    ContentType: contentType
  }), { expiresIn });
}

export async function inspectVehiclePhoto(key) {
  return getStorageClient().send(new HeadObjectCommand({
    Bucket: VEHICLE_PHOTOS_BUCKET,
    Key: key
  }));
}

export async function deleteVehiclePhoto(key) {
  return getStorageClient().send(new DeleteObjectCommand({
    Bucket: VEHICLE_PHOTOS_BUCKET,
    Key: key
  }));
}
