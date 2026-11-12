# Tasks: L'atelier

## Phase 1 — Fondations de la tranche

- [x] T001 `platform/secrets.ts` (seal/open) et ses tests
- [x] T002 `platform/http.ts` : JSON, délai, `ProviderError`
- [x] T003 Migration `0002_identity.sql` : people, sessions, fonctions
- [x] T004 Migration `0003_workshop.sql` : connections, projects, deployments, journal, RLS
- [x] T005 Test d'isolation étendu aux nouvelles tables (SC-003)

## Phase 2 — US1 : entrer dans son atelier

- [x] T006 Port `IdentityProvider` ; adaptateurs GitHub et développement
- [x] T007 `features/identity` : sign-in, callback, `/me`, sign-out, middleware de session
- [x] T008 Tests du parcours (nouvelle personne, retour, session expirée, déconnexion)

## Phase 3 — US2 : connexions

- [x] T009 Ports de vérification de compte ; `features/connections` (connect, list, revoke)
- [x] T010 Tests : clé valide, refusée, jamais renvoyée, effacée (SC-002)

## Phase 4 — US3 et US4 : projets

- [x] T011 `domain/state.ts` et ses tests
- [x] T012 Adaptateurs GitHub, Netlify, Cloudflare, Neon, liens ; vérifiés contre les vrais comptes (`scripts/probe-providers.ts`)
- [x] T013 `importProject`, `refreshProject`, routes ; tests de bout en bout
- [x] T014 Journal des gestes

## Phase 5 — Écrans

- [x] T015 Client API de la console, page de connexion
- [x] T016 Liste des projets, fiche projet
- [x] T017 Connexions, import
- [x] T018 Rendu vérifié FR/EN

## Phase 6 — Preuve

- [ ] T019 `[auteur]` Application GitHub créée (connexion en ligne) ; SC-001 vérifié à la main
- [ ] T020 Adaptateur Coolify (nettio et firmo y sont hébergés : aujourd'hui « introuvable »)
- [ ] T021 Workers Cloudflare reliés à un dépôt (seules les Pages sont lues)
- [ ] T022 Tests des adaptateurs sur réponses enregistrées (aujourd'hui : vérification en direct seulement)
