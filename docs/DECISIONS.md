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

---

## D-016 — Le catalogue a trois niveaux, et le partage passe par l'exploitant

**Tranché le 2026-11-12.**

- **Officiel** : les fichiers de Pono, et les templates que l'exploitant importe depuis un dépôt
  (`pono-template.yaml`, `.pono/skills/`). Le dépôt devient le dépôt de départ.
- **Privé** : ce qu'une organisation crée, dans la console ou par MCP. Les skills de sûreté restent
  ceux de Pono ; un nom officiel ne peut pas être repris.
- **Partagé** : ce que l'exploitant a relu et approuvé. Un skill est une consigne exécutée par les
  agents des autres : sans relecture, ce serait une porte d'injection.
- Les skills tiers (Impeccable, Apache-2.0) sont épinglés à une version relue, changée par commit.

**Ce qui la renverserait.** Un volume de propositions qu'une personne ne peut plus relire : il
faudrait alors des relecteurs de confiance, ou une analyse automatique en premier filtre.

---

## D-017 — Les visites se lisent chez Umami, puis PostHog, derrière un port

**Tranché le 2026-11-12**, sur la demande de l'auteur (« on va utiliser Umami maintenant »).

- Le port `SiteAnalytics` ne nomme aucun fournisseur ; Umami (Cloud ou auto-hébergé) est le premier
  adaptateur, PostHog le second.
- Chaque personne connecte son propre compte ; Pono lit, il ne garde aucune donnée de visite.
- Un projet lancé reçoit son site dès le premier jour ; le site est nommé dans `pono.yaml`.
- La console de Pono se compte avec Umami, sans cookie, jamais sur les pages de l'exploitant.

---

## D-018 — Les tâches de fond sur pg-boss, Coolify pour le reste

**Tranché le 2026-11-12**, en appliquant D-002 (pg-boss « quand la première tâche périodique
arrive ») et D-006.

- Un cycle toutes les 15 minutes, file singleton : serveurs, projets, consommation, retour arrière
  automatique, alertes. Il agit au canal `system`, pour aucune personne, et ne peut ni valider, ni
  changer un mode.
- Les alertes partent par email (Resend), avec la clé de Pono ; une alerte n'est envoyée qu'une fois.
- Coolify héberge ce que Netlify et Cloudflare ne font pas tourner. N'ayant pas de retour arrière,
  il est épinglé au commit précédent ; il le reste jusqu'à ce qu'une personne le remette à HEAD.

---

## D-019 — OAuth 2.1 pour les clients MCP, variables scellées pour les serveurs

**Tranché le 2026-11-12**, en suite de D-007 et D-011.

- Pono est son propre serveur d'autorisation : clients publics enregistrés dynamiquement, PKCE S256
  seulement, approbation par une personne dans la console. L'accès accordé devient un jeton d'agent
  ordinaire : mêmes droits que la personne, journal, coupure d'un clic. Pas de jeton de
  rafraîchissement : l'accès dure jusqu'à ce qu'on le coupe.
- Les variables de développement sont tapées par une personne, scellées, envoyées au seul serveur
  du projet au démarrage. Un agent ne voit que des noms et peut en demander un.
- Les noms `PONO_` sont réservés à Pono.

---

## D-020 — La boucle de dev tourne sur le serveur du projet, Pono tient git

**Tranché le 2026-11-12.**

- Le dépôt est cloné sur le serveur du projet, sur `dev`. Pono lance le serveur de dev de la stack et
  publie son port : le rechargement à chaud est celui de la stack, à travers l'adresse publique.
- Pono fait les opérations git (récupérer, pousser) : l'accès passe par un en-tête donné pour une
  seule commande, jamais écrit dans une configuration git ni sur le disque. En attendant
  l'application GitHub, c'est la clé de la personne ; ensuite, un jeton d'une heure limité au dépôt.
- Toute poussée passe par le contrôle des secrets, et ne va que vers `dev`.
- Une poussée vers `dev` faite ailleurs revient sur le serveur, par l'outil ou par un webhook signé.

**Ce que ça coûte.** Le temps d'une commande, la clé est dans la ligne de commande du serveur du
projet — un serveur de la personne elle-même.

---

## D-021 — Dans l'agent de code, Pono se dit sans qu'on le demande

**Tranché le 2026-11-12.**

Un plugin Claude Code donne le serveur MCP de Pono, le contexte du projet à chaque début de session,
une ligne de statut et des commandes. Pour Codex : le serveur MCP et `AGENTS.md`. Le script ne bloque
jamais une session : sans Pono joignable, il se tait.

## D-022 — La console : clair ou sombre, des cartes, la couleur ne dit que l'état

**Tranché le 2026-11-13**, précise le système visuel de D-009.

La console prend la structure de la maquette validée (`design/proposition/`) : barre latérale
groupée, chemin en haut, recherche `Ctrl K`, cartes à trois chiffres, barres fines, onglets. Elle
s'ouvre selon le réglage de l'ordinateur, clair ou sombre, et se change d'un clic. On garde les
invariants : aucune couleur de marque, la couleur ne dit que l'état d'un projet (vert, bleu pour ce
qui est en cours, ambre, rouge, gris), Inter Tight et JetBrains Mono, chiffres tabulaires, le bandeau
verdict en tête de page. L'accueil s'adapte au niveau : la personne guidée voit l'essentiel.

---

## D-023 — Les plans se paient par Moneroo, une période à la fois

**Tranché le 2026-11-13**, remplace Stripe comme moyen par défaut (D-013 reste vrai pour le reste).

Moneroo encaisse Mobile Money et carte, mais pas d'abonnement. Un paiement achète trente jours du
plan ; un second paiement prolonge la période. Le webhook signé (`X-Moneroo-Signature`) ne fait que
prévenir : Pono relit le paiement chez Moneroo (statut, montant, devise, organisation) avant de
changer un plan, et compte chaque paiement une seule fois. La tâche périodique remet au plan gratuit
toute période finie. Stripe reste branché si Moneroo n'est pas configuré.

**Ce que ça coûte.** Pas de prélèvement automatique : la personne repaie chaque mois. Un rappel avant
la fin de la période reste à faire.

## D-024 — Pono tient dans une image, derrière une seule adresse

**Tranché le 2026-11-13.**

Une image Docker porte la console et l'API. Seule la console est exposée ; elle relaie `/auth`,
`/v1`, `/oauth`, `/mcp` et les webhooks signés (`/hooks/*`, `/billing/webhook`) vers l'API, sur la
même machine. Au démarrage, les migrations passent avec le rôle propriétaire, puis l'API et la
console partent ; si l'une s'arrête, le conteneur s'arrête et l'hébergeur le relance. Pono tourne sur
le Coolify de l'auteur, base sur Neon.

## D-025 — Une page publique qui montre l'atelier avant d'en parler

**Tranché le 2026-11-13.**

À l'adresse de Pono, une personne non connectée voit la page publique : la promesse, une vue de
l'atelier dessinée avec les pièces de la console (le verdict en tête), ce que Pono fait, trois
étapes, les agents, les tarifs, les questions. Aucune image générée : l'atelier lui-même est la
meilleure illustration, et le système reste sans couleur de marque.

## D-026 — Aucune question avant la console

**Tranché le 2026-11-13**, précise D-022 et la phase 9.

Après la connexion GitHub, la personne arrive directement dans sa console. Son niveau reste vide
tant qu'elle ne l'a pas choisi dans les réglages ; l'agent, lui, le demande une fois dans la
conversation et l'enregistre (`set_level`). La vue d'ensemble guide en trois étapes jusqu'à l'agent
relié (D-027), sans jamais bloquer.

## D-027 — Coder depuis n'importe quel chat : l'agent écrit sur le serveur du projet

**Tranché le 2026-11-13**, accomplit la phase 4 de la première version (« écrire depuis son agent,
sans poste local ») et complète D-020.

Le serveur MCP offre la main qui écrit, sur le serveur du projet seulement : `list_files`,
`search_code`, `read_file` (lignes numérotées, par plages), `edit_file` (remplacements exacts, tout
ou rien, diff, essai à blanc), `write_file`, `move_file`, `delete_file`, `show_changes`,
`run_command` (borné dans le temps, en fond avec `command_output`). Modelés sur les outils que les
agents connaissent déjà (Claude Code, le serveur de fichiers MCP, Desktop Commander). Les chemins
restent dans le dépôt, hors `.git`, `node_modules` et `.pono` ; toute écriture et toute commande
sont au journal ; aucune sortie ne porte une valeur de développement ; écrire exige « Lecture et
actions ». La production reste derrière la proposition et la règle du projet.

On relie un agent en collant l'adresse MCP de Pono dans Claude ou ChatGPT : OAuth fait le reste,
sans clé. Claude Code passe aussi par OAuth ; seul Codex prend une clé d'accès. Le positionnement
devient : _code depuis n'importe quel chat, ton agent a un serveur pour chaque projet_.

**Ce que ça coûte.** Un agent de chat convient aux changements courants ; un gros chantier reste
plus à l'aise dans Claude Code sur une machine. Les deux chemins mènent au même serveur et à `dev`.

## D-028 — L'atelier suit les agents de code open source, et les skills la norme Agent Skills

**Tranché le 2026-11-14**, précise D-027.

Vérifié à la source (OpenHands, SWE-agent, Codex, OpenCode, Goose, Cline, Aider) : la boîte à outils
du serveur (`toolbox.cjs`) écrit d'un coup (fichier temporaire puis renommage), garde dix retours en
arrière par fichier (`undo_edit`), refuse une modification qui casse la syntaxe d'un fichier qui se
lisait (JSON, JavaScript ; leçon mesurée par SWE-agent), retrouve un texte dont les espaces de bord
diffèrent en le disant, accepte le format `apply_patch` de Codex pour les modèles GPT, donne une
carte du dépôt (`project_map`, à la manière d'Aider), plafonne les recherches à 100 résultats et
renvoie les erreurs du serveur de dev après chaque changement.

Les skills suivent la norme ouverte Agent Skills : un dossier par skill, son `SKILL.md` (nom,
description, puis les instructions) et ses `references/`, `scripts/`, `assets/`. Pono les sert peu à
peu (`list_skills`, `get_skill`, `get_skill_file`), les installe sur le serveur du projet dans
`.claude/skills` et `.agents/skills` hors de git, sans écraser celles du dépôt, et lit les dépôts
de templates qui les rangent ainsi. L'ancien fichier unique se lit encore.

## D-029 — On relie un service en se connectant chez lui ; l'agent dit ce qui manque

**Tranché le 2026-11-14.**

« Services connectés » montre d'abord le chemin d'un projet jusqu'en ligne : code, développement
(inclus), mise en ligne, données, visites et IA. Là où le fournisseur ouvre une connexion à une
application tierce (GitHub, Netlify), on clique et on autorise ; ailleurs, le bouton ouvre la page
du fournisseur où se crée la clé, avec les droits à donner, et Pono trouve seul ce qu'il peut
(le compte Cloudflare). Avant de publier, d'ajouter une base, de compter les visites ou d'utiliser
l'IA, l'agent appelle `what_is_missing` ; un refus pour un service absent porte le lien pour le
relier. L'agent l'explique avec des mots simples et reprend une fois le service relié.

**Ce que ça coûte.** Une connexion par clic demande une application de Pono chez chaque fournisseur,
créée par l'exploitant ; sans elle, la clé guidée reste.

## D-030 — Pono profite de ce que son hébergeur de serveurs offre déjà

**Tranché le 2026-11-14.**

Lu dans la documentation d'Agent37 : la preview porte le nom du projet (`<projet>-<id>`) ; l'état
du dev dit si le serveur a manqué de mémoire ou redémarré ; l'exploitant recharge le portefeuille
depuis l'admin (une page de paiement du fournisseur). Repérés pour la suite : sauvegarde et
restauration d'un serveur, copie d'un serveur, previews privées signées, gabarits de serveur avec
les outils déjà installés, et les agents qui tournent sur le serveur lui-même.

## D-031 — Le serveur d'un projet a ses filets : preview privée, réseau limité, sauvegardes

**Tranché le 2026-11-14.**

- **Preview privée.** Aucun port du serveur n'est plus ouvert à internet. L'adresse de la preview
  passe par Pono (`/v1/projects/:id/preview`), qui vérifie qui l'ouvre puis donne un lien signé du
  fournisseur valable 12 h. Pour montrer le travail à quelqu'un sans compte, « Partager 24 h » (ou
  `share_preview`, de 1 à 168 h) donne un lien qui se ferme seul. Un lien partagé ne se révoque pas
  avant son terme : on choisit une durée courte.
- **Réseau.** Ouvert par défaut. Limité, le serveur ne joint que les registres de paquets,
  l'hébergeur de code, les services de l'hébergeur de serveurs, les domaines de chaque service
  connecté, et ceux que la personne ajoute (60 au plus). Le choix s'applique en quelques secondes,
  sans redémarrage, et suit le serveur s'il est donné plus tard. Seule la personne le change, dans
  la console ; une commande refusée par le réseau le dit à l'agent, qui nomme le domaine à ajouter.
- **Sauvegardes.** Chaque nuit, sept gardées, plus une à la demande toutes les 15 minutes. L'agent
  peut sauvegarder avant un geste risqué (`backup_server`) ; seule la personne restaure, depuis la
  console, après confirmation. La restauration remplace tous les fichiers et arrête le serveur de
  dev ; elle se poursuit après la réponse et le journal dit sa fin.

**Prouvé** sur un vrai serveur Agent37 (`apps/api/scripts/safety-live.ts`, 22 s) : sans lien la
preview répond 401, le lien signé la sert ; un domaine non listé est refusé
(`ERR_SSL_TLSV1_ALERT_ACCESS_DENIED`, reconnu par Pono) ; un fichier changé après la sauvegarde
revient tel qu'il était.

**Restent pour la suite** : un gabarit de serveur Pono (outils déjà installés), la copie d'un
serveur pour essayer sans risque, et l'agent qui tourne sur le serveur lui-même, qui attend la
décision sur qui paie l'IA.

## D-032 — Les jetons qui expirent se renouvellent seuls

**Tranché le 2026-11-14.**

Les jetons d'une application GitHub durent 8 heures. Pono scelle avec eux le jeton de
renouvellement (6 mois) et les renouvelle avant leur fin, sous un verrou de ligne : le jeton de
renouvellement change à chaque usage, deux renouvellements simultanés le perdraient. Un
renouvellement refusé après la fin marque la connexion « expirée » : la personne se reconnecte.
Une clé ordinaire, sans fin, reste comme avant.

## D-033 — Le catalogue se range par catégories, les variantes héritent, la valeur se mesure

**Tranché le 2026-11-14.**

Six catégories : être visible, vendre, prendre rendez-vous, piloter, logiciel, libre. Une variante
nomme son template : elle en hérite la stack, les skills, ce qu'il faut relier et le dépôt de
départ, puis ajoute les siens. Chaque template dit ce qu'il demandera de relier. Sa valeur, c'est ce
qu'il amène en production : projets lancés, projets en ligne, temps médian jusqu'à la première
preview, comptés sur toutes les organisations sans rien livrer d'aucune.

## D-034 — Un gabarit de serveur Pono

**Tranché le 2026-11-14.**

L'image `pono-web` (Agent37, `deploy/server-image`) part de l'image Claude Code d'Agent37 et ajoute
pnpm, Spec Kit, un client Postgres, Chromium et Playwright (Node et Python). Les projets lancés sans
autre agent démarrent dessus quand `PONO_SERVER_TEMPLATE=pono-web` ; sinon, l'image du fournisseur.

## D-035 — Les skills des éditeurs, épinglées et relues

**Tranché le 2026-11-14.**

`frontend-design` et `webapp-testing` (Anthropic, Apache-2.0), `supabase-postgres-best-practices`
(Supabase, MIT, valable pour tout Postgres) sont copiées telles quelles à un commit relu, avec leur
licence (`scripts/vendor-skills.ts`). Écartées : celles de Vercel (sans licence déclarée, ou pensées
pour Next.js). La skill `moneroo-payments` est de Pono, tirée de son intégration prouvée.

## D-036 — Des dépôts de départ réels

**Tranché le 2026-11-14.**

Trois dépôts-modèles publics dans `kete-africa` : `pono-starter-site`, `pono-starter-shop` (Neon,
Moneroo : prix recalculé par le serveur, webhook signé puis relu, paiement compté une fois) et
`pono-starter-dashboard` (tableur publié en CSV). Chacun : TanStack Start, construction Netlify,
textes dans un seul fichier, constitution et première spec Spec Kit, `pono.yaml` qui dit comment il
tourne. Au lancement, Pono attend que GitHub ait fini de générer le dépôt avant d'écrire son
manifeste, et y garde la section `dev` du modèle.

## D-037 — Pono crée le site de production

**Tranché le 2026-11-14.**

« Mettre en ligne » (`put_online`) crée le site chez l'hébergeur relié (Netlify) : une clé de
déploiement en lecture seule posée sur le dépôt, le site lié au dépôt, un webhook de poussée, une
première construction. Ensuite, la production suit les fusions sur la branche principale, sous la
règle du projet. **Ce que ça coûte** : l'application GitHub de Pono doit avoir les permissions
« Administration » (clés de déploiement) et « Webhooks » ; sans elles, Pono le dit clairement.

**Prouvé** (`apps/api/scripts/template-live.ts`, 2 minutes) : template « site » lancé, serveur
`pono-web` prêt en 12 s, dev et preview privée, site Netlify créé, production qui répond, valeur du
template comptée.

## D-038 — L'agent voit ce qu'il construit

**Tranché le 2026-11-23.**

Vu sur un vrai projet codé depuis ChatGPT : l'agent ne pouvait ni voir la preview (il vérifiait
avec `curl`), ni compter sur le rechargement (son petit serveur Node lisait les fichiers une fois).

- `preview_screenshot` : le navigateur du serveur (gabarit `pono-web`) capture une page de la
  preview, sur ordinateur ou téléphone, et la renvoie en image au chat, avec la réponse de la page
  et les erreurs de sa console. Un serveur d'avant le gabarit le dit, sans rien casser.
- Un serveur de dev en `node …` tourne sous `node --watch` ; `dev_status` dit `reloads`, et l'agent
  ne promet le rechargement que s'il est vrai.
- Le rafraîchissement périodique n'écrit au journal que ce qui change (844 lignes identiques en neuf
  jours sur un seul projet).
- La création d'un serveur attend jusqu'à deux minutes : le gabarit, plus lourd, peut démarrer
  lentement sur une machine froide. Playwright pour Python va dans le Python du système : le
  `~/.venv` du serveur le masquait.

**Prouvé** (`apps/api/scripts/eyes-live.ts`) sur un serveur `pono-web` neuf : une modification
servie sans redémarrage, une capture JPEG reçue, l'erreur de console rapportée.

## D-039 — Du chat à la production, sans machine à soi

**Tranché le 2026-11-24.**

Un parcours joué uniquement par MCP, comme ChatGPT ou Claude.ai le font, a montré qu'un agent de
chat ne pouvait jamais mener son travail en production : il pousse sur `dev`, mais rien n'ouvrait la
proposition `dev` → branche principale, et un site créé par « Mettre en ligne » ne construisait
jamais d'aperçu de `dev`, si bien que le garde-fou « preview » refusait toute proposition.

- `propose_release` (et le bouton « Proposer dev et évaluer » de la console) ouvre la proposition
  depuis `dev`, ou retrouve celle qui est ouverte, puis l'évalue. Pono propose ; ce qui part en
  production reste la règle du projet.
- Le site créé construit aussi `dev` en aperçu, et dès sa création, pour le travail poussé avant.
- Une proposition refusée seulement parce que son aperçu n'était pas encore construit est réévaluée
  à l'appel suivant, au lieu de rester refusée pour toujours.
- Les commandes `pnpm dev`, `npm run dev`… des gabarits comptent comme rechargeant seules.
- Un site tout juste créé a une adresse dont l'état est « inconnu », pas « aucune adresse ».

**Prouvé** (`apps/api/scripts/mcp-live.ts`, environ 5 minutes) : par MCP seul, template « site »
lancé, dev, capture, modification suivie sans redémarrage, poussée, mise en ligne, proposition
ouverte depuis `dev`, réévaluée une fois l'aperçu construit, approuvée par la personne, production
qui montre la modification, sauvegarde du serveur. Les gabarits « shop » et « dashboard » vont aussi
en production par Pono (`template-live.ts`, `TEMPLATE=shop|dashboard`).

## D-040 — Le budget d'un serveur, tenu par Pono

**Tranché le 2026-11-24.**

Un serveur plafonné à 0,001 $ tournait encore après dix minutes. La documentation d'Agent37 le
confirme : le plafond d'une instance ne couvre que les appels payants passés par Agent37 (IA,
recherche, outils) ; le temps éveillé n'est jamais plafonné, et l'instance continue de tourner. La
landing disait pourtant « ne dépasse jamais son budget ».

- À chaque cycle (15 minutes), Pono lit ce que chaque serveur a dépensé depuis le début du mois UTC
  (`GET /v1/usage`, par instance, temps éveillé et appels payants ensemble). Un serveur éveillé qui
  atteint son budget est mis en veille, et le journal le dit (`server.budget_reached`).
- Le réveiller est refusé (`servers.budget_reached`, 402) jusqu'au mois suivant.
- La landing dit ce qui est vrai : Pono le met en veille quand il a dépensé son budget du mois.
  Agent37 facture le temps éveillé à la minute mais ne le règle qu'à l'heure : le dépassement
  possible est d'environ une heure de temps éveillé, plus un cycle.

**Prouvé** (`apps/api/scripts/budget-live.ts`) : dépense du mois lue par serveur chez Agent37,
serveur jetable dont le budget est atteint mis en veille, puis libéré.

## D-041 — Les offres réglées par l'exploitant, et les forfaits vendus par licence

**Tranché le 2026-11-24.**

Les prix et les serveurs de chaque forfait étaient écrits dans le code et sur la landing.

- Chaque forfait a son offre en base (`plan_offers`) : prix, serveurs éveillés à la fois, et sa
  vente : « en vente », « à venir » ou « sur demande ». La landing (`GET /v1/offers`, lu sans
  connexion), la console, les limites de serveurs, Moneroo et la vue d'exploitation la lisent.
  « À venir » et « sur demande » n'affichent pas de prix et ne se paient pas en ligne ; « sur
  demande » mène au contact réglé. Le forfait gratuit reste gratuit et en vente.
- Moneroo facture le prix de l'offre au moment du paiement ; ce prix voyage avec le paiement, et le
  webhook vérifie le montant payé contre lui.
- Chariow vend un forfait comme produit de licence. La personne saisit sa clé dans Réglages ; Pono la
  lit à la boutique, l'active une fois pour son atelier, et le forfait court jusqu'à la fin de la
  licence (ou les jours réglés pour une licence sans fin). Une licence compte une fois : saisie dans
  un autre atelier, elle est refusée.
- Les réglages de l'exploitant (clé Chariow, adresse de la boutique, contact) se posent dans
  l'administration : une clé est vérifiée auprès de la boutique, scellée, jamais réaffichée ; à
  défaut, la valeur de l'environnement sert.
- Le badge « Le plus choisi » devient « Conseillé » : sans clients payants, il n'était pas vrai.

**Prouvé** : clé Chariow réelle acceptée, fausse clé refusée, clé de licence inconnue reconnue
comme telle ; parcours complet (activation, double saisie, autre atelier, licence révoquée, autre
produit) sur une boutique simulée. L'activation réelle attend un produit de type licence sur la
boutique.

## D-042 — Vercel comme hébergeur

**Tranché le 2026-11-24.**

Vercel se relie comme Netlify (un jeton), et « Mettre en ligne » y crée le projet. Vercel atteint
le dépôt par sa propre app GitHub : pas de clé de déploiement ni de webhook ; chaque branche
poussée se construit, `dev` en aperçu avec le commit construit, que le garde-fou « preview » lit.
Le jeton agit dans l'équipe par défaut du compte, gardée avec lui. Le retour arrière remet en
production le déploiement précédent. Avec Netlify et Vercel reliés, `put_online` choisit par
`provider`. Si l'app GitHub de Vercel n'a pas accès au dépôt, Pono le dit
(`hosting.repository_access`).

**Prouvé** : adaptateur contre un Vercel simulé. La preuve réelle attend un jeton Vercel.

## D-043 — Choisir un forfait, payer à la boutique, et le reste se fait

**Tranché le 2026-11-24.**

D-041 faisait recopier au client sa clé de licence. L'exploitant veut le parcours d'une boutique :
un clic, la page de paiement, et le forfait actif.

- Un forfait relié à un produit de licence Chariow : « Choisir » ouvre la page de paiement de la
  boutique pour ce produit (`POST /v1/checkout`), avec l'atelier et le forfait dans les métadonnées
  de la vente. Chariow exige un téléphone pour payer (Mobile Money) : la console le demande, une fois,
  avant la redirection. Sans produit relié, Moneroo reste le paiement.
- La boutique prévient Pono par un Pulse signé (`successful.sale` sur `/billing/chariow`, secret
  `whsec_…` réglé dans l'administration). Pono vérifie la signature, ne traite qu'une fois chaque
  livraison, relit la vente auprès de l'API (seule sa réponse compte), retrouve la licence émise à
  l'acheteur pour ce produit, l'active pour l'atelier et compte les jours du forfait.
- Une licence appartient à un seul atelier (`licence_claims`) : payée ici puis recopiée à la main,
  elle n'ajoute rien ; recopiée ailleurs, elle est refusée.
- Payée sans licence encore listée, la vente démarre quand même le forfait pour les jours de l'offre.
- La saisie d'une clé reste possible, pour une clé reçue autrement.
- « Le paiement passe par Stripe » disait faux : le texte nomme Moneroo et la boutique Chariow.

**Prouvé** : la vraie clé de la boutique ouvre un paiement (Chariow répond « produit introuvable »
pour un produit absent, pas « droit manquant ») ; parcours complet sur une boutique simulée :
paiement, Pulse signé, faux Pulse refusé, vente impayée ignorée, licence activée pour l'atelier,
doublons sans effet. Le premier achat réel attend un produit de licence publié et le Pulse réglé.

## D-046 — Les erreurs inattendues vont à Sentry, sans rien de personnel

**Tranché le 2026-11-27.**

Une erreur en production (une route qui plante, un cycle qui échoue, une page qui casse) n'était
visible que dans les journaux de l'hébergeur.

- Un projet `pono` dans l'organisation Sentry de l'auteur reçoit les erreurs de l'API (`onError`,
  cycle par organisation, démarrage et exécuteur des tâches de fond) et du navigateur.
- Rien de personnel ni de secret n'est envoyé : ni cookie, ni en-tête, ni corps, ni chaîne de
  requête, ni nom, ni email ; seulement la méthode, le chemin, la route, l'organisation (un id) et
  l'endroit (`where`). Aucune trace de performance.
- Sans `PONO_SENTRY_DSN` (API) ni `VITE_SENTRY_DSN` (console, au build), tout reste dans les
  journaux : développement et tests n'envoient rien. Le SDK du navigateur ne se charge qu'après
  l'affichage de la page.
- Le DSN n'est pas un secret (il est public dans le navigateur), mais il vit dans l'environnement,
  pas dans le code : Sentry reste un adaptateur, hors du domaine (principe 3).

**Prouvé** : `tests/monitor.test.ts` (filtrage de l'événement, environnement, éteint sans DSN).
`scripts/sentry-probe.ts` avec le vrai DSN : l'erreur de test atteint Sentry, qui la refuse
(`rate_limited`, `error_usage_exceeded`) : le quota d'erreurs de l'organisation, partagé entre tous
ses projets, est épuisé sur 30 jours (7 726 erreurs venues de `dym-functions`). La réception dans le
projet reste à prouver une fois le quota libéré.
