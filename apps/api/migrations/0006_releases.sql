-- Guarded releases (phase 5): every proposal evaluated, its verdict kept, the project's mode (D-006).

ALTER TABLE projects
  ADD COLUMN release_mode text NOT NULL DEFAULT 'ask' CHECK (release_mode IN ('ask', 'auto', 'bypass')),
  ADD COLUMN release_mode_until timestamptz,
  ADD COLUMN production_protection text NOT NULL DEFAULT 'unknown'
    CHECK (production_protection IN ('unknown', 'protected', 'unprotected', 'unavailable_on_plan')),
  ADD CONSTRAINT projects_bypass_is_limited CHECK (release_mode <> 'bypass' OR release_mode_until IS NOT NULL);

CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  head_sha text NOT NULL,
  branch text NOT NULL,
  url text,
  mode text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('passed', 'warned', 'refused')),
  guards jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('refused', 'waiting', 'merged', 'declined', 'superseded', 'failed')),
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (project_id, number, head_sha)
);

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases FORCE ROW LEVEL SECURITY;
CREATE POLICY releases_isolation ON releases
  USING (organization_id = pono_current_organization())
  WITH CHECK (organization_id = pono_current_organization());

GRANT SELECT, INSERT, UPDATE ON releases TO pono_app;
