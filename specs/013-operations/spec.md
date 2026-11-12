# Feature Specification: Les tâches de fond, Coolify, le retour arrière automatique, les alertes

**Feature Branch**: `013-operations` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: D-006 (mode automatique : « il revient en arrière seul si la production ne répond
plus »), la technologie libre jusqu'en production, les alertes hors console ; D-018.

## User Scenarios & Testing

### US1 — Pono relit tout, seul (P1)

Toutes les 15 minutes (pg-boss, un seul exécutant) : serveurs, projets, consommation de chaque
organisation, au canal `system`. Une organisation en échec n'arrête pas les autres.

### US2 — Le retour arrière automatique (P1)

Après une fusion faite par Pono en mode automatique, si la production ne répond plus dans l'heure,
Pono remet le déploiement précédent, une seule fois, le journalise et ouvre une alerte. Jamais après
la fusion d'une personne, jamais en mode « demander ».

### US3 — Les alertes par email (P1)

Chaque alerte nouvelle part aux membres de l'organisation (Resend), sans secret ni chiffre absent
de la console, une seule fois.

### US4 — Coolify, pour toute technologie (P1)

Une instance Coolify (adresse, jeton) héberge les backends en conteneur : application trouvée par
son dépôt, déploiements lus, retour arrière par épinglage du commit précédent.

## Success Criteria

- **SC-001**: Un projet automatique dont la production tombe est remis en arrière une fois, et la
  personne reçoit l'email.
