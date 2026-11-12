# Data Model — L'atelier

## Globales (pas d'organisation)

**people** : `id`, `code_host_id` (identifiant chez le fournisseur d'identité, unique),
`login`, `name`, `email` (facultatif), `created_at`. Accès applicatif seulement par
`upsert_person(...)` et `person_by_session(hash)` (`SECURITY DEFINER`).

**sessions** : `id`, `person_id`, `token_hash` (SHA-256, unique), `expires_at`, `created_at`.
Accès par `open_session`, `person_by_session`, `close_session`.

`organizations_of(person)` renvoie les organisations d'une personne (lecture de `members` hors
contexte, par une fonction `SECURITY DEFINER`).

## D'organisation (RLS forcée)

**connections** : `id`, `organization_id`, `provider` (identifiant opaque d'adaptateur), `kind`
(`code_host` | `hosting` | `database`), `account` (nom du compte chez le fournisseur), `status`
(`active` | `expired`), `sealed_credential` (texte, `NULL` après coupure), `created_by`,
`created_at`, `revoked_at`.

**projects** : `id`, `organization_id`, `name`, `repository` (`owner/name`), `default_branch`,
`hosting_provider`, `hosting_ref`, `hosting_status` (`found` | `missing` | `unknown`),
`database_provider`, `database_ref`, `database_status`, `production_url`, `link_status`
(`up` | `down` | `unknown` | `missing`), `last_commit_at`, `state`, `state_reason`,
`refreshed_at`, `created_at`. Unique `(organization_id, repository)`.

**deployments** : `id`, `organization_id`, `project_id`, `environment` (`production` | `preview`),
`status` (`building` | `succeeded` | `failed` | `cancelled`), `url`, `commit`, `created_at`
(chez le fournisseur). Le dernier par environnement fait foi.

**journal** : `id`, `organization_id`, `project_id` (facultatif), `action` (code stable),
`actor_person`, `channel` (`console` | `mcp` | `system`), `detail` (`jsonb`, jamais de secret),
`created_at`. `pono_app` : `SELECT, INSERT` seulement.
