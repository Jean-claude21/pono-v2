-- The workshop: connections to providers, projects, their deployments, and the journal.
-- Every table belongs to an organization and forces row-level security here, at its creation.

CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('code_host', 'hosting', 'database')),
  account text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  sealed_credential text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((status = 'revoked') = (sealed_credential IS NULL))
);
CREATE UNIQUE INDEX connections_one_active ON connections (organization_id, provider) WHERE status <> 'revoked';

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  repository text NOT NULL,
  default_branch text NOT NULL,
  hosting_provider text,
  hosting_ref text,
  hosting_status text NOT NULL CHECK (hosting_status IN ('found', 'missing', 'unknown')),
  database_provider text,
  database_ref text,
  database_status text NOT NULL CHECK (database_status IN ('found', 'missing', 'unknown')),
  production_url text,
  link_status text NOT NULL CHECK (link_status IN ('up', 'down', 'unknown', 'missing')),
  last_commit_at timestamptz,
  state text NOT NULL CHECK (state IN ('healthy', 'active', 'warning', 'failing', 'idle')),
  state_reason text NOT NULL,
  refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, repository)
);

CREATE TABLE deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('production', 'preview')),
  external_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('building', 'succeeded', 'failed', 'cancelled')),
  url text,
  commit_sha text,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, external_id)
);

CREATE TABLE journal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_person uuid,
  channel text NOT NULL CHECK (channel IN ('console', 'mcp', 'system')),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections', 'projects', 'deployments', 'journal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = pono_current_organization()) WITH CHECK (organization_id = pono_current_organization())',
      t || '_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON connections TO pono_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, deployments TO pono_app;
-- The journal is append-only for the app.
GRANT SELECT, INSERT ON journal TO pono_app;
