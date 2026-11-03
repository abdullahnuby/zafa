-- ZAFFA initial PostgreSQL domain schema.
-- Applied transactionally to Neon production branch br-super-resonance-bedi3tom.
-- Enforce availability and payment invariants in DB/API,
-- not only in the client. All timestamps should be stored in UTC; user-facing schedules use Africa/Cairo.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('customer','owner','driver','admin','finance_admin','operations_admin');
CREATE TYPE vehicle_approval AS ENUM ('draft','pending','approved','rejected','suspended');
CREATE TYPE booking_status AS ENUM ('draft','pending_owner','awaiting_payment','confirmed','driver_assigned','ready','in_progress','completed','cancelled','no_show','disputed','declined');
CREATE TYPE payment_method AS ENUM ('cash','online_full','online_deposit');
CREATE TYPE payment_status AS ENUM ('pending','authorized','captured','failed','refunded','partially_refunded','cash_due');
CREATE TYPE owner_kind AS ENUM ('fleet_partner','independent_owner','premium_partner');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE TABLE owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  kind owner_kind NOT NULL,
  legal_name text NOT NULL,
  onboarding_status text NOT NULL DEFAULT 'pending',
  contract_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  verification_status text NOT NULL DEFAULT 'pending',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id),
  make text NOT NULL,
  model text NOT NULL,
  model_year int NOT NULL CHECK (model_year BETWEEN 1990 AND 2100),
  plate_number text NOT NULL UNIQUE,
  seats int NOT NULL CHECK (seats BETWEEN 2 AND 12),
  transmission text,
  service_zones text[] NOT NULL DEFAULT '{}',
  approval_status vehicle_approval NOT NULL DEFAULT 'draft',
  driver_included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  storage_key text NOT NULL,
  expires_on date,
  review_status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicle_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  media_type text NOT NULL DEFAULT 'photo',
  sort_order int NOT NULL DEFAULT 0,
  approved boolean NOT NULL DEFAULT false
);
CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE vehicle_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  package_id uuid NOT NULL REFERENCES packages(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE TABLE vehicle_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  CHECK (end_time > start_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TABLE availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  period tstzrange NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK (NOT isempty(period)),
  EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
);
CREATE TABLE owner_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id),
  contract_version text NOT NULL,
  storage_key text NOT NULL,
  signed_at timestamptz,
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  consent_type text NOT NULL,
  policy_version text NOT NULL,
  granted boolean NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES users(id),
  currency char(3) NOT NULL DEFAULT 'EGP',
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  quote_version int NOT NULL DEFAULT 1,
  quote_payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE price_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES price_quotes(id) ON DELETE CASCADE,
  line_code text NOT NULL,
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES users(id),
  quote_id uuid REFERENCES price_quotes(id),
  status booking_status NOT NULL DEFAULT 'draft',
  occasion text NOT NULL,
  pickup_address text NOT NULL,
  destination_address text NOT NULL,
  scheduled_start timestamptz NOT NULL,
  notes text,
  quote_currency char(3) NOT NULL DEFAULT 'EGP',
  quote_total_minor bigint NOT NULL CHECK (quote_total_minor >= 0),
  quote_version int NOT NULL DEFAULT 1,
  payment_method payment_method NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  owner_id uuid NOT NULL REFERENCES owners(id),
  driver_id uuid REFERENCES drivers(id),
  package_id uuid NOT NULL REFERENCES packages(id),
  service_period tstzrange NOT NULL,
  buffer_minutes int NOT NULL DEFAULT 60 CHECK (buffer_minutes >= 0),
  item_total_minor bigint NOT NULL CHECK (item_total_minor >= 0),
  commission_minor bigint NOT NULL CHECK (commission_minor >= 0),
  UNIQUE (booking_id, vehicle_id),
  CHECK (NOT isempty(service_period))
);
-- Final overlap protection is added to booking_items for active states via a dedicated reservation table,
-- because PostgreSQL exclusion predicates cannot directly join bookings.status.
CREATE TABLE vehicle_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_item_id uuid NOT NULL UNIQUE REFERENCES booking_items(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  reserved_period tstzrange NOT NULL,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  reservation_kind text NOT NULL DEFAULT 'booking_hold',
  created_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (vehicle_id WITH =, reserved_period WITH &&) WHERE (active),
  CHECK (NOT isempty(reserved_period))
);
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status booking_status,
  to_status booking_status NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  storage_key text NOT NULL,
  expires_on date,
  review_status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_item_id uuid NOT NULL REFERENCES booking_items(id),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  reason text
);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  provider text,
  provider_reference text UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  status payment_status NOT NULL DEFAULT 'pending',
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  provider_refund_reference text UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL,
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);
CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL,
  reference_id uuid,
  description text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  booking_id uuid REFERENCES bookings(id),
  owner_id uuid REFERENCES owners(id),
  entry_type text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  reversal_of uuid REFERENCES ledger_entries(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_minor = 0) <> (credit_minor = 0))
);
CREATE TABLE settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  status text NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE TABLE settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
  ledger_entry_id uuid NOT NULL REFERENCES ledger_entries(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  category text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
-- Financial invariant: every ledger_transactions group must balance to zero across
-- debit_minor and credit_minor before commit. Enforce this with a deferred constraint trigger
-- or a single privileged posting function before enabling finance writes.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_customer_schedule_idx ON bookings(customer_id, scheduled_start DESC);
CREATE INDEX bookings_status_schedule_idx ON bookings(status, scheduled_start);
CREATE INDEX booking_items_vehicle_idx ON booking_items(vehicle_id);
CREATE INDEX payments_booking_idx ON payments(booking_id, created_at DESC);
CREATE INDEX ledger_owner_idx ON ledger_entries(owner_id, created_at DESC);

INSERT INTO packages(code,name_ar,duration_minutes) VALUES
 ('mini','ميني',120),('classic','كلاسيك',180),('wedding','زفاف',300),('royal','رويال',360)
ON CONFLICT (code) DO NOTHING;


CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.schema_migrations(version, description)
VALUES ('0001_initial', 'Initial ZAFFA marketplace schema')
ON CONFLICT (version) DO NOTHING;
