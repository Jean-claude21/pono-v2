# Feature Specification: Plans, facturation, administration

**Feature Branch**: `008-billing-admin` · **Created**: 2026-11-12 · **Status**: Implemented
**Input**: Phase 7 de `docs/ROADMAP.md`.

## User Scenarios & Testing

### US1 — Changer de plan (P1)

Le plan ne change que par la facturation : paiement Stripe Checkout, événements signés ; à la fin
de l'abonnement, retour au plan Découverte. Le rôle de l'API ne peut pas écrire le plan.

### US2 — L'exploitant voit la plateforme (P1)

Organisations, projets, serveurs, revenu et coût, portefeuille du fournisseur de serveurs — jamais
le code, les données ni les clés. Il peut mettre un serveur en veille ; c'est journalisé chez
l'organisation.

## Success Criteria

- **SC-001**: Un événement non signé est refusé ; un événement signé change le plan.
- **SC-002**: L'administration est refusée à qui n'est pas exploitant.
