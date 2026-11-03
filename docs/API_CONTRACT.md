# API Contract Draft — ZAFFA

Status: design draft; endpoints below are not yet implemented by the static prototype server.

Base path: `/api/v1`

## Identity

- `POST /auth/otp/request` — request OTP (rate limited; provider adapter required).
- `POST /auth/otp/verify` — verify OTP and issue short-lived access + refresh credentials.
- `GET /me` — return server-authorized user profile and role claims.

## Vehicles and availability

- `GET /vehicles` — approved vehicles only; filters for date, zones, seats, class, and package range.
- `GET /vehicles/:vehicleId` — public safe vehicle details and approved media only.
- `POST /owner/vehicles` — create vehicle onboarding draft.
- `POST /owner/vehicles/:vehicleId/documents` — issue private upload URL with restricted content type/size.
- `POST /admin/vehicles/:vehicleId/decision` — approve/reject/suspend with reason and audit record.
- `GET /vehicles/:vehicleId/availability` — return coarse availability; never expose another customer's personal details.
- `PUT /owner/vehicles/:vehicleId/availability` — add/remove owner availability blocks.

## Quotes and bookings

- `POST /quotes` — validate zone, dates, package, add-ons, buffers, and current rates; return immutable quote snapshot and expiry.
- `POST /bookings` — idempotent request using quote ID and idempotency key; performs a transactional final availability check and reservation hold.
- `GET /bookings` — list only bookings visible to the authenticated actor.
- `GET /bookings/:bookingId` — scoped booking detail.
- `POST /owner/bookings/:bookingId/decision` — accept/reject an independent-owner request.
- `POST /admin/bookings/:bookingId/assign-driver` — permissioned dispatch action.
- `POST /driver/bookings/:bookingId/events` — append allowed service event after state/assignment checks.
- `POST /bookings/:bookingId/cancel` — apply policy, calculate refund/fees, write status event and ledger actions.

## Payments / finance

- `POST /payments/intents` — create PSP payment intent for a booking/deposit.
- `POST /webhooks/:provider` — verify signature, deduplicate provider event, and update payment ledger idempotently.
- `GET /owner/finance/summary` — owner-scoped payable/commission snapshot.
- `GET /admin/finance/ledger` — finance-role-only ledger report.
- `POST /admin/settlements` — create a reviewed settlement batch.

## API invariants

1. Require authenticated actor and server-side RBAC on every non-public route.
2. Validate request payloads with strict schemas; reject unknown fields where appropriate.
3. Use idempotency keys for booking and payment-intent creation.
4. Use DB transactions for reservation + booking status + booking event + ledger writes.
5. Never trust amount, role, payment status, owner ID, driver ID, or booking state supplied by the client.
6. Verify PSP webhook signature and provider event identity before marking money as captured.
7. Return generic public vehicle data only; keep documents, phone numbers, notes, and internal owner records private.
8. Log sensitive actions without writing OTPs, credentials, or full document contents to logs.
