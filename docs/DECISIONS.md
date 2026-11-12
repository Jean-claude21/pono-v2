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
