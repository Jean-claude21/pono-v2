# Feature Specification: Les visites des sites, Umami d'abord

**Feature Branch**: `012-analytics` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: l'auteur — « un système pour les métriques, les visites du site ; PostHog et Umami, en
commençant par Umami » ; D-017.

## User Scenarios & Testing

### US1 — Connecter Umami ou PostHog (P1)

Umami Cloud (clé d'API), Umami auto-hébergé (adresse et compte), PostHog (clé personnelle, région).
Les accès sont scellés comme les autres.

### US2 — Un projet lancé est compté dès le premier jour (P1)

Au lancement, Pono crée le site chez Umami, le nomme dans `pono.yaml` et donne la balise au serveur
(`PONO_ANALYTICS_SCRIPT`) ; le skill `pono-stack` dit où la poser.

### US3 — Un projet adopté se relie à un site existant (P1)

La personne choisit le site ; Pono le garde et propose la ligne `analytics` dans `pono.yaml`.

### US4 — Lire les visites (P1)

Pages vues, visiteurs, visites, rebond, pages et sources sur 7, 30 ou 90 jours, « mesuré » ; sinon
« indisponible » avec la raison, jamais zéro (D-005). Console, API et MCP (`read_site_metrics`).

### US5 — Les visites de Pono lui-même (P2)

La console se compte avec Umami quand son site est configuré ; jamais les pages de l'exploitant.

## Success Criteria

- **SC-001**: Les deux formes de réponse d'Umami et les requêtes PostHog sont lues depuis des
  réponses enregistrées.
