# Research — Le socle

## R-01 — Tester contre un vrai Postgres sans Docker

- **Décision** : les tests démarrent un Postgres 17 local (`initdb` + `pg_ctl` dans un dossier
  temporaire, port libre), créent les rôles et appliquent les migrations ; `PONO_TEST_DATABASE_URL`
  permet d'utiliser une base existante (branche Neon `test`, CI).
- **Pourquoi** : le RLS ne se prouve que sur Postgres ; Docker n'est pas requis sur le poste de
  l'auteur, et les binaires Postgres 17 y sont installés.
- **Rejeté** : pg-mem et PGlite pour l'isolation, qui ne prouvent pas les rôles réels.

## R-02 — RLS forcée et contexte d'organisation

- **Décision** : `ALTER TABLE … FORCE ROW LEVEL SECURITY` et une politique
  `organization_id = nullif(current_setting('pono.organization_id', true), '')::uuid`. L'API fixe le
  réglage avec `set_config(..., true)` au début de chaque transaction.
- **Pourquoi** : sans réglage, `current_setting(..., true)` renvoie `NULL` et la politique ne laisse
  rien passer.

## R-03 — Migrations SQL

- **Décision** : fichiers `NNNN_name.sql`, table `schema_migrations(version, applied_at)`, une
  transaction par fichier, exécutés par le rôle propriétaire.
- **Pourquoi** : le RLS et les rôles sont du SQL ; un outil de plus n'apporterait rien ici.

## R-04 — Langue de la console

- **Décision** : Paraglide JS, catalogues `messages/{fr,en}.json`, cookie `pono_locale`, sinon la
  langue du navigateur, sinon le français.
- **Pourquoi** : c'est l'outil des autres projets de l'auteur ; les messages sont typés et seuls
  ceux utilisés partent dans le paquet.
