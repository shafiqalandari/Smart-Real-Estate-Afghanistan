ALTER TABLE provider_messages
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;

CREATE INDEX IF NOT EXISTS provider_messages_installation_seen_idx
  ON provider_messages (installation_id, sender, is_read, created_at DESC);

NOTIFY pgrst, 'reload schema';
