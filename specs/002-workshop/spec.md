# Feature Specification: L'atelier

**Feature Branch**: `002-workshop`
**Created**: 2026-11-12
**Status**: Draft
**Input**: Phase 1 de `docs/ROADMAP.md` — voir l'état réel de ses projets au même endroit.

## User Scenarios & Testing

### User Story 1 — Entrer dans son atelier (Priority: P1)

Une personne se connecte avec GitHub. À la première connexion, Pono crée son atelier personnel
(une organisation dont elle est propriétaire). Elle revient plus tard : sa session la reconnaît.

**Independent Test**: un parcours de connexion avec un fournisseur d'identité simulé crée la
personne, son organisation et une session ; la session ouvre `/me`.

**Acceptance Scenarios**:

1. **Given** une personne inconnue, **When** elle se connecte, **Then** Pono crée la personne, son
   atelier et une session, et la renvoie vers la console.
2. **Given** une personne connue, **When** elle se reconnecte, **Then** aucune organisation n'est
   créée en double.
3. **Given** une session expirée ou inconnue, **When** elle appelle l'API, **Then** `401`
   `auth.required`.
4. **Given** une session, **When** la personne se déconnecte, **Then** la session ne marche plus.

### User Story 2 — Connecter ses fournisseurs (Priority: P1)

La personne connecte Neon, Netlify et Cloudflare avec une clé, et GitHub par sa connexion. Pono
vérifie chaque clé avant de la garder, la scelle, ne la montre plus jamais, et l'efface quand on
coupe la connexion.

**Acceptance Scenarios**:

1. **Given** une clé valide, **When** la personne la connecte, **Then** Pono la vérifie chez le
   fournisseur, la scelle, et la connexion apparaît `active` avec le nom du compte.
2. **Given** une clé refusée par le fournisseur, **When** elle la connecte, **Then** rien n'est
   gardé et l'erreur dit `connection.rejected`.
3. **Given** une connexion, **When** l'API la liste, **Then** aucune valeur de clé n'apparaît.
4. **Given** une connexion, **When** la personne la coupe, **Then** la clé scellée est effacée.

### User Story 3 — Importer un projet sans rien saisir (Priority: P1)

La personne choisit un de ses dépôts GitHub. Pono retrouve seul l'hébergement (site Netlify ou
projet Cloudflare relié à ce dépôt), la base (projet Neon du même nom), l'adresse de production et
le dernier déploiement.

**Acceptance Scenarios**:

1. **Given** un dépôt relié à un site Netlify, **When** il est importé, **Then** le projet porte
   ce site, son adresse et son dernier déploiement.
2. **Given** un dépôt sans hébergement trouvé, **When** il est importé, **Then** le projet est créé
   et l'hébergement est marqué `introuvable`, jamais inventé.
3. **Given** un dépôt déjà importé, **When** on l'importe à nouveau, **Then** `409`
   `project.already_imported`.

### User Story 4 — Voir l'état de ses projets (Priority: P1)

La console liste les projets avec leur état, leur adresse de production (et si elle répond), leur
dernier déploiement ; la fiche d'un projet détaille dépôt, hébergement, base, environnements.

**Acceptance Scenarios**:

1. **Given** une adresse de production qui ne répond pas en 10 s, **When** l'état est relevé,
   **Then** le projet est `failing` et l'adresse marquée `down`.
2. **Given** un déploiement en échec, **When** l'état est relevé, **Then** le projet est `failing`.
3. **Given** un commit ou un déploiement de moins de 24 h, **When** l'état est relevé, **Then** le
   projet est `active`.
4. **Given** plus de 30 jours sans activité, **Then** il est `idle` ; sinon `healthy`.
5. **Given** la personne, **When** elle demande un relevé, **Then** l'état est relu chez les
   fournisseurs.

### Edge Cases

- Un fournisseur ne répond pas pendant un relevé : l'état garde les dernières valeurs connues et
  dit `unknown` pour ce qui n'a pas pu être lu.
- Deux sites Netlify reliés au même dépôt : celui de la branche de production est choisi ; à
  défaut, le plus récemment déployé.

## Requirements

### Functional Requirements

- **FR-001**: Connexion par un fournisseur d'identité derrière un port ; adaptateur GitHub (OAuth)
  et adaptateur de développement, refusé quand `NODE_ENV=production`.
- **FR-002**: Les personnes sont globales ; les sessions sont gardées sous forme d'empreinte
  (SHA-256), dans un cookie `HttpOnly`, `Secure` en production, `SameSite=Lax`, 30 jours.
- **FR-003**: La première connexion crée l'atelier personnel par `create_organization`.
- **FR-004**: Les connexions aux fournisseurs sont scellées en AES-256-GCM sous `PONO_SECRETS_KEY`,
  vérifiées avant d'être gardées, jamais renvoyées ni journalisées, effacées à la coupure.
- **FR-005**: Ports `CodeHost`, `Hosting`, `Database`, `LinkChecker` ; adaptateurs GitHub,
  Netlify, Cloudflare, Neon, testés sur des réponses enregistrées.
- **FR-006**: L'import d'un dépôt trouve hébergement, base, adresse et dernier déploiement sans
  saisie ; ce qui n'est pas trouvé est marqué, jamais inventé.
- **FR-007**: Les règles d'état (FR US4) vivent dans le domaine, sans fournisseur.
- **FR-008**: Chaque geste (connexion, coupure, import, relevé) est inscrit au journal du projet ou
  de l'organisation, avec son auteur et son canal.
- **FR-009**: Écrans : liste des projets, fiche projet, connexions, import — en français et en
  anglais.

### Key Entities

- **Person**, **Session** (globales).
- **Connection** : organisation, fournisseur, type (code, hébergement, base), compte, état, clé
  scellée.
- **Project** : organisation, nom, dépôt, hébergement, base, adresse de production, état.
- **Deployment** : le dernier connu par environnement.
- **JournalEntry** : organisation, projet (facultatif), geste, auteur, canal, date ; ajout seul.

## Success Criteria

- **SC-001**: Les projets réels de l'auteur importés sans aucun champ saisi ; état vérifié à la
  main chez chaque fournisseur.
- **SC-002**: Aucun octet stocké ne contient une clé en clair ; une coupure efface la clé.
- **SC-003**: Toutes les nouvelles tables étanches entre organisations (test d'isolation étendu).
