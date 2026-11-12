-- Usage: declared subscriptions, readings of what providers measure, and alerts (phase 2).

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  service text NOT NULL CHECK (char_length(service) BETWEEN 1 AND 80),
  plan text,
  price_micros bigint NOT NULL CHECK (price_micros >= 0),
  cycle text NOT NULL CHECK (cycle IN ('month', 'year')),
  renews_on date,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE usage_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider text NOT NULL,
  meter text NOT NULL,
  subject text NOT NULL DEFAULT '',
  used numeric,
  quota numeric,
  unit text NOT NULL,
  cost_micros bigint,
  source text NOT NULL CHECK (source IN ('measured', 'estimated', 'declared', 'unavailable')),
  reason text,
  period_start timestamptz,
  period_end timestamptz,
  read_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'unavailable') = (used IS NULL))
);
CREATE INDEX usage_readings_latest ON usage_readings (organization_id, provider, meter, subject, read_at DESC);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('quota', 'renewal', 'spend', 'server', 'release')),
  level text NOT NULL CHECK (level IN ('warn', 'bad')),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX alerts_one_open ON alerts (organization_id, key) WHERE resolved_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'usage_readings', 'alerts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = pono_current_organization()) WITH CHECK (organization_id = pono_current_organization())',
      t || '_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON subscriptions, alerts TO pono_app;
GRANT SELECT, INSERT ON usage_readings TO pono_app;

-- AI providers can be connected too, to read what they cost.
ALTER TABLE connections DROP CONSTRAINT connections_kind_check;
ALTER TABLE connections ADD CONSTRAINT connections_kind_check CHECK (kind IN ('code_host', 'hosting', 'database', 'ai'));
