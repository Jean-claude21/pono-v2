# Feature Specification: Templates et skills

**Feature Branch**: `005-project-servers` (livré avec le lancement) · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: Phase 6 de `docs/ROADMAP.md`.

## User Scenarios & Testing

### US1 — Choisir un point de départ (P1)

Sept templates (projet vide, rendez-vous, boutique, caisse, SaaS, vitrine, outil interne), chacun
avec sa stack et ses skills.

### US2 — Lancer en une fois (P1)

Lancer crée le dépôt dans le compte de la personne avec son `pono.yaml`, l'importe, lui donne son
serveur avec les skills du template. La place est vérifiée d'abord : rien n'est créé si le plan est
plein. La durée est journalisée.

### US3 — Les skills servis (P1)

Huit skills servis par l'API et par MCP (`get_skill`), lus depuis le dépôt de Pono.

## Success Criteria

- **SC-001**: Un template mène un vrai projet en production (preuve de la phase).
