-- A licence belongs to one workshop (D-043): claimed when Pono activates it, whether the plan came
-- from the store's payment (a Chariow sale) or from the key entered by hand. A key claimed by one
-- workshop is refused in another; claimed twice by the same one, it buys nothing more.
CREATE TABLE licence_claims (
  licence text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  sale text,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE licence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY licence_claims_read ON licence_claims FOR SELECT TO pono_app
  USING (organization_id = pono_current_organization());
CREATE POLICY licence_claims_owner ON licence_claims FOR ALL TO pono_owner
  USING (true) WITH CHECK (true);
GRANT SELECT ON licence_claims TO pono_app;

-- Claims a licence for a workshop: answers its owner, and whether this call claimed it.
CREATE FUNCTION claim_licence(p_licence text, p_organization uuid, p_sale text)
  RETURNS TABLE (owner uuid, fresh boolean) LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO licence_claims (licence, organization_id, sale)
    VALUES (p_licence, p_organization, p_sale) ON CONFLICT (licence) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN QUERY SELECT c.organization_id, inserted > 0 FROM licence_claims c WHERE c.licence = p_licence;
END;
$$;

-- Who holds a licence: its claim, or a payment counted before claims existed (0019).
CREATE OR REPLACE FUNCTION licence_owner(p_payment text)
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT coalesce(
      (SELECT organization_id FROM licence_claims WHERE licence = p_payment),
      (SELECT organization_id FROM billing_payments WHERE id = p_payment)
    )
  $$;

-- A sale counted for a workshop, to find it again when its licence arrives after it.
CREATE FUNCTION sale_licence(p_sale text)
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT licence FROM licence_claims WHERE sale = p_sale $$;

-- A Pulse delivery handled once, whatever the store retries (its delivery id).
CREATE TABLE store_deliveries (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE store_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY store_deliveries_owner ON store_deliveries FOR ALL TO pono_owner
  USING (true) WITH CHECK (true);

CREATE FUNCTION record_store_delivery(p_id text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO store_deliveries (id) VALUES (p_id) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION claim_licence(text, uuid, text), sale_licence(text),
  record_store_delivery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_licence(text, uuid, text), sale_licence(text),
  record_store_delivery(text) TO pono_app;
