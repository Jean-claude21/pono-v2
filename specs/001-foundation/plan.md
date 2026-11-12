# Implementation Plan: Le socle

**Branch**: `001-foundation` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Poser un monorepo TypeScript où l'API Hono, la base Postgres sous RLS forcée et la console TanStack
Start existent, se testent et se contrôlent en une commande.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22+ (ESM)
**Primary Dependencies**: Hono 4 et `@hono/node-server`, Zod 4, `pg` 8 ; TanStack Start (React 19)
**Storage**: Postgres 17 (Neon en ligne)
**Testing**: Vitest ; un Postgres 17 local démarré par les tests (`initdb` dans un dossier
temporaire, port libre), ou `PONO_TEST_DATABASE_URL`
**Target Platform**: serveur Linux (conteneur) ; développement sous Windows
**Project Type**: web (API + console)
**Constraints**: aucun secret affiché ; aucun fournisseur dans le cœur
**Scale/Scope**: socle seulement

## Constitution Check

| Principe               | Comment il est tenu                                                       |
| ---------------------- | ------------------------------------------------------------------------- |
| I. Simple              | Deux apps, un paquet ; aucune fonctionnalité métier                       |
| III. Aucun fournisseur | Aucun adaptateur dans cette phase                                         |
| IV. Sécurité en base   | RLS forcée dès la première migration, rôle `pono_app` sans `BYPASSRLS`    |
| VI. Aucun secret       | Configuration validée ; erreurs qui nomment la variable, jamais la valeur |
| VIII. Preuve           | Test d'isolation, test de `/health`, contrôle des textes                  |

Aucune violation.

## Project Structure

```text
apps/api/
├── src/
│   ├── app.ts                 # createApp(deps): routes, erreurs
│   ├── main.ts                # démarrage du serveur
│   ├── platform/              # config, db (pools, withOrganization), errors, migrate
│   └── features/health/       # index.ts, routes.ts
├── migrations/0001_organizations.sql
└── tests/                     # setup Postgres, isolation, health, migrate
apps/web/
├── src/routes/                # __root.tsx, index.tsx
├── src/lib/i18n.ts            # catalogues fr/en, cookie
├── messages/fr.json, en.json
└── scripts/check-strings.mjs
packages/design/               # style.css, fonts
```

**Structure Decision** : monorepo pnpm à deux apps, comme l'ancien Pono, sans le SDK généré : la
console appellera l'API avec le client RPC typé de Hono (phase 1).
