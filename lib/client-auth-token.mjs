/**
 * Get the signed JWT supplied by Neon Auth's managed SDK.
 *
 * The Neon adapter captures the set-auth-jwt response header and injects
 * that signed JWT into Better Auth's session.token field. On page reload,
 * getSession() returns the same SDK-managed session and injected JWT.
 */
function isCompactJwt(value) {
  if (typeof value !== "string" || value.length < 40) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part));
}

function throwAuthError(result, fallbackCode) {
  const source = result?.error;
  if (!source) return;

  const error = new Error(
    source.message || source.code || fallbackCode
  );
  error.status = source.status || source.statusCode || 0;
  error.code = source.code || fallbackCode;
  throw error;
}

export async function getAuthBearerToken(authClient, signInSessionJwt = null) {
  // The token injected by Neon into a successful sign-in response is already
  // the signed JWT; validate its compact structure before using it.
  if (isCompactJwt(signInSessionJwt)) return signInSessionJwt;

  if (typeof authClient?.getSession !== "function") {
    throw new Error("AUTH_SESSION_METHOD_UNAVAILABLE");
  }

  const result = await authClient.getSession();
  throwAuthError(result, "AUTH_SESSION_FAILED");

  const token = result?.data?.session?.token;
  return isCompactJwt(token) ? token : null;
}
