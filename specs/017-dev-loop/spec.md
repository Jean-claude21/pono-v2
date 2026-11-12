# Feature Specification: La boucle de dev sur le serveur du projet

**Feature Branch**: `017-dev-loop` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: l'auteur — « comment l'écriture du code sera faite sur le serveur distant ? le hot
reload en temps réel ? » et « que l'utilisateur ait les infos sur les liens et les process en cours
naturellement quand il code » ; D-020, D-021.

## User Scenarios & Testing

### US1 — Lancer le serveur de dev (P1)

Pono récupère le dépôt sur le serveur du projet, sur la branche `dev`, lit comment le lancer
(`dev:` dans `pono.yaml`, sinon `package.json` : gestionnaire de paquets par fichier de verrou, port,
hôte), installe, lance en arrière-plan, publie le port : une adresse de preview.

### US2 — Le rechargement à chaud (P1)

Un fichier modifié sur le serveur recharge la preview tout seul (le rechargement de la stack, à
travers l'adresse publique).

### US3 — Pousser vers `dev`, jamais ailleurs (P1)

Pono contrôle les secrets des fichiers modifiés ; un secret arrête la poussée et nomme fichier et
ligne. La production ne s'atteint que par une proposition.

### US4 — Coder depuis sa machine (P1)

Une poussée vers `dev` faite ailleurs est ramenée sur le serveur (`pull_changes`, ou le webhook
signé du fournisseur de code) ; la preview suit.

### US5 — Savoir où on en est, sans demander (P1)

Console (section Développement), MCP (`dev_status`…), et le plugin Claude Code : contexte au début de
chaque session, ligne de statut, commandes. Pour Codex : MCP et `AGENTS.md`.

## Success Criteria

- **SC-001**: Sur un vrai serveur Agent37 et un vrai dépôt GitHub, toute la boucle en moins de 20 s.
- **SC-002**: Un serveur de dev qui s'arrête sur une erreur se dit « arrêté sur une erreur », avec son journal.
