# Pono — contexte du projet

> Le seul endroit où vit le contexte. `AGENTS.md` y renvoie.

## Ordre de lecture, avant toute action

1. `docs/MANDAT.md` — pour qui, quel bien, à quel prix moral.
2. `docs/PRINCIPES.md` — les invariants.
3. `docs/DECISIONS.md` — ce qui est tranché. Ne pas retrancher.
4. `docs/ROADMAP.md` — les phases et leurs preuves.
5. `.specify/memory/constitution.md` — la constitution du cycle Spec Kit.

## Le produit, en une phrase

Le cadre unique de tous les projets construits par agent : leur état, ce qu'ils coûtent, un serveur
prêt pour chaque projet lancé, et une production qui obéit à la règle choisie.

## Phase en cours

**v1.** Phases 0 à 22 codées, testées et déployées sur `pono.kete.digital` (`specs/001` à `023`).
Un template mène un projet en production par Pono seul (D-036, D-037). Restent les gestes de
l'auteur listés dans `docs/ROADMAP.md`, puis, après la v1 : l'agent sur le serveur, la copie d'un
serveur, la galerie des créateurs.

## Lancer en local

```bash
pnpm db:dev                                   # Postgres 17 local sur 54340, migrations, apps/api/.env
cd apps/api && PONO_ADMIN_LOGINS=<login> pnpm exec tsx watch --env-file-if-exists=.env \
  --env-file-if-exists=../../../.secrets/.admin.env src/main.ts
pnpm dev:web                                  # console sur :3000 (relaie /auth, /v1, /mcp)
pnpm --filter @pono/api exec tsx scripts/e2e-live.ts   # parcours complet contre les vrais fournisseurs
GITHUB_TOKEN=$(gh auth token) pnpm --filter @pono/api exec tsx scripts/multi-user-live.ts  # trois personnes, trois serveurs
GITHUB_TOKEN=$(gh auth token) node --env-file=../../../.secrets/.admin.env --import tsx scripts/devloop-live.ts  # boucle de dev réelle (depuis apps/api)
```

## Carte du dépôt

```
apps/api/        l'API Hono : la seule porte (console, MCP, agents). src/features/<feature>
apps/web/        la console TanStack Start
packages/design/ le système visuel, source unique (style.css)
docs/            mandat, principes, décisions, roadmap, preuves (en français)
specs/           les phases Spec Kit
```

## Gestes interdits à l'agent

- Pousser sur `main` ou `dev`, ou contourner une protection de branche.
- Écrire un nom de fournisseur dans `domain/` ou `application/`.
- Créer une table sans sa politique RLS dans la même migration.
- Écrire un secret dans un fichier, un message, un journal ou un commit. Les secrets locaux de
  l'auteur sont dans `../.secrets/.admin.env` : on les charge, on ne les affiche jamais.
- Écrire un texte visible en dur dans un composant.
- Ajouter une dépendance `@kete/*` (D-001).

## Outillage

- Node 22+ · pnpm 11 · TypeScript strict · Vitest
- Postgres 17 local pour les tests (`PONO_PG_BIN`, par défaut `C:\Users\messa\dev-tools\pgsql\bin`)
- Spec Kit `v0.16.0` (scripts PowerShell dans `.specify/scripts/powershell`)
