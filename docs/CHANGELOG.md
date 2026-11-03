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
