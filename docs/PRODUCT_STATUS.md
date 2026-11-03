# ZAFFA Product Status

Updated: 2026-11-03

## Identity
- Primary brand: زفّة | ZAFFA.
- Palette: deep navy and champagne gold.
- Main wordmark: logo.svg. App icon: icon.svg.

## Payment policy
- Supported methods: InstaPay and cash only.
- Default deposit: 30%, stored in basis points and configurable by an authorized finance/admin user.
- InstaPay receipt images stay private and remain pending until an employee checks the actual transfer and approves it.
- Cash remains due until an authorized employee confirms physical collection.
- Receipt formats: JPEG, PNG, WebP. Maximum size: 3 MiB.
- The application stores a private object key, not a public receipt URL.

## Infrastructure prepared
- Neon Auth enabled on the production branch.
- Private Neon Object Storage bucket payment-receipts created.
- Production Vercel has the Neon Auth URL/JWKS and private storage credentials.
- Production DB has payment_settings and payment_receipts, migrations 0002 and 0003.
- Customer profiles link a signed Neon Auth identity to the application user and validate Egyptian mobile numbers.
- Receipt upload is checked against the signed-in customer's own pending InstaPay payment.
- Receipt review and cash confirmation are protected by admin/finance_admin roles and audit logs.

## Not commercially launch-ready
- Production currently has no approved vehicles, users, or bookings. The customer catalog must be populated with real approved cars and prices.
- Transactional quote creation, booking holds/expiry, live availability, and owner responses still need implementation and tests.
- InstaPay recipient name and IPA/registered phone have not been supplied, so InstaPay is intentionally disabled until configured.
- The first operating admin account needs promotion to the admin role.
- Email/password login is configured. Phone OTP needs an SMS provider and webhook.
- Cancellation/refund policy, owner/driver onboarding, notifications, and legal/operating procedures remain launch gates.

## Next milestones
1. Confirm the InstaPay recipient and first admin email.
2. Add real cars, prices, owner records, and availability.
3. Implement transactional booking and hold logic.
4. Complete admin/owner/driver screens against protected APIs.
5. Run end-to-end tests before accepting paid reservations.
