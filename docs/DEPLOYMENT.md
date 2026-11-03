# ZAFFA Deployment — Neon + Vercel

## Production resources

- GitHub: `abdullahnuby/zafa`, branch `main`.
- Vercel project: `zafa`.
- Neon project: `twilight-morning-20216632`.
- Neon branch: `production` (`br-super-resonance-bedi3tom`).
- Neon database: `neondb`, region `aws-us-east-2`.
- Runtime database variable: `DATABASE_URL` (pooled host, stored as a sensitive Vercel environment value).
- Vercel Functions region: `iad1`; Fluid compute is enabled.

## Deployment behavior

Vercel builds directly from the linked GitHub repository. There is no frontend build step: the Arabic RTL files are served as static assets and files under `api/` run as Node.js Functions.

## Runtime endpoints

- `GET /api/health` — verifies that the deployed API can reach Neon and returns safe connectivity/inventory metadata.
- `GET /api/v1/vehicles` — returns approved chauffeur vehicles and current package prices only.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `DATABASE_URL` to a Neon pooled connection string in your local file only.
3. Run `npm install`, `npm test`, and `npm start`.

Never commit `.env.local` or a real connection string.

## Production boundary

The initial schema is applied and tracked as `0001_initial`. The visible customer/owner/driver/admin workspaces still use prototype/demo state. There is no production login/OTP, server-side role enforcement, booking-creation endpoint, payment provider, or document workflow. Keep real booking and payment actions disabled until those controls and the Egypt operating/legal review are complete.
