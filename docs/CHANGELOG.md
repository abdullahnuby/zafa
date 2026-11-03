# ZAFFA Changelog

## 2026-11-03 — Guest browsing and PWA refresh
- Keep the public catalog and site accessible without customer authentication.
- Request sign-in only when a guest chooses to begin a booking.
- Simplify new-customer registration to one form for name, mobile number, email and password.
- Remove the obsolete local booking submission path; do not display a payment form or imply a reservation before the transactional booking service exists.
- Upgrade the service-worker cache to v3, clear previous shell caches on activation, fetch HTML/JS/CSS from the network first, and automatically reload already-open tabs when the new worker activates.
- Never cache API responses for inventory, payment settings or identity.
- Add automated acceptance checks for guest browsing, booking-only authentication and PWA cache invalidation.
