# Feature Specification: Le niveau de la personne, GitHub d'abord

**Feature Branch**: `010-profile` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: l'auteur — « en fonction de son niveau, on lui donne le choix des technologies, ou on
prend tout et on le fait » ; « il passe par GitHub directement » ; D-015.

## User Scenarios & Testing

### US1 — Dire comment on veut travailler (P1)

Après la première connexion, la personne choisit : « Fais tout pour moi », « Je veux choisir un
peu », « Je sais ce que je fais ». Elle le change dans les réglages.

### US2 — L'agent suit la même réponse (P1)

`get_profile` rend le niveau et la conduite à tenir ; sans niveau, l'agent pose une seule question
et l'enregistre avec `set_level`.

### US3 — Entrer par GitHub (P1)

La connexion passe par GitHub : le compte et l'accès aux dépôts en un geste. L'écran dit pourquoi et
propose de créer un compte GitHub gratuit.

## Success Criteria

- **SC-001**: Un niveau enregistré par l'agent se lit dans la console, et l'inverse.
