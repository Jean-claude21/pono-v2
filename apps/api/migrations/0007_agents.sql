-- Agents' access (phase 3): a person gives an agent a token, read-only or read and act, in the
-- console. Only its hash is kept; the token reaches Pono's MCP server as a bearer.

CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  scope text NOT NULL CHECK (scope IN ('read', 'act')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_tokens_isolation ON agent_tokens
  USING (organization_id = pono_current_organization())
  WITH CHECK (organization_id = pono_current_organization());
-- The lookup below runs as the owner, before any organization is known.
CREATE POLICY agent_tokens_owner_lookup ON agent_tokens FOR SELECT TO pono_owner USING (true);
CREATE POLICY agent_tokens_owner_touch ON agent_tokens FOR UPDATE TO pono_owner USING (true);

GRANT SELECT, INSERT, UPDATE ON agent_tokens TO pono_app;

CREATE FUNCTION agent_by_token(p_token_hash text)
  RETURNS TABLE (id uuid, organization_id uuid, person_id uuid, name text, scope text, login text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  UPDATE agent_tokens SET last_used_at = now() WHERE agent_tokens.token_hash = p_token_hash AND revoked_at IS NULL;
  RETURN QUERY
    SELECT t.id, t.organization_id, t.person_id, t.name, t.scope, p.login
    FROM agent_tokens t JOIN people p ON p.id = t.person_id
    WHERE t.token_hash = p_token_hash AND t.revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION agent_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_by_token(text) TO pono_app;
