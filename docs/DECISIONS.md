# Journal des décisions

> Une décision par entrée : ce qui est tranché, pourquoi, ce que ça coûte, et ce qui la
> renverserait. On n'efface jamais une entrée ; on en ajoute une qui la remplace.

---

## D-001 — Pono repart sur de nouvelles bases, séparé de Kete

**Tranché le 2026-11-12** par l'auteur (« dissocions Pono de Kete d'abord »).

Le nouveau Pono est un dépôt neuf. Il ne dépend d'aucun paquet `@kete/*`. L'ancien Pono (FastAPI)
sert de référence : son mandat, ses garde-fous, son système visuel et ses tests décrivent le
comportement attendu, mais aucun code Python n'est repris.

**Pourquoi.** Aller vite sur un seul produit, sans attendre ni suivre les versions d'un socle
partagé.

**Ce que ça coûte.** Certains mécanismes existent déjà dans kete-core (connexions scellées,
consommation, sandbox) et seront réécrits ici, plus petits.

**Ce qui la renverserait.** Pono stable en production ; une convergence vers `@kete/*` se décide
alors, paquet par paquet.

---

## D-002 — Tout en TypeScript

**Tranché le 2026-11-12.**

- API : **Hono** sur Node 22, seule porte (console, MCP, agents).
- Console : **TanStack Start**, Tailwind 4 non requis : le système visuel `@pono/design` suffit.
- Données : **Postgres** (Neon en ligne, Postgres 17 local pour les tests), requêtes SQL écrites à
  la main avec `pg`, migrations SQL versionnées.
- Validation : **Zod** à chaque frontière.
- Tâches de fond : **pg-boss** quand la première tâche périodique arrive.
- MCP : **SDK MCP officiel** TypeScript.
- Tests : **Vitest**, Playwright pour la console.

**Pourquoi SQL écrit à la main.** Le RLS, les rôles et les politiques s'écrivent en SQL de toute
façon ; un ORM ajouterait une couche à contourner pour l'essentiel.

---

## D-003 — Les serveurs de projet chez Agent37, derrière un port

**Tranché le 2026-11-12.**

Un projet lancé reçoit un serveur. Le premier adaptateur est Agent37 (sandboxes persistantes,
veille, réveil à la première requête, serveurs aux États-Unis). Le port `ProjectServerHost` ne
nomme aucun fournisseur.

**Ce que ça coûte.** Une dépendance à une jeune entreprise ; l'adaptateur la rend remplaçable.

---

## D-004 — La limite porte sur les serveurs actifs en parallèle

**Tranché le 2026-11-12.**

Chaque plan fixe un nombre de serveurs actifs en même temps. Un serveur en veille ne compte pas.
Quand la limite est atteinte, la personne choisit un projet à mettre en veille ou change de plan :
rien ne s'arrête sans elle.

---

## D-005 — Chaque chiffre de consommation dit sa source

**Tranché le 2026-11-12.**

Quatre sources : **mesuré** (lu chez le fournisseur), **estimé** (calculé par Pono), **déclaré**
(saisi par la personne), **indisponible** (un trou, jamais un zéro). Un total additionne et dit sa
composition.

---

## D-006 — Les modes de mise en production suivent la réversibilité

**Tranché le 2026-11-12**, sur la demande de l'auteur d'un mode comparable au contournement des
permissions de Claude.

Trois modes, par projet, avec un mode par défaut pour l'organisation :

1. **Demander** (défaut) : rien ne part sans validation.
2. **Automatique si tout est vert** : si tous les garde-fous passent, Pono fusionne et met en
   ligne ; il revient en arrière seul si la production ne répond plus.
3. **Sans validation** : l'agent met en ligne seul. Activé par une personne, pour une durée
   limitée, inscrit au journal. Les garde-fous de migrations et de preview deviennent des
   avertissements.

Toujours vrai, quel que soit le mode : un secret dans le code bloque ; un agent ne peut jamais
changer le mode lui-même.

**Ce que ça coûte.** Le mode 3 est une exception au principe 5, écrite ici pour être assumée.

---

## D-007 — Pono ne garde pas les secrets de production

**Tranché le 2026-11-12.**

- Les valeurs de production vivent chez l'hébergeur ; Pono les transmet et ne garde que le nom,
  l'environnement, une empreinte et l'auteur.
- Ce que Pono doit garder (accès aux fournisseurs, clés de test des serveurs de dev) est scellé en
  AES-256-GCM sous une clé d'instance, jamais renvoyé, jamais journalisé.
- Un agent ne voit jamais une valeur : il voit des noms. Une valeur ne passe jamais par une
  conversation.
- Un serveur de dev ne reçoit jamais une clé de production.

---

## D-008 — MCP d'abord, console complète

**Tranché le 2026-11-12.**

On parlera souvent à Pono depuis une conversation. Le serveur MCP reconnaît l'intention (lancer un
projet, en reprendre un, le trouver) et chaque outil a son équivalent dans la console.

---

## D-009 — Langues et système visuel

- Code, identifiants, commits : anglais. Documentation de `docs/` : français.
- Écrans en français, et en anglais par catalogue ; aucun texte visible en dur.
- Le système visuel reprend `packages/design/style.css` de l'ancien Pono (discipline Firmo).
  Correctifs de contraste proposés (gris inactif et libellés sous 4,5:1) : en attente de l'auteur.

---

## D-010 — Méthode : Spec Kit, une phase à la fois

- Spec Kit `v0.16.0` : specify → clarify → plan → tasks → analyze → implement → converge.
- Branches : `main` (geste humain), `dev` (intégration, CI verte), `NNN-slug` par phase.
- Tests sur un Postgres 17 local lancé par les tests, ou une branche Neon `test`.

---

## D-011 — Les agents se relient par un jeton personnel, en attendant OAuth

**Tranché le 2026-11-12.**

Une personne donne à un agent un jeton (lecture seule, ou lecture et actions) dans la console ; il
est montré une fois, Pono n'en garde que l'empreinte, et il se coupe d'un clic. Claude Code et tout
client MCP l'acceptent en en-tête. L'autorisation OAuth 2.1 avec enregistrement dynamique, que le
connecteur de Claude.ai exige, vient ensuite.

**Pourquoi.** Le chemin le plus court vers « on continue lectio » depuis Claude Code, sans rien
retirer à la sécurité : mêmes droits que la personne, journal, coupure immédiate.

---

## D-012 — La forme d'un serveur de projet

**Tranché le 2026-11-12.**

2 vCPU, 4 Go, 4 Go de disque (4,76 $ par mois éveillé chez Agent37), veille après 30 minutes,
plafond de 5 $ par mois et par serveur, région États-Unis. Le modèle suit l'agent : Claude Code,
Codex, OpenCode, ou aucun.

---

## D-013 — Le plan ne change que par la facturation

**Tranché le 2026-11-12.**

Le rôle de l'API ne peut pas écrire le plan d'une organisation ; seule la fonction appelée par un
événement signé du fournisseur de paiement le fait. Sans clé Stripe, un fournisseur de développement
signe localement ; en production sans clé, changer de plan est refusé.

---

## D-014 — `pono.yaml` à la racine, et tout projet peut être adopté

**Tranché le 2026-11-12**, sur la demande de l'auteur (« peu importe le projet, on doit pouvoir le
faire »).

- Le manifeste est `pono.yaml`, à la racine : YAML plutôt que HCL ou JSON, pour les commentaires,
  la lecture humaine et l'écriture sûre par les agents ; un schéma strict versionné le valide.
- Il ne contient que des identifiants : ni secret, ni mode de mise en production (D-006).
- Un projet entre par un template ou par adoption. L'adoption pré-remplit le fichier depuis
  `project.yaml`, `.fluxio/project.json`, `stack.hcl` et la détection, et le propose en pull
  request. Pono n'écrit jamais la branche de production.
- Les skills ont trois familles. La sûreté est proposée partout ; l'architecture et le design de
  Pono ne s'imposent qu'aux projets lancés depuis un template.

**Ce qui la renverserait.** Un besoin de configuration que YAML exprime mal (logique, héritage).

---

## D-015 — Trois niveaux, et GitHub comme porte d'entrée

**Tranché le 2026-11-12.**

- Trois niveaux : **guidé** (Pono choisit tout sur sa base), **au choix** (deux ou trois templates
  et quelques options), **expert** (sa technologie, son architecture). Le niveau appartient à la
  personne ; la console et les agents lisent la même réponse.
- On entre par GitHub : la connexion relie le compte et les dépôts en un geste, puisque chaque
  projet vit dans un dépôt de la personne. Celui qui n'a pas de compte est guidé vers la création
  d'un compte gratuit.

**Ce que ça coûte.** Une personne sans GitHub fait un pas de plus. **Ce qui la renverserait.** Un
public qui ne veut pas de code chez lui : un dépôt hébergé par Pono deviendrait alors nécessaire.
