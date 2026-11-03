-- Enforce a strict three-photo maximum per vehicle at the database level.
-- Slots are zero-based (0, 1, 2); deferred uniqueness permits safe reordering.
ALTER TABLE public.vehicle_media
  ADD CONSTRAINT vehicle_media_sort_order_check
  CHECK (sort_order BETWEEN 0 AND 2);

ALTER TABLE public.vehicle_media
  ADD CONSTRAINT vehicle_media_vehicle_sort_order_unique
  UNIQUE (vehicle_id, sort_order)
  DEFERRABLE INITIALLY DEFERRED;

INSERT INTO public.schema_migrations(version,description)
VALUES('0004_vehicle_media_max_three','Limit each vehicle to three ordered photos')
ON CONFLICT(version) DO NOTHING;
