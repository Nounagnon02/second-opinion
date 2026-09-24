Tu travailles en autonomie sur le projet Second Opinion, une itération à la fois. Personne ne répondra à tes questions pendant cette itération.

1. Lis `CLAUDE.md`, `CAHIER_DES_CHARGES.md`, `TASKS.md`, puis les 40 dernières lignes de `.loop/PROGRESS.md` et `.loop/BLOCKED.md` s'ils existent.
2. Choisis **la première tâche non cochée `[ ]`** de `TASKS.md` dont les prérequis sont satisfaits. Ignore les tâches `[H]` et `[!]`. Si une tâche `[!]` peut maintenant être débloquée (par ex. la clé est apparue dans `.env`), reprends-la d'abord.
3. Réalise-la entièrement, en respectant les règles de `CLAUDE.md`.
4. Lance `npm run lint && npm run typecheck && npm test` (dès que ces scripts existent). Corrige jusqu'à ce que tout passe.
5. Si c'est réussi : coche la tâche `[x]` dans `TASKS.md`, lance `scripts/check-secrets.sh`, puis fais un commit git local.
   Si c'est impossible (information manquante, accès refusé, action humaine requise) : marque-la `[!]`, explique précisément la cause et ce qu'il faudrait dans `.loop/BLOCKED.md`, commit, et arrête l'itération.
6. Ajoute à `.loop/PROGRESS.md` une entrée datée : tâche, ce qui a été fait, fichiers modifiés, prochaine tâche prévue.
7. Si **toutes** les tâches non humaines sont `[x]` (ou `[!]` avec une raison qui ne dépend que de l'humain) **et** que la tâche T9.2 est `[x]`, crée le fichier `.loop/DONE` contenant un résumé final et la liste des actions humaines restantes.

Ne traite qu'une seule tâche par itération. Termine proprement.
