# ZAFFA — Latest Technical Handoff

**Date:** 2026-11-03  
**Repository:** `abdullahnuby/zafa`, branch `main`  
**Production site:** https://zafa-orcin.vercel.app  
**Neon:** project `twilight-morning-20216632`, branch `production` (`br-super-resonance-bedi3tom`), database `neondb`

## Customer login issue

The customer can pass the password check, but the profile API rejects the bearer token. Code inspection found two connected problems.

### Root cause

1. `NEON_AUTH_BASE_URL` contains the route path `/neondb/auth`. The API previously used the full URL as the expected JWT issuer. Neon Managed Auth uses the service **origin** as the JWT `iss` value, so comparing it with the full path rejects a valid JWT.
2. The previous client-side repair switched away from Neon SDK's injected session JWT. The Managed SDK captures the `set-auth-jwt` response header and injects that signed JWT into `session.token`. The public `token()` client route is not the correct extraction path for this app's current SDK adapter behavior.

### Changes made

- `lib/auth.js` now normalizes `NEON_AUTH_BASE_URL` to `new URL(authBaseUrl).origin` before verifying the JWT. `NEON_AUTH_JWKS_URL` remains the full JWKS URL.
- `app.js` passes the signed JWT from the successful sign-in response's `session.token` into a shared helper.
- `lib/client-auth-token.mjs` validates the compact JWT structure and restores the signed JWT from `getSession().data.session.token` after a page reload.
- `test/client-auth-token.test.mjs` now covers the injected JWT, session restoration, invalid/opaque values, absent tokens, SDK errors, and missing SDK method.
- `test/guest-access.test.mjs` now asserts the SDK session-token contract and the JWT issuer origin.
- `sw.js` shell cache was bumped to v4 to force installed mobile PWAs to refresh the updated JavaScript.

## Data safety

- No SQL writes, schema changes, or migrations were performed.
- No Auth user, customer profile, role, password, or session was edited or deleted.
- No secret or bearer token was read into source control.
- Existing customer account records remain in Neon.

## Verification status

- The isolated issuer-origin change reached production on commit `661ff782afa5e556bd247af6a2c292bd7bd6cd83`, and its GitHub quality workflow and Vercel deployment both succeeded.
- The subsequent client/session-token correction and PWA cache invalidation are committed separately. Their latest GitHub Actions run and Vercel deployment must be checked before the site is declared fully verified.
- No live sign-in using the customer's private credentials has been performed by this integration. The final real-account check must still be completed in the customer's browser.

## Remaining launch gates

- Guest browsing stays public; sign-in is requested only when starting a booking.
- SMS phone ownership verification and SMS password recovery still need a provider/webhook.
- Transactional booking creation, expiring availability holds, concurrent no-overlap protection, and complete owner/driver dispatch remain launch blockers.
- No payment gateway is connected. InstaPay receipts are manual-review evidence; cash requires authorized confirmation.
- Keep live reservation acceptance and money collection disabled until booking transaction safety, role-specific end-to-end testing, and Egyptian operating/legal review are complete.
