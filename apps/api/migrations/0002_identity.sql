-- People and their sessions are global: a person exists before any organization. The app role has
-- no access to these tables; it goes through the functions below (SECURITY DEFINER).

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  login text NOT NULL,
  name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE people ENABLE ROW LEVEL SECURITY;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- The functions below run as the owner, which row-level security still applies to on the
-- organization tables (FORCE): these policies let the owner role read them, never the app role.
CREATE POLICY organizations_owner_read ON organizations FOR SELECT TO pono_owner USING (true);
CREATE POLICY members_owner_read ON members FOR SELECT TO pono_owner USING (true);

CREATE FUNCTION upsert_person(p_external_id text, p_login text, p_name text, p_email text)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO people (external_id, login, name, email)
    VALUES (p_external_id, p_login, p_name, p_email)
    ON CONFLICT (external_id) DO UPDATE
      SET login = excluded.login, name = excluded.name, email = coalesce(excluded.email, people.email)
    RETURNING id
  $$;

CREATE FUNCTION open_session(p_person uuid, p_token_hash text, p_expires_at timestamptz)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO sessions (person_id, token_hash, expires_at) VALUES (p_person, p_token_hash, p_expires_at) $$;

CREATE FUNCTION person_by_session(p_token_hash text)
  RETURNS TABLE (id uuid, login text, name text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT p.id, p.login, p.name, p.email
    FROM sessions s JOIN people p ON p.id = s.person_id
    WHERE s.token_hash = p_token_hash AND s.expires_at > now()
  $$;

CREATE FUNCTION close_session(p_token_hash text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ DELETE FROM sessions WHERE token_hash = p_token_hash $$;

CREATE FUNCTION organizations_of(p_person uuid)
  RETURNS TABLE (id uuid, name text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id, o.name, m.role
    FROM members m JOIN organizations o ON o.id = m.organization_id
    WHERE m.person_id = p_person
    ORDER BY o.created_at
  $$;

REVOKE ALL ON FUNCTION upsert_person(text, text, text, text), open_session(uuid, text, timestamptz),
  person_by_session(text), close_session(text), organizations_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_person(text, text, text, text), open_session(uuid, text, timestamptz),
  person_by_session(text), close_session(text), organizations_of(uuid) TO pono_app;
