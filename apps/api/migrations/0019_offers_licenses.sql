-- Offers set by the operator (D-041): each plan's price, its servers awake at once, and whether it is
-- sold now, coming soon or on request; how it is sold by licence (Chariow product, days bought).
CREATE TABLE plan_offers (
  plan text PRIMARY KEY CHECK (plan IN ('free', 'solo', 'pro')),
  availability text NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'coming_soon', 'on_request')),
  price_micros bigint NOT NULL CHECK (price_micros >= 0),
  active_servers integer NOT NULL CHECK (active_servers BETWEEN 1 AND 100),
  licence_product text,
  licence_days integer NOT NULL DEFAULT 30 CHECK (licence_days BETWEEN 1 AND 3660),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plan_offers (plan, price_micros, active_servers) VALUES
  ('free', 0, 1), ('solo', 12000000, 3), ('pro', 39000000, 10);

-- Everyone reads the offers (the landing, the console); only the operator's function writes them.
ALTER TABLE plan_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_offers_read ON plan_offers FOR SELECT TO pono_app USING (true);
CREATE POLICY plan_offers_owner ON plan_offers FOR ALL TO pono_owner USING (true) WITH CHECK (true);
GRANT SELECT ON plan_offers TO pono_app;

CREATE FUNCTION admin_set_offer(
  p_plan text, p_availability text, p_price_micros bigint, p_active_servers integer,
  p_licence_product text, p_licence_days integer
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE plan_offers SET availability = p_availability, price_micros = p_price_micros,
      active_servers = p_active_servers, licence_product = nullif(p_licence_product, ''),
      licence_days = p_licence_days, updated_at = now()
    WHERE plan = p_plan
  $$;

-- The operator's settings (D-041): a payment provider's key or a contact address, set from the
-- console. Secret values arrive sealed by the API; no role reads the table, only these functions.
CREATE TABLE platform_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  value text NOT NULL,
  sealed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_owner ON platform_settings FOR ALL TO pono_owner
  USING (true) WITH CHECK (true);

CREATE FUNCTION admin_set_setting(p_key text, p_value text, p_sealed boolean)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF p_value IS NULL OR p_value = '' THEN
    DELETE FROM platform_settings WHERE key = p_key;
  ELSE
    INSERT INTO platform_settings (key, value, sealed) VALUES (p_key, p_value, p_sealed)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, sealed = excluded.sealed, updated_at = now();
  END IF;
END;
$$;

CREATE FUNCTION platform_setting(p_key text)
  RETURNS TABLE (value text, sealed boolean, updated_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT value, sealed, updated_at FROM platform_settings WHERE key = p_key $$;

-- A licence is counted once, for one organization: its id is the payment's (billing_payments.id is
-- the primary key), so a key entered in a second workshop buys nothing there.
CREATE FUNCTION licence_owner(p_payment text)
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT organization_id FROM billing_payments WHERE id = p_payment $$;

REVOKE ALL ON FUNCTION admin_set_offer(text, text, bigint, integer, text, integer),
  admin_set_setting(text, text, boolean), platform_setting(text), licence_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_offer(text, text, bigint, integer, text, integer),
  admin_set_setting(text, text, boolean), platform_setting(text), licence_owner(text) TO pono_app;
