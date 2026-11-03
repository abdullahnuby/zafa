import { createRemoteJWKSet, jwtVerify } from "jose";
import { getPool } from "./db.js";

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
let remoteJwks;
function getJwks() {
  const url = process.env.NEON_AUTH_JWKS_URL;
  if (!url) throw new ApiError(503, "AUTH_NOT_CONFIGURED");
  if (!remoteJwks) remoteJwks = createRemoteJWKSet(new URL(url));
  return remoteJwks;
}
export async function requireIdentity(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\\s+(.+)$/i.exec(String(authorization));
  if (!match) throw new ApiError(401, "AUTH_REQUIRED");
  const issuer = process.env.NEON_AUTH_BASE_URL;
  if (!issuer) throw new ApiError(503, "AUTH_NOT_CONFIGURED");
  try {
    const { payload } = await jwtVerify(match[1], getJwks(), { issuer });
    if (typeof payload.sub !== "string") throw new Error("SUBJECT_MISSING");
    return { authUserId: payload.sub, email: payload.email || null, name: payload.name || null };
  } catch { throw new ApiError(401, "INVALID_OR_EXPIRED_SESSION"); }
}
export async function requireProfile(req) {
  const identity = await requireIdentity(req);
  const { rows } = await getPool().query(
    `SELECT u.id, u.display_name, u.phone_e164, u.email,
            COALESCE(array_agg(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
       FROM public.users u LEFT JOIN public.user_roles ur ON ur.user_id = u.id
      WHERE u.auth_user_id = $1::uuid AND u.is_active = true
      GROUP BY u.id LIMIT 1`,
    [identity.authUserId]
  );
  if (!rows.length) throw new ApiError(409, "PROFILE_SETUP_REQUIRED");
  return { ...identity, ...rows[0] };
}
export async function requireRole(req, allowedRoles) {
  const profile = await requireProfile(req);
  if (!profile.roles.some(role => allowedRoles.includes(role))) throw new ApiError(403, "FORBIDDEN");
  return profile;
}
export function sendApiError(res, error, fallback = "REQUEST_FAILED") {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === "string" ? error.code : fallback;
  if (status >= 500) console.error("[ZAFFA API]", { code });
  return res.status(status).json({ ok: false, code });
}
