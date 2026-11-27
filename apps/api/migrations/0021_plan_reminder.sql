-- A paid period does not renew itself (D-023): Pono warns before it ends (D-044).

ALTER TABLE alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('quota', 'renewal', 'spend', 'server', 'release', 'plan'));

-- The periodic task: a paid period that ends within `p_days` opens one alert, keyed by its end, so
-- a person is told once per period. A period paid again, or ended, closes it.
CREATE FUNCTION remind_paid_plans(p_days integer DEFAULT 3) RETURNS integer LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  org record;
  wanted text;
  n integer := 0;
BEGIN
  -- Every organization: alerts are only readable once the organization is set, and a period that
  -- just ended (plan_paid_until back to null) must still close its alert.
  FOR org IN SELECT o.id, o.plan, o.plan_paid_until FROM organizations o LOOP
    PERFORM set_config('pono.organization_id', org.id::text, true);
    wanted := NULL;
    IF org.plan <> 'free' AND org.plan_paid_until > now()
       AND org.plan_paid_until <= now() + make_interval(days => p_days) THEN
      wanted := 'plan:' || to_char(org.plan_paid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI');
    END IF;
    UPDATE alerts SET resolved_at = now()
      WHERE organization_id = org.id AND kind = 'plan' AND resolved_at IS NULL
        AND key IS DISTINCT FROM wanted;
    IF wanted IS NOT NULL THEN
      INSERT INTO alerts (organization_id, key, kind, level, detail)
        VALUES (org.id, wanted, 'plan',
          CASE WHEN org.plan_paid_until <= now() + interval '1 day' THEN 'bad' ELSE 'warn' END,
          jsonb_build_object('plan', org.plan, 'until', org.plan_paid_until))
        ON CONFLICT (organization_id, key) WHERE resolved_at IS NULL
          DO UPDATE SET level = excluded.level;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION remind_paid_plans(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remind_paid_plans(integer) TO pono_app;
