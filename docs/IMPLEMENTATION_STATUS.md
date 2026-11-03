# Implementation Status

## Milestone 0 — Interactive product prototype

Status: implemented.

- Arabic RTL responsive PWA shell.
- Customer, owner, driver, and admin demo workspaces.
- Demo booking flow, package selection, add-ons, owner decisions, and driver status progression.
- Browser-local demo persistence.

## Milestone 1 — Neon + Vercel backend foundation

Status: infrastructure configured; first API endpoints committed.

- Neon project: `twilight-morning-20216632`, branch `production`, database `neondb`.
- Initial PostgreSQL schema applied transactionally; 31 domain tables created.
- `schema_migrations` records `0001_initial`.
- Vercel project `zafa` connected to GitHub repository `abdullahnuby/zafa`.
- `DATABASE_URL` configured as a sensitive Vercel environment variable in production, preview, and development.
- Runtime API uses `pg` connection pooling with Vercel Fluid's `attachDatabasePool`.
- `GET /api/health` checks the live database.
- `GET /api/v1/vehicles` returns approved chauffeur vehicles only.
- The app header displays the live API/Neon connectivity status.

## Current safety boundary

- The customer/owner/driver/admin workspaces and sample inventory remain a **demo UI**. The role selector is not authentication.
- The public vehicle API reads approved inventory from Neon. No fake vehicles were inserted.
- Real OTP/sign-in, server-side RBAC, document upload/review, booking creation, transactional availability holds, payment provider/webhooks, refunds, and settlement posting are **not enabled**.
- Do not accept customer bookings or money until identity, authorization, booking transaction/overlap protection, Egypt operating/legal classification, and payment integration are completed.

## Verification

- Confirm Vercel deployment reaches `READY`.
- Confirm `GET /api/health` returns `ok: true` and connects to Neon.
- Confirm `GET /api/v1/vehicles` returns only approved inventory (currently expected to be empty until real vehicles are onboarded).
- Run `npm test` before each deployment.
