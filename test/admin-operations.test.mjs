import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [router, fleet, people, vehicles, documents, availability, assignDriver, bookings, app, vercel] = await Promise.all([
  read("../api/v1/admin-router.js"),
  read("../lib/admin-api/fleet.js"),
  read("../lib/admin-api/people.js"),
  read("../lib/admin-api/vehicles.js"),
  read("../lib/admin-api/documents.js"),
  read("../lib/admin-api/availability.js"),
  read("../lib/admin-api/assign-driver.js"),
  read("../lib/admin-api/bookings.js"),
  read("../app.js"),
  read("../vercel.json")
]);

test("the consolidated admin router exposes each admin API without creating separate functions", () => {
  for (const name of [
    "fleet", "people", "vehicles", "documents", "availability",
    "assign-driver", "bookings", "payment-settings",
    "payment-receipts", "payment-receipts-review", "cash-payment-confirmation"
  ]) {
    assert.ok(router.includes(`"${name}":`), `missing route ${name}`);
  }
  assert.match(vercel, /\/api\/v1\/admin\/:route\*/);
  assert.match(vercel, /admin-router\?route=:route\*/);
});

test("the repository deploys fewer than twelve Vercel API function files", async () => {
  async function jsFiles(dir) {
    const entries = await readdir(new URL(dir, import.meta.url), { withFileTypes: true });
    const rows = await Promise.all(entries.map(async entry => {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) return jsFiles(child);
      return entry.isFile() && entry.name.endsWith(".js") ? [child] : [];
    }));
    return rows.flat();
  }
  const files = await jsFiles("../api");
  assert.ok(files.length <= 12, `found ${files.length} API files`);
});

test("every administrative route enforces a database-backed admin role", () => {
  for (const [name, source] of Object.entries({
    fleet, people, vehicles, documents, availability, assignDriver, bookings
  })) {
    assert.match(source, /requireRole\(req, \["admin"/, `${name} must enforce an admin role`);
  }
});

test("vehicle publishing requires an approved owner, licence, insurance and photo", () => {
  assert.match(vehicles, /OWNER_NOT_APPROVED/);
  assert.match(vehicles, /VEHICLE_LICENSE_AND_INSURANCE_REQUIRED/);
  assert.match(vehicles, /VEHICLE_PHOTO_REQUIRED/);
  assert.match(vehicles, /vehicle_license/);
  assert.match(vehicles, /insurance/);
});

test("owner approval requires an approved contract and driver verification requires valid identity documents", () => {
  assert.match(people, /OWNER_CONTRACT_REQUIRED/);
  assert.match(people, /DRIVER_DOCUMENTS_REQUIRED/);
  assert.match(people, /driving_license/);
  assert.match(people, /national_id/);
  assert.match(people, /expires_on >= current_date/);
});

test("vehicle availability is stored in the database and booking blocks use protected time ranges", () => {
  assert.match(availability, /vehicle_availability_rules/);
  assert.match(availability, /availability_blocks/);
  assert.match(availability, /tstzrange/);
  assert.match(availability, /AVAILABILITY_CONFLICT/);
});

test("driver assignment requires an active verified driver and prevents schedule conflicts", () => {
  assert.match(assignDriver, /verification_status !== "verified"/);
  assert.match(assignDriver, /DRIVER_SCHEDULE_CONFLICT/);
  assert.match(assignDriver, /other_item\.service_period && \$3::tstzrange/);
  assert.match(assignDriver, /driver_assignments/);
});

test("admin dashboard uses live fleet and booking APIs instead of local-only approval actions", () => {
  assert.match(app, /loadAdminFleet\(\)/);
  assert.match(app, /loadAdminBookings\(\)/);
  assert.match(app, /adminApiRequest\("\/api\/v1\/admin\/vehicles"/);
  assert.match(app, /adminApiRequest\("\/api\/v1\/admin\/people"/);
  assert.match(app, /adminApiRequest\("\/api\/v1\/admin\/availability"/);
  assert.match(app, /assignDriverToBooking/);
  assert.doesNotMatch(app, /تم تغيير الحالة إلى معتمدة تجريبيًا/);
});
