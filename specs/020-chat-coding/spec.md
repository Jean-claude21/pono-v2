# Feature Specification: Coder depuis n'importe quel chat

**Feature Branch**: `020-direct-start` · **Created**: 2026-11-13 · **Status**: Implemented
**Input**: l'auteur — « la personne doit pouvoir coder depuis son mobile, son PC, tout à partir du
chat » ; « quand une personne se connecte, guide-la jusqu'à joindre le MCP » ; « pourquoi la
question au début ? » ; D-026, D-027.

## User Scenarios & Testing

### US1 — Coder sans machine (P1)

Depuis Claude ou ChatGPT, l'agent démarre le serveur du projet, lit et modifie le code, lance une
commande, et la preview publique change ; il pousse vers `dev` après le contrôle des secrets.

### US2 — Relier son agent sans clé (P1)

La personne colle l'adresse MCP de Pono dans son assistant et autorise : l'étape se coche dès le
premier appel de l'agent, sans recharger.

### US3 — Entrer sans question (P1)

Après la connexion GitHub, la console s'ouvre directement, avec trois étapes facultatives : GitHub,
l'agent, un premier projet.

## Requirements

- **FR-001** Outils MCP : `list_files`, `search_code`, `read_file`, `edit_file`, `write_file`,
  `move_file`, `delete_file`, `show_changes`, `run_command`, `command_output`.
- **FR-002** Chemins dans le dépôt seulement ; écriture et commandes réservées à « Lecture et
  actions » ; journal ; valeurs de développement masquées.
- **FR-003** Modifications exactes, tout ou rien, avec diff ; lecture par plages numérotées ;
  sorties et durées bornées.
- **FR-004** Aucun écran bloquant après la connexion ; démarrage en trois étapes sur la vue
  d'ensemble ; la page Agents commence par relier un agent.

## Success Criteria

- **SC-001** Prouvé le 2026-11-13 sur un vrai serveur Agent37 et GitHub, uniquement par MCP
  (`scripts/code-live.ts`) : modification visible dans la preview publique en moins d'une seconde,
  poussée sur `dev` en 22 s de bout en bout.
- **SC-002** Un assistant relié par OAuth en production (Claude.ai) : geste de l'auteur.
