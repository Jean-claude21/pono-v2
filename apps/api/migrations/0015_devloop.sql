-- The dev loop (D-020): the project's dev server on its project server, and its preview address.

ALTER TABLE project_servers
  ADD COLUMN dev_port integer CHECK (dev_port BETWEEN 1 AND 65535),
  ADD COLUMN dev_command text,
  ADD COLUMN preview_url text,
  ADD COLUMN dev_started_at timestamptz;

-- A push to `dev` reaches the servers of every project built from that repository.
CREATE FUNCTION projects_by_repository(p_repository text)
  RETURNS TABLE (organization_id uuid, project_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT p.organization_id, p.id FROM projects p
    JOIN project_servers s ON s.project_id = p.id AND s.status = 'running' AND s.dev_port IS NOT NULL
    WHERE lower(p.repository) = lower(p_repository)
  $$;
REVOKE ALL ON FUNCTION projects_by_repository(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects_by_repository(text) TO pono_app;
