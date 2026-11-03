-- ZAFFA payment-method and receipt-review foundation.
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'instapay_deposit';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_auth_user_id_fkey') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_fkey FOREIGN KEY(auth_user_id)
      REFERENCES neon_auth."user"(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_percent_bps integer NOT NULL DEFAULT 3000;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_due_minor bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_deposit_percent_bps_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_deposit_percent_bps_check CHECK(deposit_percent_bps BETWEEN 500 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_allowed_payment_method_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_allowed_payment_method_check
      CHECK(payment_method IN ('cash'::public.payment_method,'instapay_deposit'::public.payment_method)) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_allowed_payment_method_check;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_kind text NOT NULL DEFAULT 'deposit';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_payment_kind_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_payment_kind_check CHECK(payment_kind IN ('deposit','balance'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_provider_allowed_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_provider_allowed_check
      CHECK(provider IS NULL OR provider IN ('instapay','cash')) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_provider_allowed_check;
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
  instapay_recipient text,
  instapay_display_name text,
  deposit_percent_bps integer NOT NULL DEFAULT 3000 CHECK(deposit_percent_bps BETWEEN 500 AND 10000),
  cash_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(instapay_recipient IS NULL OR length(trim(instapay_recipient)) BETWEEN 3 AND 150),
  CHECK(instapay_display_name IS NULL OR length(trim(instapay_display_name)) BETWEEN 2 AND 120)
);
INSERT INTO public.payment_settings(id,deposit_percent_bps,cash_enabled) VALUES(1,3000,true) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 3145728),
  sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'upload_pending' CHECK(status IN ('upload_pending','pending_review','approved','rejected')),
  submitted_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK(review_notes IS NULL OR length(review_notes)<=500)
);
CREATE INDEX IF NOT EXISTS payment_receipts_review_idx ON public.payment_receipts(status,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_receipts_booking_idx ON public.payment_receipts(booking_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_one_open_per_payment_uidx
  ON public.payment_receipts(payment_id) WHERE status IN ('upload_pending','pending_review');
INSERT INTO public.schema_migrations(version,description)
VALUES('0002_payment_auth_receipts','Neon Auth identity link, strict payment methods, deposit settings and private receipt review')
ON CONFLICT(version) DO NOTHING;
