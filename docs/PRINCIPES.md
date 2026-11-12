# Principes

> Les invariants. Une décision qui les contredit est refusée, ou remplace d'abord ce fichier.

1. **Simple et qui marche.** On livre la version la plus simple qui aide réellement quelqu'un. Une
   tâche de plus de trois heures sans livrable visible est un signal de sur-ingénierie.
2. **L'étape en cours seulement.** Ce qui n'aide personne aujourd'hui va au backlog.
3. **Aucun fournisseur dans le cœur.** Le domaine et l'application parlent à des ports ; GitHub,
   Neon, Netlify, Cloudflare, Agent37, Claude vivent dans des adaptateurs. Un port n'est livré
   qu'avec un adaptateur et un exemple qui marche.
4. **La sécurité vit dans la base.** L'organisation est la frontière dure. Chaque table porte son
   organisation et sa politique RLS dans la migration qui la crée. L'application se connecte avec
   un rôle qui ne peut pas contourner le RLS.
5. **L'IA prépare, une personne décide.** Un agent n'a jamais plus de droits que la personne pour
   qui il agit. L'autonomie suit la réversibilité : ce qui s'annule peut passer seul avec une
   notification ; ce qui ne s'annule pas passe par une validation tracée, sauf règle écrite par la
   personne.
6. **Le garde-fou est mécanique.** Une règle qu'un agent peut contourner en argumentant n'est pas
   une règle.
7. **Tout ce qui se fait par MCP se fait dans la console, et inversement.** Aucun chemin réservé à
   un agent ni à un écran.
8. **Chaque chiffre dit d'où il vient** : mesuré, estimé, déclaré, ou indisponible. Jamais un zéro
   inventé à la place d'un trou.
9. **Des commandes nommées, jamais de mise à jour générique.** Chaque geste porte son auteur (qui,
   pour qui, par quel canal) et finit au journal.
10. **Rien n'est affirmé sans preuve.** Une fonctionnalité est finie quand sa preuve écrite est
    obtenue (`docs/VERITE_ET_PREUVES.md`).
