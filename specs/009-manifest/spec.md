# Feature Specification: Le manifeste et l'adoption de tout projet

**Feature Branch**: `009-manifest` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: l'auteur — « peu importe le projet, on doit pouvoir le faire » ; le manifeste de l'ancien
Pono (`.pono/project.json`, pré-rempli depuis `project.yaml`, `.fluxio`, `stack.hcl`) ; D-014.

## User Scenarios & Testing

### US1 — Adopter n'importe quel dépôt (P1)
Un dépôt sans `pono.yaml`, dans n'importe quelle technologie, rejoint l'atelier. Pono pré-remplit le
fichier depuis un manifeste existant (atelier, Fluxio, Livio) puis la détection des fournisseurs, et
l'ouvre en pull request sur `pono/manifest`. La personne complète et fusionne. Par la console ou par
MCP (`adopt_project`, avec l'adresse Git du dossier).

### US2 — Le fichier fait foi (P1)
Un `pono.yaml` présent est lu à l'import et à la demande ; il complète l'hébergement et la base que la
détection n'a pas trouvés. Un fichier illisible nomme chaque problème par son chemin. Le mode de mise
en production n'est jamais lu du dépôt (D-006) : un fichier qui le contient est refusé.

### US3 — Des skills activables (P1)
Trois familles : sûreté, architecture et stack, design. Sûreté activée partout ; architecture et
design activés pour un projet lancé depuis un template, désactivés pour un projet adopté. Activer ou
désactiver propose le changement de `pono.yaml` ; les conventions du dépôt passent avant.

## Requirements
- **FR-001**: Schéma strict v1 (Zod), clés inconnues refusées ; écriture canonique avec la ligne de
  schéma pour les éditeurs.
- **FR-002**: Pono n'écrit jamais la branche de production : toute écriture est une pull request.
- **FR-003**: `resume_project` rend les skills actifs du projet et ce qu'il reste à faire du fichier.

## Success Criteria
- **SC-001**: Un dépôt Go sans manifeste, adopté par MCP, reçoit sa pull request `pono/manifest`.
- **SC-002**: Un fichier qui déclare `release.mode` est refusé et ne déclare aucune destruction.
