-- What a template brings (D-033): projects launched from it, those whose production answers, and
-- the median time from launch to the first dev server. Counted over every organization; nothing of
-- any one of them leaves this function.

-- The function reads, as the owner, only the first dev start of each project: nothing else of the
-- journal is opened to it.
CREATE POLICY journal_owner_read_dev_started ON journal FOR SELECT TO pono_owner
  USING (action = 'dev.started');

CREATE FUNCTION template_values()
  RETURNS TABLE (template text, launched bigint, live bigint, minutes_to_preview numeric)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    WITH firsts AS (
      SELECT p.id, p.template, p.created_at, p.link_status,
        (SELECT min(j.created_at) FROM journal j
          WHERE j.project_id = p.id AND j.action = 'dev.started') AS first_dev
      FROM projects p
      WHERE p.origin = 'template' AND p.template IS NOT NULL
    )
    SELECT f.template,
      count(*) AS launched,
      count(*) FILTER (WHERE f.link_status = 'up') AS live,
      round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM f.first_dev - f.created_at) / 60))::numeric, 1) AS minutes_to_preview
    FROM firsts f GROUP BY f.template
  $$;
REVOKE ALL ON FUNCTION template_values() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION template_values() TO pono_app;
