# Implementation Status

Updated: 2026-11-03

## Milestone 1 — Neon + Vercel identity and payment foundation

Status: infrastructure and identity/payment API foundations are present; live booking transactions remain unfinished.

- Neon production project: `twilight-morning-20216632`, branch `production`, database `neondb`.
- Domain schema and migrations `0001_initial`, `0002_payment_auth_receipts`, and `0003_auth_identity_unique_constraint` are applied and recorded in `public.schema_migrations`.
- Neon Managed Auth (Better Auth) is enabled on production.
- Customer registration/sign-in uses Egyptian mobile number and password in the interface. The current Managed Auth integration maps the normalized phone to an internal non-deliverable email alias because the managed client exposes email/password sign-in methods.
- The browser obtains a signed API JWT through the Neon Auth JWT plugin `authClient.token()` method. The server validates that JWT using `jose`, the configured issuer, and Neon Auth JWKS.
- `GET/POST /api/v1/profile` links an authenticated Neon identity to an application profile; missing profiles may be recovered only from a matching internal phone alias. Customer privileges are stored in `public.user_roles` and checked server-side for protected operations.
- Guest browsing remains public; sign-in is requested only when a visitor starts a booking.
- `GET /api/health` checks the database. `GET /api/v1/vehicles` exposes approved vehicle inventory only.
- Payment method settings and private receipt upload/review/cash-confirmation endpoints are present. Review and cash confirmation require authorized roles and audit records.
- Production Vercel has the database URL, Neon Auth base URL, and JWKS environment entries. Secret values remain outside source control.

## Authentication repair — 2026-11-03

The frontend previously sent Better Auth's opaque `session.token` value as a Bearer JWT after successful password authentication. That caused the profile API to reject the request with HTTP 401. The client now uses only the signed JWT returned by `authClient.token()`. Regression tests protect this distinction. Existing customer records and Auth sessions were preserved; no DB migration was needed.

## Current launch boundary

- SMS phone-ownership verification and SMS password reset are not implemented; a phone alias must not be described as a verified phone number.
- No payment gateway or verified payment webhook is connected. InstaPay receipts are manual-review evidence and do not automatically mark a payment as captured.
- Transactional quotes, booking creation, expiring reservation holds, and no-double-booking guarantees under concurrent requests remain unfinished.
- Complete owner/driver dispatch, notification delivery, cancellation/refund policy, and the Egypt operating/legal review remain launch gates.
- Do not enable live reservation acceptance or money collection until the above controls and end-to-end role checks are complete.

## Verification

- `.github/workflows/quality.yml` performs JavaScript syntax checks and `npm test` on pushes to `main`.
- After each source change, inspect the actual GitHub Actions result and Vercel production deployment. A Git push alone is not a passing test or proof of deployment.
