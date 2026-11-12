# Feature Specification: La mise en ligne sous garde-fou

**Feature Branch**: `006-guarded-release` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: Phase 5 de `docs/ROADMAP.md` et D-006.

## User Scenarios & Testing

### US1 — Chaque proposition est évaluée (P1)

Secrets, migrations, preview du commit exact. Le verdict est publié sur le commit (`pono/release`),
une seule fois par tête de proposition.

### US2 — Le mode du projet décide de la suite (P1)

- Demander : la proposition attend ; une personne valide cette version exacte, qui est fusionnée.
- Automatique : fusion seule si tout est vert.
- Sans validation : fusion seule, migrations et preview en avertissement, toujours bornée dans le
  temps ; un secret bloque toujours.

### US3 — Protéger, revenir en arrière (P2)

La production exige `pono/release`, administrateurs compris. Le retour arrière passe par
l'hébergeur. Un agent peut seulement le demander.

## Success Criteria

- **SC-001**: Une migration destructrice refusée ; une destruction déclarée seule acceptée.
- **SC-002**: Aucun agent ne valide, ne change le mode, ne revient en arrière.
