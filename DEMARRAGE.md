# Démarrage

## 1. Avant de lancer la boucle (à faire vous-même)
1. Créez un compte sur https://coinmarketcap.com/api et inscrivez-vous au hackathon sur DoraHacks avec **le même e-mail**.
2. `cp .env.example .env` puis collez votre clé dans `CMC_API_KEY`.
3. Installez Node.js 20+ et Claude Code, et connectez-vous (`claude` une première fois).

## 2. Lancer la boucle
Recommandé : dans un conteneur ou une VM jetable, car la boucle exécute des commandes sans demander.
```
SANDBOXED=1 ./loop.sh
```
Sur votre machine, avec le mode de permission automatique (si votre version de Claude Code le propose, vérifiez avec `claude --help`) :
```
PERMISSION_FLAGS="--permission-mode auto" ./loop.sh
```
Réglages utiles : `MAX_ITER=80`, `MAX_TURNS=100`, `MODEL=opus`.

## 3. Suivre l'avancement
- `TASKS.md` : ce qui est fait `[x]`, restant `[ ]`, bloqué `[!]`
- `.loop/PROGRESS.md` : journal de chaque itération
- `.loop/BLOCKED.md` : ce qui attend une action de votre part
- `.loop/logs/` : sortie complète de chaque session

Si la boucle s'arrête pour blocage, lisez `.loop/BLOCKED.md`, réglez le problème, puis relancez `./loop.sh` : elle reprend où elle s'était arrêtée.

## 4. Quand `.loop/DONE` apparaît
Suivez `docs/HUMAN_CHECKLIST.md` : dépôt public, déploiement Vercel, vidéo, post X, soumission DoraHacks avant le **30 septembre 2026 à 23h59 UTC**.
