-- Additive migration: does not delete legacy SafarPro tables.
CREATE TABLE IF NOT EXISTS re_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), office_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('persons','properties','deals','expenses','income','requests','payments','rules')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS re_records_office_kind_idx ON re_records(office_id,kind,created_at DESC);
CREATE TABLE IF NOT EXISTS re_audit (
 id bigserial PRIMARY KEY, office_id text NOT NULL, record_id uuid,
 action text NOT NULL, detail jsonb DEFAULT '{}'::jsonb, at timestamptz DEFAULT now()
);
