/**
 * Get the signed Neon Auth JWT used by protected ZAFFA API routes.
 *
 * Better Auth's session.token is an opaque session identifier, not a JWT.
 * The API accepts only the signed JWT returned by the JWT plugin's token().
 */
export async function getAuthBearerToken(authClient) {
  if (typeof authClient?.token !== "function") {
    throw new Error("AUTH_TOKEN_METHOD_UNAVAILABLE");
  }

  const result = await authClient.token();
  if (result?.error) {
    const error = new Error(
      result.error.message || result.error.code || "AUTH_TOKEN_FAILED"
    );
    error.status = result.error.status || result.error.statusCode || 0;
    error.code = result.error.code || "AUTH_TOKEN_FAILED";
    throw error;
  }

  const token = result?.data?.token;
  return typeof token === "string" && token.length > 20 ? token : null;
}
