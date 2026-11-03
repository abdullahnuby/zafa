# ZAFFA Product Status

Updated: 2026-11-03

## Identity
- Primary brand: زفّة | ZAFFA.
- Visual identity: the wedding car, interlocked rings, diamond and gold arch mark in `logo.svg`; compact app icon in `icon.svg`.
- Palette: deep navy and champagne gold.

## Payment policy and configuration
- Supported methods: InstaPay deposit and cash only.
- Default deposit: 30%, stored in basis points and configurable by an authorized finance/admin user.
- The production `payment_settings` row is configured with the recipient supplied by the owner; the exact receiving details are intentionally stored in the database, not source control.
- InstaPay receipt images stay private and remain pending until an employee checks the actual transfer and approves it.
- Cash remains due until an authorized employee confirms physical collection.
- Receipt formats: JPEG, PNG, WebP. Maximum size: 3 MiB.
- The application stores a private object key, not a public receipt URL.

## Infrastructure prepared
- Neon Auth enabled on the production branch.
- Private Neon Object Storage bucket `payment-receipts` created.
- Production Vercel has the Neon Auth URL/JWKS and private storage credentials configured.
- Production DB has payment settings and payment receipts tables, migrations 0002 and 0003.
- Customer profiles link a signed Neon Auth identity to the application user and validate Egyptian mobile numbers.
- Receipt upload is checked against the signed-in customer's own pending InstaPay payment.
- Receipt review and cash confirmation are protected by admin/finance_admin roles and audit logs.

## Customer access
- The public catalog and marketing pages are guest-accessible; account creation is not required to browse.
- Customer sign-in is requested only after the customer chooses to start a booking.
- Customer registration uses one form for name, mobile number, email and password. Existing customers sign in with email and password.
- Phone OTP is not implemented; the mobile number is a contact field, not an SMS verification claim.

## Launch boundary — not accepting real reservations yet
- The public interface is a pre-launch/soft-launch experience. It must not imply that paid bookings are currently available.
- Production currently has no approved vehicles, real prices, owner inventory or completed bookings.
- Transactional quote creation, booking holds/expiry, overlap-safe live availability, and owner responses still need implementation and end-to-end tests.
- The first operating admin account still needs promotion to the admin role.
- Email/password login is configured. Phone OTP needs an SMS provider and webhook.
- Cancellation/refund policy, owner/driver onboarding, notifications, and legal/operating procedures remain launch gates.
- Payment receipt upload is evidence for manual review only; it does not independently mark a payment as captured.

## Next milestones
1. Populate verified vehicles, prices, owner records, and availability.
2. Implement transactional booking creation, reservation holds, expiry and owner acceptance.
3. Bootstrap the first admin account and complete the operations/finance screens.
4. Complete cancellation/refund, notifications, and operating policies.
5. Run customer, owner, finance, and admin end-to-end tests before enabling live reservations.
