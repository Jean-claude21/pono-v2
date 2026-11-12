-- How much a person wants to decide (D-015): « do it all for me », « let me choose a little », or
-- « I know what I'm doing ». Null until asked. People stay global: the app role reaches the column
-- only through the functions below.

ALTER TABLE people
  ADD COLUMN level text CHECK (level IN ('guided', 'choosing', 'expert'));

CREATE FUNCTION person_level(p_person uuid)
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT level FROM people WHERE id = p_person $$;

CREATE FUNCTION set_person_level(p_person uuid, p_level text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE people SET level = p_level WHERE id = p_person $$;

REVOKE ALL ON FUNCTION person_level(uuid), set_person_level(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_level(uuid), set_person_level(uuid, text) TO pono_app;
