# ZAFFA Changelog

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
