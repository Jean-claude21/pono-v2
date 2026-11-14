-- Where a project's server may connect, and its previews kept private (D-031).
-- 'open': anywhere (the default); 'limited': only the code host, the package registries, the host's
-- own services, and the domains the person added.

ALTER TABLE projects
  ADD COLUMN network text NOT NULL DEFAULT 'open' CHECK (network IN ('open', 'limited')),
  ADD COLUMN network_allow text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(network_allow) <= 60);
