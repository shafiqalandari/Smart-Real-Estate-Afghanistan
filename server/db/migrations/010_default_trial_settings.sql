-- Separate configuration for future customer trials. Existing users unchanged.
CREATE TABLE IF NOT EXISTS public.safarpro_access_settings (
  id integer PRIMARY KEY CHECK (id=1),
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.safarpro_access_settings (id,trial_days) VALUES (1,7)
ON CONFLICT (id) DO NOTHING;
