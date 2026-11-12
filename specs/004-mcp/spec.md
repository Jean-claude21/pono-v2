# Feature Specification: Pono par MCP

**Feature Branch**: `004-mcp` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: Phase 3 de `docs/ROADMAP.md` — parler à Pono depuis sa conversation (D-008).

## User Scenarios & Testing

### US1 — Relier son agent (P1)

La personne donne un accès à un agent dans la console : lecture seule, ou lecture et actions. Le
jeton est montré une fois, avec la commande Claude Code ; Pono n'en garde que l'empreinte. Couper
l'accès refuse l'appel suivant.

### US2 — « On continue lectio » (P1)

Dans une conversation, l'agent reconnaît le projet par le nom dit, ou par le dépôt Git du dossier
courant ; quand deux projets répondent, il demande ; sinon il propose les projets récents.

### US3 — « Lance un projet avec Pono » (P1)

L'agent propose un template, lance le projet ; quand le plan est plein, la réponse nomme les
serveurs actifs et l'agent demande lequel mettre en veille.

## Requirements

- **FR-001**: `/mcp` en Streamable HTTP, sans état, derrière un jeton `Bearer pono_…`, joignable par
  l'origine de la console.
- **FR-002**: Outils annotés lecture seule ou action ; un jeton en lecture seule ne peut pas agir.
- **FR-003**: Aucun outil ne valide une mise en ligne, ne change le mode ni ne revient en arrière.
- **FR-004**: Chaque geste d'un agent est journalisé avec le canal `mcp`.

## Success Criteria

- **SC-001**: Un client MCP réel, passant par la console, reconnaît « lectio » et le dépôt d'un
  dossier, et reprend le projet.
