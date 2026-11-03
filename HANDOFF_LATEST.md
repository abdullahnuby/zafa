# ZAFFA — Latest Technical Handoff

**Date:** 2026-11-03  
**Repository:** `abdullahnuby/zafa`, branch `main`  
**Production site:** https://zafa-orcin.vercel.app  
**Vercel project:** `zafa` (`prj_uoHCquRZvbL5q9emDDpVHpuDHAXR`)  
**Neon:** project `twilight-morning-20216632`, branch `production` (`br-super-resonance-bedi3tom`), database `neondb`

## Issue investigated

The customer login screen reported that the credentials had been validated but the customer profile service rejected the session.

### Root cause

The browser took `authData.session.token` from the Better Auth sign-in response and sent it as `Authorization: Bearer ...`. This value is an opaque session identifier, not the signed JWT expected by ZAFFA's protected APIs. `lib/auth.js` correctly verifies Bearer JWTs against the Neon Auth issuer and JWKS, so the profile request returned HTTP 401 after the password step had succeeded.

### Code changes

- Added `lib/client-auth-token.mjs` as the shared, testable JWT retrieval helper.
- The helper calls `authClient.token()` and accepts only `result.data.token`.
- `app.js` now uses that helper for post-login profile loading and session restoration.
- Removed the path that forwards `authData.session.token` as an API bearer credential.
- Updated `test/guest-access.test.mjs` to guard against reintroducing the old behavior.
- Added `test/client-auth-token.test.mjs` covering signed JWT retrieval, opaque session-id rejection, absent token, API errors, and missing SDK support.

## Production/database inspection

- Neon Managed Auth is enabled with the Better Auth provider on the production branch.
- Production Vercel environment entries for `DATABASE_URL`, `NEON_AUTH_BASE_URL`, and `NEON_AUTH_JWKS_URL` are configured. Secret values were not read or copied into source control.
- Read-only production counts: 1 application user, 1 linked Auth identity, 1 application role row, 3 recorded migrations, and 4 Auth sessions.
- Applied migration history: `0001_initial`, `0002_payment_auth_receipts`, `0003_auth_identity_unique_constraint`.
- The customer's existing application profile and Auth identity were present during inspection.
- **No production SQL writes, migration, user/profile edit, role edit, password reset, or session deletion was performed.**

## Verification

- `.github/workflows/quality.yml` runs JavaScript syntax checks and `npm test` on pushes to `main`.
- The post-push GitHub Actions run and Vercel deployment must be checked before calling the fix verified in production.
- Local `npm test` was not executed in this environment; authoritative test execution is delegated to the repository's GitHub Actions workflow.

## Remaining product launch gates

- Guest visitors can browse the catalogue without an account; sign-in is required only when starting a booking.
- SMS phone-ownership verification and SMS password recovery still need a provider and webhook. An internal phone alias is not proof of phone ownership.
- Transactional quote/booking creation, expiring reservation holds, database-enforced no-overlap under concurrent requests, and complete owner/driver dispatch are still launch blockers.
- No payment gateway is connected. Uploaded InstaPay receipts remain evidence for manual review, and cash must be confirmed by an authorized employee.
- Keep live reservation acceptance and money collection disabled until booking transaction safety, role-specific end-to-end testing, and Egyptian operating/legal review are complete.
