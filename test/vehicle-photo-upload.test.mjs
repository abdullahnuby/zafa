import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [router, photoApi, storage, app, publicVehicles, neon, schema, photoMigration, vehicleApi, fleet, driverMigration, uploadHandler] = await Promise.all([
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
  read("../database/migrations/0005_vehicle_default_driver.sql"),
  read("../api/v1/admin-vehicle-photo-upload.js")
]);

test("vehicle photo management stays inside the consolidated Vercel admin router", () => {
  assert.ok(router.includes('"vehicle-photos": vehiclePhotos'));
  assert.ok(router.includes('vehiclePhotos from "../../lib/admin-api/vehicle-photos.js"'));
});

test("server enforces three photo slots and four-megabyte per-image limit", () => {
  assert.ok(photoApi.includes("const MAX_PHOTOS = 3"));
  assert.ok(photoApi.includes("const MAX_BYTES = 4 * 1024 * 1024"));
  assert.ok(photoApi.includes("current.rows[0].count + files.length > MAX_PHOTOS"));
  assert.ok(photoApi.includes('"image/jpeg"'));
  assert.ok(photoApi.includes('"image/png"'));
  assert.ok(photoApi.includes('"image/webp"'));
  assert.ok(uploadHandler.includes("MAX_BYTES = 4 * 1024 * 1024"));
});

test("authenticated same-origin upload validates file signatures before writing to Neon", () => {
  assert.ok(photoApi.includes("/api/v1/admin-vehicle-photo-upload"));
  assert.ok(uploadHandler.includes("bodyParser: false"));
  assert.ok(uploadHandler.includes('requireRole(req, ["admin", "operations_admin"])'));
  assert.ok(uploadHandler.includes("imageMatchesSignature"));
  assert.ok(uploadHandler.includes("putVehiclePhotoObject"));
  assert.ok(uploadHandler.includes("vehicles/"));
  assert.ok(storage.includes('VEHICLE_PHOTOS_BUCKET = "vehicle-photos"'));
  assert.ok(storage.includes("putVehiclePhotoObject"));
  assert.ok(storage.includes("getPublicVehiclePhotoUrl"));
  assert.ok(!storage.includes("PutBucketCorsCommand"));
});

test("photo selection supports up to three previews from local images", () => {
  assert.ok(app.includes('name="photos" id="vehicle-photo-input"'));
  assert.ok(app.includes('multiple required data-max-photos="3"'));
  assert.ok(app.includes("validateVehiclePhotoFiles(photos,1,3)"));
  assert.ok(app.includes("URL.createObjectURL"));
  assert.ok(app.includes("uploadVehiclePhotos(vehicleId,photos)"));
  assert.ok(app.includes("photosUploaded"));
  assert.ok(app.includes("PHOTO_UPLOAD_NETWORK_FAILED"));
  assert.ok(app.includes("4*1024*1024"));
  assert.ok(app.includes("لا تتجاوز 4 ميجابايت"));
});

test("admin can choose primary photo and delete photos without deleting the final image of a published car", () => {
  assert.ok(app.includes('data-action="vehicle-photo-primary"'));
  assert.ok(app.includes('data-action="delete-vehicle-photo"'));
  assert.ok(photoApi.includes("APPROVED_VEHICLE_NEEDS_PHOTO"));
  assert.ok(photoApi.includes('action === "primary"'));
  assert.ok(photoApi.includes('action === "delete"'));
});

test("public catalog exposes only approved vehicle photos and no more than three", () => {
  assert.ok(publicVehicles.includes("vm.approved=true"));
  assert.ok(publicVehicles.includes("LIMIT 3"));
  assert.ok(publicVehicles.includes("image_urls"));
  assert.ok(app.includes("customer-car-gallery"));
});

test("vehicle and payment buckets retain distinct public/private visibility", () => {
  assert.ok(neon.includes('"payment-receipts": {}'));
  assert.ok(neon.includes('"vehicle-photos": { access: "public_read" }'));
});

test("database schema and migration enforce three ordered image slots", () => {
  assert.ok(schema.includes("sort_order int NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 2)"));
  assert.ok(schema.includes("UNIQUE (vehicle_id, sort_order) DEFERRABLE INITIALLY DEFERRED"));
  assert.ok(photoMigration.includes("vehicle_media_sort_order_check"));
  assert.ok(photoMigration.includes("vehicle_media_vehicle_sort_order_unique"));
  assert.ok(photoMigration.includes("0004_vehicle_media_max_three"));
});

test("one advertisement form captures owner, driver, vehicle and images together", () => {
  assert.ok(app.includes('name="ownerName"'));
  assert.ok(app.includes('name="ownerPhone"'));
  assert.ok(app.includes('name="driverName"'));
  assert.ok(app.includes('name="driverPhone"'));
  assert.ok(app.includes('ensureListingPerson(f,"owner"'));
  assert.ok(app.includes('ensureListingPerson(f,"driver"'));
  assert.ok(app.includes("driverId:driver.id"));
  assert.ok(app.includes("إضافة إعلان سيارة متكامل"));
  assert.ok(!app.includes('data-action="add-owner">+ إضافة مالك'));
  assert.ok(!app.includes('data-action="add-driver">+ إضافة سائق'));
});

test("vehicle records link the listing chauffeur and publishing requires a verified driver", () => {
  assert.ok(vehicleApi.includes("default_driver_id"));
  assert.ok(vehicleApi.includes("VEHICLE_DRIVER_REQUIRED"));
  assert.ok(vehicleApi.includes("DRIVER_NOT_VERIFIED_OR_INACTIVE"));
  assert.ok(fleet.includes("default_driver_name"));
  assert.ok(fleet.includes("LEFT JOIN public.drivers driver_profile"));
  assert.ok(schema.includes("default_driver_id uuid REFERENCES drivers(id)"));
  assert.ok(driverMigration.includes("vehicles_default_driver_id_fkey"));
  assert.ok(driverMigration.includes("0005_vehicle_default_driver"));
});
