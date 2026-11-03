import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeEgyptianPhone } from "../api/v1/profile.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [app, shell, worker, profileApi] = await Promise.all([
  read("../app.js"),
  read("../index.html"),
  read("../sw.js"),
  read("../api/v1/profile.js")
]);

test("public website shell has no demo mode or customer role switcher", () => {
  assert.doesNotMatch(shell, /role-switcher|demo-chip|وضع تجريبي/);
  assert.ok(shell.includes('id="app-content"'));
});

test("guest visitors can browse and authentication is gated at booking intent", () => {
  assert.ok(app.includes("تقدر تتصفح زفّة من غير حساب"));
  assert.ok(app.includes('if(!authSession?.user){pendingBookingCarId=id;openAuthModal("signin");return;}'));
  assert.ok(app.includes("function showBookingUnavailable(id)"));
});

test("customer registration and sign-in use phone and password without an email field", () => {
  assert.ok(app.includes('name="phone" type="tel"'));
  assert.ok(app.includes('name="password" type="password"'));
  assert.ok(!app.includes('name="email" type="email"'));
  assert.ok(app.includes("function internalAuthEmail(phone)"));
  assert.ok(app.includes("@phone.zaffa.invalid"));
  assert.ok(app.includes("authClient.signIn.email({email:authEmail,password})"));
  assert.ok(profileApi.includes('email: row.email?.endsWith("@phone.zaffa.invalid") ? null : row.email'));
});

test("Egyptian mobile numbers normalize consistently for customer identities", () => {
  assert.equal(normalizeEgyptianPhone("01012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("01112345678"), "+201112345678");
  assert.equal(normalizeEgyptianPhone("+20 12 1234 5678"), "+201212345678");
  assert.equal(normalizeEgyptianPhone("01512345678"), "+201512345678");
  assert.equal(normalizeEgyptianPhone("01912345678"), null);
  assert.equal(normalizeEgyptianPhone("123"), null);
});

test("wedding home page uses real image-led occasion cards and friendly authentication feedback", () => {
  assert.ok(app.includes("hero-photo"));
  assert.ok(app.includes("occasion-tile"));
  assert.ok(app.includes("empty-state-photo"));
  assert.ok(app.includes("showAuthError"));
  assert.ok(app.includes("friendlyAuthError"));
  assert.ok(app.includes("status===404"));
});

test("PWA service worker invalidates old shell and never caches API data", () => {
  assert.ok(worker.includes("zaffa-shell-v3"));
  assert.ok(worker.includes('key.startsWith("zaffa-shell-")'));
  assert.ok(worker.includes('url.pathname.startsWith("/api/")'));
  assert.ok(worker.includes('cache: "no-store"'));
  assert.ok(worker.includes("client.navigate(client.url)"));
});
