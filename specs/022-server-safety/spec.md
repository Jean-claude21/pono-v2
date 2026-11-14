# 022 — Les filets du serveur d'un projet

Décision : D-031. Fournisseur : Agent37 (liens signés, politique réseau, sauvegardes).

## Récits

1. **Preview privée.** Je lance le dev ; la preview s'ouvre pour moi, connecté à Pono, et pour
   personne d'autre. Je la montre à un client avec un lien de 24 h qui se ferme seul.
2. **Réseau limité.** Je limite le réseau du serveur : les installations marchent encore, un site
   inconnu est refusé. Mon agent me dit quel domaine ajouter quand une commande en a besoin.
3. **Sauvegarde.** Avant une grosse refonte, mon agent sauvegarde le serveur. Si ça tourne mal, je
   reviens à cette version depuis la console.

## Exigences

- Aucun port ouvert à internet par Pono quand l'hébergeur sait faire des liens signés ; un ancien
  port public est fermé au démarrage du dev.
- Liens partagés de 1 à 168 h, journalisés.
- Réseau : `open` | `limited`, domaines et IPv4 seulement, 60 ajouts au plus ; changé par la
  personne seule (canal console) ; appliqué au serveur existant et à celui donné ensuite.
- Sauvegarde : l'agent peut ; restauration : la personne seule, sauvegarde connue seulement, une à
  la fois, en arrière-plan, journalisée (début, fin, échec).

## Preuves

- `apps/api/tests/server-safety.test.ts`, `apps/api/tests/devloop.test.ts`.
- `apps/api/scripts/safety-live.ts` sur un vrai serveur.
