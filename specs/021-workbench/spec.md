# Feature Specification: L'atelier de code, les skills en dossiers, les services par connexion

**Feature Branch**: `021-workbench` · **Created**: 2026-11-14 · **Status**: Implemented
**Input**: l'auteur — « va vérifier les systèmes de code open source » ; « les skills vont au-delà
d'un seul fichier » ; « évite au maximum les clés API » ; « que l'agent dise au novice quel service
relier » ; D-028, D-029.

## User Scenarios & Testing

- **US1 (P1)** Un agent de chat modifie le code sans le casser : une modification qui casse la
  syntaxe est refusée, une autre se défait, plusieurs fichiers changent d'un coup.
- **US2 (P1)** Les skills d'un projet arrivent à l'agent peu à peu et sur le serveur, au format
  standard, avec leurs fichiers.
- **US3 (P1)** La personne voit ce qu'il lui manque pour aller jusqu'en ligne, et relie un service
  en se connectant chez lui ou en ouvrant la bonne page de clés.
- **US4 (P1)** Un novice demande « mets en ligne » sans hébergeur : l'agent le lui dit simplement,
  avec le lien, puis continue.

## Success Criteria

- **SC-001** Prouvé le 2026-11-14 sur Agent37 et GitHub, par MCP seulement (`scripts/code-live.ts`) :
  skills installées hors de git, carte du dépôt, modification cassante refusée, `apply_patch` sur
  deux fichiers, `undo_edit`, poussée sur `dev`, en 32 s.
- **SC-002** `[auteur]` L'application OAuth de Pono chez Netlify, puis une connexion par clic en ligne.
