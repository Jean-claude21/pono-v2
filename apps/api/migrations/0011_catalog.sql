-- The catalog in the database (D-016): templates and skills on three levels.
--   official : the operator's, imported from a repository; no organization.
--   private  : an organization's own, from the console or an agent; seen by it alone.
--   shared   : an organization's entry the operator approved; seen by everyone.
-- A skill is a text agents execute: nothing becomes visible to others without the operator.

CREATE TABLE catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('template', 'skill')),
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  body jsonb NOT NULL,
  sharing text NOT NULL CHECK (sharing IN ('official', 'private', 'proposed', 'shared', 'refused')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((organization_id IS NULL) = (sharing = 'official'))
);
CREATE UNIQUE INDEX catalog_entries_unique
  ON catalog_entries (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name);

ALTER TABLE catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_entries FORCE ROW LEVEL SECURITY;

-- Read: one's own, and what is official or shared.
CREATE POLICY catalog_read ON catalog_entries FOR SELECT
  USING (organization_id = pono_current_organization() OR sharing IN ('official', 'shared'));
-- Write: one's own only, and never into the official or shared levels.
CREATE POLICY catalog_insert ON catalog_entries FOR INSERT
  WITH CHECK (organization_id = pono_current_organization() AND sharing IN ('private', 'proposed'));
CREATE POLICY catalog_update ON catalog_entries FOR UPDATE
  USING (organization_id = pono_current_organization() AND sharing IN ('private', 'proposed', 'refused'))
  WITH CHECK (organization_id = pono_current_organization() AND sharing IN ('private', 'proposed'));
CREATE POLICY catalog_delete ON catalog_entries FOR DELETE
  USING (organization_id = pono_current_organization());

-- The operator's functions run as the owner: these policies let it, never the app role.
CREATE POLICY catalog_owner_all ON catalog_entries TO pono_owner USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_entries TO pono_app;

CREATE FUNCTION admin_catalog_publish(p_kind text, p_name text, p_body jsonb)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO catalog_entries (organization_id, kind, name, body, sharing)
    VALUES (NULL, p_kind, p_name, p_body, 'official')
    ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name)
      DO UPDATE SET body = excluded.body, updated_at = now()
    RETURNING id
  $$;

CREATE FUNCTION admin_catalog_entries()
  RETURNS TABLE (id uuid, organization_id uuid, organization_name text, kind text, name text,
                 body jsonb, sharing text, updated_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT e.id, e.organization_id, o.name, e.kind, e.name, e.body, e.sharing, e.updated_at
    FROM catalog_entries e LEFT JOIN organizations o ON o.id = e.organization_id
    WHERE e.sharing IN ('official', 'proposed', 'shared')
    ORDER BY e.sharing = 'proposed' DESC, e.updated_at DESC
  $$;

CREATE FUNCTION admin_catalog_review(p_id uuid, p_decision text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE v_org uuid;
  BEGIN
    IF p_decision NOT IN ('shared', 'refused', 'private') THEN
      RAISE EXCEPTION 'unknown decision %', p_decision;
    END IF;
    UPDATE catalog_entries SET sharing = p_decision, updated_at = now()
      WHERE id = p_id AND organization_id IS NOT NULL RETURNING organization_id INTO v_org;
    RETURN v_org::text;
  END
  $$;

CREATE FUNCTION admin_catalog_remove(p_id uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ DELETE FROM catalog_entries WHERE id = p_id AND sharing = 'official' $$;

REVOKE ALL ON FUNCTION admin_catalog_publish(text, text, jsonb), admin_catalog_entries(),
  admin_catalog_review(uuid, text), admin_catalog_remove(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_catalog_publish(text, text, jsonb), admin_catalog_entries(),
  admin_catalog_review(uuid, text), admin_catalog_remove(uuid) TO pono_app;
