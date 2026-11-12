# Implementation Plan: L'atelier

**Branch**: `002-workshop` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Identité et sessions, connexions scellées, import d'un dépôt et relevé de son état chez GitHub,
Netlify, Cloudflare et Neon, puis les écrans de l'atelier.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22+
**Primary Dependencies**: Hono (cookies, routes), Zod, `pg`, `node:crypto` (AES-256-GCM, SHA-256)
**Storage**: Postgres ; migrations `0002_identity.sql`, `0003_workshop.sql`
**Testing**: Vitest ; adaptateurs testés sur des réponses enregistrées (un `fetch` simulé) ;
parcours de l'API de bout en bout avec un fournisseur d'identité simulé
**Constraints**: aucune clé en clair, aucun fournisseur dans `domain/` ni `application/`

## Constitution Check

| Principe                  | Comment il est tenu                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| III. Aucun fournisseur    | Ports dans `application/ports.ts` ; adaptateurs dans `infrastructure/`                                                                                      |
| IV. Sécurité en base      | `connections`, `projects`, `deployments`, `journal` : RLS forcée à la création ; `people` et `sessions` globales, lues par des fonctions `SECURITY DEFINER` |
| V. Auteur de chaque geste | `journal` en ajout seul (pas d'`UPDATE` ni de `DELETE` accordés)                                                                                            |
| VI. Aucun secret          | `seal`/`open` ; les réponses de l'API ne portent jamais `credential`                                                                                        |

## Project Structure

```text
apps/api/src/
├── platform/secrets.ts            # seal / open (AES-256-GCM)
├── platform/http.ts               # fetch JSON avec délai, erreurs de fournisseur
├── features/identity/             # people, sessions, sign-in, /me, middleware
├── features/connections/          # connect, list, revoke
├── features/projects/
│   ├── domain/state.ts            # règles d'état (FR-007)
│   ├── application/               # ports, importProject, refreshProject
│   ├── infrastructure/            # github.ts, netlify.ts, cloudflare.ts, neon.ts, links.ts
│   └── routes.ts
└── features/journal/
apps/web/src/routes/               # /, /projects/$id, /connections, /import, /sign-in
```

**Structure Decision** : une tranche par fonctionnalité ; les adaptateurs restent dans la tranche
qui les utilise tant qu'une seule s'en sert.
