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

- **GitHub Actions run #75: SUCCESS.** JavaScript syntax checks passed and `npm test` passed **31/31 tests**, with 0 failures and 0 skipped tests: https://github.com/abdullahnuby/zafa/actions/runs/41699881760
- **Vercel production deployment: READY.** Deployment `dpl_DP4jgHDxVdzgDKTXPz31TJNyLNM3` points to commit `3178e4744890d729a4ce1b1ec41036fce4a92f01` and received the production alias `zafa-orcin.vercel.app`.
- The CI run validates the corrected JWT issuer, SDK-injected session JWT path, and session restoration. No live sign-in using the customer's private credentials has been performed by this integration; the final real-account check still needs the customer's browser.

## Remaining launch gates

- Guest browsing stays public; sign-in is requested only when starting a booking.
- SMS phone ownership verification and SMS password recovery still need a provider/webhook.
- Transactional booking creation, expiring availability holds, concurrent no-overlap protection, and complete owner/driver dispatch remain launch blockers.
- No payment gateway is connected. InstaPay receipts are manual-review evidence; cash requires authorized confirmation.
- Keep live reservation acceptance and money collection disabled until booking transaction safety, role-specific end-to-end testing, and Egyptian operating/legal review are complete.

## Vehicle photo management — 2026-11-03

- Admin can upload 1–3 car photos directly from the device, preview before saving, append photos later up to the same three-photo total, choose the primary photo, and delete non-final photos.
- Formats: JPEG, PNG, WEBP. Server validates stored object content type and size (5 MB maximum per photo) after a direct presigned upload.
- Added a separate Neon Object Storage bucket `vehicle-photos` with `public_read` access for vehicle display images. Payment receipts remain in the separate private `payment-receipts` bucket.
- Photo metadata is stored in `public.vehicle_media`; only approved photos are exposed in the customer catalogue.
- Applied migration `0004_vehicle_media_max_three` on production: order slots are limited to 0–2 and `(vehicle_id, sort_order)` is unique and deferred. The table was empty before applying the constraints.
- GitHub Actions passed 47/47 tests (0 failures): https://github.com/abdullahnuby/zafa/actions/runs/41710516262.
- Neon successfully issued a presigned upload URL. A full browser-to-object upload was not verified in this environment because the container could not resolve the storage host; complete a real browser upload after the matching Vercel deployment is live.
- Do not treat the photo workflow as live until a production deployment for the current main commit reaches READY.

