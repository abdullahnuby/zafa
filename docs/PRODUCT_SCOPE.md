# ZAFFA Product Scope — MVP 0.1

## Product definition

ZAFFA (زفّة) is a specialized marketplace and operations platform for booking chauffeured vehicles for weddings and occasions. The initial launch market is Luxor. It is not a self-drive rental product and should not be designed as a generic ride-hailing clone.

## Personas and surfaces

### Customer
- Discover approved cars by occasion, date, zone, vehicle class, and indicative package price.
- Inspect current photos, verified status, features, capacity, service zones, and supply type.
- Select package, extras, pickup location, destination, date/time, and payment intent.
- View quote, booking state, service timeline, and support information.

### Owner / fleet partner
- Submit owner and vehicle information for manual verification.
- Maintain vehicle details, indicative packages, service zones, and availability.
- Accept/reject independent-owner requests.
- View booking history, commission, payable balance, and settlement status.

### Driver
- View assigned jobs and operational instructions.
- Confirm readiness, start service, and complete service.
- Report exceptions. Real GPS/OTP and proof-of-service are future integrations.

### Operations / administration
- Review vehicles, owners, drivers, documents, and approval state.
- Monitor bookings, status transitions, driver assignments, and exceptions.
- Review finance ledger and settlement batches with separated permissions.
- Inspect audit history and operational metrics.

## Booking lifecycle

`draft → pending_owner | awaiting_payment | confirmed → driver_assigned → ready → in_progress → completed`

Terminal/exception states include `declined`, `cancelled`, `no_show`, and `disputed`.

- Fleet supply: may proceed to confirmation only after the requested interval is atomically reserved. Depending on payment terms, the next state is `awaiting_payment` or `confirmed`.
- Independent owner: starts as `pending_owner`. On owner acceptance, payment is collected/recorded according to policy; cash bookings may be confirmed only when cash collection responsibilities and cancellation terms are explicit.
- Every transition must create an immutable `booking_event` with actor, time, reason, and relevant metadata.
- A booking with multiple convoy vehicles must use a parent booking plus independent items so one car can be replaced/cancelled without corrupting the other items.

## No-double-booking rules

- Compute a complete occupied interval, including setup/teardown and travel buffer.
- Check maintenance blocks, owner blocks, active reservations, driver availability, and service-zone coverage.
- Use an expiring reservation hold while waiting for payment or owner approval.
- Re-check availability inside the booking transaction immediately before confirmation.
- Enforce overlap protection in PostgreSQL (GiST exclusion constraint or equivalent serialization strategy).
- Release expired/failed holds safely and idempotently.

## Quote model

`total = package base + approved extras + waiting time + approved distance/scope adjustment`

- An out-of-zone/distance extra is not auto-priced in this prototype; it requires an explicit quote.
- Persist a quote snapshot/version, currency, line items, taxes/fees if applicable, cancellation terms, and expiry.
- The customer's payable amount and provider/owner payable must be distinct from platform commission.
- The demo currently uses illustrative EGP prices and a 12% arithmetic example only; neither is market research nor an approved contract rate.

## MVP exclusions

No self-drive rental, cash wallet, custody of provider funds, continuous GPS tracking, multi-city rollout, automated dynamic pricing, photographer/decoration vendor marketplace, or LLM-based agent is included in this first stage.
