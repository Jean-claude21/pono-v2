# Registre de vérité et preuves

> Toute affirmation publique doit se rattacher à une ligne de ce fichier.

Classement : `fait vérifié` · `observation` · `hypothèse` · `promesse contractuelle`.

## Faits vérifiés

| Fait                                                                                                                                                                                                                                                                                                                                                                                                | Preuve                                                                                                          | Date       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Deux organisations sont étanches : aucune ligne de l'une n'est lisible depuis l'autre, rien n'est lisible sans organisation, l'écriture chez l'autre est refusée, le rôle applicatif ne peut ni créer une organisation hors de `create_organization` ni désactiver le RLS (001 SC-002)                                                                                                              | `apps/api/tests/isolation.test.ts`, sur Postgres 17 local                                                       | 2026-11-12 |
| La console s'affiche en français et en anglais, le choix tient après rechargement, sans texte en dur (001 SC-003)                                                                                                                                                                                                                                                                                   | navigateur ; `pnpm check:strings`                                                                               | 2026-11-12 |
| Pono importe des projets réels de l'auteur sans aucun champ saisi, sur un poste local branché aux vrais fournisseurs : lectio-reads et fluxio-runtime-test retrouvent leur site Netlify (adresse qui répond, dernier déploiement réussi) et leur base Neon ; nettio et firmo, hébergés sur Coolify, sont marqués « introuvable », jamais inventés ; chaque import dure entre 2,3 et 4,2 s (002 US3) | API locale, connexions GitHub, Netlify, Cloudflare et Neon vérifiées chez chaque fournisseur ; console regardée | 2026-11-12 |
| Les clés des fournisseurs sont scellées (AES-256-GCM), jamais renvoyées par l'API, effacées à la coupure ; un autre atelier ne peut ni les voir ni les couper (002 SC-002)                                                                                                                                                                                                                          | `apps/api/tests/workshop.test.ts`                                                                               | 2026-11-12 |

## Repris de l'ancien Pono (à reprouver ici)

| Fait                                                                                              | Source                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Une migration destructrice est détectable et sa fusion bloquable par une vérification obligatoire | ancien Pono, lectio-reads#3, 2026-09-23 |
| Claude Code se relie à un serveur MCP qui porte son propre serveur d'autorisation                 | ancien Pono, 2026-09-26                 |

## Hypothèses — à prouver avant d'en parler

| Hypothèse                                                                        | Comment on la tranchera               |
| -------------------------------------------------------------------------------- | ------------------------------------- |
| Lancer un projet depuis un template prend quelques minutes jusqu'au premier lien | chronométrage à chaque lancement      |
| Voir le total de ses abonnements change ce qu'on garde                           | observation des premiers utilisateurs |

## Interdit d'affirmer aujourd'hui

- Tout chiffre de performance non mesuré.
- Tout nombre d'utilisateurs, témoignage ou logo.
- « Vos secrets sont en sécurité » : à prouver, pas à proclamer.
