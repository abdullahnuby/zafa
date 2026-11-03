import test from "node:test";
import assert from "node:assert/strict";
import { getAuthBearerToken } from "../lib/client-auth-token.mjs";

const signedJwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ6YWZmYS11c2VyIn0.signature";
const opaqueSessionId = "opaque-better-auth-session-id-that-is-not-a-jwt";

test("uses the signed JWT from the JWT plugin instead of an opaque sign-in session id", async () => {
  let calls = 0;
  const authClient = {
    token: async () => {
      calls += 1;
      return { data: { token: signedJwt } };
    }
  };

  // The legacy extra argument is intentionally ignored; it must never be used as a bearer token.
  assert.equal(await getAuthBearerToken(authClient, opaqueSessionId), signedJwt);
  assert.equal(calls, 1);
});

test("returns null when the JWT plugin has no sufficiently long token", async () => {
  assert.equal(await getAuthBearerToken({ token: async () => ({ data: {} }) }), null);
  assert.equal(await getAuthBearerToken({ token: async () => ({ data: { token: "short" } }) }), null);
});

test("preserves token endpoint error status and code", async () => {
  const authClient = {
    token: async () => ({
      error: { message: "Unauthorized", status: 401, code: "AUTH_REQUIRED" }
    })
  };

  await assert.rejects(
    () => getAuthBearerToken(authClient),
    error => error.status === 401 && error.code === "AUTH_REQUIRED"
  );
});

test("fails clearly when the JWT plugin method is unavailable", async () => {
  await assert.rejects(
    () => getAuthBearerToken({}),
    error => error.message === "AUTH_TOKEN_METHOD_UNAVAILABLE"
  );
});
