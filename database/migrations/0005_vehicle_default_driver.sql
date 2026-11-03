-- Attach a default chauffeur to each vehicle advertisement.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS default_driver_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='vehicles_default_driver_id_fkey'
       AND conrelid='public.vehicles'::regclass
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_default_driver_id_fkey
      FOREIGN KEY (default_driver_id) REFERENCES public.drivers(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vehicles_default_driver_id_idx
  ON public.vehicles(default_driver_id)
  WHERE default_driver_id IS NOT NULL;

INSERT INTO public.schema_migrations(version,description)
VALUES('0005_vehicle_default_driver','Associate a default verified chauffeur with each vehicle advertisement')
ON CONFLICT(version) DO NOTHING;
