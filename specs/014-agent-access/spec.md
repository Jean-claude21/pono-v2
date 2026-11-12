# Feature Specification: L'accès des agents, sans jamais voir une valeur

**Feature Branch**: `014-agent-access` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: D-007, D-011 (« OAuth 2.1 avec enregistrement dynamique vient ensuite ») ; les
variables de dev et le contrôle des secrets avant commit restés ouverts en phase 4 ; D-019.

## User Scenarios & Testing

### US1 — Les variables de développement (P1)

La personne tape une valeur dans la fiche projet ; elle est scellée et part vers le serveur du projet
à son prochain démarrage. L'agent voit les noms (`list_variables`) et peut en demander un, avec sa
raison (`request_variable`) : la demande s'affiche dans la console, en alerte. Une valeur ne passe
jamais par une conversation ni par le journal ; un nom `PONO_` est refusé.

### US2 — Contrôler les secrets avant de commiter (P1)

`check_secrets` applique les règles du garde-fou de mise en ligne aux fichiers d'un lot, avant le
commit ; les constats nomment fichier et ligne, jamais la valeur.

### US3 — Le connecteur Claude.ai (P1)

OAuth 2.1 : métadonnées (RFC 9728, RFC 8414), enregistrement dynamique de clients publics, code
d'autorisation avec PKCE S256, approbation par une personne dans la console, retour après
connexion. L'accès accordé est un jeton d'agent, listé et coupé comme les autres. Un code ne sert
qu'une fois.

### US4 — Limiter le débit (P2)

Par appelant et par minute, sur `/auth`, `/oauth`, `/v1` et `/mcp` ; au-delà, 429 et `retry-after`.

## Success Criteria

- **SC-001**: Aucune valeur de variable ne se retrouve dans une réponse ni dans le journal.
- **SC-002**: Un client OAuth inconnu, une adresse de retour non https, un vérificateur faux sont refusés.
