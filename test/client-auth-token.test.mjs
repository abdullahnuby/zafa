import test from "node:test";
import assert from "node:assert/strict";
import { getAuthBearerToken } from "../lib/client-auth-token.mjs";

const signedJwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ6YWZmYS11c2VyIn0.signature";
const opaqueSessionId = "opaque-better-auth-session-id-that-is-not-a-jwt";

test("uses the JWT injected into the successful Neon sign-in session", async () => {
  let sessionReads = 0;
  const authClient = {
    getSession: async () => {
      sessionReads += 1;
      return { data: { session: { token: "a different token" } } };
    }
  };

  assert.equal(await getAuthBearerToken(authClient, signedJwt), signedJwt);
  assert.equal(sessionReads, 0);
});

test("restores the injected JWT through Neon SDK getSession", async () => {
  const authClient = {
    getSession: async () => ({ data: { session: { token: signedJwt } } })
  };

  assert.equal(await getAuthBearerToken(authClient), signedJwt);
});

test("rejects opaque session identifiers and malformed JWT values", async () => {
  const opaqueClient = {
    getSession: async () => ({ data: { session: { token: opaqueSessionId } } })
  };
  const malformedClient = {
    getSession: async () => ({ data: { session: { token: "header.payload" } } })
  };

  assert.equal(await getAuthBearerToken(opaqueClient), null);
  assert.equal(await getAuthBearerToken(malformedClient), null);
});

test("returns null when no authenticated JWT is present", async () => {
  const authClient = {
    getSession: async () => ({ data: { session: null } })
  };

  assert.equal(await getAuthBearerToken(authClient), null);
});

test("preserves getSession endpoint error status and code", async () => {
  const authClient = {
    getSession: async () => ({
      error: { message: "Unauthorized", status: 401, code: "AUTH_REQUIRED" }
    })
  };

  await assert.rejects(
    () => getAuthBearerToken(authClient),
    error => error.status === 401 && error.code === "AUTH_REQUIRED"
  );
});

test("fails clearly when the Neon session method is unavailable", async () => {
  await assert.rejects(
    () => getAuthBearerToken({}),
    error => error.message === "AUTH_SESSION_METHOD_UNAVAILABLE"
  );
});
