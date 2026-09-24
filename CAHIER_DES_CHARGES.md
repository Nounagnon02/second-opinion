# Cahier des charges — Second Opinion

> Projet pour le hackathon **Build with CMC: API Hackathon** (DoraHacks × CoinMarketCap).
> Clôture des soumissions : **mercredi 30 septembre 2026, 23h59 UTC**.
> Tout ce qui est livré aux juges (code, README, soumission, post X) est rédigé **en anglais**. Ce cahier des charges est en français pour l'équipe.

---

## 1. Contexte et objectif

Les agents IA et les traders agissent sur des données de marché qu'ils ne peuvent pas vérifier. Un prix périmé, une paire DEX sans vraie liquidité ou un token RWA qui s'écarte de son actif sous-jacent suffisent à provoquer une perte.

**Second Opinion** est une couche de confiance posée sur l'API CoinMarketCap. Pour un actif donné, il croise plusieurs sources que CMC expose déjà, calcule un **score de fiabilité** et rend un verdict clair, avec les preuves.

Il sert deux publics :

1. **Les agents IA**, via un serveur MCP : avant d'agir, l'agent demande « cette donnée est-elle fiable ? ».
2. **L'équipe produit CMC**, via un rapport d'audit automatique qui liste les incohérences, les champs manquants et les écarts entre la documentation et le comportement réel de l'API.

**Principe de ton, non négociable** : le projet est présenté comme un outil *au service* de CMC, jamais comme une dénonciation. On écrit « data quality signals » et « consistency checks », pas « CMC is wrong ».

## 2. Track choisi

**AI Agents and Automation.** Le cœur du produit est un outil pour agents (MCP). Le scénario de démonstration principal porte sur un token **RWA**, pour exploiter aussi les nouveaux endpoints RWA que CMC met en avant.

## 3. Utilisateurs cibles

| Utilisateur | Besoin | Ce que Second Opinion lui donne |
|---|---|---|
| Développeur d'agent de trading | Empêcher son agent d'agir sur une donnée douteuse | Un outil MCP `preflight_trade` qui répond ACT / CAUTION / DO_NOT_ACT |
| Trader non expert | Savoir si le prix affiché d'un token est fiable | Une page web avec un verdict en langage simple |
| Équipe produit CMC | Connaître les défauts de son API | Un rapport d'audit reproductible, avec preuves |

## 4. Périmètre fonctionnel

### F1. Découverte et inventaire des endpoints
- Lire la documentation officielle (https://coinmarketcap.com/api/documentation/v1 et la référence RWA https://coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets).
- Tester réellement chaque endpoint candidat avec la clé du hackathon (plan Startup) et noter : accessible ou non avec ce plan, coût en crédits, champs réellement renvoyés.
- Produire `docs/ENDPOINTS.md`. **Aucun endpoint ne doit être utilisé dans le code s'il n'a pas été vérifié ici.**

### F2. Client API CMC
- Un seul module client, typé, avec : lecture de la clé depuis l'environnement, gestion des erreurs et des codes de statut CMC, retries avec backoff, cache local (TTL configurable) pour économiser les crédits, compteur de crédits consommés.
- Mode `--record` : enregistre les réponses brutes (clé masquée) dans `fixtures/` pour les tests et les preuves.
- Mode `--replay` : rejoue les fixtures sans appel réseau (tests déterministes, démo hors ligne).

### F3. Normalisation
- Ramener toutes les sources à un modèle commun : identifiant CMC, symbole, prix en USD, horodatage, volume, liquidité, source.
- Gérer les unités (par ex. token représentant une fraction d'once ou d'action) et les décalages temporels.

### F4. Moteur de contrôles de cohérence
Chaque contrôle renvoie : identifiant, sévérité (info / warning / critical), valeur mesurée, seuil, explication en anglais simple, et **références aux réponses brutes** qui le prouvent.

| ID | Contrôle | Sources croisées (à confirmer en F1) |
|---|---|---|
| C1 | Écart entre le prix agrégé et les prix des paires DEX | quotes + DEX pairs |
| C2 | Écart entre le prix agrégé et les paires des exchanges centralisés | quotes + market pairs |
| C3 | Fraîcheur : `last_updated` trop ancien | tous |
| C4 | Liquidité fantôme : volume élevé mais liquidité trop faible pour sortir d'une position | DEX pairs |
| C5 | RWA : prime ou décote du token par rapport à l'actif de référence, et entre wrappers d'un même actif | endpoints RWA |
| C6 | Cohérence inter-endpoints : même actif, valeurs contradictoires selon l'endpoint | tous |
| C7 | Anomalies de schéma : champs attendus absents, `null` inattendus, types incohérents | tous |

Les seuils sont dans un fichier de configuration, pas en dur dans le code.

### F5. Score de fiabilité
- Score de 0 à 100, dérivé des contrôles avec une pondération documentée.
- Verdict : `ACT` (≥ 75), `CAUTION` (40–74), `DO_NOT_ACT` (< 40). Seuils ajustables.
- **Calibration obligatoire** : sur les 50 premières cryptos par capitalisation (actifs réputés fiables), au moins 90 % doivent obtenir `ACT`. Si ce n'est pas le cas, le moteur crie au loup et doit être corrigé avant toute démo.

### F6. Serveur MCP
Outils exposés :
- `check_asset(symbol_or_id)` → score, verdict, contrôles, preuves.
- `check_rwa_token(symbol_or_id)` → idem, avec le contrôle C5 détaillé.
- `preflight_trade(symbol_or_id, side, size_usd)` → verdict adapté à la taille de l'ordre (la liquidité compte davantage pour un gros ordre).
- `explain(check_id)` → explication d'un contrôle en langage simple.

Compatible avec Claude Desktop / Claude Code (transport stdio), avec un exemple de configuration dans le README.

### F7. Agent de démonstration
- Un script qui simule un agent recevant l'ordre d'acheter un token RWA.
- Il appelle `preflight_trade`, reçoit `DO_NOT_ACT`, refuse l'ordre et explique pourquoi.
- Un second cas où l'agent reçoit `ACT` et procède (simulation uniquement, **aucune transaction réelle**).
- Le scénario doit reposer sur des données réellement capturées. Si aucun token ne déclenche naturellement `DO_NOT_ACT` au moment de la capture, on utilise le cas le plus parlant trouvé, et on l'indique honnêtement ; on ne fabrique jamais de données.

### F8. Interface web
- Page d'accueil : champ de recherche, verdict en couleur, contrôles en langage simple, lien vers les preuves.
- Page « API audit » : dernier rapport d'audit (F9).
- Déployable sur Vercel ; la clé API reste côté serveur uniquement.

### F9. Audit de l'API (le livrable qui fait la différence)
- Commande `npm run audit` : parcourt un échantillon d'actifs et d'endpoints, agrège les résultats de C3, C6 et C7, compare les champs documentés aux champs reçus, mesure latences et consommation de crédits.
- Produit `docs/API_AUDIT.md` (lisible) et `docs/api_audit.json` (structuré).
- Chaque constat renvoie à une fixture. **Un constat sans preuve capturée n'est pas publié.**
- Ce rapport alimente directement la section « API feedback » de la soumission.

## 5. Exigences non fonctionnelles

- **Langage** : TypeScript, Node.js 20+, modules ES. Tests avec Vitest.
- **Sécurité** : la clé CMC n'est jamais committée ni exposée au navigateur. `.env` dans `.gitignore`, script `scripts/check-secrets.sh` exécuté avant chaque commit. (Le règlement pénalise en qualité de code toute clé commitée.)
- **Budget de crédits** : cache systématique, compteur visible, plafond configurable par exécution.
- **Déterminisme** : tous les tests passent en mode `--replay`, sans réseau.
- **Qualité** : `npm run lint`, `npm run typecheck`, `npm test` passent sans erreur. Couverture raisonnable du moteur de contrôles et du score.
- **Documentation** : README clair en anglais, avec démarrage en moins de 5 minutes.

## 6. Architecture cible

```
second-opinion/
├── src/
│   ├── cmc/          # client API, cache, record/replay, compteur de crédits
│   ├── normalize/    # modèle commun, unités
│   ├── checks/       # C1 à C7, un fichier par contrôle
│   ├── score/        # score et verdict
│   ├── mcp/          # serveur MCP
│   ├── audit/        # génération du rapport d'audit
│   └── cli/          # commandes : check, audit, record
├── demo/agent/       # agent de démonstration
├── web/              # interface web (Next.js)
├── fixtures/         # réponses brutes capturées, clé masquée
├── config/           # seuils et pondérations
├── docs/             # ENDPOINTS, API_AUDIT, SUBMISSION, etc.
└── tests/
```

## 7. Livrables (correspondance avec le règlement)

| Exigé par le règlement | Livrable | Qui le produit |
|---|---|---|
| Dépôt public | Le dépôt GitHub | Claude Code (code) + humain (rendre public) |
| Démo fonctionnelle / lien / vidéo | Web déployé + agent de démo + script vidéo `docs/VIDEO_SCRIPT.md` | Claude Code prépare, humain déploie et enregistre |
| Post X avec lien DoraHacks, vidéo, #BuildwithCMC | Brouillon `docs/X_POST.md` | Claude Code rédige, humain publie |
| Endpoints CMC nommés explicitement | Section dans `docs/SUBMISSION.md` + `docs/ENDPOINTS.md` | Claude Code |
| Preuve d'un vrai appel API (code + réponse) | `docs/EVIDENCE.md` + fixtures | Claude Code |
| Note sur ce que l'API a permis et ce qui a gêné | `docs/API_FEEDBACK.md`, nourri par F9 | Claude Code |
| Un track choisi | AI Agents and Automation | — |

## 8. Critères d'acceptation (Definition of Done)

1. `npm install && npm run build && npm test` fonctionne sur une machine propre.
2. `npm run check -- <symbole>` donne un verdict en moins de 10 secondes avec une vraie clé.
3. Le serveur MCP fonctionne dans Claude Desktop ou Claude Code avec l'exemple de configuration fourni.
4. La calibration (F5) est atteinte et documentée dans `docs/CALIBRATION.md`.
5. L'agent de démo déroule les deux scénarios de bout en bout.
6. `docs/API_AUDIT.md` contient au moins un constat réel, prouvé par une fixture, formulé avec tact. Si aucune incohérence réelle n'est trouvée, le rapport le dit honnêtement et présente les mesures effectuées.
7. Tous les fichiers de `docs/` listés en section 7 existent et sont complets.
8. `scripts/check-secrets.sh` ne trouve aucune clé dans l'historique git.

## 9. Tâches réservées à l'humain

Ces étapes demandent un compte, une identité ou un jugement humain ; la boucle ne doit pas essayer de les faire :

- Créer le compte CMC, s'inscrire sur DoraHacks avec le même e-mail, mettre la clé dans `.env`.
- Créer le dépôt GitHub public et pousser le code.
- Déployer sur Vercel et y définir la variable `CMC_API_KEY`.
- Enregistrer la vidéo de démo (environ 90 secondes) en suivant `docs/VIDEO_SCRIPT.md`.
- Publier le post X et soumettre le BUIDL sur DoraHacks.
- Relire le ton du rapport d'audit avant publication.

## 10. Risques et parades

| Risque | Parade |
|---|---|
| Un endpoint nécessaire n'est pas accessible avec le plan Startup | Découverte en F1 d'abord ; remplacer le contrôle concerné ou le marquer « non disponible » |
| Faux positifs du score | Calibration F5 obligatoire avant la démo |
| Crédits épuisés | Cache, replay, plafond par exécution |
| Ton perçu comme hostile | Règle de ton section 1, relecture humaine |
| Constat d'audit inventé ou mal compris | Règle « pas de preuve, pas de publication » ; formuler comme observation, pas comme accusation |
