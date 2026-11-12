-- Organizations and their members: the hard boundary of Pono (principle 4).
-- Every table of an organization forces row-level security in the migration that creates it.

CREATE FUNCTION pono_current_organization() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('pono.organization_id', true), '')::uuid $$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_isolation ON organizations
  USING (id = pono_current_organization())
  WITH CHECK (id = pono_current_organization());

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, person_id)
);
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;
CREATE POLICY members_isolation ON members
  USING (organization_id = pono_current_organization())
  WITH CHECK (organization_id = pono_current_organization());

-- An organization is born with its first owner, in one gesture; the app role cannot insert one
-- otherwise.
CREATE FUNCTION create_organization(org_name text, owner_person uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('pono.organization_id', new_id::text, true);
  INSERT INTO organizations (id, name) VALUES (new_id, org_name);
  INSERT INTO members (organization_id, person_id, role) VALUES (new_id, owner_person, 'owner');
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION create_organization(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization(text, uuid) TO pono_app;
GRANT EXECUTE ON FUNCTION pono_current_organization() TO pono_app;
GRANT SELECT, UPDATE ON organizations TO pono_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON members TO pono_app;
