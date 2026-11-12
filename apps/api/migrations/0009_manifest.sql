-- The project's manifest, `pono.yaml` (D-014): read from the repository, never the other way round.
-- A project is either launched from a template or adopted; adoption proposes the file in a pull
-- request the person merges.

ALTER TABLE projects
  ADD COLUMN origin text NOT NULL DEFAULT 'adopted' CHECK (origin IN ('template', 'adopted')),
  ADD COLUMN template text,
  ADD COLUMN manifest_status text NOT NULL DEFAULT 'missing'
    CHECK (manifest_status IN ('present', 'proposed', 'invalid', 'missing', 'unknown')),
  ADD COLUMN manifest jsonb,
  ADD COLUMN manifest_problems jsonb,
  ADD COLUMN manifest_proposal_url text,
  ADD COLUMN manifest_read_at timestamptz;
