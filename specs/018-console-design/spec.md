# Feature Specification: La console au nouveau design

**Feature Branch**: `018-console-design` · **Created**: 2026-11-13 · **Status**: Implemented
**Input**: l'auteur — « applique proprement ce nouveau design qu'on a validé » ; la maquette
`design/proposition/` (neuf pages) ; D-022.

## User Scenarios & Testing

### US1 — Savoir où on est (P1)

Une barre latérale toujours visible (Atelier, Organisation), la page active marquée, un chemin en
haut de la page, une recherche `Ctrl K` qui mène à une page ou à un projet.

### US2 — Lire avant de chercher (P1)

Chaque page commence par son titre, une phrase qui dit à quoi elle sert, et, quand quelque chose ne
va pas, le bandeau verdict qui le dit en une phrase avec le geste à faire.

### US3 — Une vue d'ensemble selon le niveau (P1)

L'accueil montre des cartes à trois chiffres : projets, serveurs, consommation, alertes. Une
personne guidée voit l'essentiel (verdict, projets, que faire) ; une personne qui choisit ou experte
voit tout. Les projets ont leur propre page.

### US4 — Clair ou sombre (P2)

Le thème suit le réglage de l'ordinateur et se change d'un clic ; le choix est retenu.

### US5 — Une fiche projet en onglets (P2)

Aperçu, Développement, Manifeste, Variables, Mises en ligne, Journal.

## Requirements

- **FR-001**: Aucun texte visible en dur : tout vient des catalogues fr/en (D-013).
- **FR-002**: La couleur ne dit que l'état (D-022) ; le reste est à l'encre.
- **FR-003**: La console reste lisible de 375 px à l'écran large, sans défilement horizontal de page.
- **FR-004**: Les pages gardent leurs routes ; `/` devient la vue d'ensemble, `/projects` la liste.

## Success Criteria

- **SC-001**: `pnpm check` passe (types, lint, format, textes, tests).
- **SC-002**: Chaque page de la console s'affiche sans erreur contre l'API locale, en clair et en sombre.
