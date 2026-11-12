-- Plans and administration (phase 7).

-- The plan changes only through billing: the app may rename an organization, never set its plan.
REVOKE UPDATE ON organizations FROM pono_app;
GRANT UPDATE (name) ON organizations TO pono_app;

ALTER TABLE organizations ADD COLUMN billing_customer text;

CREATE FUNCTION set_organization_plan(p_organization uuid, p_plan text, p_customer text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF p_plan NOT IN ('free', 'solo', 'pro') THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  PERFORM set_config('pono.organization_id', p_organization::text, true);
  UPDATE organizations SET plan = p_plan, billing_customer = coalesce(p_customer, billing_customer) WHERE id = p_organization;
  INSERT INTO journal (organization_id, action, channel, detail)
    VALUES (p_organization, 'plan.changed', 'system', jsonb_build_object('plan', p_plan));
END;
$$;
CREATE POLICY organizations_owner_update ON organizations FOR UPDATE TO pono_owner USING (true);
CREATE POLICY journal_owner_insert ON journal FOR INSERT TO pono_owner WITH CHECK (true);
CREATE POLICY project_servers_owner_read ON project_servers FOR SELECT TO pono_owner USING (true);
CREATE POLICY projects_owner_read ON projects FOR SELECT TO pono_owner USING (true);

-- What the platform's operator sees across organizations: counts and states, never a project's
-- code, data or keys.
CREATE FUNCTION admin_organizations()
  RETURNS TABLE (id uuid, name text, plan text, created_at timestamptz, projects bigint, active_servers bigint, sleeping_servers bigint, server_micros bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, o.plan, o.created_at,
      (SELECT count(*) FROM projects p WHERE p.organization_id = o.id),
      (SELECT count(*) FROM project_servers s WHERE s.organization_id = o.id AND s.status IN ('provisioning', 'running', 'waking')),
      (SELECT count(*) FROM project_servers s WHERE s.organization_id = o.id AND s.status IN ('sleeping', 'stopped')),
      (SELECT coalesce(sum(s.monthly_micros), 0)::bigint FROM project_servers s WHERE s.organization_id = o.id AND s.status <> 'released')
    FROM organizations o ORDER BY o.created_at DESC
  $$;

CREATE FUNCTION admin_servers()
  RETURNS TABLE (id uuid, organization_id uuid, organization text, project text, provider text, external_id text, status text, size text, monthly_micros bigint, status_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT s.id, s.organization_id, o.name, p.name, s.provider, s.external_id, s.status, s.size, s.monthly_micros, s.status_at
    FROM project_servers s JOIN organizations o ON o.id = s.organization_id JOIN projects p ON p.id = s.project_id
    WHERE s.status <> 'released' ORDER BY s.status_at DESC
  $$;

REVOKE ALL ON FUNCTION set_organization_plan(uuid, text, text), admin_organizations(), admin_servers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_organization_plan(uuid, text, text), admin_organizations(), admin_servers() TO pono_app;
