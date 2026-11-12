# Feature Specification: Le catalogue sur trois niveaux

**Feature Branch**: `011-catalog` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: l'auteur — importer des templates depuis l'admin, laisser les utilisateurs créer les
leurs par MCP, intégrer Impeccable ; D-016.

## User Scenarios & Testing

### US1 — L'exploitant importe un template officiel (P1)

Il donne un dépôt qui porte `pono-template.yaml` et ses skills dans `.pono/skills/*.md`. Pono le lit,
le valide, publie le template et ses skills pour tous, et fait du dépôt le dépôt de départ : les
projets lancés en sont générés.

### US2 — Une organisation garde sa façon de faire (P1)

Dans la console ou par MCP (`create_skill`, `save_as_template`), une organisation crée ses skills
(architecture ou design ; la sûreté reste celle de Pono) et fait d'un projet son template. Ils sont
privés.

### US3 — Le partage passe par l'exploitant (P1)

`share_with_everyone` propose ; l'exploitant relit le texte du skill et partage, refuse ou retire.
Un skill est un texte que l'agent exécute : rien n'est vu des autres sans cette relecture.

### US4 — Impeccable, figé (P2)

Le skill `impeccable` épingle une version relue (4.8.0) ; un serveur lancé avec lui reçoit cette
version.

## Success Criteria

- **SC-001**: Un template importé est visible de tous et lance un projet généré depuis son dépôt.
- **SC-002**: Un skill privé n'est pas vu d'une autre organisation avant l'approbation.
