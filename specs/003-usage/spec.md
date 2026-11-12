# Feature Specification: La consommation

**Feature Branch**: `003-usage` · **Created**: 2026-11-12 · **Status**: Draft
**Input**: Phase 2 de `docs/ROADMAP.md` — un total juste de ses abonnements, et l'alerte avant que ça lâche.

## User Scenarios & Testing

### US1 — Relever ce que consomment ses fournisseurs (P1)

Pono lit, chez chaque fournisseur connecté, ce qui est consommé sur la période et la limite de
l'offre. Ce qui ne peut pas être lu est inscrit **indisponible**, avec sa raison, jamais zéro.

1. **Given** une connexion qui expose sa consommation, **When** le relevé passe, **Then** chaque
   compteur est inscrit `mesuré`, avec sa limite et sa période.
2. **Given** une clé sans le droit de lire la facturation, **When** le relevé passe, **Then** le
   compteur est `indisponible` avec la raison `permission`.

### US2 — Déclarer ce qui n'a pas d'API (P1)

La personne déclare un abonnement (Claude Max, un domaine…) : prix, cycle, renouvellement, projets
concernés. Il compte dans le total comme `déclaré`.

### US3 — Le total et ce qui va lâcher (P1)

La console montre le total du mois (mesuré + estimé + déclaré, composition affichée), les compteurs
avec leur jauge, les renouvellements à venir. Un compteur au-delà du seuil (80 % par défaut) ouvre
une alerte, une seule tant qu'elle n'est pas résolue ; elle se ferme quand le compteur redescend.

## Requirements

- **FR-001**: Port `UsageSource` ; sources Netlify (bande passante), Neon (stockage et calcul par
  projet), Cloudflare (requêtes Workers du jour), GitHub et OpenAI (indisponibles sans droit).
- **FR-002**: Chaque relevé : fournisseur, compteur (code stable), utilisé, limite, unité, coût en
  micro-dollars s'il est connu, source (`measured` | `estimated` | `declared` | `unavailable`),
  raison si indisponible, période, projet si rattaché.
- **FR-003**: Abonnements déclarés : ajout, modification, fin ; journalisés.
- **FR-004**: Total du mois : somme des abonnements déclarés ramenés au mois et des coûts mesurés ou
  estimés ; la composition par source est renvoyée.
- **FR-005**: Alertes : seuil 80 % sur un compteur, renouvellement à moins de 7 jours ; une alerte
  ouverte par clé ; fermée automatiquement quand la condition cesse.
- **FR-006**: Écran « Consommation » en français et en anglais.

## Success Criteria

- **SC-001**: Les compteurs de l'auteur relevés chez Netlify, Neon et Cloudflare correspondent aux
  consoles des fournisseurs.
- **SC-002**: Aucun compteur illisible n'apparaît à zéro.
