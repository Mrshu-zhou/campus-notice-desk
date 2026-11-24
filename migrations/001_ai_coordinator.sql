CREATE TABLE app.ai_coordinator (
  lock_key text PRIMARY KEY,
  payload jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);