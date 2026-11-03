# ZAFFA | زفّة — MVP 0.1

A mobile-first Arabic RTL PWA prototype for a chauffeur-only wedding and occasions car-booking marketplace, launching conceptually in Luxor, Egypt.

## Run locally

Requirements: Node.js 20 or newer. No npm packages are required.

```bash
npm start
```

Open `http://localhost:4173`.

For automatic server restart during development:

```bash
npm run dev
```

Run the current automated server tests:

```bash
npm test
```

## What is implemented in this first milestone

- Responsive Arabic RTL customer experience: home, vehicle discovery, vehicle details, package selection, add-ons, estimate summary, demo booking creation, bookings, favorites, and profile.
- Owner workspace: demo vehicle records, vehicle onboarding request, booking request review/accept/reject, availability calendar view, and estimated settlement view.
- Driver workspace: assigned demo tasks and service-state progression (ready, in progress, completed).
- Admin workspace: operations overview, booking register, demo vehicle approval queue, partner/driver overview, and finance/report screens.
- Local demo state saved in the current browser's `localStorage`.
- PWA manifest and basic service-worker shell cache.
- Initial PostgreSQL domain schema draft in `database/schema.sql`.
- Pure booking rules module for package arithmetic, supply-dependent initial booking states, allowed status transitions, and explicitly illustrative commission math.

## Explicitly not production-ready

This is the first executable product/UI prototype, not a live booking marketplace. The following are not integrated:

- Real authentication, OTP, customer/owner/driver identity verification, or role authorization.
- Persistent server database. Browser demo data is local to the device/browser and can be reset or edited.
- Live vehicle availability, atomic reservation holds, PostgreSQL exclusion enforcement, or multi-car convoy booking.
- Payment gateway, webhook verification, refunds, owner payouts, or a real financial ledger.
- Real driver dispatch, GPS, push notifications, SMS, support case management, or document storage.
- Production cancellation/no-show policies, legal compliance checks, or contractual onboarding.

All seed vehicles, names, phone masks, dates, booking records, ratings, commission figures, and prices are illustrative demo data. A 12% commission is used only to demonstrate arithmetic; it is not an approved commercial rate. Never use the demo records as customer commitments or accounting data.

## First-run demo roles

Use the **عرض الواجهة** selector in the top bar to switch among customer, owner, driver, and admin workspaces. The selector is a development/demo convenience only and must be removed/replaced by server-authorized role claims before launch.

## Project guardrails

1. Chauffeur-only in MVP; no self-drive rental.
2. Luxor-first service area. Service coverage must be checked per vehicle/booking.
3. Hybrid supply: fleet partners and approved independent owners.
4. Independent-owner requests require explicit owner acceptance. Fleet instant confirmation is permitted only after availability is locked.
5. Booking totals and quote versions must be stored immutably. Never silently reprice a confirmed booking.
6. Database transactions and database-level reservation-overlap constraints must enforce no double-booking; the UI is not authoritative.
7. Payments are only confirmed by a verified provider webhook, never by a client-side success button.
8. The platform must not hold/transfer third-party funds outside a legally reviewed, licensed PSP model.
9. Private vehicle/driver documents must be stored privately with least-privilege access and audit logs.
10. Legal and insurance classification for paid chauffeured wedding services in Egypt is a launch gate.

## Next milestone

Implement the authenticated API and PostgreSQL persistence against `database/schema.sql`, beginning with identity/roles, vehicle onboarding and approval, availability reservation, quote snapshots, and transactional booking creation. Then replace demo state mutations with API calls. Payment integration remains disabled until the PSP and legal model are approved.
