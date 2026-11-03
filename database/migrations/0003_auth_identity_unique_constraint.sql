-- Enforce a one-to-one nullable mapping to Neon Auth identities.
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_unique UNIQUE(auth_user_id);
INSERT INTO public.schema_migrations(version,description)
VALUES('0003_auth_identity_unique_constraint','Unique nullable application-user to Neon Auth identity mapping')
ON CONFLICT(version) DO NOTHING;
