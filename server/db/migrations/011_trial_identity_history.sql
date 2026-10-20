-- Persistent one-trial evidence, separate from deletable customer accounts and backups.
-- SafarPro database only. Existing users' trials and paid plans are unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.safarpro_trial_identity_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('PHONE','STRONG_DEVICE')),
 identity_hash text NOT NULL CHECK (length(identity_hash)=64),
 customer_id uuid,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,identity_hash)
);
-- Backfill from existing customer records so email change / account deletion is
-- less likely to enable repeat trials. Keep identifiers hashed only.
INSERT INTO public.safarpro_trial_identity_history(kind,identity_hash,customer_id,first_seen_at)
SELECT 'PHONE', encode(sha256(convert_to(regexp_replace(phone,'[^0-9+]','','g'),'UTF8')),'hex'),
       id, COALESCE(created_at,now())
FROM public.service_customers
WHERE length(regexp_replace(COALESCE(phone,''),'[^0-9+]','','g')) >= 7
ORDER BY created_at ASC
ON CONFLICT(kind,identity_hash) DO NOTHING;
INSERT INTO public.safarpro_trial_identity_history(kind,identity_hash,customer_id,first_seen_at)
SELECT 'STRONG_DEVICE', physical_fingerprint_hash, customer_id, COALESCE(created_at,now())
FROM public.installations
WHERE physical_fingerprint_hash ~ '^[a-f0-9]{64}$' AND fingerprint_strength >= 5
ORDER BY created_at ASC
ON CONFLICT(kind,identity_hash) DO NOTHING;
COMMIT;
