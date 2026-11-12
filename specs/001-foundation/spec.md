# Feature Specification: Le socle

**Feature Branch**: `001-foundation`
**Created**: 2026-11-12
**Status**: Draft
**Input**: Phase 0 de `docs/ROADMAP.md` — un dépôt où l'on peut livrer vite et sans peur.

## User Scenarios & Testing

### User Story 1 — Les données d'une organisation restent les siennes (Priority: P1)

Deux organisations existent. Ce que l'une écrit, l'autre ne le lit jamais, même si le code de
l'application oublie de filtrer.

**Why this priority**: c'est la frontière dure du produit (principe 4). Tout ce qui suit s'appuie
dessus.

**Independent Test**: créer deux organisations, écrire dans chacune, lire depuis l'autre avec le
rôle applicatif : zéro ligne étrangère.

**Acceptance Scenarios**:

1. **Given** deux organisations A et B, **When** l'application lit les organisations dans le
   contexte de A, **Then** elle ne voit que A.
2. **Given** aucun contexte d'organisation, **When** l'application lit une table d'organisation,
   **Then** elle ne voit rien.
3. **Given** le rôle applicatif, **When** il tente de désactiver le RLS ou de lire en
   propriétaire, **Then** c'est refusé.

### User Story 2 — L'API répond et dit son état (Priority: P1)

Un service qui surveille Pono appelle `/health` et sait si l'API et sa base répondent.

**Acceptance Scenarios**:

1. **Given** la base joignable, **When** on appelle `GET /health`, **Then** `200` et
   `{ status: "ok", database: "ok" }`.
2. **Given** la base injoignable, **When** on appelle `GET /health`, **Then** `503` et
   `database: "down"`.
3. **Given** une route inconnue, **When** on l'appelle, **Then** `404` avec un code d'erreur stable
   `route.not_found`.

### User Story 3 — La console s'ouvre, en français ou en anglais (Priority: P2)

Une personne ouvre la console : elle voit la coquille de l'atelier (rail, titre), dans sa langue.

**Acceptance Scenarios**:

1. **Given** un navigateur en français, **When** la console s'ouvre, **Then** les textes sont en
   français.
2. **Given** le choix « EN », **When** la page se recharge, **Then** les textes restent en anglais.
3. **Given** le code de la console, **When** le contrôle des textes en dur passe, **Then** aucun
   texte visible n'est écrit dans un composant.

### Edge Cases

- Une variable d'environnement manquante : l'API refuse de démarrer et nomme la variable, sans
  afficher de valeur.
- Une migration déjà appliquée : elle n'est pas rejouée.
- Une migration qui échoue : rien n'est appliqué d'elle (transaction).

## Requirements

### Functional Requirements

- **FR-001**: Le dépôt est un monorepo pnpm : `apps/api`, `apps/web`, `packages/design`.
- **FR-002**: TypeScript strict, ESLint, Prettier et Vitest sont posés ; `pnpm check` et
  `pnpm test` les exécutent.
- **FR-003**: Les migrations SQL sont versionnées, appliquées dans l'ordre, une seule fois, chacune
  dans une transaction, par le rôle propriétaire.
- **FR-004**: Les rôles `pono_owner` et `pono_app` existent (créés par l'administrateur de la base) ; la première migration crée les tables
  `organizations` et `members` avec RLS **forcée** et leurs politiques.
- **FR-005**: L'API ouvre chaque travail d'organisation dans une transaction qui fixe
  `pono.organization_id` ; sans lui, une table d'organisation ne renvoie rien.
- **FR-006**: L'API valide sa configuration avec Zod au démarrage.
- **FR-007**: `GET /health` dit l'état de l'API et de la base.
- **FR-008**: Les erreurs de l'API ont la forme `{ error: { code, message } }` avec un code stable.
- **FR-009**: La console rend la coquille de l'atelier sur `@pono/design`, en français et en
  anglais, la langue choisie gardée dans un cookie.
- **FR-010**: Un script refuse tout texte visible en dur dans les composants de la console.
- **FR-011**: Une CI GitHub Actions exécute `pnpm check` et `pnpm test`.

### Key Entities

- **Organization** : la frontière dure ; un nom, une date.
- **Member** : une personne dans une organisation, avec un rôle (`owner`, `member`).

## Success Criteria

- **SC-001**: `pnpm check` et `pnpm test` passent sur une copie propre du dépôt.
- **SC-002**: Le test d'isolation prouve qu'aucune ligne d'une organisation n'est lisible depuis une
  autre, sur chaque table créée.
- **SC-003**: La console s'affiche en français et en anglais sans texte en dur.
