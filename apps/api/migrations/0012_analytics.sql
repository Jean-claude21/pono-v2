-- Site metrics (D-017): a project's visits, read at the analytics provider the person connected
-- (Umami first, PostHog). The site is named in pono.yaml; until it is merged, the project keeps it.

ALTER TABLE connections DROP CONSTRAINT connections_kind_check;
ALTER TABLE connections ADD CONSTRAINT connections_kind_check
  CHECK (kind IN ('code_host', 'hosting', 'database', 'ai', 'analytics'));

ALTER TABLE projects
  ADD COLUMN analytics_provider text,
  ADD COLUMN analytics_site text,
  ADD CHECK ((analytics_provider IS NULL) = (analytics_site IS NULL));
