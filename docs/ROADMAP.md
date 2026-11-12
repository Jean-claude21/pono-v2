# Roadmap — Pono

- **Statut** : `in progress` · **Version** : `1` · **Validée** : en attente de l'auteur
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

> **Livrée le 2026-11-12.** Preuve : isolation de deux organisations (tests), console FR/EN.

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

> **Livrée le 2026-11-12, en local.** Preuve : projets réels importés sans saisie. Restent la
> connexion GitHub en ligne (application à créer par l'auteur) et l'adaptateur Coolify.

**Objectif.** Voir l'état réel de ses projets au même endroit.

- Connexion par GitHub ; organisation personnelle créée à la première connexion.
- Connexions aux fournisseurs (GitHub, Neon, Netlify, Cloudflare) : autorisation ou clé scellée,
  coupure qui efface.
- Import d'un dépôt : lecture de son état (dernier commit, déploiements, adresse de production,
  base) sans saisie.
- Écrans : liste des projets, fiche projet.

**Preuve.** Les projets réels de l'auteur importés, état vérifié à la main chez chaque fournisseur.

## Phase 2 — La consommation · `003-usage`

> **Livrée le 2026-11-12, en local.** Preuve : 60 relevés réels (Netlify, Neon, Cloudflare),
> GitHub et OpenAI « indisponibles » faute de droit. Restent les alertes hors console.

**Objectif.** Un total juste de ses abonnements, et l'alerte avant que ça lâche.

- Relevés mesurés : Neon, Netlify, Cloudflare, GitHub, Agent37, OpenAI.
- Abonnements déclarés (Claude, domaines…), renouvellements.
- Total du mois, coût par projet, prévision, sources affichées.
- Alertes : seuils, Telegram et email.

**Preuve.** Le total de l'auteur pour un mois, comparé ligne à ligne à ses factures.

## Phase 3 — Pono par MCP · `004-mcp`

> **Livrée le 2026-11-12, en local.** Preuve : un client MCP réel passe par la console, reconnaît
> « lectio » et le dépôt d'un dossier. Reste l'autorisation OAuth pour le connecteur Claude.ai.

**Objectif.** Parler à Pono depuis sa conversation.

- Serveur MCP distant, autorisation OAuth avec consentement dans la console.
- Outils : lister, trouver, reprendre un projet ; lire la consommation.
- Reconnaissance : nom, dépôt du dossier, projets récents ; question quand c'est ambigu.

**Preuve.** Depuis Claude Code, « on continue lectio » reprend le bon projet.

## Phase 4 — Les serveurs de projet · `005-project-servers`

> **Livrée le 2026-11-12, en local.** Preuve : cycle complet sur Agent37 ; limite du plan tenue.
> Restent les variables de dev scellées et le contrôle des secrets avant commit.

**Objectif.** Une phrase, et le projet a son serveur.

- Port `ProjectServerHost`, adaptateur Agent37.
- Limite de serveurs actifs par plan, veille et réveil, plafond de dépense.
- Lancer un projet : dépôt, base, serveur, premier aperçu.
- Variables de dev scellées, jamais de clé de production sur un serveur.

**Preuve.** Un projet lancé depuis une conversation ; le temps jusqu'au premier lien publié tel
quel.

## Phase 5 — La mise en ligne sous garde-fou · `006-guarded-release`

> **Codée et testée le 2026-11-12.** Reste la preuve sur un projet réel, avec l'auteur (elle
> écrit chez GitHub).

- Garde-fous : secrets, migrations, preview ; contrôle des secrets avant chaque commit du serveur.
- Les trois modes (D-006), retour arrière.

**Preuve.** Un refus, une validation et une mise en ligne automatique sur un projet réel.

## Phase 6 — Templates et skills · `007-templates`

> **Codée et testée le 2026-11-12.** Restent les dépôts de départ par template et la preuve en
> production.

**Preuve.** Un template a mené un vrai projet en production.

## Phase 7 — Plans, facturation, administration · `008-billing-admin`

> **Codée et testée le 2026-11-12.** Reste le compte Stripe de l'auteur.

**Preuve.** Un premier paiement reçu ; l'administration voit coût et revenu par organisation.

## Phase 8 — Le manifeste et l'adoption · `009-manifest`

> **Codée et testée le 2026-11-12.** Reste le schéma JSON publié à l'adresse de sa ligne `$schema`.

**Preuve.** Un dépôt sans manifeste, dans n'importe quelle technologie, reçoit sa PR `pono/manifest`.

## Phase 9 — Le niveau de la personne · `010-profile`

> **Codée et testée le 2026-11-12.** Reste l'application GitHub en production (auteur).

**Preuve.** Le niveau choisi dans la console guide l'agent, et l'inverse.

## Phase 10 — Le catalogue sur trois niveaux · `011-catalog`

> **Codée et testée le 2026-11-12.** Restent les dépôts de départ officiels de la base Pono (auteur).

**Preuve.** Un template importé par l'exploitant lance un projet généré depuis son dépôt.

## Phase 11 — Les visites · `012-analytics`

> **Codée et testée le 2026-11-12**, sur réponses enregistrées. Reste le compte Umami (auteur).

**Preuve.** Un projet lancé compte ses visites dès le premier jour, lues chez Umami.

## Phase 12 — Les tâches de fond · `013-operations`

> **Codée et testée le 2026-11-12** ; la tâche pg-boss tourne sur l'API locale. Restent la clé
> Resend et une instance Coolify (auteur).

**Preuve.** Une production tombée après une fusion automatique revient en arrière seule, une fois.

## Phase 13 — L'accès des agents · `014-agent-access`

> **Codée et testée le 2026-11-12.** Reste la preuve du connecteur Claude.ai, avec le domaine.

**Preuve.** Le connecteur Claude.ai se relie par OAuth et reprend un projet.

## Phase 14 — Preuves à plusieurs · `015-live-proofs`

> **Prouvée le 2026-11-12** : trois personnes, trois serveurs Agent37 réels, limite et isolation
> tenues, tout rendu.

---

## Backlog

Second fournisseur de serveurs · invités par projet · mode « Pono héberge » · galerie de templates
par des créateurs · application mobile.
