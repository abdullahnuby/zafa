import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeEgyptianPhone } from "../api/v1/profile.js";

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
  assert.match(app, /تقدر تتصفح زفّة من غير حساب/);
  assert.match(app, /function openBooking\\(id\\)\\{[\\s\\S]*?if\\(!authSession\\?\\.user\\)\\{pendingBookingCarId=id;openAuthModal\\("signin"\\);return;\\}/);
  assert.match(app, /function showBookingUnavailable\\(id\\)/);
});

test("customer registration and sign-in use phone and password without an email field", () => {
  assert.match(app, /name="phone" type="tel"/);
  assert.match(app, /name="password" type="password"/);
  assert.doesNotMatch(app, /name="email" type="email"/);
  assert.match(app, /function internalAuthEmail\\(phone\\)/);
  assert.match(app, /@phone\\.zaffa\\.invalid/);
  assert.match(app, /authClient\\.signIn\\.email\\(\\{email:authEmail,password\\}\\)/);
});

test("Egyptian mobile numbers normalize consistently for customer identities", () => {
  assert.equal(normalizeEgyptianPhone("01012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("01112345678"), "+201112345678");
  assert.equal(normalizeEgyptianPhone("+20 12 1234 5678"), "+201212345678");
  assert.equal(normalizeEgyptianPhone("01512345678"), "+201512345678");
  assert.equal(normalizeEgyptianPhone("01912345678"), null);
  assert.equal(normalizeEgyptianPhone("123"), null);
});

test("profile API never returns the internal synthetic identity as a customer email", () => {
  const api = app.replace(/\\s+/g, " ");
  assert.match(api, /@phone\\.zaffa\\.invalid/);
});

test("PWA service worker invalidates old shell and never caches API data", () => {
  assert.match(worker, /zaffa-shell-v3/);
  assert.match(worker, /key\\.startsWith\\("zaffa-shell-"\\)/);
  assert.match(worker, /url\\.pathname\\.startsWith\\("\/api\/"\\)/);
  assert.match(worker, /cache: "no-store"/);
  assert.match(worker, /client\\.navigate\\(client\\.url\\)/);
});
