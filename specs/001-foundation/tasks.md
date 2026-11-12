# Tasks: Le socle

**Input**: `specs/001-foundation/` (spec, plan, research, data-model)

## Phase 1 — Setup

- [x] T001 Monorepo pnpm : `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`
- [x] T002 [P] ESLint, Prettier, Vitest à la racine
- [x] T003 [P] Paquet `packages/design` (`@pono/design`) avec son README

## Phase 2 — US1 : l'isolation des organisations (P1)

- [x] T004 Migration `0001_organizations.sql` : rôles, tables, RLS forcée, `create_organization`
- [x] T005 `platform/migrate.ts` : application ordonnée, une fois, en transaction
- [x] T006 `platform/db.ts` : pools propriétaire et applicatif, `withOrganization`
- [x] T007 Harnais de test Postgres local (`tests/support/postgres.ts`)
- [x] T008 Test d'isolation (SC-002) et test des migrations

## Phase 3 — US2 : l'API répond (P1)

- [x] T009 `platform/config.ts` (Zod) et `platform/errors.ts`
- [x] T010 `features/health` et `app.ts` (404, erreurs stables)
- [x] T011 Tests de `/health` (base joignable, injoignable) et des erreurs
- [x] T012 `main.ts` et script `dev:api`

## Phase 4 — US3 : la console (P2)

- [x] T013 App TanStack Start, coquille de l'atelier sur `@pono/design`
- [x] T014 Catalogues fr/en, cookie de langue, sélecteur
- [x] T015 `scripts/check-strings.mjs` et test de la langue
- [x] T016 Build et rendu vérifiés dans le navigateur

## Phase 5 — Finition

- [x] T017 CI GitHub Actions
- [x] T018 READMEs ; preuve inscrite dans `docs/VERITE_ET_PREUVES.md`
