# Instructions permanentes pour Claude Code — Second Opinion

La spécification complète est dans `CAHIER_DES_CHARGES.md`. Le backlog est dans `TASKS.md`. Lis les deux au début de chaque session.

## Règles absolues
1. **Ne jamais inventer de données.** Aucun endpoint, champ, prix ou constat d'audit qui n'ait été vérifié par un vrai appel et enregistré dans `fixtures/`. Si une information manque, marque la tâche bloquée plutôt que de supposer.
2. **Ne jamais committer la clé API.** Elle vit uniquement dans `.env`. Masque-la (`***`) dans toute fixture, log ou document. Lance `scripts/check-secrets.sh` avant chaque commit.
3. **Aucune transaction réelle**, aucun ordre, aucun portefeuille. L'agent de démo simule.
4. **Pas d'actions hors du dépôt** : pas de push, pas de déploiement, pas de création de compte, pas de publication. Ce sont des tâches `[H]`.
5. **Économiser les crédits CMC** : utilise le cache et le mode replay ; n'appelle le réseau que pour enregistrer de nouvelles fixtures ou pour l'audit.
6. **Ton** : tout ce qui concerne la qualité des données CMC est formulé de façon neutre et constructive (« observed », « signal », « suggestion »), jamais accusatoire.

## Conventions
- Code, commentaires, README et documents de soumission **en anglais**. Journaux internes (`.loop/`) en français.
- TypeScript strict, modules ES, Node 20+. Un fichier par contrôle dans `src/checks/`.
- Chaque fonctionnalité arrive avec ses tests. Les tests tournent sans réseau.
- Commits petits et explicites, format : `T3.2: add C1/C2 price divergence checks`.

## Commandes de vérification (doivent passer avant de cocher une tâche)
```
npm run lint && npm run typecheck && npm test
```
