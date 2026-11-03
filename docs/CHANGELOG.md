## Photo upload transport correction — 2026-11-03

- Replaced cross-origin browser PUTs with a same-origin authenticated Vercel upload function.
- The server validates JPEG/PNG/WEBP signatures and writes bytes to the Neon `vehicle-photos` bucket. No browser CORS setup is needed.
- Each image is capped at 4 MB, below Vercel's documented 4.5 MB request-body cap. Up to three images are sent in separate requests.
- On upload failure, the one-form listing retains its generated IDs so the admin can retry without duplicating owner, driver or vehicle records.


## Single vehicle advertisement workflow — 2026-11-03

- Replaced separate add-owner, add-driver and add-vehicle entry points with one admin action: **إضافة إعلان سيارة متكامل**.
- The single form captures owner identity/contact and legal name, driver identity/contact, car details, 1–3 photos, package prices, weekly availability, and optional document links.
- The form automatically reuses an existing owner/driver account when the supplied phone number already matches a registered partner. If the owner is also the driver, entering the same phone reuses one Auth identity with both roles.
- New owner/driver accounts are created inline. Temporary credentials are shown once after a successful submission. Profile, document, vehicle and image steps retain their saved IDs in the open form so retry does not create duplicate profiles or vehicles.
- Each new advertisement stores `vehicles.default_driver_id` to retain its default chauffeur. Publishing now requires that chauffeur to have verified identity documents and an active account.
- Production photo upload was still empty before this correction. The direct browser PUT flow now configures Neon S3 bucket CORS (`PUT`, `GET`, `HEAD`) for the production app origin before issuing an upload URL; browser/network upload errors remain visible and the form stays open for retry.
- Service-worker cache bumped to `zaffa-shell-v6` so installed PWAs refresh the unified form.
- Migration `0005_vehicle_default_driver` adds the nullable default-driver link without modifying existing vehicle records.
- **Deployment note:** this source correction must not be described as live until the Vercel production deployment points to the resulting main commit and an actual browser upload appears in `vehicle-photos`.


## Vehicle photo management — 2026-11-03

- Admin can upload 1–3 car photos directly from the device, preview before saving, append photos later up to the same three-photo total, choose the primary photo, and delete non-final photos.
- Formats: JPEG, PNG, WEBP. Server validates stored object content type and size (5 MB maximum per photo) after a direct presigned upload.
- Added a separate Neon Object Storage bucket `vehicle-photos` with `public_read` access for vehicle display images. Payment receipts remain in the separate private `payment-receipts` bucket.
- Photo metadata is stored in `public.vehicle_media`; only approved photos are exposed in the customer catalogue.
- Applied migration `0004_vehicle_media_max_three` on production: order slots are limited to 0–2 and `(vehicle_id, sort_order)` is unique and deferred. The table was empty before applying the constraints.
- GitHub Actions passed 47/47 tests (0 failures): https://github.com/abdullahnuby/zafa/actions/runs/41710516262.
- Neon successfully issued a presigned upload URL. A full browser-to-object upload was not verified in this environment because the container could not resolve the storage host; complete a real browser upload after the matching Vercel deployment is live.
- Do not treat the photo workflow as live until a production deployment for the current main commit reaches READY.

# ZAFFA Changelog

## 2026-11-03 — Fix valid customer sign-in rejected by profile API
- Root cause: the frontend forwarded Better Auth's opaque `session.token` as a Bearer JWT. Password authentication could succeed, but the profile API correctly rejected the non-JWT value during Neon JWKS verification.
- Sign-in and session restoration now obtain the signed API credential exclusively through `authClient.token()` and `data.token`; the opaque session identifier is never sent as a Bearer token.
- Extracted token retrieval into `lib/client-auth-token.mjs` and added unit plus acceptance regression coverage.
- Read-only production checks confirmed the customer identity/profile and session records remain present. No customer row, password, role, session, schema, or database migration was changed.
- Verification completed: GitHub Actions run #64 passed JavaScript syntax checks and all 29 tests (0 failures); Vercel deployment `dpl_FNooLdgPF45BjxFiKnRLhszCCBDH` reached `READY` and received the production alias `zafa-orcin.vercel.app`.
- The first CI run caught an over-escaped test assertion; it was corrected in the next commit and the repeat run passed.

## 2026-11-03 — Guest browsing and PWA refresh
- Keep the public catalog and site accessible without customer authentication.
- Request sign-in only when a guest chooses to begin a booking.
- Simplify new-customer registration to one form for name, mobile number, email and password.
- Remove the obsolete local booking submission path; do not display a payment form or imply a reservation before the transactional booking service exists.
- Upgrade the service-worker cache to v3, clear previous shell caches on activation, fetch HTML/JS/CSS from the network first, and automatically reload already-open tabs when the new worker activates.
- Never cache API responses for inventory, payment settings or identity.
- Add automated acceptance checks for guest browsing, booking-only authentication and PWA cache invalidation.

## 2026-11-03 — Phone/password customer access
- Customer sign-up now asks only for name, Egyptian mobile number, and password.
- Customer sign-in now asks only for mobile number and password.
- Email addresses are no longer requested or shown to customers; Managed Auth uses an internal non-deliverable alias based on the normalized phone number.
- Corrected Egyptian mobile normalization in the profile API and added tests for all supported mobile prefixes.
- SMS ownership verification and SMS password reset remain unavailable until an SMS provider/webhook is configured.
- Admin promotion will be applied only after the owner creates the account with the confirmed admin mobile number.

## 2026-11-03 — Wedding visual refresh and authentication diagnostics
- Reworked the public home page with wedding-car photography, occasion shortcuts, a clear search panel, and a three-step journey.
- Replaced the dark navy-heavy appearance with an ivory, blush, mauve, and champagne palette across desktop, mobile, navigation, cards, and auth modal.
- Added inline Arabic sign-in error feedback and specific handling for HTTP 404 vs invalid credentials.
- Verified the production Neon Auth base path (`/neondb/auth`): `/sign-in/email` is the valid sign-in route; duplicated `/auth` and `/api/auth` prefixes return 404.
- Switched authenticated profile loading and session restoration to the supported Neon JWT `token()` endpoint, avoiding an unnecessary post-login `get-session` request.
- Added Neon Auth base URL/JWKS to Preview only so the temporary diagnostic can be run against the same auth branch without changing production settings.
- Hero photo: Mark Cantle / Unsplash (Unsplash License). Wedding floral detail: Valdemars Magone / Unsplash (Unsplash License).

## 2026-11-03 — Brand mark and quiet customer header
- Refined the ZAFFA logo to match the approved reference: wedding rings and diamond above a clean car silhouette, Arabic wordmark, and English ZAFFA signature.
- Updated the app icon to the same champagne-and-mauve wedding identity for home-screen and browser use.
- Removed the customer-facing Neon connection badge and its UI-only health-check poll; catalog loading and all backend API behavior remain unchanged.
- Updated browser/PWA theme colors to the warm ivory and blush identity.

## 2026-11-03 — Correct Neon JWT retrieval and recover interrupted sign-ups
- Use the documented Neon Auth `getJWTToken()` API to obtain the JWT injected into the authenticated session by the Neon adapter.
- Do not misreport a 401 from token/profile stages as an incorrect phone/password pair.
- On an authenticated profile GET, recover a missing application profile from the signed Neon Auth identity only when it matches the internal Egyptian phone alias and the Auth row. A default customer role is added; no privileged role is granted automatically.
- Add regression tests for the documented JWT method and recovery of orphaned registrations.

## 2026-11-03 — Use Neon JWT plugin endpoint for session tokens
- The `getJWTToken()` helper in the published Neon adapter delegates to Better Auth `getSession()` and therefore depends on the failing `/get-session` route in this Neon Auth environment.
- Switched protected API token retrieval to Better Auth's JWT client plugin method `authClient.token()`, which uses the separate `/token` endpoint. The route was probed from the Preview environment and exists (401 without a session cookie is expected).
- Prefer the JWT injected into the successful sign-in/sign-up response's session when the SDK provides it; otherwise request it through the JWT plugin.