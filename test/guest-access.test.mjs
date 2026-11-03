import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [app, shell, worker] = await Promise.all([
  read("../app.js"),
  read("../index.html"),
  read("../sw.js")
]);

test("public website shell has no demo mode or customer role switcher", () => {
  assert.doesNotMatch(shell, /role-switcher|demo-chip|وضع تجريبي/);
  assert.match(shell, /id="app-content"/);
});

test("guest visitors can browse and authentication is gated at booking intent", () => {
  assert.match(app, /تقدر تتصفح زفّة من غير تسجيل دخول/);
  assert.match(app, /function openBooking\(id\)\{[\s\S]*?if\(!authSession\?\.user\)\{pendingBookingCarId=id;openAuthModal\("signin"\);return;\}/);
  assert.match(app, /function showBookingUnavailable\(id\)/);
});

test("new customer registration collects contact phone in the same form", () => {
  assert.match(app, /name="phone" type="tel"/);
  assert.match(app, /name="email" type="email"/);
  assert.match(app, /name="password" type="password"/);
});

test("PWA service worker invalidates old shell and never caches API data", () => {
  assert.match(worker, /zaffa-shell-v2/);
  assert.match(worker, /key\.startsWith\("zaffa-shell-"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /cache: "no-store"/);
});
