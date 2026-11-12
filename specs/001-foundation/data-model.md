# Data Model — Le socle

## Rôles

| Rôle         | Usage      | Droits                                                                                |
| ------------ | ---------- | ------------------------------------------------------------------------------------- |
| `pono_owner` | migrations | propriétaire des tables                                                               |
| `pono_app`   | API        | `SELECT, INSERT, UPDATE, DELETE` sur les tables ; `NOBYPASSRLS` ; jamais propriétaire |

## `organizations`

| Colonne      | Type          | Règle               |
| ------------ | ------------- | ------------------- |
| `id`         | `uuid` PK     | `gen_random_uuid()` |
| `name`       | `text`        | 1 à 120 caractères  |
| `created_at` | `timestamptz` | `now()`             |

Politique : une ligne est visible si `id` = organisation du contexte. L'insertion d'une
organisation passe par la fonction `create_organization(name, person_id)` (`SECURITY DEFINER`), qui
crée aussi le premier membre `owner`.

## `members`

| Colonne           | Type          | Règle                                   |
| ----------------- | ------------- | --------------------------------------- |
| `id`              | `uuid` PK     |                                         |
| `organization_id` | `uuid` FK     | `organizations(id)` on delete cascade   |
| `person_id`       | `uuid`        | la personne (table `people` en phase 1) |
| `role`            | `text`        | `owner` ou `member`                     |
| `created_at`      | `timestamptz` |                                         |

Unicité `(organization_id, person_id)`. Politique : `organization_id` = organisation du contexte.
