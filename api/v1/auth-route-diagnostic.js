const ROUTES = [
  { label: "get-session", path: "/get-session", method: "GET" },
  { label: "auth/get-session", path: "/auth/get-session", method: "GET" },
  { label: "api/auth/get-session", path: "/api/auth/get-session", method: "GET" },
  { label: "token", path: "/token", method: "GET" },
  { label: "sign-in/email", path: "/sign-in/email", method: "POST" },
  { label: "auth/sign-in/email", path: "/auth/sign-in/email", method: "POST" },
  { label: "api/auth/sign-in/email", path: "/api/auth/sign-in/email", method: "POST" }
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  const base = String(process.env.NEON_AUTH_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return res.status(503).json({ ok: false, code: "AUTH_NOT_CONFIGURED" });

  const results = [];
  for (const route of ROUTES) {
    try {
      const response = await fetch(base + route.path, {
        method: route.method,
        headers: {
          Origin: "https://zafa-orcin.vercel.app",
          Accept: "application/json",
          ...(route.method === "POST" ? { "Content-Type": "application/json" } : {})
        },
        ...(route.method === "POST" ? { body: "{}" } : {}),
        redirect: "manual"
      });
      const raw = await response.text();
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      results.push({
        route: route.label,
        method: route.method,
        status: response.status,
        code: typeof body.code === "string" ? body.code : null,
        message: typeof body.message === "string" ? body.message.slice(0, 100) : null
      });
    } catch (error) {
      const errorObject = error !== null && typeof error === "object" ? error : null;
      const causeObject = errorObject && errorObject.cause !== null && typeof errorObject.cause === "object"
        ? errorObject.cause
        : null;
      const detail = causeObject && typeof causeObject.code === "string"
        ? causeObject.code
        : errorObject && typeof errorObject.message === "string"
          ? errorObject.message
          : "NETWORK_ERROR";
      results.push({
        route: route.label,
        method: route.method,
        status: 0,
        code: "NETWORK_ERROR",
        error: detail.slice(0, 100)
      });
    }
  }
  return res.status(200).json({ ok: true, basePath: new URL(base).pathname, results });
}
