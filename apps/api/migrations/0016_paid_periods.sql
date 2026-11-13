-- Plans paid by one-off payments (D-023): one payment buys a period; when it ends, the plan is free.

ALTER TABLE organizations ADD COLUMN plan_paid_until timestamptz;

-- Every payment Pono counted, once: a provider that retries its webhook never buys two periods.
CREATE TABLE billing_payments (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('solo', 'pro')),
  days integer NOT NULL CHECK (days > 0),
  paid_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_payments_read ON billing_payments FOR SELECT TO pono_app
  USING (organization_id = pono_current_organization());
CREATE POLICY billing_payments_owner ON billing_payments FOR ALL TO pono_owner
  USING (true) WITH CHECK (true);
GRANT SELECT ON billing_payments TO pono_app;

-- A payment: the plan runs `p_days` more, from today or from the end of the period already paid.
CREATE FUNCTION pay_organization_plan(
  p_organization uuid, p_plan text, p_customer text, p_payment text, p_days integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  counted integer;
BEGIN
  IF p_plan NOT IN ('solo', 'pro') THEN RAISE EXCEPTION 'unknown paid plan %', p_plan; END IF;
  INSERT INTO billing_payments (id, organization_id, plan, days)
    VALUES (p_payment, p_organization, p_plan, p_days) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS counted = ROW_COUNT;
  IF counted = 0 THEN RETURN; END IF;
  PERFORM set_config('pono.organization_id', p_organization::text, true);
  UPDATE organizations
    SET plan = p_plan,
        billing_customer = coalesce(p_customer, billing_customer),
        plan_paid_until = greatest(now(), coalesce(plan_paid_until, now())) + make_interval(days => p_days)
    WHERE id = p_organization;
  INSERT INTO journal (organization_id, action, channel, detail)
    VALUES (p_organization, 'plan.paid', 'system',
      jsonb_build_object('plan', p_plan, 'days', p_days));
END;
$$;

-- The periodic task: every paid period that ended goes back to the free plan.
CREATE FUNCTION expire_paid_plans() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  org record;
  n integer := 0;
BEGIN
  FOR org IN SELECT id FROM organizations
    WHERE plan_paid_until IS NOT NULL AND plan_paid_until < now() AND plan <> 'free'
  LOOP
    PERFORM set_config('pono.organization_id', org.id::text, true);
    UPDATE organizations SET plan = 'free', plan_paid_until = NULL WHERE id = org.id;
    INSERT INTO journal (organization_id, action, channel, detail)
      VALUES (org.id, 'plan.changed', 'system', jsonb_build_object('plan', 'free', 'reason', 'period_ended'));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION pay_organization_plan(uuid, text, text, text, integer), expire_paid_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pay_organization_plan(uuid, text, text, text, integer), expire_paid_plans() TO pono_app;
