import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [router, uploadApi, storage, app, publicVehicles, neon, schema, migration, vehicleApi, fleet, driverMigration] = await Promise.all([
  read("../api/v1/admin-router.js"),
  read("../lib/admin-api/vehicle-photos.js"),
  read("../lib/storage.js"),
  read("../app.js"),
  read("../api/v1/vehicles.js"),
  read("../neon.ts"),
  read("../database/schema.sql"),
  read("../database/migrations/0004_vehicle_media_max_three.sql"),
  read("../lib/admin-api/vehicles.js"),
  read("../lib/admin-api/fleet.js"),
  read("../database/migrations/0005_vehicle_default_driver.sql")
]);

test("vehicle photo management is routed through the consolidated Vercel admin function", () => {
  assert.match(router, /"vehicle-photos":\s*vehiclePhotos/);
  assert.match(router, /vehiclePhotos from .*vehicle-photos\.js/);
});

test("server enforces exactly three photo slots and a five-megabyte per-image limit", () => {
  assert.match(uploadApi, /const MAX_PHOTOS = 3/);
  assert.match(uploadApi, /const MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(uploadApi, /current\.rows\[0\]\.count \+ files\.length > MAX_PHOTOS/);
  assert.match(uploadApi, /image\/jpeg/);
  assert.match(uploadApi, /image\/png/);
  assert.match(uploadApi, /image\/webp/);
});

test("uploads require admin authorization, signed URLs and server-side object verification", () => {
  assert.match(uploadApi, /requireRole\(req, \["admin", "operations_admin"\]\)/);
  assert.match(uploadApi, /createVehiclePhotoUploadUrl/);
  assert.match(uploadApi, /inspectVehiclePhoto/);
  assert.match(uploadApi, /ContentLength/);
  assert.match(uploadApi, /ContentType/);
  assert.match(uploadApi, /startsWith/);
  assert.match(storage, /VEHICLE_PHOTOS_BUCKET = "vehicle-photos"/);
  assert.match(storage, /createVehiclePhotoUploadUrl/);
  assert.match(storage, /getPublicVehiclePhotoUrl/);
  assert.match(storage, /PutBucketCorsCommand/);
  assert.match(storage, /AllowedMethods: \["GET", "HEAD", "PUT"\]/);
  assert.match(uploadApi, /ensureVehiclePhotoBucketCors/);
});

test("photo selection supports a maximum of three images with client previews", () => {
  assert.match(app, /name="photos" id="vehicle-photo-input"/);
  assert.match(app, /multiple required data-max-photos="3"/);
  assert.match(app, /validateVehiclePhotoFiles\(photos,1,3\)/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /uploadVehiclePhotos\(vehicleId,photos\)/);
  assert.match(app, /photosUploaded/);
  assert.match(app, /openVehiclePhotoManager/);
});

test("admins can choose the primary photo and delete photos without deleting the final image of a published car", () => {
  assert.match(app, /data-action="vehicle-photo-primary"/);
  assert.match(app, /data-action="delete-vehicle-photo"/);
  assert.match(uploadApi, /APPROVED_VEHICLE_NEEDS_PHOTO/);
  assert.match(uploadApi, /action === "primary"/);
  assert.match(uploadApi, /action === "delete"/);
});

test("public catalog exposes no more than three approved vehicle photos", () => {
  assert.match(publicVehicles, /vm\.approved=true/);
  assert.match(publicVehicles, /LIMIT 3/);
  assert.match(publicVehicles, /image_urls/);
  assert.match(app, /images:\(v\.image_urls\|\|\[\]\)\.map/);
  assert.match(app, /customer-car-gallery/);
});

test("Neon declares vehicle photos public-read while payment receipts remain private", () => {
  assert.match(neon, /"payment-receipts": \{\}/);
  assert.match(neon, /"vehicle-photos": \{ access: "public_read" \}/);
});

test("database schema and migration enforce only the three ordered image slots", () => {
  assert.match(schema, /sort_order int NOT NULL DEFAULT 0 CHECK \(sort_order BETWEEN 0 AND 2\)/);
  assert.match(schema, /UNIQUE \(vehicle_id, sort_order\) DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /vehicle_media_sort_order_check/);
  assert.match(migration, /vehicle_media_vehicle_sort_order_unique/);
  assert.match(migration, /0004_vehicle_media_max_three/);
});


test("vehicle ad creation is one combined owner, driver, vehicle and photo form", () => {
  assert.match(app, /name="ownerName"/);
  assert.match(app, /name="ownerPhone"/);
  assert.match(app, /name="driverName"/);
  assert.match(app, /name="driverPhone"/);
  assert.match(app, /ensureListingPerson\\(f,"owner"/);
  assert.match(app, /ensureListingPerson\\(f,"driver"/);
  assert.match(app, /driverId:driver\.id/);
  assert.match(app, /إضافة إعلان سيارة متكامل/);
  assert.doesNotMatch(app, /data-action="add-owner">\\+ إضافة مالك/);
  assert.doesNotMatch(app, /data-action="add-driver">\\+ إضافة سائق/);
});

test("vehicle records retain the listing's default driver and publishing requires a verified chauffeur", () => {
  assert.match(vehicleApi, /default_driver_id/);
  assert.match(vehicleApi, /VEHICLE_DRIVER_REQUIRED/);
  assert.match(vehicleApi, /DRIVER_NOT_VERIFIED_OR_INACTIVE/);
  assert.match(fleet, /default_driver_name/);
  assert.match(fleet, /LEFT JOIN public\.drivers driver_profile/);
  assert.match(schema, /default_driver_id uuid REFERENCES drivers\\(id\\)/);
  assert.match(driverMigration, /vehicles_default_driver_id_fkey/);
  assert.match(driverMigration, /0005_vehicle_default_driver/);
});
