-- Project servers (phase 4): one server per project; a plan caps how many run at once (D-004).

ALTER TABLE organizations ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'solo', 'pro'));

CREATE TABLE project_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  agent text NOT NULL,
  status text NOT NULL CHECK (status IN ('provisioning', 'running', 'waking', 'sleeping', 'stopped', 'failed', 'released')),
  size text NOT NULL,
  url text,
  monthly_micros bigint NOT NULL,
  budget_micros bigint NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX project_servers_one_per_project ON project_servers (project_id) WHERE status <> 'released';

ALTER TABLE project_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_servers FORCE ROW LEVEL SECURITY;
CREATE POLICY project_servers_isolation ON project_servers
  USING (organization_id = pono_current_organization())
  WITH CHECK (organization_id = pono_current_organization());

GRANT SELECT, INSERT, UPDATE ON project_servers TO pono_app;
