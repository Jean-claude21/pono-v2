# Feature Specification: Pono en ligne

**Feature Branch**: `019-deploy` · **Created**: 2026-11-13 · **Status**: Implemented
**Input**: l'auteur — « termine tout, tu déploies tout proprement, et propose une page d'accueil » ;
Moneroo en sandbox à la place de Stripe ; D-023, D-024, D-025.

## User Scenarios & Testing

### US1 — Ouvrir Pono à son adresse (P1)

`https://pono.kete.digital` répond en HTTPS. Une personne non connectée voit la page publique ; elle
se connecte avec GitHub (application `kete-pono`) et arrive dans sa console.

### US2 — Payer un plan (P1)

Depuis Réglages, la personne choisit Solo ou Pro, paie chez Moneroo, revient ; le plan est actif
trente jours. Un webhook rejoué ne paie pas deux fois. À la fin de la période, le plan redevient
gratuit.

### US3 — Les webhooks arrivent (P2)

Les poussées GitHub (`/hooks/code`) et les paiements (`/billing/webhook`) passent par l'adresse de
la console et arrivent signés à l'API.

## Requirements

- **FR-001** Une image Docker : migrations, API sur 8787, console sur 3000 (seul port exposé).
- **FR-002** Une variable vide est une variable absente.
- **FR-003** Moneroo : paiement initialisé avec le prix du plan, l'organisation en métadonnée ;
  webhook vérifié par HMAC, paiement relu avant tout changement ; une période de 30 jours par paiement.
- **FR-004** La page publique, en français et en anglais, sans texte en dur, lisible à 375 px.

## Success Criteria

- **SC-001** La page publique et la connexion GitHub répondent en ligne.
- **SC-002** Un paiement sandbox Moneroo fait passer une organisation en Solo.
