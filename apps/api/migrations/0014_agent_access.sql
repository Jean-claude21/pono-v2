-- How agents reach what they need, without ever seeing what they must not (D-007, D-019).
--
-- 1. Development variables of a project: a person sets each value in the console; it is sealed,
--    sent only to the project's development server, never shown again, never to an agent. An agent
--    may only ask for a name, with its reason.
-- 2. OAuth 2.1 for MCP clients (the Claude.ai connector): clients register themselves; a person
--    approves in the console; the grant becomes an agent token, cut like any other.

CREATE TABLE project_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[A-Z][A-Z0-9_]{0,63}$' AND name NOT LIKE 'PONO\_%'),
  sealed_value text,
  requested_reason text CHECK (char_length(requested_reason) <= 280),
  set_by uuid,
  set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
ALTER TABLE project_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_variables FORCE ROW LEVEL SECURITY;
CREATE POLICY project_variables_isolation ON project_variables
  USING (organization_id = pono_current_organization())
  WITH CHECK (organization_id = pono_current_organization());
GRANT SELECT, INSERT, UPDATE, DELETE ON project_variables TO pono_app;

-- OAuth clients are global: they register before anyone signs in.
CREATE TABLE oauth_clients (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;

CREATE TABLE oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read', 'act')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION oauth_register(p_id text, p_name text, p_redirect_uris text[])
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (p_id, p_name, p_redirect_uris) $$;

CREATE FUNCTION oauth_client(p_id text)
  RETURNS TABLE (id text, name text, redirect_uris text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id, name, redirect_uris FROM oauth_clients WHERE id = p_id $$;

CREATE FUNCTION oauth_issue_code(p_code_hash text, p_client text, p_org uuid, p_person uuid,
                                 p_redirect text, p_challenge text, p_scope text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO oauth_codes (code_hash, client_id, organization_id, person_id, redirect_uri, code_challenge, scope, expires_at)
    VALUES (p_code_hash, p_client, p_org, p_person, p_redirect, p_challenge, p_scope, now() + interval '10 minutes')
  $$;

-- A code is used once: the first redemption marks it, a second one finds nothing.
CREATE FUNCTION oauth_redeem_code(p_code_hash text)
  RETURNS TABLE (client_id text, organization_id uuid, person_id uuid, redirect_uri text,
                 code_challenge text, scope text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE oauth_codes SET used_at = now()
    WHERE code_hash = p_code_hash AND used_at IS NULL AND expires_at > now()
    RETURNING client_id, organization_id, person_id, redirect_uri, code_challenge, scope
  $$;

REVOKE ALL ON FUNCTION oauth_register(text, text, text[]), oauth_client(text),
  oauth_issue_code(text, text, uuid, uuid, text, text, text), oauth_redeem_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oauth_register(text, text, text[]), oauth_client(text),
  oauth_issue_code(text, text, uuid, uuid, text, text, text), oauth_redeem_code(text) TO pono_app;
