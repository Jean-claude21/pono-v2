# Feature Specification: Les serveurs de projet

**Feature Branch**: `005-project-servers` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: Phase 4 de `docs/ROADMAP.md` — une phrase, et le projet a son serveur (D-003, D-004).

## User Scenarios & Testing

### US1 — Donner un serveur à un projet (P1)

Le serveur est créé chez le fournisseur avec l'agent choisi, un plafond de dépense, la veille après
30 minutes ; ses variables ne portent que le projet et ses skills, jamais une clé de production.

### US2 — La limite du plan (P1)

Découverte 1, Solo 3, Pro 10 serveurs actifs. Les serveurs en veille ne comptent pas. Au-delà, rien
n'est créé : la réponse nomme les serveurs actifs, la personne en choisit un à mettre en veille.

### US3 — Veille, réveil, rendu (P1)

L'état suit le fournisseur (la veille automatique se fait chez lui). Rendre un serveur le supprime
chez le fournisseur. Chaque geste est journalisé ; chaque serveur compte dans la consommation comme
`estimé`.

## Success Criteria

- **SC-001**: Sur le vrai compte Agent37 : création, veille, réveil, suppression.
- **SC-002**: Le second serveur sur le plan Découverte est refusé et nomme le projet qui occupe la place.
