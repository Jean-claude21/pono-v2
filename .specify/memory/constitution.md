# Pono — Constitution

> Dérivée de `docs/MANDAT.md`, `docs/PRINCIPES.md` et `docs/DECISIONS.md`. Elle gouverne le cycle
> Spec Kit (specify → clarify → plan → tasks → analyze → implement → converge). Tout agent s'y
> conforme. Les principes de livraison priment sur l'élégance technique.

## Core Principles

### I. Simple et qui marche — NON NÉGOCIABLE

On livre la version la plus simple qui aide réellement quelqu'un. Rien ne passe à l'étape suivante
tant que l'étape en cours n'est pas livrée et prouvée.

### II. L'étape en cours seulement

Ce qui n'aide personne aujourd'hui va au backlog, jamais dans l'implémentation en cours.

### III. Aucun fournisseur dans le cœur — NON NÉGOCIABLE

`domain/` et `application/` ne nomment aucun fournisseur. Les fournisseurs vivent dans
`infrastructure/`, derrière un port. Un port est livré avec un adaptateur et un test.

### IV. La sécurité vit dans la base — NON NÉGOCIABLE

Chaque table porte `organization_id` et sa politique RLS dans la migration qui la crée. L'API se
connecte avec le rôle `pono_app`, qui ne contourne pas le RLS. Rien ne traverse les organisations.

### V. L'IA prépare, une personne décide

Un agent n'a jamais plus de droits que la personne. Chaque geste enregistre son auteur : qui, pour
qui, par quel canal. Les modes de mise en production suivent D-006.

### VI. Aucun secret en clair

Aucun secret dans le dépôt, un message, un journal ou une réponse d'API. `.env.example` documente
chaque variable. Ce qui doit être gardé est scellé (D-007).

### VII. Chaque chiffre dit sa source

Mesuré, estimé, déclaré ou indisponible (D-005).

### VIII. Rien n'est affirmé sans preuve

Une phase est finie quand sa preuve est écrite dans `docs/VERITE_ET_PREUVES.md`.

## Contraintes

- TypeScript strict partout ; Hono, TanStack Start, Zod, `pg`, Vitest (D-002).
- Code en anglais, `docs/` en français, écrans en français et en anglais par catalogue (D-009).
- Une fonctionnalité de l'API est une tranche verticale : `domain`, `application`, `routes`, un seul
  `index.ts` public.
- Des commandes nommées, jamais de mise à jour générique.
- Un README par paquet et par application.

## Workflow

- Branches : `main` (geste humain), `dev` (CI verte), `NNN-slug` par phase (D-010).
- Avant chaque tâche, les cinq questions : la seule chose à livrer ; la version la plus simple ;
  pour l'utilisateur ou pour nous ; que garderait-on si on livrait dans trois heures ; la personne
  qui attend est-elle aidée aujourd'hui.

**Version** : 1.0.0 | **Ratifiée** : 2026-11-12
