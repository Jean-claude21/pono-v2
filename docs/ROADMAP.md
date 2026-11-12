# Roadmap — Pono

- **Statut** : `candidate` · **Version** : `1` · **Validée** : en attente de l'auteur
- **Axe** : dépendances et preuves, jamais des dates.
- **Règle** : une phase se ferme sur sa preuve écrite dans `docs/VERITE_ET_PREUVES.md`.

## But

Un constructeur voit tous ses projets et leur coût au même endroit, lance un projet depuis sa
conversation sur un serveur prêt, et la production obéit à la règle qu'il a choisie.

## Matrice des surfaces

| Surface                 | Décision de la personne           | Données                            | Action réelle                | Preuve                                    |
| ----------------------- | --------------------------------- | ---------------------------------- | ---------------------------- | ----------------------------------------- |
| Console · projets       | lequel reprendre                  | projet, environnement, déploiement | ouvrir un lien qui marche    | les projets réels de l'auteur, état juste |
| Console · consommation  | quoi couper, quoi surveiller      | abonnement, relevé                 | alerte avant épuisement      | total du mois comparé aux factures        |
| MCP                     | agir sans quitter la conversation | les mêmes                          | les mêmes outils             | Claude Code reconnaît « on continue X »   |
| Console · serveurs      | lancer, mettre en veille          | serveur de projet                  | serveur alloué, limite tenue | premier lien mesuré                       |
| Console · mise en ligne | valider, ou laisser faire         | proposition, verdict, mode         | production déployée          | un refus, une validation, un automatique  |

---

## Phase 0 — Le socle · `001-foundation`

**Objectif.** Un dépôt où l'on peut livrer vite et sans peur.

- Monorepo pnpm : `apps/api` (Hono), `apps/web` (TanStack Start), `packages/design`.
- TypeScript strict, ESLint, Prettier, Vitest, contrôle des textes en dur.
- Postgres : rôle propriétaire et rôle applicatif, migrations SQL versionnées, organisation et
  membre avec RLS forcée, transaction par organisation.
- API : `/health`, erreurs aux codes stables, configuration validée par Zod.
- Console : la coquille (rail, langue FR/EN) sur le système visuel.
- CI GitHub Actions.

**Preuve.** `pnpm check` et `pnpm test` verts ; deux organisations étanches prouvées par un test.

## Phase 1 — L'atelier · `002-workshop`

**Objectif.** Voir l'état réel de ses projets au même endroit.

- Connexion par GitHub ; organisation personnelle créée à la première connexion.
- Connexions aux fournisseurs (GitHub, Neon, Netlify, Cloudflare) : autorisation ou clé scellée,
  coupure qui efface.
- Import d'un dépôt : lecture de son état (dernier commit, déploiements, adresse de production,
  base) sans saisie.
- Écrans : liste des projets, fiche projet.

**Preuve.** Les projets réels de l'auteur importés, état vérifié à la main chez chaque fournisseur.

## Phase 2 — La consommation · `003-usage`

**Objectif.** Un total juste de ses abonnements, et l'alerte avant que ça lâche.

- Relevés mesurés : Neon, Netlify, Cloudflare, GitHub, Agent37, OpenAI.
- Abonnements déclarés (Claude, domaines…), renouvellements.
- Total du mois, coût par projet, prévision, sources affichées.
- Alertes : seuils, Telegram et email.

**Preuve.** Le total de l'auteur pour un mois, comparé ligne à ligne à ses factures.

## Phase 3 — Pono par MCP · `004-mcp`

**Objectif.** Parler à Pono depuis sa conversation.

- Serveur MCP distant, autorisation OAuth avec consentement dans la console.
- Outils : lister, trouver, reprendre un projet ; lire la consommation.
- Reconnaissance : nom, dépôt du dossier, projets récents ; question quand c'est ambigu.

**Preuve.** Depuis Claude Code, « on continue lectio » reprend le bon projet.

## Phase 4 — Les serveurs de projet · `005-project-servers`

**Objectif.** Une phrase, et le projet a son serveur.

- Port `ProjectServerHost`, adaptateur Agent37.
- Limite de serveurs actifs par plan, veille et réveil, plafond de dépense.
- Lancer un projet : dépôt, base, serveur, premier aperçu.
- Variables de dev scellées, jamais de clé de production sur un serveur.

**Preuve.** Un projet lancé depuis une conversation ; le temps jusqu'au premier lien publié tel
quel.

## Phase 5 — La mise en ligne sous garde-fou · `006-guarded-release`

- Garde-fous : secrets, migrations, preview ; contrôle des secrets avant chaque commit du serveur.
- Les trois modes (D-006), retour arrière.

**Preuve.** Un refus, une validation et une mise en ligne automatique sur un projet réel.

## Phase 6 — Templates et skills · `007-templates`

**Preuve.** Un template a mené un vrai projet en production.

## Phase 7 — Plans, facturation, administration · `008-billing-admin`

**Preuve.** Un premier paiement reçu ; l'administration voit coût et revenu par organisation.

---

## Backlog

Second fournisseur de serveurs · invités par projet · mode « Pono héberge » · galerie de templates
par des créateurs · application mobile.
