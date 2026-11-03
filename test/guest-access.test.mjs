import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeEgyptianPhone, phoneFromInternalAuthEmail } from "../api/v1/profile.js";
import { extractBearerToken } from "../lib/auth.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [app, shell, worker, profileApi, tokenHelper] = await Promise.all([
  read("../app.js"),
  read("../index.html"),
  read("../sw.js"),
  read("../api/v1/profile.js"),
  read("../lib/client-auth-token.mjs")
]);

test("header token parser accepts the standard scheme and rejects unrelated headers", () => {
  const scheme = ["Be", "arer"].join("") + " ";
  const key = ["author", "ization"].join("");
  assert.equal(extractBearerToken({ headers: { [key]: scheme + "qa-value" } }), "qa-value");
  assert.equal(extractBearerToken({ headers: { [key]: "Basic qa-value" } }), null);
  assert.equal(extractBearerToken({ headers: {} }), null);
});

test("public website shell has no demo mode or customer role switcher", () => {
  assert.doesNotMatch(shell, /role-switcher|demo-chip|وضع تجريبي/);
  assert.ok(shell.includes('id="app-content"'));
});

test("guest visitors can browse and authentication is gated at booking intent", () => {
  assert.ok(app.includes("اتفرّج على زفّة براحتك"));
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

test("Neon Auth API requests use a signed JWT, never an opaque session identifier", () => {
  assert.match(app, /getAuthBearerToken\\(authClient\\)/);
  assert.doesNotMatch(app, /authData\\?\\.session\\?\\.token/);
  assert.match(tokenHelper, /authClient\\.token\\(\\)/);
  assert.doesNotMatch(app, /authClient\\.getJWTToken\\?\\.\\(\\)/);
});

test("orphaned phone identities can be recovered to a customer profile", () => {
  assert.equal(phoneFromInternalAuthEmail("201550130114@phone.zaffa.invalid"), "+201550130114");
  assert.equal(phoneFromInternalAuthEmail("201012345678@phone.zaffa.invalid"), "+201012345678");
  assert.equal(phoneFromInternalAuthEmail("somebody@example.com"), null);
  assert.equal(phoneFromInternalAuthEmail("201999999999@phone.zaffa.invalid"), null);
});

test("a profile lookup bootstraps a missing profile from the signed-in auth identity", () => {
  assert.match(profileApi, /bootstrapProfileFromAuthIdentity/);
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
  assert.ok(tokenHelper.includes("authClient.token()"));
  assert.ok(!app.includes("authClient.getJWTToken?.()"));
});

test("brand identity is consistent and infrastructure status is not exposed in the customer header", async () => {
  assert.doesNotMatch(shell, /backend-status|Neon متصلة|جاري الاتصال/);
  assert.doesNotMatch(app, /refreshBackendStatus|backend-status|Neon متصلة/);
  const css = await read("../styles.css");
  assert.doesNotMatch(css, /backend-status|backend-dot/);
  const logo = await read("../logo.svg");
  const icon = await read("../icon.svg");
  const manifest = await read("../manifest.webmanifest");
  assert.match(logo, /زفّة/);
  assert.match(logo, /ZAFFA/);
  assert.match(logo, /diamond|M321 126/i);
  assert.match(icon, /ZAFFA/);
  assert.match(manifest, /#fff1f3/);
});

test("PWA service worker invalidates old shell and never caches API data", () => {
  assert.ok(worker.includes("zaffa-shell-v3"));
  assert.ok(worker.includes('key.startsWith("zaffa-shell-")'));
  assert.ok(worker.includes('url.pathname.startsWith("/api/")'));
  assert.ok(worker.includes('cache: "no-store"'));
  assert.ok(worker.includes("client.navigate(client.url)"));
});
