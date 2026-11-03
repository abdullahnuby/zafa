import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const BUCKET = "payment-receipts";
let client;
export function getStorageClient() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !AWS_REGION) {
    throw Object.assign(new Error("STORAGE_NOT_CONFIGURED"), { status: 503, code: "STORAGE_NOT_CONFIGURED" });
  }
  if (!client) client = new S3Client({
    region: AWS_REGION, endpoint: AWS_ENDPOINT_URL_S3, forcePathStyle: true,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
  });
  return client;
}
export async function putPrivateReceipt(key, body, contentType, sha256) {
  return getStorageClient().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    Metadata: { sha256 }, CacheControl: "private, no-store"
  }));
}
export async function deletePrivateReceipt(key) {
  return getStorageClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
export async function createPrivateReceiptUrl(key, expiresIn = 300) {
  return getSignedUrl(getStorageClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}
