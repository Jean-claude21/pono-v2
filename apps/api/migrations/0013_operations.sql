-- Pono's periodic tasks (D-018): read every workshop again, roll back after an automatic merge that
-- broke production (D-006), and tell people of the alerts that open, by email.

ALTER TABLE alerts ADD COLUMN notified_at timestamptz;

-- The organizations the periodic task visits; nothing else about them.
CREATE FUNCTION system_organizations()
  RETURNS TABLE (id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM organizations ORDER BY created_at $$;

-- Where an organization's alerts go: its members' addresses, as their sign-in gave them.
CREATE FUNCTION organization_recipients(p_organization uuid)
  RETURNS TABLE (email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT p.email FROM members m JOIN people p ON p.id = m.person_id
    WHERE m.organization_id = p_organization AND p.email IS NOT NULL
  $$;


REVOKE ALL ON FUNCTION system_organizations(), organization_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system_organizations(), organization_recipients(uuid) TO pono_app;
