# Changelog

## 0.3.1 — Correct Neon Auth bearer JWT handling
- Always use the signed JWT returned by the Neon Auth JWT plugin `token()` method for protected API calls.
- Never treat Better Auth's opaque `session.token` identifier as a JWT.
- Add an isolated token helper and regression tests for the post-login 401 failure.
- Preserve customer records and Auth sessions; no database migration is required.

## 0.1.0 — First interactive prototype

- Added Arabic RTL responsive customer, owner, driver, and admin workspaces.
- Added demo vehicle discovery, details, packages, add-ons, price summary, booking submission, and booking status display.
- Added owner request decisions, basic vehicle onboarding, driver task-state progression, and admin vehicle approval demo.
- Added PWA manifest, service worker shell cache, and application icon.
- Added pure booking rule module and automated tests.
- Added PostgreSQL schema draft, API contract, product scope, design handoff, and implementation status notes.
- Explicitly left production authentication, payment provider, real availability reservations, GPS, messaging, document storage, and legal approvals out of scope for this iteration.
