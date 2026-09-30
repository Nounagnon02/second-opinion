## 2026-09-24 — T0.1 Initialiser le projet TypeScript ✅

**Fait :**
- `package.json` (ESM, `engines.node >=20.19`) avec scripts `build`, `typecheck`, `lint`, `test`, `test:watch`.
- Outillage épinglé sur des versions réellement publiées et compatibles entre elles :
  - `typescript ~6.0.3` (TS 7.0.x existe mais typescript-eslint 8.70 exige `typescript <6.1.0`) ;
  - `eslint ^10.11.0` + `@eslint/js ^10.0.1` + `typescript-eslint ^8.70.1` (config flat, lint typé via `projectService`) ;
  - `vitest ^4.1.11` (Vitest 5 abandonne Node 20, or le cahier des charges exige Node 20+) ;
  - `@types/node ^20.19.43`.
- `tsconfig.json` strict (NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `tsconfig.build.json` (src → dist).
- `vitest.config.ts` (tests dans `tests/**/*.test.ts`, environnement node).
- Point d'entrée `src/index.ts` + test factice `tests/smoke.test.ts`.
- Vérifié : `npm run build` produit `dist/`, `lint`, `typecheck`, `test` passent (1 test). Le lint typé détecte bien une promesse flottante (sonde temporaire supprimée).

**Fichiers :** package.json, package-lock.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, eslint.config.js, src/index.ts, tests/smoke.test.ts, TASKS.md, .loop/PROGRESS.md, .loop/BLOCKED.md

**Commit :** ⚠️ NON effectué. Le hook global `gitflow-asin-guard.py` refuse `git add` (confirmation requise, impossible en
headless), les commits sur `master` et le format `T0.1: ...`. Rien n'a été contourné. Détails et solutions dans
`.loop/BLOCKED.md`. Fichiers laissés non suivis dans le working tree ; `scripts/check-secrets.sh` ✅ + scan manuel des fichiers ✅.

**Prochaine tâche :** T0.2 — `.gitignore` (ajouter `coverage/`), `.env.example`, hook pre-commit lançant `scripts/check-secrets.sh`, test qu'un commit avec une fausse clé est refusé.

## 2026-09-24 — T0.2 `.gitignore`, `.env.example`, hook pre-commit ✅

**Fait :**
- Repris le travail déjà présent dans le working tree (non journalisé par l'itération précédente) : `.gitignore`
  (+ `coverage/`), `.env.example` traduit en anglais, `.githooks/pre-commit`, `scripts/install-hooks.sh`.
- `package.json` : script `prepare` → `bash scripts/install-hooks.sh`, donc `npm install` active les hooks versionnés
  (`core.hooksPath=.githooks`) sur chaque clone. Ne fait rien hors d'un dépôt git (ex. build Vercel).
- `scripts/check-secrets.sh` durci :
  - motif élargi : `CMC_API_KEY` / `CMC_PRO_API_KEY` / `X-CMC_PRO_API_KEY`, casse ignorée (en-têtes minuscules dans
    les fixtures Node), valeur en 32 caractères hex **ou** UUID. La vraie clé fait 32 caractères hex, sans tirets :
    l'ancien motif (UUID seulement) ne l'aurait pas détectée sur un clone sans `.env` ;
  - diffs lus avec `--no-color --no-ext-diff --text` (indépendant de la config git de l'utilisateur, binaires inclus) ;
  - échoue au lieu d'annoncer « aucun secret » hors d'un dépôt git ; les erreurs git ne sont plus avalées.
- `tests/git-hooks.test.ts` (11 tests) : dépôt jetable dans le dossier temporaire du système, isolé de la config git
  globale et système, hooks installés par `install-hooks.sh`. Vérifie : refus d'un commit contenant une fausse clé
  (5 formes), la clé de `.env`, ou `.env` lui-même ; acceptation d'un commit propre ; `--history` retrouve une clé
  passée avec `--no-verify` ; échec hors dépôt. Les fausses clés sont construites à l'exécution, donc le fichier de test
  ne déclenche pas le scan.
- Vérifié : `npm run lint && npm run typecheck && npm test` ✅ (12 tests), `npm run build` ✅,
  `scripts/check-secrets.sh` ✅, `--history` ✅, aucun fichier suivi ne contient la vraie clé ni le motif.

**Fichiers :** package.json, scripts/check-secrets.sh, tests/git-hooks.test.ts (nouveau), TASKS.md, .loop/BLOCKED.md,
.loop/PROGRESS.md (+ repris : .gitignore, .env.example, .githooks/pre-commit, scripts/install-hooks.sh)

**Commit :** ⚠️ toujours impossible : le hook global `gitflow-asin` refuse `git add`, comme à l'itération T0.1.
Le hook pre-commit n'est pas non plus activé dans ce clone : `.git/config` ne contient pas `core.hooksPath`, et je n'ai
pas lancé `npm run prepare` pour ne pas contourner le hook global. Commande manuelle mise à jour dans `.loop/BLOCKED.md`.

**Prochaine tâche :** T0.3 — vérifier `CMC_API_KEY` dans `.env` (une valeur de 32 caractères est déjà présente).

## 2026-09-24 — T0.3 Présence de `CMC_API_KEY` dans `.env` ✅

**Fait :**
- Vérifié sans jamais afficher la valeur : `.env` existe, `CMC_API_KEY` y est définie une seule fois, 32 caractères
  hexadécimaux, sans guillemets ni espaces. `.env` est ignoré par git (`.gitignore:5`) et n'est pas suivi.
  → T0.3 cochée `[x]`, pas de `[!]` : les tâches réseau (T1.2) peuvent utiliser la clé.
- Limite : seule la présence et la forme sont vérifiées. Aucun appel réseau (règle 5, économie de crédits) ; la
  validité réelle de la clé et le plan associé seront confirmés au premier appel enregistré en T1.2.
- Nouveau `scripts/check-env.sh` + script npm `check:env` : contrôle réutilisable (humain avant de lancer la boucle,
  T9.1), n'imprime que la longueur. Échoue si `.env` absent, clé absente/commentée, vide (copie brute de
  `.env.example`), définie deux fois, ou de forme inattendue (ni 32 hex ni UUID : les formes que
  `check-secrets.sh` surveille). Accepte guillemets et fins de ligne CRLF.
- `tests/check-env.test.ts` (10 tests, dossier temporaire, fausses clés construites à l'exécution) : chaque cas
  ci-dessus + la sortie ne contient jamais la clé.
- `DEMARRAGE.md` étape 2 : mention de `npm run check:env`.
- Vérifié : `npm run lint && npm run typecheck && npm test` ✅ (22 tests), `npm run check:env` ✅ sur le vrai `.env`,
  `scripts/check-secrets.sh` ✅, `--history` ✅, scan direct des fichiers modifiés (ni la clé ni le motif).

**Fichiers :** scripts/check-env.sh (nouveau), tests/check-env.test.ts (nouveau), package.json, DEMARRAGE.md,
TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add` refusé par le hook global `gitflow-asin` (confirmation requise en
headless). Non contourné. Commande manuelle (commit unique T0.1–T0.3) mise à jour dans `.loop/BLOCKED.md`.
Note : ce hook refuse aussi toute commande Bash combinant un heredoc et `git` ; écrire les journaux avec Edit/Write.

**Prochaine tâche :** T1.1 — lire la doc CMC (générale + RWA) et lister les endpoints candidats pour C1 à C7 dans
`docs/ENDPOINTS.md`.

## 2026-09-24 — T1.1 Inventaire des endpoints CMC candidats ✅

**Fait :**
- Lu la doc officielle (aucun appel API, aucun crédit consommé) : page de choix des endpoints, référence RWA, pages
  interactives par catégorie (plans, coûts, exemples de réponses) et pages `.md` par endpoint (schémas), `llms.txt`,
  changelog (catégorie RWA ajoutée le 2026-07-07), guide des erreurs (403 + code 1006 = endpoint hors plan).
- `docs/ENDPOINTS.md` (anglais) : 20 candidats E01–E20, tous au statut `to verify`, avec plan Startup documenté, coût
  en crédits, fréquence de mise à jour, contrôles alimentés, paramètres prévus et champs documentés. Couverture C1–C7,
  endpoints écartés (dépréciés, hors périmètre) et plan d'appels pour T1.2 (~20–25 appels, ~13 crédits documentés hors
  DEX ; identifiants obtenus par l'API, jamais de mémoire ; échantillon suggéré BTC + PAXG).
- Points ouverts relevés pour T1.2 (questions, pas des constats) : les endpoints DEX (E08–E12) n'indiquent ni plan ni
  coût ; `/v5/real-world-assets/map` dit « No credit » mais l'exemple montre `credit_count: 1` ; types `string` vs
  `number` entre `/v1/dex/token/pools` et `/v1/dex/token/price` ; noms différents pour un même `rwa_id` dans les
  exemples ; mention d'endpoints RWA « historical » absents.
- **Risque pour C5 :** aucun champ documenté ne donne le prix de l'actif sous-jacent (`tradfi_markets` = bourse, ticker,
  URL). La moitié « écart entre wrappers » est couverte (E14 `tokens[].price` vs `average_tokenized_price`) ; la moitié
  « prime/décote vs actif de référence » sera tranchée en T1.3 selon ce que T1.2 observe.
- `tests/endpoints-doc.test.ts` (4 tests) : IDs et chemins uniques, statut ∈ {to verify, verified, refused}, chaque
  contrôle C1–C7 a au moins une source, et **tout chemin `/vN/...` présent dans `src/` doit être `verified`** (applique
  la règle du cahier des charges ; vérifié sur une copie jetable : échoue bien avec un chemin non vérifié).
- Vérifié : `npm run lint && npm run typecheck && npm test` ✅ (26 tests), `scripts/check-secrets.sh` ✅, `--history` ✅,
  scan direct des fichiers nouveaux/modifiés (ni la clé ni le motif).

**Fichiers :** docs/ENDPOINTS.md (nouveau), tests/endpoints-doc.test.ts (nouveau), TASKS.md, .loop/BLOCKED.md,
.loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add` refusé par le hook global `gitflow-asin` (« Confirmation requise avant
execution »). Non contourné. Commande manuelle mise à jour dans `.loop/BLOCKED.md` (commit unique T0.1–T1.1).

**Prochaine tâche :** T1.2 — appeler chaque endpoint E01–E20 avec la vraie clé selon le plan d'appels de
`docs/ENDPOINTS.md`, enregistrer les réponses brutes (clé masquée) dans `fixtures/`, et passer chaque ligne en
`verified` / `refused` avec le `credit_count` observé. Lire `/v1/key/info` avant et après pour mesurer la consommation.

## 2026-09-24 — T1.2 Vérification réelle des endpoints CMC ✅

**Fait :**
- Enregistreur minimal : `src/cmc/fixtures.ts` (format `RecordedExchange`, masquage de la clé sur tout le JSON sérialisé,
  refus de masquer un secret < 16 caractères) et `src/cli/record.ts` (`npm run record -- <label> <chemin> [nom=valeur…]`,
  un appel par exécution, n'écrase jamais une fixture, aucun chemin d'API en dur dans `src/`).
- 26 appels réels (16:03–16:09 UTC) → `fixtures/discovery/*.json`, clé masquée `***`. Identifiants tous issus des
  réponses (BTC 1 / PAXG 4705 via E01, GOLD `rwa_id=1` via E13, adresse et slug via E05, pools et `dex_id` via E11,
  `issuer_id` via E14). **15 crédits consommés** (E20 avant/après = somme des `credit_count`) ; 14 985 / 15 000 restants.
- Résultat : **17 verified, 3 refused**. Refusés : E04 market-pairs et E15 RWA market-pairs (403 / 1006, alors que la doc
  liste le plan Startup), E12 token-liquidity (400 « Parameter error », valeurs d'`interval` non documentées, aucune
  valeur devinée). DEX E08–E11 accessibles à 1 crédit.
- `docs/ENDPOINTS.md` réécrit : statuts, table « T1.2 results » (HTTP / error_code, crédits, latence, fixtures),
  champs observés et types réels, couverture C1–C7 après T1.2, 14 observations neutres à reprendre en T1.3 / T6.
- **Impacts pour T1.3 :** C2 n'a plus de source de paires CEX (E04 refusé) ; C5 n'a pas de prix de référence du
  sous-jacent (`tradfi_markets` vide, E15 refusé) et les wrappers GOLD sont cotés dans des unités différentes
  (~4 250 USD vs ~137 USD, unité non fournie) ; E08 exige `dex_id`/`dex_slug` et n'a pas filtré par actif (E11 + E09 /
  E10 le font) ; `status.error_code` arrive en nombre ou en chaîne selon l'endpoint.
- Tests : `tests/fixtures.test.ts` (masquage, sérialisation, aucune fixture ne contient de clé), `tests/record-cli.test.ts`
  (arguments), `tests/endpoints-doc.test.ts` étendu : chaque ligne vérifiée/refusée a sa ligne de résultat, et HTTP,
  error_code, crédits, latence et chemin sont confrontés aux fixtures (vérifié : échoue si une valeur est fausse).
- Vérifié : `npm run lint && npm run typecheck && npm test` ✅ (41 tests), `scripts/check-secrets.sh` ✅, `--history` ✅,
  scan direct de tous les fichiers du working tree (ni la clé réelle, ni le motif).

**Fichiers :** src/cmc/fixtures.ts, src/cli/record.ts, fixtures/discovery/ (26 fichiers), tests/fixtures.test.ts,
tests/record-cli.test.ts (nouveaux) ; docs/ENDPOINTS.md, tests/endpoints-doc.test.ts, package.json (script `record`),
TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add` refusé par le hook global `gitflow-asin` (« Confirmation requise avant
execution »). Non contourné. Commande manuelle mise à jour dans `.loop/BLOCKED.md` (commit unique T0.1–T1.2).

**Prochaine tâche :** T1.3 — adapter la liste des contrôles aux résultats de T1.2 dans `docs/DECISIONS.md` (C2 sans
paires CEX, C5 sans prix de référence et avec unités hétérogènes, E08 remplacé par E11 + E09/E10, E12 retiré de C4).


## 2026-09-25 — T1.3 Contrôles adaptés aux endpoints vérifiés ✅

**Contexte :** l'itération précédente (2026-09-24, interrompue avant journal et coche) avait déjà écrit
`docs/DECISIONS.md`, appelé E21 (`/v1/exchange/market-pairs/latest`, remplaçant possible d'E04 : 403 / 1006, 0 crédit,
fixture `E21-exchange-market-pairs-binance-paxg`) et mis `docs/ENDPOINTS.md` à jour. Le test annoncé par
DECISIONS.md (`tests/decisions-doc.test.ts`) manquait. Aucun appel CMC dans cette itération.

**Fait :**
- Revérification de chaque chiffre de `docs/DECISIONS.md` contre les fixtures (script jetable dans /tmp) : PAXG
  E02 = E06 = 4253.226063661451 ; E10 `p` = prix du pool E09 PAXG/WETH = 4264.1538, `mc` = `fully_diluted_value`, pool le
  plus profond d'E11 (16,26 M USD) ; 4 des 5 premiers d'E03 sans `platform` ; prix des 7 wrappers GOLD, moyenne 4255.05,
  conversion once troy de CGO (−0,09 %) et VNXAU (+0,34 %) ; XAU `market_cap` 0 / `volume_24h` 0 ; cas E08 BULL/WETH
  (171 USD de liquidité, 40 M USD de volume) et WETH/TRUMP2028 (mai 2025). Tout concorde.
- Doc CMC relue (page `.md` de `/v5/real-world-assets/quotes/latest`) : les items `tradfi_markets` n'ont pas de champ
  prix (`exchange`, `ticker`, `market_url`) → D6 confirmé, URL ajoutée comme source.
- Précision D7 : le 16:02:03 commun est `quote[].last_updated` (E02) / `quotes[].last_updated` (E06) ; le
  `last_updated` au niveau de l'item E02 vaut 16:03:00 (utile pour C3 / C6 en T3.1 et T3.5).
- Décisions retenues : C1 adapté (E02 vs E10, E08 écarté), **C2 indisponible** (E04, E15, E21 refusés, aucun substitut
  sous son nom), C3 conservé (âge = `status.timestamp` − horodatage de la donnée), C4 adapté (instantané E10 + E11, sans
  E12), C5 adapté (dispersion entre wrappers autour de `average_tokenized_price`, règles d'unité), C6 adapté (E02 vs
  E06, E14 vs E02), C7 adapté (seuls les champs utiles au verdict sont notés, le reste va à l'audit), statuts
  `evaluated` / `not_applicable` / `unavailable` avec renormalisation des poids (D9).
- `tests/decisions-doc.test.ts` (5 tests) : C1–C7 décidés une fois ; sources des contrôles exécutables toutes `verified`
  ; chaque fixture citée existe et vient bien de l'endpoint de son label ; preuve d'un contrôle `unavailable` = refus
  uniquement, sinon au moins un appel réussi ; chaque endpoint de l'inventaire a un rôle et la ligne « Refused » de D10
  = exactement les endpoints refusés. Vérifié par 4 mutations de DECISIONS.md (chacune fait échouer le test, fichier
  restauré à l'identique).
- Vérifié : `npm run lint && npm run typecheck && npm test` ✅ (46 tests), `scripts/check-secrets.sh` ✅, scan direct du
  working tree : la vraie clé n'apparaît dans aucun fichier hors `.env`.

**Fichiers :** docs/DECISIONS.md, tests/decisions-doc.test.ts (nouveaux, DECISIONS.md complété) ; TASKS.md,
.loop/BLOCKED.md, .loop/PROGRESS.md (déjà : docs/ENDPOINTS.md, fixtures/discovery/E21-…json de l'itération interrompue)

**Commit :** ⚠️ toujours impossible : `git add` refusé par le hook global `gitflow-asin` (« Confirmation requise avant
execution »). Non contourné. `.loop/BLOCKED.md` mis à jour : la commande manuelle couvre désormais T0.1–T1.3 par
dossiers entiers, car l'ancienne liste oubliait `tests/helpers/endpoints-doc.ts`.

**Prochaine tâche :** T2.1 — client CMC (clé depuis l'env, erreurs, retries, cache TTL, compteur et plafond de crédits),
en suivant D1 / D8 et la section « Handed to later tasks » de DECISIONS.md : deux formes du bloc `status`, timeout par
appel, TTL long pour E01 / E05 / E13.

## 2026-09-25 — T2.1 Client CMC ✅

**Contexte :** aucun appel CMC dans cette itération (0 crédit). Seule la page officielle des erreurs
(<https://coinmarketcap.com/api/documentation/guides/errors-and-rate-limits>) a été relue, pour fonder la règle de retry
sur ses codes (400/401/402/403, 429 1008–1011, 500 « Retry with exponential backoff »).

**Fait (`src/cmc/`) :**
- `endpoints.ts` : registre typé des 17 endpoints `verified` (et d'eux seuls), avec leur coût par appel (= le
  `credit_count` observé dans les fixtures T1.2 : 0 pour E01 / E13 / E20, 1 pour les autres) et leur classe de cache :
  `static` pour E01 / E05 / E13 (D1), `none` pour E20 (compteur), `market` pour le reste.
- `status.ts` : lecture du bloc `status` sous ses deux formes (observation 1) : `error_code` nombre ou chaîne,
  `error_message` `""` ramené à `null`, `credit_count` absent ou invalide ramené à « inconnu ».
- `errors.ts` : `CmcError` avec `kind` (`config`, `budget`, `timeout`, `network`, `api`, `invalid_response`), le code
  HTTP, le bloc `status`, `retryable` et `attempts`. Réessayables : HTTP ≥ 500, 429 sauf 1009 / 1010 (limites
  journalière et mensuelle).
- `credits.ts` : `CreditMeter`. Le coût estimé est réservé avant l'envoi, puis remplacé par le `credit_count` reçu. Un
  appel payant qui dépasserait `CMC_CREDIT_BUDGET` est refusé sans réseau (les appels gratuits passent toujours).
  Plafond exact pour les appels parallèles de D1. Une tentative de coût inconnu (timeout, réseau, page non JSON) est
  comptée à son estimation (`unconfirmed`), par prudence.
- `cache.ts` : `MemoryCache` et `FileCache` (`.cache/cmc/<sha256>.json`, écriture atomique, fichier illisible = miss).
  Seule la réponse est stockée, jamais les en-têtes de requête, donc jamais la clé.
- `config.ts` : `loadClientConfig(env)` (clé obligatoire, entiers validés, variable vide = défaut). Nouvelles variables
  dans `.env.example` : `CACHE_STATIC_TTL_SECONDS` (86400), `CMC_TIMEOUT_MS` (8000, car E03 = 5,9 s et E10 = 5,1 s),
  `CMC_MAX_RETRIES` (2), `CMC_CACHE_DIR`.
- `client.ts` : `CmcClient.get(endpoint, query)`. Paramètres triés (clé de cache stable), clé API en en-tête seulement,
  timeout par tentative (abort + course, même si le transport ignore le signal), backoff exponentiel à gigue (base
  500 ms, plafond 4 s). Échecs jamais mis en cache ; une écriture de cache ratée ne fait pas échouer un appel payé. La
  réponse garde `status.timestamp` d'origine (D4), `fromCache`, `attempts`, `latencyMs`, `receivedAt`. `keyInfo()` lit
  E20 (`key-info.ts`). `createClientFromEnv()` = config env + cache disque. Le réseau passe par un `Transport`
  injectable : c'est le point d'entrée prévu pour `--record` / `--replay` (T2.2).
- `src/index.ts` réexporte le client.

**Tests (65 nouveaux, 111 au total, sans réseau) :** `cmc-client` (fixtures réelles E01 / E02 / E08 / E15 / E20 / E21
rejouées par un faux transport : succès, deux formes de `status`, refus 403 / 1006, 400, retries 5xx et 429, backoff,
timeout, erreur réseau sans fuite de clé, page 502 HTML, cache mémoire / disque / TTL / E20 jamais mis en cache,
plafond séquentiel, parallèle et pendant les retries, `createClientFromEnv`) ; `cmc-status` (le bloc de **chacune** des
27 fixtures est lu) ; `cmc-config` (dont : une copie de `.env.example` donne exactement les défauts du code) ;
`cmc-endpoints` (registre = lignes `verified` de ENDPOINTS.md, coûts = `credit_count` de chaque fixture réussie).
Mutations vérifiées : sans réservation (7 échecs), paramètres non triés (3), limites journalières réessayées (4) ;
fichiers restaurés à l'identique (`cmp`).

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (111 tests), `npm run build` ✅,
`scripts/check-secrets.sh` ✅, scan direct du working tree (dist/ et .cache/ compris) : la vraie clé n'apparaît nulle
part hors `.env`, aucune affectation de forme clé.

**Fichiers :** src/cmc/{endpoints,status,errors,credits,cache,config,key-info,client}.ts (nouveaux), src/index.ts,
.env.example, tests/{cmc-client,cmc-status,cmc-config,cmc-endpoints}.test.ts, tests/helpers/transport.ts (nouveaux),
TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add` refusé par le hook global `gitflow-asin` (« Confirmation requise avant
execution », branche `master`). Non contourné. `.loop/BLOCKED.md` mis à jour (commit manuel unique T0.1–T2.1).

**Points laissés aux tâches suivantes :**
- T2.2 : brancher `--record` / `--replay` sur `Transport` ; `src/cli/record.ts` appelle encore `fetch` directement.
- T3.7 / T4.1 : pas de limiteur côté client pour les 50 requêtes / minute de la clé (E20). La calibration (50 actifs ×
  jusqu'à 5 appels) devra étaler ses appels ou en ajouter un. Le délai global de 10 s d'un `check` (D1) reste à tenir
  au niveau de la commande : timeout × tentatives peut le dépasser.
- Une réponse servie par le cache peut avoir jusqu'à `CACHE_TTL_SECONDS` de plus que son `status.timestamp` : C3 (T3.1)
  doit l'afficher (`fromCache`, `receivedAt`) plutôt que de l'ignorer.

**Prochaine tâche :** T2.2 — modes `--record` et `--replay` (fixtures servies par un `Transport` de rejeu, tests sans
réseau).

## 2026-09-25 — T2.2 Modes `--record` et `--replay` ✅

**Tâche :** T2.2 — « Modes `--record` et `--replay`. Fini quand : les tests tournent sans réseau. »

**État trouvé au début de l'itération :** l'implémentation était déjà écrite (itération précédente interrompue avant la
vérification) : `src/cmc/{mode,recorder,replay}.ts`, `src/cli/{args,call}.ts`, `tests/setup/no-network.ts`,
`tests/cmc-replay.test.ts`. Mais `npm run lint` échouait, aucun test ne couvrait le mode `--record` ni la ligne de
commande `call`, et `tests/no-network.test.ts` — annoncé par le commentaire de `tests/setup/no-network.ts` — n'existait
pas. L'itération a terminé et vérifié la tâche, elle n'a pas réécrit le code déjà en place.

**Ce qui a été fait :**
- `tests/setup/no-network.ts` : suppression de l'assertion `as typeof fetch`, inutile et refusée par ESLint
  (`no-unnecessary-type-assertion`). C'était la seule erreur de lint du dépôt.
- `tests/no-network.test.ts` (nouveau, 5 tests) — la garantie hors-ligne de T2.2, dans les deux sens :
  `fetch` global et `fetchTransport` échouent pendant les tests ; et un scan de tout `src/` (commentaires retirés)
  vérifie que `fetch(` n'apparaît que dans `src/cmc/client.ts` et qu'aucun fichier n'importe `node:http(s)`, `net`,
  `tls`, `dgram`, `undici`, `axios`… ni n'utilise `XMLHttpRequest` / `WebSocket` / `EventSource`. Une sortie réseau
  ajoutée ailleurs fait donc échouer la suite au lieu de consommer des crédits.
- `tests/cmc-record.test.ts` (nouveau, 11 tests) — le mode `--record`, joué hors réseau par un transport scripté qui
  rejoue les fixtures T1.2 : une fixture écrite par réponse (clé masquée, requête et en-têtes à côté, `label` = nom du
  fichier, `fixture` rendu dans la réponse) ; un refus HTTP 400 enregistré lui aussi et cité par l'erreur ; rien
  d'écrit quand aucune réponse n'arrive ; jamais d'écrasement (deux enregistrements de la même requête → `<label>.json`
  et `<label>-2.json`) ; le cache disque d'un run antérieur ignoré (contraste explicite avec `createClientFromEnv`, qui
  lui répond depuis le cache) ; **aller-retour** record → replay strictement identique, paramètres écrits dans l'autre
  sens ; refus d'une clé trop courte pour être masquée ; crédits d'un appel payé dont la fixture n'a pas pu être écrite
  correctement comptés, avec le dossier fautif nommé et sans fuite de clé. Plus `fixtureLabel` (format, stabilité vis
  à vis de l'ordre des paramètres, marqueur `X-` pour un chemin non vérifié).
- `tests/cli-call.test.ts` (nouveau, 16 tests) — les drapeaux et la commande : `parseRunMode` (live par défaut, dossiers
  par défaut `fixtures/recorded` et `fixtures/`, drapeau retiré où qu'il soit, chemin relatif résolu contre le cwd,
  refus de deux modes ou d'un dossier vide), `parseCallArgs` (dont le refus d'un endpoint non vérifié, E15), `runCall`
  (replay qui nomme sa fixture et ses crédits, `--data`, replay miss qui explique `--record`, refus enregistré avec sa
  preuve, enregistrement dans un dossier donné, refus de partir sans clé **sans rien envoyer**) et `describeResponse`
  (`from the local cache` / `live`).

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (156 tests, 15 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅ + scan direct des fichiers nouveaux (ni la clé réelle, ni de motif clé).
Bout en bout, sans réseau ni clé : `npm run call -- E02 id=1,4705 convert=USD --replay` répond
`HTTP 200, error_code 0, 1 credit(s), … replayed from fixtures/discovery/E02-quotes-latest-btc-paxg.json`, et
`npm run call -- E02 id=999 --replay` explique qu'il faut d'abord enregistrer la requête.
**Mutations vérifiées** (fichiers restaurés à l'identique, `cmp`) : fixture écrite sans masquer la clé → 1 échec ;
`flag: 'wx'` → `'w'` (écrasement) → 1 échec ; mode record rebranché sur le `FileCache` de l'environnement → 10 échecs ;
`fetch(` ajouté dans `src/cmc/credits.ts` → 1 échec ; `import "node:https"` ajouté au même endroit → 1 échec.

**Fichiers :** tests/no-network.test.ts, tests/cmc-record.test.ts, tests/cli-call.test.ts (nouveaux),
tests/setup/no-network.ts, TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add src tests TASKS.md` refusé par le hook global `gitflow-asin`
(« Confirmation requise avant execution », branche `master`). Non contourné. Nouveau symptôme : le hook refuse
maintenant aussi mes commandes d'édition dont le texte contient une ligne `git …` (« Commande git/glab non analysable
automatiquement ») ; `.loop/BLOCKED.md` a donc été mis à jour avec l'outil d'édition de fichiers. Commit manuel unique
T0.1–T2.2 décrit dans `.loop/BLOCKED.md`.

**Points laissés aux tâches suivantes :**
- `fixtures/recorded/` (dossier par défaut de `--record`) n'existe pas encore : il naîtra au premier enregistrement
  réel. `--replay` sans argument lit `fixtures/` entier, donc `discovery/` et `recorded/` ensemble.
- Un run `--record` ne réutilise jamais le cache disque : chaque requête coûte ses crédits. À garder en tête pour la
  calibration T4.1 (50 actifs), qui devra aussi étaler ses appels (50 requêtes/minute, cf. E20).
- La commande `call` est provisoire : `check` (T3.7) et `audit` (T6.1) devront réutiliser `parseRunMode` /
  `createClientForMode` plutôt que refaire leur propre analyse de drapeaux.

**Prochaine tâche :** T2.3 — modèle normalisé et normaliseurs pour chaque source vérifiée, testés sur les fixtures.

---

## 2026-09-25 — T2.3 Modèle normalisé et normaliseurs de chaque source vérifiée ✅

**Fait :** le modèle commun de la spécification F3 (identifiant CMC, symbole, prix USD, horodatage, volume,
liquidité, source) et un normaliseur pour **chacune des 16 sources vérifiées** de `docs/ENDPOINTS.md` qui porte des
données de marché ou d'identité. E20 (usage de la clé) n'en a pas besoin : `parseKeyInfo` le lit déjà depuis T2.1.

Deux règles tenues partout, héritées de la règle 1 de `CLAUDE.md` :
- une valeur est **lue dans une réponse ou `null`** — jamais reprise d'une autre source, jamais remplacée par un
  défaut ;
- un champ illisible produit un `FieldIssue`, pas une exception : une donnée abîmée ne doit pas cacher le reste de
  la réponse, et c'est la matière de C7 (D8).

**`src/normalize/values.ts`** — la lecture des champs bruts :
- `toFiniteNumber` accepte les nombres JSON **et** les décimales envoyées en chaîne (E11 `liqUsd`, `v24`, `liq`) ;
- `toIsoTimestamp` accepte l'ISO **et** les époques en millisecondes envoyées en chaîne (E10 `ts`, E11 `pubAt`), et
  **refuse** une époque hors 2000–2100 au lieu de deviner l'unité — la même valeur en secondes est rejetée, pas
  requalifiée ;
- `ageSeconds(observedAt, lastUpdated)` mesure l'âge contre `status.timestamp` de la **même** réponse, jamais contre
  l'horloge locale (D4) : une fixture rejouée donne toujours le même âge ;
- `Reader` lit les champs d'un objet et note ce qu'il n'a pas pu utiliser. Le drapeau `required` distingue les
  champs qu'un contrôle lit (notés même absents, seuls scorés par C7) des autres (notés seulement s'ils ont été
  envoyés dans une forme illisible). Chaque item d'une liste a sa propre liste d'anomalies : un item abîmé ne
  pollue pas ses voisins.

**`src/normalize/model.ts`** — `PriceObservation` (le modèle commun), `AssetRef`, `PlatformRef`, `Venue`, `Page`,
`SourceRef` (endpoint + chemin + `observedAt` + **la fixture qui le prouve**), `pickUsd` (l'entrée USD d'un bloc
`quote`, par `symbol` sinon par l'ID 2781, car E08/E09 n'envoient que `convert_id`), `expectEndpoint` (refuse une
réponse qu'un normaliseur n'attend pas) et `sourceFromBody` (lit un corps enregistré ; refuse un corps sans bloc
`status` lisible plutôt que de le dater à l'horloge locale).

**Normaliseurs**, groupés par famille :
- `aggregated.ts` — E02, E03, E06, E07. Le prix est daté par le `last_updated` **du bloc quote**, pas par celui de
  l'item (pour PAXG : 16:02:03 contre 16:03:00), parce que c'est lui qui date le prix et que c'est lui que C6
  compare entre E02 et E06 (D7). E07 ramène le prix à **une** unité (`price / amount`, F3) ; si `amount` est
  illisible, le prix reste `null` et l'anomalie sur `amount` dit pourquoi.
- `dex.ts` — E08 et E09 (mêmes champs de paire et de quote, un seul lecteur), E10 (noms courts `p`, `l`, `v24h`,
  `ts`) et E11 (`PoolObservation` : les deux côtés du pool, `bidx` pour l'actif de base). E10 **ne nomme aucun
  actif** (ni ID CMC ni symbole) : l'observation porte l'adresse du contrat interrogé et c'est l'appelant qui la
  rapproche de l'actif demandé — rien n'est inventé. Le `fully_diluted_value` des paires n'est **pas** renommé en
  capitalisation.
- `rwa.ts` — E13, E14, E16, E17, E18, E19. `RwaQuote` porte `averageTokenizedPriceUsd` et ses wrappers ;
  `tradfi_markets` n'est que **compté**, jamais lu champ par champ : le tableau était vide dans toutes les réponses
  enregistrées, donc la forme de ses items n'a pas été observée (D6). E17 ne lit que `about.description` et
  `about.date_added` : les six autres champs étaient `null` dans la réponse enregistrée, donc leur type n'est pas
  connu.
- `identity.ts` — E01 (tous les candidats d'un symbole, le choix reste à T3.7) et E05 (`data` est un objet indexé
  par ID CMC ; donne le couple slug + adresse que E10 et E11 réclament). Les `platform.id` ne sont jamais
  rapprochés entre endpoints (Ethereum = 1 dans E01, 1027 dans E02, "1027" dans E05, observation 8) : seul le slug
  est comparable.
- `index.ts` — `priceObservations(response)` renvoie, pour les 8 endpoints qui portent un prix USD (`PRICE_SOURCES`),
  les observations dans le modèle commun ; pour E14 ce sont les wrappers.

**Tests** (74 nouveaux, tous sur les **vraies** réponses enregistrées — aucun corps CMC écrit à la main) :
`tests/normalize-values.test.ts`, `-aggregated`, `-dex`, `-rwa`, `-identity`, `-model`, plus
`tests/helpers/normalize.ts` (`recordedSource` construit l'entrée depuis une fixture avec sa référence de preuve,
`damaged` en abîme un champ). Ils vérifient à la fois la lecture correcte (aucune anomalie sur les fixtures saines)
et le comportement face à une donnée abîmée (prix `null`, horodatage illisible, absence de quote USD, `data` qui
n'est pas la liste attendue). `normalize-model.test.ts` est le test qui justifie la tâche : le prix de PAXG lu par
**sept** sources différentes devient comparable, les trois sources agrégées s'accordent au dernier chiffre, et
l'écart DEX de +0,26 % (observation 10) se mesure directement — c'est l'entrée de C1.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (230 tests, 21 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅ + scan direct des fichiers nouveaux.
**Mutations vérifiées** (fichiers restaurés à l'identique, `diff -r`) : `ageSeconds` branché sur l'horloge locale →
9 échecs ; fenêtre d'époque 2000–2100 retirée → 2 échecs ; E07 qui ne divise plus par `amount` → 2 échecs ;
`pickUsd` qui prend la première quote venue → 1 échec ; prix E02 déclaré non requis → 2 échecs.

**Fichiers :** src/normalize/{values,model,aggregated,dex,rwa,identity,index}.ts (nouveaux), src/index.ts,
tests/normalize-{values,aggregated,dex,rwa,identity,model}.test.ts (nouveaux), tests/helpers/normalize.ts (nouveau),
TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : `git add src tests TASKS.md` refusé par le hook global `gitflow-asin`
(« Confirmation requise avant execution », branche `master`). Non contourné. Neuvième itération sans commit ;
`.loop/BLOCKED.md` mis à jour (commit manuel unique T0.1–T2.3).

**Constat gardé pour T6.1 (audit), pas encore une conclusion :** dans
`fixtures/discovery/E08-dex-spot-pairs-paxg-uniswap.json`, **12 paires sur 100** ont `base_asset_ucid: null` alors
que `base_asset_symbol` est renseigné (BULL/WETH, MEMEGOD/WETH, B2B/WETH…) : ces paires ne peuvent pas être
rattachées à un actif CMC. Le fait est vérifié par `tests/normalize-dex.test.ts` ; il complète l'observation 13
(`base_asset_id` toujours `null`). À reformuler de façon neutre et à re-vérifier en T6.1 avant publication.

**Points laissés aux tâches suivantes :**
- Les seuils n'existent pas encore : le modèle mesure (âge, écart, liquidité/volume), il ne juge pas. `config/`
  arrive avec T3.1.
- Le rapprochement E02 ↔ E10 (E10 ne nomme aucun actif) est à faire dans C1 (T3.2), à partir de l'adresse de
  contrat demandée via E05.
- `RwaWrapper` ajoute `issuerId` / `issuerName` au modèle commun ; T3.4 y branchera l'index token → RWA de D6.

**Prochaine tâche :** T3.1 — C3 fraîcheur et C7 schéma, les deux contrôles les plus simples, utiles à l'audit.

---

## 2026-09-25 — T3.1 C3 fraîcheur + C7 schéma ✅

**Fait :** ouverture de `src/checks/` et de `config/`, les deux premiers contrôles du moteur (spécification F4).

- `config/checks.json` — **les seuils ne sont pas dans le code** (exigence F4). Chaque section porte un champ
  `notes` qui dit d'où viennent ses nombres ; le chargeur le conserve, pour qu'une constatation puisse afficher la
  provenance de la limite qui l'a produite. Valeurs fondées sur les âges réellement mesurés dans les fixtures T1.2 :
  52–173 s pour les sources agrégées (E02, E03, E06, E07, E14 ; rafraîchissement documenté toutes les 60 s), 105 s
  pour E10, 138 s pour E09 ; côté E08, médiane 402 s, 19 paires sur 100 au-delà d'1 h et 11 au-delà de 24 h.
  D'où deux familles (D4) : agrégé 600 s / 3 600 s, DEX 3 600 s / 86 400 s — une paire DEX calme n'est pas une
  paire fausse. Tolérance de 60 s pour un horodatage postérieur à la réponse (aucune réponse enregistrée n'en
  montre). T4.2 calibrera ces six nombres.
- `src/checks/config.ts` — lecture **stricte** : clé inconnue, section absente, sévérité hors des trois noms,
  seuil négatif ou `warnAfterSeconds` au-dessus de `criticalAfterSeconds` arrêtent l'exécution (`CmcError`
  `config`). Un seuil mal lu changerait tous les verdicts en silence ; mieux vaut ne pas démarrer.
- `src/checks/model.ts` — la forme commune à tous les contrôles : `CheckResult` (id, titre, statut, sévérité,
  raison, constatations, mesures, sources), `Finding` (code, sévérité, phrase neutre, mesure, preuves), `Measurement`
  (libellé, valeur, unité, seuil, preuve), `Evidence` (réponse enregistrée + chemin du champ). Les trois statuts de
  D9 (`evaluated`, `not_applicable`, `unavailable`) avec leurs constructeurs, dont `unavailableFromError` qui
  transforme un échec client en raison lisible. Un contrôle qui a tourné sans rien trouver vaut `info`, jamais le
  silence.
- `src/checks/c3-freshness.ts` — âge mesuré contre `status.timestamp` de **la réponse qui portait la donnée**,
  jamais contre l'horloge locale (D4) : une fixture rejouée donne toujours le même âge. `PRICE_KIND_FAMILY` range
  chaque genre de prix dans sa famille et marque `rwa_wrapper: null` — E14 ne date pas ses jetons, c'est
  l'horodatage au niveau de l'actif qui les date (D7), lu par `datedRwaQuotes`. Trois constatations : `stale`
  (warning / critical selon la famille), `timestamp_ahead_of_response` (warning), et `age_unknown` en **info
  seulement** : le champ lui-même est déjà compté par C7, et un même défaut ne doit pas être facturé deux fois (D8).
- `src/checks/c7-schema.ts` — repose sur les `FieldIssue` que les normaliseurs écrivaient déjà : seuls les champs
  `required` (lus par un contrôle) deviennent des constatations ; les autres partent à l'audit via `schemaIssues`
  (`scored` / `reported`), conformément à D8 — les formes identiques pour tous les actifs décrivent l'API, pas
  l'actif, et les compter abaisserait tout le monde d'autant. Regroupement par (champ sans indices, problème) avec
  le nombre d'occurrences et un chemin concret : une réponse de 100 paires donne une ligne, pas cent. Sévérité prise
  dans la configuration — chemin complet, puis dernier segment, puis défaut.

**Constaté sur les réponses réelles** (aucun corps CMC écrit à la main) : les sept sources saines de T1.2 passent
C3 et C7 sans rien à signaler (`info`). `E08-dex-spot-pairs-paxg-uniswap` produit deux résultats réels : 19 paires
au-delà de la limite DEX dont 11 au-delà de 24 h (jusqu'à 485 jours), et **12 paires sur 100 dont
`base_asset_ucid` est `null`** — la même observation gardée pour T6.1, maintenant mesurée par un contrôle.

**Tests** (48 nouveaux) : `tests/checks-model.test.ts`, `-config`, `-c3`, `-c7`. Les seuils attendus sont dérivés de
la configuration chargée, pas recopiés, pour que T4.2 puisse calibrer sans casser les tests ; ce qui est figé, ce
sont les comportements (âge lu sur l'horloge de la réponse, wrappers E14 non datés, regroupement, partage
scored/reported, refus du chargeur).

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (278 tests, 25 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅ + scan direct des fichiers nouveaux (seule chaîne longue : l'adresse publique du
contrat PAXG, déjà présente dans les fixtures et la documentation).
**Mutations vérifiées** (fichiers restaurés à l'identique, `diff -r`) : C3 basé sur l'horloge locale → 6 échecs ;
`age_unknown` passé en warning → 1 échec ; `rwa_wrapper` daté comme un agrégat → 2 échecs ; C7 comptant les champs
non requis → 1 échec ; C7 sans regroupement → 1 échec ; sévérité cherchée sur le dernier segment seulement →
1 échec ; chargeur acceptant `warnAfterSeconds > criticalAfterSeconds` → 1 échec.

**Fichiers :** config/checks.json (nouveau), src/checks/{model,config,c3-freshness,c7-schema,index}.ts (nouveaux),
src/index.ts, tests/checks-{model,config,c3,c7}.test.ts (nouveaux), TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests TASKS.md` est refusé par le hook global
`gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Dixième itération sans
commit. `.loop/BLOCKED.md` mis à jour — la commande manuelle de l'option 3 oubliait le nouveau dossier `config/`,
elle a été corrigée (commit manuel unique T0.1–T3.1).

**Points laissés aux tâches suivantes :**
- Les seuils de C3 et les sévérités de C7 ne sont pas calibrés : `config/checks.json` porte des valeurs plausibles
  mesurées sur un seul échantillon (T1.2). T4.2 est la tâche qui les tranche.
- `schemaIssues(...).reported` est vide sur les fixtures saines : c'est normal, les normaliseurs ne notent un champ
  optionnel que s'il arrive dans une forme illisible. T6.1 le remplira en balayant l'échantillon d'audit.
- `runFreshnessCheck` et `runSchemaCheck` prennent leurs entrées toutes prêtes : c'est le plan d'appel de D1
  (T3.7 / T5.1) qui les assemblera à partir du client.
- C7 n'atteint les jetons imbriqués d'E14 que par `rwaQuoteInput` ; lu par `priceObservations`, E14 donne ses
  wrappers comme items et `schemaInput` suffit. T3.4 choisira lequel des deux le chemin RWA emprunte.

**Prochaine tâche :** T3.2 — C1 (écart prix agrégé E02 ↔ prix DEX E10, via le contrat pris dans E05) et C2, qui
reste `unavailable` avec cette clé (D2) et doit le dire dans chaque sortie.

## 2026-09-25 — T3.2 C1 et C2 écarts de prix ✅

**Fait.** Les deux contrôles d'écart de prix, chacun dans son fichier comme l'exige `CLAUDE.md`.

**C1 — prix agrégé contre prix DEX** (`src/checks/c1-dex-divergence.ts`). L'écart est mesuré en pourcentage du prix
de référence : `(marché − référence) / référence`. Le côté « référence » regroupe les prix agrégés (E02, E06, E07),
le côté « marché » les prix DEX (E10 pour `check`, E08/E09 pour l'audit) ; les wrappers RWA ne sont d'aucun côté,
ils relèvent de C5 (D6). Sans prix DEX le contrôle est `not_applicable` et non « tout va bien » (D9) ; le message
d'un résultat dit toujours les deux prix, le sens de l'écart et la limite franchie.

**C2 — prix agrégé contre paires d'exchanges centralisés** (`src/checks/c2-cex-divergence.ts`). `unavailable`,
avec la raison affichée dans chaque sortie, conformément à D2 : les trois sources candidates (E04, E15, E21)
répondent toutes 403 / 1006. Le contrôle ne fait aucun appel, ne coûte aucun crédit, et ne compte pas dans le score.
Aucun proxy ne prend son nom. Les endpoints ne sont nommés que par leur identifiant d'inventaire : aucun chemin
refusé n'entre dans `src/`, ce que `tests/endpoints-doc.test.ts` continue de vérifier.

**Constaté sur les réponses réelles** (aucun prix écrit à la main) : PAXG le 2026-09-24 vers 16 h 04–16 h 07 UTC,
agrégat E02 4253.2261 USD contre E10 4264.1538 USD, soit +0.26 % — le premier cas C1 repéré en T1.2
(observation 10). Les trois paires PAXG de la page Uniswap enregistrée donnent −0.20 %, +0.01 % et +0.26 %, soit
0.46 % d'écart entre places pour un actif liquide. Aux seuils livrés (2 % / 5 %) rien n'est signalé, ce qui est
l'attendu pour PAXG ; les branches warning et critical sont testées en resserrant la limite sous ces écarts réels,
pas en fabriquant des prix.

**Facteurisation.** `priceLabel` et la table des libellés, jusque-là privés dans `c3-freshness.ts`, passent dans un
`src/checks/prices.ts` partagé, qui accueille aussi `pricesOfAsset` / `isAboutAsset` (une réponse porte plusieurs
actifs : E02 rend BTC et PAXG ; E10 ne nomme ni identifiant ni symbole et n'est reconnu que par son contrat) et
l'écriture des nombres dans une phrase. C3 est inchangé, ses tests le prouvent.

**Configuration.** Nouvelle section `C1` dans `config/checks.json` (`warnAbovePercent` 2, `criticalAbovePercent` 5),
validée strictement comme les autres. Les `notes` disent d'où viennent ces nombres et qu'ils sont provisoires :
un seul actif mesuré, T4.2 tranche.

**Tests** (29 nouveaux, 307 au total) : `tests/checks-c1.test.ts`, `tests/checks-c2.test.ts`, plus C1 ajouté à
`tests/checks-config.test.ts`. Le test de C2 relit les trois fixtures citées dans sa raison et vérifie que chacune
est bien un refus 403 / 1006, que l'inventaire les marque `refused` et que `docs/DECISIONS.md` porte la même
décision : une raison sans preuve enregistrée ferait échouer la suite.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (307 tests, 27 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅ + scan direct des fichiers nouveaux (seules chaînes longues : l'adresse publique du
contrat PAXG, déjà dans les fixtures, l'adresse nulle et des noms de fixtures).
**Mutations vérifiées** (fichiers restaurés à l'identique, `diff`) : écart divisé par le prix de marché → 3 échecs ;
`Math.abs` retiré, écarts négatifs ignorés → 2 échecs ; limite warning utilisée comme limite critical → 2 échecs ;
division par un prix de référence nul → 1 échec ; appariement d'actif rendant toujours vrai → 1 échec ; C2 rendu
`evaluated` → 1 échec ; seuil C1 abaissé sous l'écart entre places réellement observé → 1 échec ; prix écrits à
4 chiffres significatifs → 2 échecs ; C2 citant une réponse qui a réussi → 2 échecs.

**Fichiers :** src/checks/{c1-dex-divergence,c2-cex-divergence,prices}.ts (nouveaux), src/checks/{config,index,
c3-freshness}.ts, config/checks.json, tests/checks-{c1,c2}.test.ts (nouveaux), tests/checks-config.test.ts,
TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests TASKS.md` est refusé par le hook global
`gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Onzième itération sans
commit. `.loop/BLOCKED.md` mis à jour (commit manuel unique T0.1–T3.2 ; la liste de fichiers de l'option 3 couvre
déjà tout ce qu'ajoute cette itération).

**Points laissés aux tâches suivantes :**
- Les seuils de C1 ne sont pas calibrés : un seul actif a été mesuré, et il est liquide. T4.2 les tranche sur le
  panel des 50 premières capitalisations.
- C1 mesure l'écart, pas ce qu'il vaut : la profondeur de la place derrière le prix de marché est la mesure de C4
  (T3.3, D5), et c'est le score (T3.6) qui met les deux ensemble.
- `runDexDivergenceCheck` reçoit ses entrées toutes prêtes, comme C3 et C7 : c'est le plan d'appel de D1
  (T3.7 / T5.1) qui ira chercher le contrat dans E05 et appellera E10. La raison `not_applicable` générique du
  contrôle est alors à remplacer par « cet actif n'a pas de contrat » quand l'appelant le sait.
- C2 redeviendra mesurable si une clé atteint E04 : il faudra d'abord le revérifier dans `docs/ENDPOINTS.md`.

**Prochaine tâche :** T3.3 — C4 liquidité fantôme (E10 `l` / `v24h` et E11 `liqUsd` / `v24` par pool, D5 ; le cas
naturel BULL/WETH d'E08, environ 171 USD de liquidité pour environ 40 M USD de volume 24 h, sert d'entrée de test).

---

## 2026-09-25 — T3.3 : C4, la profondeur derrière un prix

**Fait.** `src/checks/c4-liquidity.ts` mesure la liquidité annoncée par une place contre le volume 24 h qu'elle
déclare — le signal de « liquidité fantôme » de la spec (F4). Trois entrées, toutes en photo instantanée puisque
E12, l'historique de liquidité, est refusé (D5) : E10 `l` / `v24h` pour le jeton entier, E11 `liqUsd` / `v24` par
pool, et les mêmes deux valeurs par paire dans E08 / E09. `liquidityOfPrices` et `liquidityOfPools` ramènent les
trois à un même `LiquidityPoint` (label, rôle `token` ou `pool`, source, liquidité, volume).

**Trois signaux.** Plancher de liquidité (une place trop mince pour y dénouer une position), rapport volume 24 h /
profondeur (le signal fantôme lui-même), et — pour `preflight_trade` (T5.1) — la taille d'ordre rapportée à la
liquidité du pool le plus profond. Les constats ne portent que sur les deux places que D5 nomme, le jeton et le
pool le plus profond ; les huit autres pools sont mesurés et leurs réponses citées, sans quoi un actif produirait
dix constats quasi identiques. Leur mesure porte alors `threshold: null` : aucune comparaison n'est affichée qui
n'ait été faite.

**Rien inventé, rien dissimulé.** Une liquidité ou un volume illisible ressort en `info` (`liquidity_unknown`,
`volume_unknown`) en renvoyant le champ lui-même à C7 (D8) ; une place à 0 USD est signalée une fois par le
plancher, sans division par cette profondeur nulle ; une taille d'ordre qui n'est pas un montant positif ressort en
`order_size_unreadable` plutôt que d'être ignorée ; sans aucune place DEX lue, le contrôle est `not_applicable`
avec sa raison, jamais un succès silencieux (D9). Un ordre n'est jamais pesé contre le total jeton : C4 le pèse
contre un pool, et le dit (`order_share_unknown`) quand aucun pool n'a été lu.

**Configuration.** Nouvelle section `C4` dans `config/checks.json` : plancher 50 000 / 10 000 USD, rapport 50 / 250,
part d'ordre 10 % / 25 %. Les `notes` donnent les deux mesures réelles qui encadrent ces nombres — PAXG le
2026-09-24 vers 16 h 06 UTC (21 006 102 USD de profondeur contre 1 415 750 USD de volume, soit 0,067 ; dix pools de
0,0045 à 0,84 ; le plus mince tient 54 245 USD) et la paire BULL/WETH d'E08 (171,00653 USD contre 39 995 193 USD,
soit 233 881) — et disent que la ligne entre les deux n'est mesurée par rien : ce sont des valeurs provisoires, T4.2
tranche les quatre limites de marché. Les deux limites de taille d'ordre ne sont mesurées par rien non plus et c'est
T5.1 qui les exercera. Le chargeur refuse la section mal écrite ; le plancher est le seul couple du fichier où le
seuil critical est *sous* le warning, et cette inversion est validée explicitement.

**Tests** (36 nouveaux, 343 au total) : `tests/checks-c4.test.ts`, plus C4 ajouté à `tests/checks-config.test.ts`.
Deux tests ancrent les seuils livrés aux mesures réelles (aucun des dix pools PAXG enregistrés ne tombe sous le
plancher ; la paire fantôme y tombe), et un autre vérifie que chaque fixture citée dans les `notes` de C4 existe
vraiment dans `fixtures/` : une note citant une preuve absente fait échouer la suite.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (343 tests, 28 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅ + scan direct des fichiers nouveaux (seules chaînes longues : l'adresse publique du
contrat PAXG et celle du pool Uniswap v2, toutes deux déjà dans les fixtures, plus des noms de réglages).
**Mutations vérifiées** (fichiers restaurés à l'identique, `cmp`) : `deepestPool` rendant aussi le total jeton →
7 échecs ; rapport inversé (profondeur / volume) → 4 échecs ; constats levés sur les dix pools → 2 échecs ; limite
warning utilisée comme limite critical → 1 échec ; ordre pesé contre n'importe quelle place → 7 échecs ; place à
0 USD traitée comme saine → 1 échec ; part d'ordre calculée mais jamais rapportée → 3 échecs ; limite de rapport
abaissée sous le 0,84 réellement observé → 1 échec ; plancher relevé au-dessus du pool le plus mince réellement
enregistré → 1 échec ; `notes` citant une fixture absente du dépôt → 1 échec.

**Fichiers :** src/checks/c4-liquidity.ts (nouveau), src/checks/{config,index,prices}.ts, config/checks.json,
tests/checks-c4.test.ts (nouveau), tests/checks-config.test.ts, TASKS.md, .loop/BLOCKED.md, .loop/PROGRESS.md

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests TASKS.md` est refusé par le hook global
`gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Douzième itération sans
commit. `.loop/BLOCKED.md` mis à jour (commit manuel unique T0.1–T3.3 ; la liste de fichiers de l'option 3 couvre
déjà tout ce qu'ajoute cette itération).

**Points laissés aux tâches suivantes :**
- Les six seuils de C4 ne sont calibrés sur rien : un seul actif liquide et une seule paire fantôme ont été mesurés,
  et l'écart entre les deux est de cinq ordres de grandeur. T4.2 tranche les quatre limites de marché sur le panel
  des 50 premières capitalisations ; les deux limites de taille d'ordre attendent T5.1.
- Comme C1, `runLiquidityCheck` reçoit ses entrées toutes prêtes : c'est le plan d'appel de D1 (T3.7 / T5.1) qui
  cherchera le contrat dans E05, appellera E10 puis E11, et remplacera la raison `not_applicable` générique par
  « cet actif n'a pas de contrat » quand il le sait.
- C4 mesure la profondeur, C1 l'écart de prix ; c'est le score (T3.6) qui met les deux ensemble — un écart large sur
  une place profonde et un écart étroit sur une place fantôme ne pèsent pas pareil.

**Prochaine tâche :** T3.4 — C5 RWA (prime/décote contre le prix tokenisé moyen d'E14 et écart entre wrappers, D6 ;
table d'unités dans `config/`, facteur once troy = 31,1034768 g, index jeton → RWA via E19 / E18 à construire et
dont le coût en crédits est à mesurer).

## 2026-09-25 — T3.4 C5 RWA : prime/décote et écart entre wrappers ✅

**État trouvé au début de l'itération :** l'essentiel de T3.4 était déjà sur le disque, écrit par une itération
précédente interrompue avant l'étape de vérification et de journalisation (la tâche était restée `[ ]`). Cette
itération a donc porté sur la vérification réelle de ce travail, la fermeture d'un trou de tests qu'elle a révélé,
puis la comptabilité de fin de tâche.

**Ce que fait C5** (`src/checks/c5-rwa.ts`) : la référence est le prix tokenisé moyen d'E14
(`average_tokenized_price`), **jamais** un prix de l'actif sous-jacent — aucun endpoint atteignable n'en porte
(`tradfi_markets` est vide pour GOLD, E15 est refusé), et les sorties nomment la référence telle qu'elle est (D6).
Deux mesures : la prime/décote du wrapper demandé contre cette moyenne, et l'écart entre les wrappers d'un même
actif. Les prix passent par l'échelle d'unités de D6 — unité déclarée dans `config/`, sinon prix déjà dans la bande
autour de la moyenne, sinon un unique facteur configuré qui l'y ramène (« unit inferred »), sinon un constat que le
niveau de prix n'est pas expliqué. Le dernier cas est **rapporté, jamais écarté** : l'API ne donne aucun moyen de
distinguer une autre unité d'une vraie déviation, et deviner dans un sens ou dans l'autre reviendrait à inventer une
donnée. Un wrapper dont le volume 24 h est sous le minimum est mesuré et cité, mais laissé hors de l'écart.

**Index jeton → RWA** (`src/rwa/wrapper-index.ts`, CLI `npm run rwa:index`) : un utilisateur demande un wrapper
(`PAXG`), pas un actif (`GOLD`), et aucun endpoint vérifié ne fait le lien directement ; la seule route est E18
(émetteurs) puis E19 (jetons d'un émetteur, avec `rwa_id` à côté de `crypto_id`). C'est une marche sur tout le
catalogue, donc l'index est construit une fois et mis en cache sous `.cache/`. Son coût est **mesuré, pas estimé** :
la marche a été lancée en vrai le 2026-09-25 et ses 32 réponses sont enregistrées dans `fixtures/rwa-index/`, ce qui
la rejoue hors ligne. 30 réponses pour 32 tentatives, 30 crédits (E20 avant/après : `credits_used` 18 → 48, donc les
2 tentatives échouées n'ont pas été facturées), 2393 jetons listés dont 1437 (60,1 %) résolvables, 8,3 s. Les 956
jetons non résolvables bornent ce que C5 peut répondre : un wrapper qui en fait partie est signalé hors index,
jamais deviné. C'est aussi une observation pour l'audit T6.1.

**Trou de tests trouvé et fermé.** Cinq mutations ont été passées sur le code livré (fichiers restaurés à
l'identique, `cmp`) : direction de la prime inversée → 2 échecs ; filtre de volume retiré de l'écart → 4 échecs ;
unité ambiguë traitée comme inférée (c'est-à-dire devinée) → 2 échecs ; jetons sans `rwa_id` admis silencieusement
→ 7 échecs. **Une mutation a survécu** : remplacer `credits: charged` par `credits: requests`, c'est-à-dire compter
les *tentatives* au lieu des *crédits que les réponses ont réellement facturés*. C'est précisément la distinction sur
laquelle repose le tableau mesuré de D6 (32 tentatives, 30 crédits) : la mutation aurait écrit 32 dans ce tableau et
surestimé le coût de l'index, sans qu'aucun test ne bronche — les tests existants passaient tous par des scénarios où
les deux nombres coïncident. Test ajouté (`tests/rwa-wrapper-index.test.ts`) : une tentative E19 échoue sous HTTP, le
retry répond, et `calls` (3), `credits` (2) et `creditsUnconfirmed` (1) se séparent. La mutation est maintenant
attrapée.

**Seuils.** Les quatre limites de C5 sont des placeholders assumés, posés bien au-dessus du seul actif enregistré
(GOLD, 7 wrappers : déviation la plus large 0,340 %, écart entre wrappers 0,501 % de la moyenne). `unitBandPercent`
n'est pas une limite de qualité mais un séparateur entre « autre unité » et « déviation » : les wrappers lus
directement sont à moins de 0,2 % de la moyenne et les deux autres à 96,8 %, donc toute bande entre ces deux valeurs
découpe l'échantillon pareil. À noter que **T4.2 ne calibrera pas C5** : elle porte sur les 50 premières
cryptomonnaies, où C5 n'est pas applicable. Ces quatre nombres restent à trancher par un panel RWA ultérieur ; T5.3
est le premier endroit qui les exerce.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (428 tests, 31 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅. Contrôle direct de la clé : la vraie valeur de `CMC_API_KEY` n'apparaît dans aucun
fichier de `fixtures/`, `src/`, `tests/`, `docs/`, `config/`, et les 32 fixtures de `fixtures/rwa-index/` portent
toutes le masque `***`.

**Fichiers :** tests/rwa-wrapper-index.test.ts (test ajouté cette itération), TASKS.md, .loop/BLOCKED.md,
.loop/PROGRESS.md. Livrés par l'itération interrompue et vérifiés ici : src/checks/c5-rwa.ts, src/rwa/wrapper-index.ts,
src/cli/rwa-index.ts, src/checks/index.ts, src/normalize/rwa.ts, config/checks.json, docs/DECISIONS.md (D6 mesuré),
package.json (script `rwa:index`), tests/checks-c5.test.ts, tests/cli-rwa-index.test.ts, tests/normalize-rwa.test.ts,
fixtures/rwa-index/ (32 réponses).

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs TASKS.md` est refusé par le hook
global `gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Treizième
itération sans commit. `.loop/BLOCKED.md` mis à jour (commit manuel unique T0.1–T3.4 ; la liste de fichiers de
l'option 3 couvre déjà `fixtures/`, donc le nouveau dossier `fixtures/rwa-index/` y entre sans changement).

**Points laissés aux tâches suivantes :**
- `runRwaCheck` reçoit sa réponse E14 toute prête, comme C1 et C4 : c'est le plan d'appel de D1 (T3.7 / T5.1) qui
  résoudra le symbole du wrapper via l'index, appellera E14 sur le `rwa_id` trouvé, et remplacera la raison
  `not_applicable` générique par « ce jeton n'est pas un wrapper RWA » ou « ce wrapper est hors index » selon le cas.
- Un seul actif RWA est enregistré (GOLD). Tant qu'un deuxième n'est pas mesuré, la table d'unités reste vide et le
  seul facteur de conversion configuré est gramme → once troy, qui est une définition d'unité écrite par ce projet,
  pas une valeur lue dans l'API.

**Prochaine tâche :** T3.5 — C6 cohérence inter-endpoints (D7 : E02 contre E06 sur le même `crypto_id`, prix et
`last_updated` ; pour un wrapper RWA, E14 `tokens[].price` contre E02 sur le même `crypto_id`. L'écart E02/E10
appartient à C1 et n'est pas recompté ici, pour qu'un même écart ne pèse jamais deux fois).

## 2026-09-25 — T3.5 C6 cohérence inter-endpoints ✅

**Ce que fait C6** (`src/checks/c6-consistency.ts`) : le même actif lu chez deux endpoints, et ce que les deux
réponses en disent. Dans `check`, l'agrégat E02 est la référence ; en face, le prix simple E06 — qui republie le
même agrégat — et, pour un wrapper tokenisé, le `tokens[].price` d'E14 sur le même `crypto_id`. **E10 est
volontairement absent** : l'agrégat contre un prix DEX est la mesure de C1, et le recompter ici ferait peser deux
fois le même écart (D7). Les comparaisons qui coûtent des crédits par actif et décrivent l'API plutôt qu'un actif
(E07/E03 contre E02, E14 contre E16, E17 contre E14, E18 contre E19) restent à l'audit T6.1.

**La règle de l'instantané, qui est le cœur du contrôle.** Un écart n'est une contradiction qu'entre deux valeurs du
même instantané. Trois cas, chacun avec son constat :
- les deux côtés sont datés et leurs horodatages tiennent dans la tolérance → même instantané, l'écart de prix est
  jugé contre les limites (`endpoint_gap`, warning ou critical) ;
- les deux côtés sont datés et s'écartent au-delà → `different_snapshots`, sévérité `info` : l'écart est **mesuré et
  affiché**, mais sa limite est retirée de la mesure (`threshold: null`), parce qu'un prix qui a bougé entre deux
  moments n'est pas un prix sur lequel deux endpoints se contredisent ;
- un côté n'est pas daté — c'est le cas d'E14, qui ne donne aucun horodatage à ses `tokens[]` — → seule la limite de
  prix s'applique, et le message le dit en toutes lettres plutôt que de laisser croire à une comparaison datée.

**Les nombres, mesurés puis assumés comme provisoires.** Sur les réponses enregistrées du 2026-09-24 vers 16 h 04 :
E02 et E06 renvoient le même prix **au dernier chiffre** pour les deux actifs demandés (BTC 84278.77808276, PAXG
4253.226063661451) et les datent tous deux de 16:02:03 — écart 0 %, distance 0 s ; E14 valorise le wrapper PAXG à
4253.420091887455, soit **+0,0046 %** au-dessus de l'agrégat E02. Les trois réglages de `config/checks.json` :
`warnAbovePercent` 0,5 %, `criticalAbovePercent` 2 %, `snapshotToleranceSeconds` 60 s. Les deux pourcentages sont
des placeholders posés bien au-dessus de ce seul échantillon, mais **plus serrés que ceux de C1** (2 % / 5 %) — et
c'est le point : C1 compare deux places de marché différentes, C6 compare deux publications du *même* agrégat, donc
il n'y a aucune raison qu'elles s'écartent. La tolérance de 60 s est un intervalle de rafraîchissement des endpoints
agrégés tel que CMC le documente ; le seul couple mesuré est à 0 s. T4.2 calibrera les trois sur le top 50, où C6 se
réduira le plus souvent à E02 contre E06.

**Tests** (`tests/checks-c6.test.ts`, 22 cas) : tous sur les réponses réelles enregistrées, aucun corps CMC écrit à
la main. Les cas dégradés passent par `damaged()`, qui abîme un champ d'une fixture réelle. Quatre mutations ont été
passées sur le code livré, fichier restauré à l'identique (`cmp`) : juger l'écart même entre deux instantanés
différents → 2 échecs ; ajouter E10 à la liste comparée, c'est-à-dire recompter l'écart de C1 → 1 échec ; tolérance
stricte au lieu d'inclusive → 1 échec ; ne plus jamais qualifier un écart de critique → 2 échecs. Aucune mutation
n'a survécu.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (454 tests, 32 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅. Contrôle direct de la clé : la vraie valeur de `CMC_API_KEY` n'apparaît dans aucun
fichier de `src/`, `tests/`, `docs/`, `config/`, `fixtures/`.

**Fichiers :** `src/checks/c6-consistency.ts` (nouveau), `src/checks/config.ts` (section C6 : `ConsistencyConfig`,
son parseur strict et l'ordre warn ≤ critical), `src/checks/index.ts` (export + en-tête), `config/checks.json`
(section C6 avec ses notes de provenance), `tests/checks-c6.test.ts` (nouveau), `tests/checks-config.test.ts`
(C6 ajouté aux cas existants : chargement, refus des réglages inconnus ou hors bornes, notes citant D7 et des
fixtures présentes), `docs/DECISIONS.md` (la ligne « T3.1–T3.5 » de la section « Handed to later tasks » est marquée
livrée), `TASKS.md`, `.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs TASKS.md` est refusé par le hook
global `gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Quatorzième
itération sans commit. `.loop/BLOCKED.md` mis à jour (le message du commit unique devient T0.1–T3.5 ; la liste de
fichiers de l'option 3 n'a pas besoin de changer, tous les dossiers touchés y sont déjà).

**Le moteur est complet.** Les sept contrôles sont posés : C1 et C2 (écarts de prix), C3 (fraîcheur), C4
(liquidité), C5 (RWA), C6 (cohérence inter-endpoints), C7 (schéma). Chacun renvoie le même `CheckResult` et, quand
il ne peut pas tourner, dit pourquoi (`not_applicable` ou `unavailable`) au lieu de se taire.

**Prochaine tâche :** T3.6 — score et verdict, pondérations dans `config/`. Points d'attention déjà écrits : le
score ne compte que les contrôles `evaluated`, avec renormalisation des poids, et l'affichage montre la couverture
(« 3 contrôles sur 7 évalués ») ; **pas** de plafonnement automatique du verdict pour faible couverture à ce stade,
puisque les actifs sans contrat ne peuvent jamais faire tourner C1, C2, C4 ni C5 et qu'un plafond les punirait pour
une raison étrangère à la qualité des données — T4.2 rouvrira la question avec les résultats de calibration (D9).

## 2026-09-25 — T3.6 score et verdict ✅

**Ce qui a été fait.** Le moteur rend maintenant un chiffre et un mot. `src/score/` pèse les sept contrôles en un
score sur 100 et le lit sur deux bornes : `ACT` à 75 ou plus, `CAUTION` à 40 ou plus, `DO_NOT_ACT` en dessous — les
bornes exactes du cahier des charges (F5). Poids, points par sévérité et bornes sont dans la section `score` de
`config/checks.json`, pas dans le code, pour que T4.2 les calibre sans toucher à un contrôle.

**Trois règles, toutes écrites dans `docs/DECISIONS.md` (D9 puis D11, nouvelle) :**
1. *Seuls les contrôles qui ont tourné pèsent*, avec renormalisation des poids (D9). La couverture (« 2 contrôles
   sur 7 évalués ») est affichée **à côté** du score, jamais fondue dedans, et chaque contrôle qui n'a pas tourné
   garde sa raison **et son poids** dans la sortie : ce qui n'a pas été mesuré reste visible.
2. *Un contrôle est noté sur sa pire observation seule.* `severity` est déjà défini comme la pire des observations
   (`src/checks/model.ts`) et rien d'enregistré ne mesure ce que devrait coûter un second avertissement sur le
   même contrôle.
3. *Une observation `critical` retient le verdict à `CAUTION` ou moins*, quelle que soit la moyenne pondérée. Ce
   point est sorti du calcul lui-même : avec les poids livrés, un actif dont C3 est propre (poids 15) et dont C7
   signale que **le prix lui-même n'a pas pu être lu** (poids 5, critical) donne (15×100 + 5×0)/20 = **75**,
   c'est-à-dire exactement la borne `ACT`. Le seul résultat que cet outil existe pour empêcher. Le plafond n'est
   pas un plafond de couverture : c'est la définition de `critical` — « le verdict ne peut pas reposer sur cette
   source » — appliquée au verdict. Il s'arrête à `CAUTION` et non `DO_NOT_ACT` parce qu'une source inutilisable
   sur sept invite à regarder avant d'agir, sans être une mesure que la donnée est fausse ; le score choisit encore
   entre `CAUTION` et `DO_NOT_ACT` sous le plafond. Réglable (`capWithCritical`), `null` le désactive.

**Couverture nulle (D11).** Un passage où **aucun** contrôle n'a pu être évalué n'a pas de score (`null`) et répond
`DO_NOT_ACT`. Ce n'est pas le plafond pour faible couverture que D9 laisse à T4.2 — celui-là porte sur un verdict
mince ; ici il n'y a aucune mesure sur laquelle en poser un. La phrase de résumé le dit dans ces termes et liste la
raison donnée par chaque contrôle, sans nommer de fautif.

**Ce que le score refuse de deviner.** On lui donne les sept contrôles, une fois chacun : un résultat absent de la
liste décalerait tous les poids renormalisés sans qu'aucune sortie le dise, et un contrôle qui ne peut pas tourner
a déjà sa façon de le dire (D9). Un poids de zéro, ou un contrôle absent de la table des poids, est refusé au
chargement pour la même raison. Deux bornes égales, ou une borne `CAUTION` à 0, sont refusées aussi : elles
retireraient silencieusement un verdict du jeu, et c'est la façon dont T4.2 ne doit pas calibrer.

**Les poids sont des placeholders, et le disent.** 20 pour C1 et C2 (ils confrontent le prix à un prix d'un autre
lieu), 15 pour C3, C4 et C5 (le marché derrière le prix), 10 pour C6 (deux publications du même agrégat, donc
recouvrement avec C1), 5 pour C7. Leur ordre est une lecture de ce que chaque contrôle dit sur le fait d'agir, pas
une mesure ; rien d'enregistré ne les mesure et T4.2 les règle sur le top 50. C2 garde son poids bien qu'il soit
`unavailable` avec cette clé (D2) : une clé qui atteindrait les prix par plateforme le noterait sans changement de
code. Les 50 points d'un avertissement sont un placeholder de même nature.

**Tests** (`tests/score.test.ts`, 24 cas ; `tests/checks-config.test.ts`, 10 cas de plus) : les bornes exactes, la
renormalisation, les parts, le plafond critique, la couverture nulle, les refus. Quatre cas tournent sur les
réponses réelles enregistrées : le score lit C2, C3 et C7 **à travers les contrôles eux-mêmes**, pas des résultats
écrits à la main — `E02-quotes-latest-btc-paxg` propre donne 100/ACT et « 2 contrôles sur 7 évalués », et la même
réponse abîmée par `damaged()` (prix du premier actif rendu illisible, rien d'autre touché) tombe à `CAUTION`.
Cinq mutations passées sur le code livré, fichiers restaurés à l'identique (`cmp`) : retirer le plafond critique →
2 échecs ; compter au dénominateur les contrôles qui n'ont pas tourné → 13 échecs ; borne `ACT` exclusive → 3
échecs ; noter 100 une couverture nulle → 3 échecs ; ne plus vérifier l'ordre de l'échelle des points → 1 échec.
Aucune mutation n'a survécu.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (490 tests, 33 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅. Contrôle direct : la vraie valeur de `CMC_API_KEY` n'apparaît dans aucun des dix
fichiers touchés.

**Fichiers :** `src/score/score.ts`, `src/score/verdict.ts`, `src/score/index.ts` (nouveau dossier),
`src/checks/config.ts` (section `score` : `ScoreConfig`, son parseur strict, le plafond), `src/checks/index.ts` et
`src/index.ts` (en-têtes et export), `config/checks.json` (section `score` avec ses notes de provenance),
`tests/score.test.ts` (nouveau), `tests/checks-config.test.ts` (dix cas pour la section `score`),
`docs/DECISIONS.md` (**D11** nouvelle ; la ligne « T3.6 » de « Handed to later tasks » est marquée livrée, celle de
T4.2 élargie aux poids), `TASKS.md`, `.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs TASKS.md` est refusé par le hook
global `gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Quinzième
itération sans commit. `.loop/BLOCKED.md` mis à jour (message du commit unique → T0.1–T3.6 ; la liste de fichiers
de l'option 3 passe par le dossier `src` entier, elle couvre donc déjà le nouveau `src/score/`).

**Prochaine tâche :** T3.7 — CLI `npm run check -- <symbole>`. C'est la première commande qu'un relecteur lancera,
et la première fois que le plan d'appels de D1 (un `check` en moins de 10 s) tourne en entier. Points d'attention :
réutiliser `createClientForMode` pour que la commande tourne en replay sans réseau ; afficher le verdict, le score,
la couverture, puis les sept contrôles avec la raison de ceux qui n'ont pas tourné ; ne jamais imprimer la clé.

## 2026-09-25 — T3.7 la commande `check` ✅

**Ce qui a été fait.** La chaîne se lance maintenant d'un mot : `npm run check -- PAXG`. Deux pièces, et les tests
qui manquaient aux deux. `src/checks/assess.ts` exécute le plan d'appels de D1 pour un actif — E01, puis E02, E06,
E05 et E14 en parallèle, puis E10 et E11 sur le contrat que E05 a donné — passe ce qu'il a lu aux sept contrôles et
remet le tout au score. `src/cli/check.ts` l'imprime : l'actif tel que les réponses le nomment, le verdict, chaque
contrôle avec la part du score qu'il a portée ou la raison pour laquelle il n'a pas tourné, puis la réponse
enregistrée derrière chaque ligne.

**L'implémentation existait déjà, non testée** (écrite en fin d'itération précédente, 21h48–21h53) : l'itération a
donc consisté à l'éprouver, et l'épreuve a trouvé deux défauts réels.
1. *`0.0726 timesx`* — `formatValue` ajoutait un `x` à `formatMultiple`, qui écrit déjà « times ». Visible sur
   chaque mesure de ratio de C4 en `--details`, c'est-à-dire partout où la commande montre la profondeur derrière un
   prix. Corrigé : le rapport reprend les mots de C4, `0.0726 times`.
2. *`runCheck` sortait par une exception* quand le client lui-même ne pouvait pas être construit — `--replay` sur un
   dossier absent, ou un appel live sans clé — alors que son commentaire promet un `ok: false` avec son rapport. La
   commande s'en tirait (le `main` rattrape et sort en 1), mais l'appelant programmatique de T7.1 n'aurait rien eu
   de structuré. La construction du client est passée dans le `try` ; sans client il n'y a pas de compteur, donc pas
   de ligne de crédits : une seule ligne `❌`.

**Ce que les tests lisent, et sur quoi.** Deux marches live de la commande ont été enregistrées (fixtures/check,
11 réponses, clé masquée dans les 11) : **PAXG**, qui traverse tout le plan — DEX et RWA compris — et **BTC**, qui
est une pièce et n'a ni contrat de jeton ni actif réel, donc éprouve le côté « n'a pas tourné » de D9. Les runs qui
doivent perdre une réponse la perdent en rejouant un dossier qui contient tout sauf cet endpoint, jamais par une
erreur écrite à la main. `tests/checks-assess.test.ts` (38 cas) et `tests/cli-check.test.ts` (36 cas) ; helper
commun `tests/helpers/check-fixtures.ts`, qui construit aussi l'index D6 depuis la page d'émetteur Paxos
enregistrée, pour ne pas dépendre du cache sous `.cache/` qu'un clone propre n'a pas.

**Le critère d'acceptation 2 est mesuré, pas estimé.** D1 annonçait « environ 7,4 s » d'après les latences de T1.2.
Les horodatages des deux marches live donnent **7,83 s** pour PAXG (sept réponses) et **4,63 s** pour BTC (quatre) :
dans le budget. Le total colle, la répartition non — E01 a répondu en 4 688 ms au lieu de 864, E10 en 646 ms au lieu
de 5 132 : le chemin critique de ces marches était la résolution, pas l'appel DEX. Les quatre requêtes de l'étape 1
sont parties à moins de 4 ms l'une de l'autre et la paire de l'étape 2 à 1 ms, donc le parallélisme du plan est réel.
PAXG laisse ~2,2 s de marge, et l'appel qui a mangé le budget est celui qu'un ID numérique évite. Consigné dans
`docs/DECISIONS.md`, D1.

**Sept mutations passées sur le code livré, fichiers restaurés à l'identique (`cmp`), aucune survivante :** ignorer
si une entrée E01 est active → 1 échec ; appeler le DEX sans contrat → 18 ; appeler E14 quand l'index n'a rien lié
→ 7 ; laisser un appel en échec interrompre la marche → 7 ; rendre `ok: true` quand rien n'a été évalué → 1 ;
retirer du rapport les contrôles qui n'ont pas tourné → 4 ; imprimer un ratio en nombre nu → 1.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (564 tests, 35 fichiers), `npm run build` ✅,
`scripts/check-secrets.sh` ✅. Contrôle direct : la vraie valeur de `CMC_API_KEY` n'apparaît dans aucun des 17
fichiers touchés ou ajoutés, fixtures comprises. Un test de la CLI vérifie en plus que le mode `--record` masque la
clé dans chaque fixture qu'il écrit.

**Fichiers :** `src/cli/check.ts` (deux corrections, `WRAP_AT` exporté), `src/checks/assess.ts` (inchangé, éprouvé),
`tests/checks-assess.test.ts` (nouveau), `tests/cli-check.test.ts` (nouveau),
`tests/helpers/check-fixtures.ts` (nouveau), `fixtures/check/` (nouveau dossier, 11 réponses réelles),
`docs/DECISIONS.md` (D1 : mesure de bout en bout ; « Handed to later tasks » : T3.7 livrée), `TASKS.md`,
`.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs fixtures TASKS.md` est refusé par
le hook global `gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Seizième
itération sans commit. `.loop/BLOCKED.md` mis à jour (message du commit unique → T0.1–T3.7 ; le nouveau dossier
`fixtures/check/` est déjà couvert par `fixtures` dans la commande de l'option 3).

**Prochaine tâche :** T4.1 — enregistrer les données des 50 premières cryptos, lancer le score, produire
`docs/CALIBRATION.md`. Points d'attention : E03 donne le panel en un appel (1 crédit) mais met 5,9 s, donc hors du
chemin par actif ; chaque actif passe ensuite par le plan de D1, ce qui coûte des crédits — prévoir le plafond
`CMC_CREDIT_BUDGET` et l'enregistrement en `--record` pour que la calibration de T4.2 tourne ensuite sans réseau.
Attention aussi : 50 actifs à ~5 crédits font ~250 crédits, à comparer au budget restant avant de lancer.

## 2026-09-26 — T4.1 calibration sur les 50 premières cryptos ✅

**Le critère d'acceptation 4 est atteint et mesuré : 90,0 % d'`ACT` sur les 50 premières cryptos par
capitalisation**, exactement la barre que F5 exige (45 `ACT`, 5 `CAUTION`, 0 `DO_NOT_ACT`). Ce n'est pas un chiffre
écrit à la main : `docs/CALIBRATION.md` et `docs/calibration.json` sont générés par `npm run calibrate`, et
`tests/calibration-doc.test.ts` vérifie que le markdown est exactement ce que le JSON rend.

**L'implémentation existait déjà, non exécutée.** L'itération précédente avait écrit `src/calibration/`
(panel, run, report) et `src/cli/calibrate.ts` avec leurs tests, puis lancé la marche live — qui s'est arrêtée à
25 actifs sur 50. Les 7 tests rouges du départ étaient tous `tests/calibration-doc.test.ts`, faute des deux
fichiers sous `docs/`. Cette itération a donc consisté à faire la marche complète et à la vérifier.

**La marche interrompue mesurait le réseau, pas le moteur.** Elle donnait `DO_NOT_ACT` à DOGE, XLM et BCH avec
0 contrôle évalué et 0 crédit, en ~25,4 s chacun — soit 3 tentatives × 8 s (le `timeoutMs` par défaut) plus le
backoff : des expirations locales, pas un signal de qualité de données. Laisser ces trois-là dans le panel aurait
donné 76 % d'`ACT` et envoyé T4.2 desserrer des seuils pour compenser une latence réseau. La marche a donc été
refaite avec `CMC_TIMEOUT_MS=20000`. Le réseau était par ailleurs redevenu rapide (1–3 s par actif contre 19–41 s) :
DOGE ressort à `ACT`, 100/100. Le choix reste lisible dans le rapport — le message d'expiration du client écrit
lui-même sa durée (« no answer within 20000 ms »), et une seule expiration subsiste sur les 322 requêtes.

**Ce que le panel a trouvé, et qui n'est pas du bruit.** 13 actifs ont perdu E10 et E11 sur un **HTTP 500
« The system is busy, please try again later! »** — côté CMC, pas côté client, et enregistré comme tel : c'est
matière pour l'audit F9. C2 est indisponible sur les 50 actifs, conformément à D2 (plan Startup). Les 5 `CAUTION`
se répartissent en deux causes distinctes : BNB, LEO et GRAM par le score lui-même (65,4 / 73,1 / 57,7), AVAX et
TAO par le plafond de D11 malgré des scores de 83,3 et 92,3, parce qu'un constat `critical` de C7 borne le verdict.
Le panel garde donc naturellement les cas que T4.2 doit préserver : le moteur n'est pas aveugle.

**Coût mesuré, pas estimé.** 322 requêtes, **216 crédits**, cadencé à 40 requêtes/minute (la clé en permet 50).
Le compteur du client et le compteur du compte concordent exactement : E20 lu avant et après donne 552 − 336 = 216.
Il reste 14 448 crédits sur les 15 000 du mois. Par actif : médiane 2,4 s, le plus lent 52,5 s, 8 actifs au-delà des
10 s de D1 — mais ces durées incluent l'attente d'un créneau sous la limite par minute, donc ce ne sont pas les
durées d'un `check` isolé.

**Un dossier de fixtures par marche.** Les 300 réponses sont dans `fixtures/calibration/live-20260926T1044Z/`, clé
masquée dans les 300 (vérifié fichier par fichier, plus `scripts/check-secrets.sh`). `CALIBRATION_FIXTURES` pointe
ce dossier et lui seul : mélanger les enregistrements partiels laisserait une réponse ancienne répondre à un appel
que cette marche a perdu, et le rejeu mesurerait autre chose que la marche live. Les deux lots partiels
(racine de `fixtures/calibration/`, et `live-2026-09-26/`) restent à supprimer à la main — ma tentative de
suppression a été refusée par le classificateur de sécurité, et je ne l'ai pas contournée. Détail dans
`.loop/BLOCKED.md`.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (641 tests, 41 fichiers, dont les 7 qui étaient
rouges au départ), `scripts/check-secrets.sh` ✅. Contrôle direct : la vraie valeur de `CMC_API_KEY` n'apparaît dans
aucune des 300 fixtures ni dans les deux fichiers de `docs/`.

**Fichiers :** `docs/CALIBRATION.md` (nouveau, généré), `docs/calibration.json` (nouveau, généré),
`fixtures/calibration/live-20260926T1044Z/` (nouveau, 300 réponses réelles),
`tests/helpers/calibration-fixtures.ts` (`CALIBRATION_FIXTURES` pointe la marche complète), `TASKS.md`,
`.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs fixtures TASKS.md` est refusé par
le hook global `gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné.
Dix-septième itération sans commit. `.loop/BLOCKED.md` mis à jour (message du commit unique → T0.1–T4.1).

**Prochaine tâche :** T4.2 — ajuster seuils et pondérations en gardant ≥ 90 % d'`ACT`, sans rendre le moteur
aveugle. Points d'attention : la cible est atteinte *tout juste* (90,0 % pour 90 % exigés), donc tout desserrage
doit être justifié par une mesure, pas par le confort ; les placeholders que D11 laisse à trancher sont les poids,
les 50 points d'un `warning` et les deux bornes ; D9 laisse aussi ouvert si une couverture faible (3 contrôles sur 7
pour 19 actifs) doit plafonner le verdict. Le rejeu tourne sans réseau et sans crédit
(`npm run calibrate -- --replay=fixtures/calibration/live-20260926T1044Z`), donc T4.2 peut itérer gratuitement.

## 2026-09-26 — T4.2 calibration des seuils sur le panel des 50 ✅

**Ce que la tâche demandait, et où en était le travail.** T4.2 demande d'ajuster seuils et pondérations jusqu'à ≥ 90 %
d'`ACT` sur le panel des 50, sans rendre le moteur aveugle, et de documenter les choix. En ouvrant l'itération, l'essentiel
du réglage était déjà posé dans `config/checks.json` (horodaté après la dernière entrée de ce journal) : 94 % d'`ACT`,
contre 90 % exigés et 90 % tout juste atteints par T4.1. Mais le travail n'était pas fini : **un test était rouge**, la
documentation générée décrivait encore ses propres seuils comme l'état « avant T4.2 », et plusieurs chiffres cités dans les
`notes` ne correspondaient pas à ce que les réponses enregistrées mesurent réellement. C'est ce qu'il restait à faire.

**Le test rouge disait quelque chose de vrai.** `tests/score-cap.test.ts` supprimait le champ `p` d'une réponse E10 et
attendait que C4 rapporte `liquidity_unknown`. Il ne le fait pas, et il a raison de ne pas le faire : `p` est le prix,
la profondeur vit dans `l` et `v24h`, qui étaient toujours là. Seul C1 perd sa mesure. Le cas que le test voulait décrire —
toute la lecture du vénue perdue d'un coup — existe pourtant dans le panel : **TAO**, dont la réponse E10 n'a rapporté que
`pid`, `pdex` et `a`. Le test porte donc maintenant deux cas distincts, et aucun corps CMC n'est écrit à la main : le prix
seul retiré (C1 dit `gap_unknown`, C4 mesure toujours la profondeur), et la réponse réduite à la forme que TAO a réellement
renvoyée (C1, C3 et C4 disent chacun ce qu'ils ont perdu, C7 lève des `warning` et rien n'est plafonné).

**Cinq chiffres documentés étaient faux ; je les ai mesurés, pas devinés.** J'ai rejoué le panel sous seuils balayés et
extrait les mesures des sept contrôles. Ce qui tient : les 102 âges agrégés (69,720 s à 87,367 s), les 30 âges DEX
(SOL 7543 s, GRAM 4453 s, puis RLUSD 1725 s), les 52 écarts C6 (le plus large 0,0084 % sur XAUt, médiane exactement 0,
49 paires à 0 s et USDG à 60 s), le turnover maximal 8,127 (pool wSOL/SUI sur Orca), les seuils de liquidité qui tombent
dans les trous de la distribution (3757 · 20585 · 37990 · 55879), C1 critique à 6 % qui ramène BNB à `ACT` et le panel à
96 %, le balayage des points d'un `warning` de 30 à 70 (92 % ou 94 %), et la levée du plafond qui ne change aucun verdict.
Ce qui ne tenait pas, et que j'ai corrigé dans les `notes` : plafonner sur une couverture faible donne **56 %**, pas 58 %,
et plafonner sur la seule indisponibilité **66 %**, pas 72 % ; AVAX n'est pas « une pièce sans contrat » mais un actif dont
E10 et E11 ont répondu **vides** (4 pièces + AVAX, pas 5 pièces) ; 28 des 30 écarts C1 tiennent dans 1,6 %, pas 1,1 %
(LEO à −1,583 % en sort) ; C1 et C4 ont tourné sur **31** actifs, pas 30, le trente-et-unième étant TAO sans lecture
utilisable ; une seule lecture dépasse 8, pas deux ; et C4 tient LEO sous `ACT` mais **pas SOL**, qui reste à `ACT` avec
76,9. Aucun seuil n'a bougé — seule la prose qui les justifie a été remise sur les mesures.

**Le garde-fou que T4.2 exige est maintenant nommé.** Le test « ne pas rendre le moteur aveugle » se contentait de vérifier
qu'au moins un actif reste sous `ACT`. Il nomme désormais les trois et le contrôle qui tient chacun : BNB et GRAM par
`price_gap` critique de C1, LEO par `thin_venue` critique de C4. J'ai vérifié que ce garde-fou mord, dans les deux sens :
élargir C1 à 6 % rend le rejeu incohérent avec le rapport committé (2 tests rouges), et régénérer le rapport pour masquer
cela fait tomber exactement le nouveau test (96 %, BNB revenu à `ACT`). Les trois fichiers touchés par cet essai ont été
restaurés à l'octet près.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (656 tests, 42 fichiers), `scripts/check-secrets.sh` ✅,
plus un scan direct : la vraie valeur de `CMC_API_KEY` n'apparaît dans aucun fichier touché. Le rapport a été régénéré par
rejeu (`--replay=fixtures/calibration/live-20260926T1044Z`) : **aucun appel réseau, aucun crédit dépensé**, et les `notes`
de `config/checks.json` sont identiques à celles que `docs/calibration.json` embarque.

**Fichiers :** `config/checks.json` (corrections des `notes` de C1, C3, C4, C5, C7 et `score` ; aucune valeur modifiée),
`src/calibration/report.ts` (le rapport ne se décrit plus comme l'état « avant T4.2 »), `tests/score-cap.test.ts` (le cas
DEX corrigé, plus le cas TAO), `tests/calibration-doc.test.ts` (les trois actifs sous `ACT` nommés),
`docs/CALIBRATION.md` et `docs/calibration.json` (régénérés), `TASKS.md`, `.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `config src tests docs TASKS.md` est refusé par le hook global
`gitflow-asin` (« Confirmation requise avant execution », branche `master`). Non contourné. Dix-huitième itération sans
commit ; `.loop/BLOCKED.md` mis à jour (message du commit unique → T0.1–T4.2).

**Prochaine tâche :** T5.1 — le serveur MCP (stdio) avec `check_asset`, `check_rwa_token`, `preflight_trade` et `explain`,
avec ses tests. Points d'attention : `preflight_trade` est le premier consommateur des deux seuils de taille d'ordre de C4
(`warnOrderSharePercent`, `criticalOrderSharePercent`), que rien n'a encore mesurés — la calibration ne les exerce pas, et
il faudra dire clairement qu'ils restent des placeholders. Les tests doivent tourner sans réseau : le rejeu des fixtures
`fixtures/check/` (PAXG et BTC) couvre déjà les deux formes utiles, un wrapper RWA et une pièce.

## 2026-09-26 — T5.2 configuration MCP du README ✅

**Fait :** le dépôt a maintenant un `README.md` (anglais) et la configuration MCP qu'un hôte peut coller telle
quelle : un bloc Claude Desktop (`claude_desktop_config.json`), la ligne `claude mcp add` pour Claude Code, et un
troisième bloc « démo hors ligne » qui rejoue `fixtures/check` — sans clé, sans réseau, sans crédit. Le README dit
aussi ce que le serveur enregistre (les quatre outils et leurs arguments), ce que mesurent les sept contrôles, et ce
que la calibration a établi.

**Trois points de cette configuration ont été mesurés, pas supposés :**
- **`npm run mcp` n'est pas une commande d'hôte.** En capturant les deux flux séparément, la bannière
  `> second-opinion@0.1.0 mcp` sort sur **stdout**, c'est-à-dire là où vit le flux JSON-RPC : un hôte pointé sur
  `npm run mcp` lit une première trame qui n'est pas du JSON. Le README envoie donc l'hôte sur
  `node dist/mcp/server.js` et dit pourquoi ; un test refait la mesure pour que la raison reste vraie.
- **La valeur passée par l'hôte l'emporte sur `.env`.** Mesuré : avec `CMC_API_KEY` déjà dans l'environnement,
  `process.loadEnvFile('.env')` ne l'écrase pas. Le bloc `env` est donc facultatif, et prioritaire quand il est là.
- **La syntaxe `claude mcp add`** vient de l'aide de la CLI installée (`claude mcp add [options] <name>
  <commandOrUrl> [args...]`, `-e KEY=value`, séparateur `--`), pas de mémoire.

**Le test lance vraiment le serveur** (`tests/mcp-config-doc.test.ts`, 23 cas) : il extrait les blocs JSON du README,
remplace le chemin d'exemple par celui de ce clone, et démarre le binaire construit dans un vrai tube, avec le client
du SDK MCP à l'autre bout — depuis le dossier temporaire du système, pour que les chemins absolus tiennent seuls. Le
bloc live va jusqu'où va un hôte sans clé : poignée de main (nom et version), quatre outils, `explain` qui répond, et
la clé manquante signalée par l'outil qui en avait besoin plutôt que par un serveur qui refuse de démarrer. Le bloc
hors ligne va jusqu'au verdict, sur PAXG (`ACT`, 100/100) puis sur BTC, en citant les fixtures lues. Chaque processus
est lancé avec `CMC_API_KEY` vide : si un cas futur appelle l'API, il échoue sur la clé au lieu de dépenser un crédit.

**Le test tient aussi le README sur le code :** le tableau des outils est comparé à `TOOL_NAMES`, celui des contrôles
à `CHECK_TITLES`, les chiffres de calibration au `summary` de `docs/calibration.json` (94 %, cible 90 %, 3 en
`CAUTION`), chaque `npm run …` cité à `package.json`, chaque variable des blocs `env` à `.env.example`, et le point
d'entrée documenté au script `mcp`. Un script qui changerait de cible, ou un seuil de calibration qui bougerait, fait
tomber le test au lieu de laisser le README mentir.

**Vérifié :** `npm run lint && npm run typecheck && npm test` ✅ (743 tests, 45 fichiers),
`scripts/check-secrets.sh` ✅, plus un scan direct : la vraie valeur de `CMC_API_KEY` n'apparaît ni dans `README.md`
ni dans le nouveau test. Aucun appel réseau, aucun crédit dépensé (rejeu et `explain` seulement).

**Fichiers :** `README.md` (nouveau), `tests/mcp-config-doc.test.ts` (nouveau), `TASKS.md`, `.loop/PROGRESS.md`,
`.loop/BLOCKED.md`.

**Journal :** l'entrée de T5.1 manque dans ce fichier — cette itération-là s'est arrêtée avant de l'écrire. Son
travail est bien présent et vert (`src/mcp/server.ts`, `src/mcp/tools.ts`, `src/mcp/explain.ts`,
`tests/mcp-server.test.ts`, `tests/mcp-tools.test.ts`), et T5.2 vient de le relancer pour de vrai à travers un tube.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `README.md tests TASKS.md` est refusé par le hook global de
conformité ASIN (« Confirmation requise avant execution », branche `master`). Non contourné. Dix-neuvième itération
sans commit ; `.loop/BLOCKED.md` mis à jour (liste de fichiers et message du commit unique → T0.1–T5.2).

**Prochaine tâche :** T5.3 — l'agent de démo, un scénario d'accord et un scénario de refus sur données capturées.
Point d'attention mesuré aujourd'hui : le seul actif RWA enregistré, PAXG, rend `ACT` 100/100 en rejeu — il fait le
scénario d'accord, pas le refus. Les trois `CAUTION` du panel (BNB 65,4 · LEO 73,1 · GRAM 57,7, enregistrés sous
`fixtures/calibration/live-20260926T1044Z/`) ne sont pas des RWA. Un refus « RWA » demandera donc soit une nouvelle
marche d'enregistrement sur un wrapper dont la prime sort de la bande (le détail C5 de PAXG en nomme deux : VNXAU,
hors bande avant conversion d'unité, et XAU, sans volume), soit un refus assumé non-RWA sur GRAM ou BNB — à trancher
au début de l'itération, et à dire dans la démo.

## 2026-09-26 — T5.3 agent de démonstration ✅

**Situation trouvée en début d'itération :** le travail de T5.3 était **déjà écrit et vert**, mais la tâche n'était
ni cochée ni journalisée — l'itération précédente s'est arrêtée après avoir produit le code, avant l'étape 5 du
protocole. Cette itération a donc vérifié l'ensemble de bout en bout plutôt que de le réécrire, puis a coché et
journalisé. Fichiers concernés, tous déjà présents : `src/demo/{agent,answers,host,run,scenarios}.ts` (793 lignes),
`tests/demo-agent.test.ts`, `tests/demo-run.test.ts`, `fixtures/demo/` (17 réponses réelles), la décision D13 de
`docs/DECISIONS.md` et le script `demo` de `package.json`.

**Ce que la vérification a établi :**
- **`npm run lint && npm run typecheck && npm test` ✅** — 789 tests, 47 fichiers, 4,28 s. Rien à corriger.
- **La démo tourne vraiment de bout en bout** (`npm run demo`, `CMC_API_KEY` vide, sortie 0) : les deux scénarios de
  F7 se déroulent, le premier refuse, le second simule.
- **Le refus ne vient pas d'un décor.** Même ordre dans les deux scénarios — acheter 25 000 USD d'or tokenisé,
  25 000 USD des deux côtés — seul le ticker change. `XAU` est le code ISO de l'once d'or, donc le ticker qu'une
  instruction sur l'or tokenisé attrape ; E01 le résout vers **XAU9999 Meme (CMC 37470)**, un token meme à ~1e-11 USD.
  Deux lectures indépendantes arrêtent l'ordre : C5 ne relie CMC 37470 à aucun actif réel, et C4 mesure que
  25 000 USD valent **219,83 %** des 11 372,54 USD du pool le plus profond. `PAXG`, lui, rend `ACT` 100/100 sur 6 des
  7 contrôles et l'ordre pèse 0,15 % du pool.
- **L'agent passe par MCP pour de vrai** (D13) : le serveur construit est lancé en processus fils, sur un vrai tube,
  avec le client du SDK à l'autre bout — `check_rwa_token` puis `preflight_trade`, l'outil que F7 nomme.
- **Aucune transaction, vérifié et pas seulement affirmé** : `tests/no-network.test.ts` impose que `fetch` n'existe
  que dans `src/cmc/client.ts` et qu'aucun autre accès réseau (socket, client HTTP, API navigateur) n'entre dans
  `src/` ; il n'y a ni portefeuille, ni clé de signature, ni venue dans `src/demo/`. Le transcript ouvre et ferme sur
  cette phrase, et la décision acceptée la répète.
- **Zéro crédit dépensé cette itération** : rejeu seulement. Les 11 crédits qu'ont coûté les réponses à la capture
  sont cités comme un coût passé, pas comme un coût de la démo.
- **Les 17 fixtures ont la clé masquée** (`"X-CMC_PRO_API_KEY": "***"` dans les 17, vérifié fichier par fichier),
  et `scripts/check-secrets.sh` ✅.

**Écart avec F7, assumé et écrit :** F7 demande un `DO_NOT_ACT` pour le refus ; le refus enregistré est un
`CAUTION`. Ce n'est pas un échantillon mal choisi mais une propriété du moteur (D11) : `DO_NOT_ACT` est la réponse
d'une passe qui n'a **rien** mesuré, tandis qu'une passe qui a beaucoup mesuré et trouvé un problème critique est
tenue à `CAUTION` par `capWithCritical`. F7 autorise le cas le plus parlant trouvé quand rien ne produit de
`DO_NOT_ACT` à la capture. Le refus n'en est pas plus faible — la règle 1 de l'agent est d'agir sur `ACT` seulement —
et l'écart est dit à trois endroits (catalogue de scénarios, transcript, D13) plutôt que maquillé.

**Observation laissée pour l'audit (T6), déjà consignée dans D13 :** CMC 39344, l'entrée qui porte réellement l'or
sous le ticker `XAU`, enregistrée dans la même session, annonce une capitalisation de 0 et un volume 24 h de 0 et
obtient quand même `ACT` 100/100 — sur 4 contrôles sur 7, parce que E05 ne liste aucun contrat pour elle. C'est un
trou de couverture de ce moteur, pas un défaut de l'API. Ses réponses restent dans `fixtures/demo` comme preuve,
même si aucun scénario ne les rejoue.

**Fichiers modifiés par cette itération :** `TASKS.md` (T5.3 cochée), `.loop/PROGRESS.md`, `.loop/BLOCKED.md`.
Aucun fichier de code touché : le travail était déjà complet et vert.

**Commit :** ⚠️ toujours impossible : l'ajout à l'index de `src/demo tests/demo-*.test.ts fixtures/demo
docs/DECISIONS.md package.json TASKS.md` est refusé par le hook global `gitflow-asin` (« Confirmation requise avant
execution », branche `master`). Non contourné. **Vingtième itération sans commit** ; `.loop/BLOCKED.md` mis à jour
(message du commit unique → T0.1–T5.3).

**Prochaine tâche :** T6.1 — la commande `npm run audit` produisant `docs/API_AUDIT.md` et `docs/api_audit.json`.
Points d'attention : le matériau existe déjà et n'a pas à être re-payé — les 403 de E04/E15/E21 (D2), les champs
absents relevés par C7, le trou de couverture de CMC 39344 ci-dessus, et les fixtures des quatre marches
(`discovery`, `rwa-index`, `check`, `calibration`, `demo`). La règle 6 de `CLAUDE.md` s'applique en plein :
chaque constat doit pointer une fixture précise et être formulé en « observed / signal / suggestion », jamais en
accusation.

## 2026-09-26 — T6.1 commande `npm run audit` et rapport d'audit de l'API ✅

**Situation trouvée en début d'itération :** l'itération précédente avait été **interrompue en cours de route**.
`src/audit/` (8 modules, 2 823 lignes), `src/cli/audit.ts`, cinq fichiers de tests et les deux livrables
`docs/API_AUDIT.md` / `docs/api_audit.json` existaient déjà (écrits entre 20h48 et 21h00), mais `TASKS.md` et
`.loop/PROGRESS.md` s'arrêtaient à 20h25 et **l'arbre était rouge** : 2 erreurs de lint et 3 erreurs de typage.
Le travail n'avait donc jamais été vérifié. Cette itération l'a repris, réparé et validé plutôt que d'en refaire un.

**Ce qui était cassé, et pourquoi :**
1. **3 erreurs de typage** (`tests/audit-findings.test.ts`) : `EndpointRow.id` était typé `EndpointId`, c'est-à-dire
   *les endpoints que le client a le droit d'appeler* (les lignes `verified` de `docs/ENDPOINTS.md`). Or l'inventaire
   lit **toutes** les lignes documentées, y compris celles que la clé s'est vu refuser (E04, E12, E15, E21) — et
   l'audit les lit précisément pour pouvoir rapporter le refus face à ce que la page annonce (entrées A1 et A2).
   Le type mentait, et le cast `as EndpointId` de `readEndpointRows` masquait le mensonge ; le nouveau test l'a
   révélé en construisant une ligne `E04`. **Corrigé en réparant le type, pas le test** : nouveau
   `DocumentedEndpointId` (`` `E${string}` ``) dans `src/audit/inventory.ts`, documenté comme volontairement plus
   large qu'`EndpointId`, et propagé à `EndpointRow.id`, `FieldInventory.endpoint/reference` et
   `InventoryComparison.reference`. Dans `compareInventory`, `endpoint` est désormais pris sur le `set` trouvé
   (même valeur, mais garde le type étroit `EndpointId` qui est bien celui de la comparaison).
2. **2 erreurs de lint** (`src/audit/corpus.ts`) : `String(code)` sur un `unknown` (`no-base-to-string`) — remplacé
   par une garde scalaire explicite, `errorCodeType` continuant d'enregistrer le type réellement reçu, donc aucune
   information n'est perdue ; et une assertion `as Record<string, string>` inutile, `RecordedExchange.request.query`
   ayant déjà ce type — supprimée.
3. **2 tests faux** (et non deux bugs de code) :
   - `tests/cli-audit.test.ts` faisait `expect(NETWORK_DISABLED).toBe(true)` alors que `NETWORK_DISABLED` est le
     *message* du stub, pas un booléen : l'assertion ne prouvait rien. Remplacée par la vraie preuve que le réseau
     est coupé dans ce fichier (`fetch(...)` doit être rejeté avec ce message), ce qui est la forme déjà utilisée
     dans `tests/no-network.test.ts`.
   - `tests/audit-inventory.test.ts` attendait `['id','is_active','price','quote','symbol']` pour E02 en omettant
     `data` tout en gardant `quote` — incohérent, puisque `data[]` et `quote[]` sont deux jetons de même forme.
     **Vérifié avant de trancher que le parseur a raison** : sur le vrai `docs/ENDPOINTS.md`, E01 compte 11 noms
     listés (`data` inclus) et les 17 comparaisons du rapport donnent toutes `missing: []` — `data` est donc bien
     reçu, l'inclure ne produit aucun faux constat. Attente corrigée.

**Ce que la tâche produit :** `npm run audit` lit les 392 réponses déjà enregistrées (5 captures : `discovery`,
`rwa-index`, `check`, `demo`, `calibration`), **n'envoie aucune requête et ne demande aucune clé** (D14), et écrit
avec `--write` les deux livrables. Le rapport tient **24 entrées** — 9 `observed`, 14 `signal`, 1 `suggestion` —
**0 retirée faute de preuve**, **0 crédit dépensé**. Chaque entrée cite au moins un fichier de `fixtures/` qui
existe, ce qu'un test ouvre réellement fichier par fichier. La règle F9 « pas de preuve, pas de publication » est
tenue par le code (`isPublishable`), pas par une promesse, et le nombre d'énoncés retirés est imprimé plutôt que
tu. Le ton est celui de la règle 6 : les trois genres sont `observed` / `signal` / `suggestion`, et aucune entrée
n'énonce de cause.

**Reproductibilité vérifiée, pas supposée :** le rapport régénéré après mes corrections est **identique octet pour
octet** à celui de l'itération interrompue pour le markdown, et ne diffère du JSON que par les deux horodatages de
la marche (`startedAt`, `finishedAt`). Mes corrections de types et de lint n'ont donc rien changé au fond.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **868 tests, 52 fichiers** ·
`scripts/check-secrets.sh` ✅. Contrôle supplémentaire sur les deux livrables générés : ni la clé, ni même l'en-tête
`X-CMC_PRO_API_KEY` n'y apparaissent (0 occurrence dans les deux fichiers).

**Fichiers modifiés par cette itération :** `src/audit/inventory.ts`, `src/audit/fields.ts`, `src/audit/corpus.ts`,
`tests/audit-inventory.test.ts`, `tests/cli-audit.test.ts`, `docs/API_AUDIT.md` et `docs/api_audit.json`
(régénérés), `TASKS.md` (T6.1 cochée), `.loop/PROGRESS.md`, `.loop/BLOCKED.md`.

**Prochaine tâche :** T6.2 — relire les 24 entrées une par une : preuve réellement présente et probante,
formulation neutre et constructive, et retrait de tout constat que la fixture citée ne démontre pas. Point
d'attention : A9 et A18 sont des constats *négatifs* (« rien à signaler »), qui sont légitimes au titre du critère
d'acceptation 6 — « si aucune incohérence n'est trouvée, le rapport le dit honnêtement » — mais qu'il faut vérifier
comme les autres. A21 à A24 viennent de la passe moteur sur le panel des 50 et citent une fixture par agrégat : il
faut s'assurer que la preuve citée est bien celle de l'actif nommé.

## 2026-09-27 — T6.2 : relire chaque constat (preuve présente, ton neutre, retrait du non prouvé)

**État trouvé en début d'itération.** Une itération précédente avait été interrompue au milieu de T6.2 : elle
avait écrit `src/audit/review.ts` (489 lignes) et l'avait câblé dans `run.ts`, `findings.ts` et `report.ts`,
mais **sans finir** — aucun test pour le module, `TASKS.md` non cochée, aucune entrée de journal, et surtout
**la suite était cassée** : `npm test` rendait **9 échecs sur 2 fichiers**. J'ai donc repris la tâche là où elle
s'était arrêtée plutôt que de la recommencer.

**Ce que le module fait (et qui était déjà écrit).** T6.1 posait une seule barrière : un constat doit *nommer*
un fichier (`isPublishable`). Un nom de fichier est bon marché — un générateur qui compte mal, cite la mauvaise
réponse ou décrit une réponse qu'il n'a pas ouverte passe cette barrière intact. `review.ts` pose la seconde :
chaque ligne de preuve est **relue depuis les mots qu'elle imprime** (« HTTP 403 », « `data.platform.id`
présent », « E14 : 9,5 s », « BTC : ACT sur 3 des 7 contrôles »), transformée en affirmations vérifiables, et
chaque affirmation est posée en question à la réponse enregistrée citée. Un constat dont la preuve ne tient pas
est retiré et compté à part de ceux qui ne citent rien. Le ton est pesé dans la même passe (listes `ACCUSATORY`
et `CAUSAL`), avec exemption de ce qui est entre guillemets ou accents graves — citer le message de l'API n'est
pas un mot que ce projet choisit.

**Les trois vrais défauts que j'ai corrigés :**

1. **La garantie hors-ligne était devenue aveugle sur un faux positif.** `tests/no-network.test.ts` signalait
   `src/audit/review.ts` comme ouvrant une connexion : sa regex `['"](node:)?(http|…)['"]` attrapait
   `kind: 'http'`, un simple discriminant de type union. J'ai **ancré** les noms de modules aux positions qui
   importent réellement un module (`from '…'`, `import '…'`, et tout appel, ce qui couvre `require('…')`,
   `import('…')` et `createRequire(…)('…')`) — je n'ai pas relâché ce qui compte comme infraction. Et parce
   qu'un détecteur qui ne se déclenche plus passe au vert aussi silencieusement qu'un code propre, j'ai ajouté
   **deux tests du détecteur lui-même** : 12 façons d'ouvrir une connexion doivent être attrapées, 5 emplois du
   même mot comme simple donnée doivent être laissés tranquilles.

2. **Le rapport ne tenait pas une promesse qu'il fait sur lui-même.** Son préambule annonce « Both counts of
   dropped statements are at the end » — et **aucune section de ce genre n'était jamais imprimée** (ni dans la
   version T6.1, ni après le câblage de T6.2) ; les comptes n'existaient que dans `auditSummaryLine`, visible
   seulement avec `--write`. C'est exactement la faute que T6.2 traque, commise par le rapport à son propre
   sujet. J'ai ajouté la section finale **`## The second read`** : ce qu'est la relecture, un tableau des six
   comptes (constats imprimés, affirmations vérifiées, retirés faute de citation (F9), retirés parce que la
   réponse citée ne les portait pas (T6.2), constats imprimés dont la relecture ne tient pas, constats dont les
   mots brisent la règle de ton), et la liste nominative si l'un d'eux n'est pas à zéro.

3. **Les tests de `auditFindings` étaient devenus vacués.** Leur corpus synthétique était vide alors que leurs
   fixtures citaient des noms de fichiers inventés : la seconde barrière retirait donc *tout*, et les assertions
   passaient sur des listes vides ou explosaient sur `undefined`. C'était, en petit, la faute même que la
   relecture attrape. J'ai généralisé les aides (`answer`, `corpusOf`, `plainCorpus`) pour que **le corpus
   contienne réellement les réponses que les constats citent**, comme le vrai.

**Ce que j'ai ajouté en propre :**
- `tests/audit-review.test.ts` (**36 tests**) : `resolvePath`, `claimsOf` sur chaque forme de ligne de preuve,
  `reviewDraft` (mauvais code HTTP, mauvais endpoint, fichier absent du corpus, prose invérifiable, coût, durée,
  champ présent/absent/null, citation d'un message que l'API n'a pas envoyé, comptage de noms), `isProven`,
  `toneIssues` et `reviewFindings`. **Chaque cas est une affirmation vraie d'un corpus et fausse d'un autre,
  rien d'autre ne changeant** — seule façon de montrer que la barrière lit la réponse au lieu de croire la phrase.
- Un test de la seconde barrière dans `tests/audit-findings.test.ts` : le même constat E10 « HTTP 500 » est
  publié sur un corpus qui le porte, et **retiré et compté dans `unproven`** sur un corpus dont la réponse porte
  HTTP 200 — le nombre et le fichier étant inchangés, seule la lecture de la réponse distingue les deux.
- `tests/audit-doc.test.ts` (**8 tests**) : le commentaire d'en-tête de `report.ts` annonçait un
  `tests/audit-doc.test.ts` qui **n'existait pas**, et rien ne vérifiait que les fichiers livrés correspondent à
  une vraie exécution. Le test compare maintenant `docs/API_AUDIT.md` **octet pour octet** avec ce qu'une
  exécution fraîche écrit, et `docs/api_audit.json` de même aux deux horodatages près ; il vérifie aussi que le
  rapport publié n'imprime aucun constat dont la preuve ne tient pas, n'emploie aucun mot proscrit, et que la
  section promise est bien **le dernier titre du fichier**. J'ai **vérifié que ce test mord** : une ligne ajoutée
  à la main dans `docs/API_AUDIT.md` le fait échouer.

**Le résultat sur le vrai corpus, mesuré et non supposé :** 392 réponses enregistrées, 17 endpoints →
**24 constats publiés** (9 `observed`, 14 `signal`, 1 `suggestion`), **133 affirmations vérifiées une à une
contre la réponse citée**, **0 retiré faute de citation**, **0 retiré faute de preuve**, **0 problème de ton**,
**0 crédit dépensé**. Aucun constat n'a donc eu à être retiré : chacun cite une réponse qui porte bien ce qu'il
énonce.

**Relecture à la main, en plus de la passe mécanique.** J'ai relu les 24 entrées et ouvert les fixtures de cinq
d'entre elles, dont celles que le journal de T6.1 signalait comme à surveiller :
- **A21** (agrégat moteur, la préoccupation explicite du journal : « la preuve citée est-elle bien celle de
  l'actif nommé ? ») — la réponse citée est bien celle de BNB (contrat `0xb8c7…dd52`), `data[4].v24` est
  réellement absent, et « observé 2 fois dans cette réponse » est exact (2 des 10 entrées de `data[]`).
- **A1** — E04 porte bien HTTP 403 / `error_code` 1006, et le message cité est mot pour mot celui de l'API.
- **A2** — E12 porte bien HTTP 400 / `error_code` « 400 » (chaîne) / « Parameter error » : la distinction que
  l'entrée fait (« le code est 400, pas 1006 ») est exacte.
- **A18** — E01 rapporte bien `credit_count` 0 pour 0 réservé.
- Clé masquée (`***`) dans les quatre fixtures ouvertes.
Le ton des 24 est neutre : aucune cause énoncée, et **A24 porte sur le moteur de ce projet, pas sur l'API**,
formulé comme une question ouverte (D9, T4.2) plutôt que comme un reproche.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **915 tests, 54 fichiers**
(contre 868 / 52 en début d'itération : **+47 tests, +2 fichiers**) · `scripts/check-secrets.sh` ✅.
Contrôle supplémentaire : la vraie clé (32 caractères, lue depuis `.env`) apparaît **0 fois** dans chacun des
fichiers touchés, et l'en-tête `X-CMC_PRO_API_KEY` **0 fois** dans les deux livrables régénérés.

**Fichiers modifiés par cette itération :** `src/audit/report.ts` (section `## The second read` + commentaire
d'en-tête corrigé), `tests/no-network.test.ts`, `tests/audit-findings.test.ts`, `tests/audit-review.test.ts`
(nouveau), `tests/audit-doc.test.ts` (nouveau), `docs/API_AUDIT.md` et `docs/api_audit.json` (régénérés par
`npm run audit -- --write`, hors réseau, 0 crédit), `TASKS.md` (T6.2 cochée), `.loop/PROGRESS.md`,
`.loop/BLOCKED.md`.

**Prochaine tâche :** T7.1 — interface Next.js (recherche, verdict, contrôles, preuves, page audit), la clé
restant strictement côté serveur. Point d'attention : c'est la première tâche qui ajoute une dépendance lourde
et un second `package.json` possible sous `web/` ; il faudra décider si l'application vit dans le dépôt
principal ou dans un sous-dossier avec sa propre chaîne de build, et le consigner dans `docs/DECISIONS.md`.
La phase 6 est terminée : l'audit est écrit, relu, et les deux relectures sont tenues par du code testé.

## 2026-09-27 — T7.1 interface web Next.js (recherche, verdict, contrôles, preuves, page audit) ✅

**L'itération précédente avait été interrompue au milieu de cette tâche.** Le `web/` trouvé dans l'arbre de
travail (15 fichiers, horodatés 14h34–14h53) et les cinq modules de `src/web/` n'étaient dans aucune entrée de ce
journal : la session s'est arrêtée avant l'étape 6. J'ai donc commencé par mesurer l'état réel plutôt que par
écrire du code — `lint`, `typecheck` et `npm test` passaient déjà (982 tests, 59 fichiers, contre 915 / 54 à la
fin de T6.2), de même que `web:lint` et `web:typecheck`. Le travail restant n'était pas de construire
l'interface, mais de finir ce qui n'avait pas pu l'être et de **vérifier qu'elle tourne vraiment**, ce qu'aucun
test ne faisait : les tests existants lisent le code source de l'application, jamais une page rendue.

**Vérifié en la faisant tourner pour de vrai.** `npm run web:build`, puis `next start` sans `CMC_API_KEY` dans
l'environnement — le déploiement bascule donc en rejeu, ce qui est précisément le cas d'un clone sans clé. Les
six routes répondent **HTTP 200** : la page de recherche, la page d'audit (les 24 constats publiés, chacun avec
les réponses enregistrées qu'il cite), `PAXG` (**ACT, 100/100, 6 contrôles sur 7 évalués**, lu depuis
`fixtures/check`), l'ID CoinMarketCap `4705` (même actif, même verdict, sans l'appel de résolution), un symbole
qui ne résout vers rien (**DO_NOT_ACT**, pas de score, 0 sur 7, chaque contrôle portant la raison pour laquelle
il n'a pas tourné) et la page actif sans requête. **La clé réelle de 32 caractères lue dans `.env` apparaît
0 fois dans le HTML des six pages**, et l'en-tête `X-CMC_PRO_API_KEY` 0 fois également. La plus lente des six a
mis 151 ms. **0 crédit dépensé.**

**Trois choses corrigées, toutes trouvées en vérifiant.**

1. **`D15` était cité par trois fichiers sans exister.** `src/web/index.ts`, `tests/web-app.test.ts` et
   `eslint.config.js` renvoyaient tous à « D15 » dans `docs/DECISIONS.md`, dont le journal s'arrêtait à D14 —
   exactement la décision que l'entrée T6.2 de ce journal annonçait qu'il faudrait consigner. La décision est
   maintenant écrite : pourquoi l'application est un paquet séparé (les deux projets TypeScript sont
   incompatibles — `nodenext` sans JSX d'un côté, `jsx: react-jsx` et résolution bundler de l'autre ; les tenir
   ensemble reviendrait à relâcher les réglages sous lesquels tout le reste est vérifié), pourquoi la moitié
   navigateur ne contient que du balisage (`npm test` ne charge jamais `web/`), les deux verrous qui gardent la
   clé côté serveur, le rejeu comme comportement par défaut sans clé, et les deux choses qu'une requête ne fait
   jamais (construire l'index de wrappers, 8,3 s ; écrire dans `.cache/cmc`, que Vercel ne peut pas écrire).
2. **La page d'audit était pré-rendue au build.** `next.config.ts` trace `docs/api_audit.json` dans le
   déploiement pour qu'il soit lu à la requête, et `SECOND_OPINION_AUDIT_FILE` choisit quel rapport lire — mais
   une page statique gèle l'environnement du build et laisse ce traçage sans lecteur. Elle est maintenant
   `force-dynamic` comme la page actif. Le build confirme le changement : `/audit` est passé de `○ (Static)` à
   `ƒ (Dynamic)`.
3. **`web/tsconfig.tsbuildinfo` n'était pas ignoré** (126 Ko, régénéré à chaque `typecheck`). Ligne
   `*.tsbuildinfo` ajoutée à `.gitignore`. Après quoi `web/` fait entrer exactement les 15 fichiers voulus dans
   git, sans `.next/`, sans `node_modules/`, sans artefact.

**Un test nouveau, qui mord.** `tests/decision-refs.test.ts` lit le code *et* le document, et refuse toute
citation `Dn` qui ne corresponde à aucun titre de `docs/DECISIONS.md` — c'est le trou par lequel D15 est passé :
tous les autres tests du document lisent le document et jamais le code. J'ai **vérifié qu'il mord** en renommant
le titre `## D15` : il échoue en nommant les cinq fichiers fautifs un par un, plutôt qu'en comptant. Il vérifie
aussi que les décisions sont numérotées sans trou. Un second test ajouté à `tests/web-app.test.ts` tient la
correction 2 : les deux pages déclarent le runtime Node et `force-dynamic`.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **986 tests, 60 fichiers**
(contre 982 / 59 au début de l'itération) · `npm run web:lint` ✅ · `npm run web:typecheck` ✅ ·
`npm run web:build` ✅ · `scripts/check-secrets.sh` ✅. La clé réelle apparaît 0 fois dans chacun des fichiers
touchés.

**Fichiers modifiés par cette itération :** `docs/DECISIONS.md` (décision D15 + les deux lignes T7.1 et T7.2 de
« Handed to later tasks »), `web/app/audit/page.tsx` (`force-dynamic` + le commentaire qui dit pourquoi),
`tests/decision-refs.test.ts` (nouveau), `tests/web-app.test.ts`, `.gitignore`, `TASKS.md` (T7.1 cochée),
`.loop/PROGRESS.md`, `.loop/BLOCKED.md`. Les 15 fichiers de `web/` et les 5 modules de `src/web/` viennent de
l'itération interrompue et restent non committés comme tout le reste.

**Commit toujours refusé** par le hook global `gitflow-asin` (vingt-deuxième itération) : `git add` est refusé
sur la branche `master`. La commande de secours de `.loop/BLOCKED.md` a été corrigée — elle oubliait `web/`, le
nouveau dossier de premier niveau, et aurait laissé toute l'interface hors du commit.

**Prochaine tâche :** T7.2 — configuration Vercel prête (`vercel.json` si besoin, instructions dans le README).
Point d'attention : l'application lit trois choses **au-dessus** de son propre dossier (`config/checks.json`,
`fixtures/` et `docs/api_audit.json`), donc la racine du build et le `outputFileTracingRoot` comptent autant que
les variables d'environnement. Les quatre réglages à documenter sont nommés dans la ligne T7.2 de
« Handed to later tasks » : `SECOND_OPINION_MODE`, `SECOND_OPINION_AUDIT_FILE`, `SECOND_OPINION_RWA_INDEX` et
`CMC_CACHE_DIR`.

## 2026-09-28 — T7.2 configuration Vercel prête (`vercel.json` + instructions dans le README) ✅

**Tâche :** T7.2 — « Configuration Vercel prête (`vercel.json` si besoin, instructions dans le README). »

**Le point de départ.** L'application de F8 vit dans `web/` mais lit trois choses **au-dessus** de son dossier
(`config/checks.json`, `fixtures/` et `docs/api_audit.json`), et `web/next.config.ts` pose déjà
`outputFileTracingRoot` sur la racine du dépôt. La question de l'itération n'était donc pas « quel fichier écrire »
mais « quelle forme de projet Vercel rend ce dépôt déployable », et elle ne se tranche pas au hasard : la règle 1 de
`CLAUDE.md` interdit de supposer.

**Ce que la documentation officielle a tranché** (lue, pas devinée ; le CLI `vercel` n'est pas installable ici et
déployer est une tâche `[H]`) :
1. `vercel.json` se lit depuis le **Root Directory** du projet, pas depuis la racine du dépôt — la page monorepo de
   Vercel écrit ses exemples `apps/web/vercel.json`. Le fichier va donc dans `web/`, et une copie à la racine ne
   serait jamais lue.
2. Il n'existe **aucune propriété** `vercel.json` pour le Root Directory : la liste complète des propriétés
   (`$schema`, `buildCommand`, `installCommand`, `outputDirectory`, `framework`, `devCommand`, `ignoreCommand`,
   `functions`, `regions`, …) ne le contient pas. C'est un réglage de tableau de bord, donc de la prose.
3. Lire au-dessus du Root Directory demande l'option **« Include source files outside of the Root Directory in the
   Build Step »**, activée par défaut sur les projets créés après le 27 août 2020. La page « Configuring a Build »
   dit l'inverse en une ligne (« you cannot use `..` »), qui décrit le comportement option éteinte : le README
   demande donc de **vérifier** la case plutôt que de la supposer.
4. `engines.node` valant `>=20.19`, Vercel résout vers son défaut actuel, Node 24.x (sa table de correspondance
   donne « latest 24.x » pour `>=20.0.0`) : rien à épingler. Et la durée maximale par défaut, 300 s, est très
   au-dessus du budget de 10 s d'une évaluation (D1) : pas de `maxDuration` à poser.

**Ce qui a été écrit.**
- `web/vercel.json` (nouveau, 4 réglages) : `framework: nextjs`, plus les deux commandes surchargées
  `installCommand: npm install --prefix .. && npm install` et `buildCommand: npm run build --prefix .. && npm run build`.
  Sans elles, Vercel lancerait `next build` dans `web/` contre un `dist/` inexistant — l'application dépend de ce
  paquet en `file:..`, dont les `exports` pointent `dist/` (D15). Ce sont **les deux étapes de `npm run web:build`
  vues depuis `web/`** : le déploiement n'est pas un second chemin de build non testé.
- Section `## The web interface` du README : comment le lancer localement, le tableau des deux réglages de tableau de
  bord que le fichier ne peut pas porter, le bloc `json` exact, et le tableau des **sept** variables
  d'environnement avec ce qui se passe quand chacune n'est pas posée (les quatre annoncées par la ligne T7.2 de
  « Handed to later tasks », plus `CMC_API_KEY`, `SECOND_OPINION_FIXTURES` et `SECOND_OPINION_ROOT`). Plus l'avertissement
  crédits : un verdict lit plusieurs endpoints, donc une URL publique en `live` dépense la clé à chaque visite.
- Décision **D16** dans `docs/DECISIONS.md`, qui dit pourquoi chacun de ces choix, et sépare explicitement ce qui a
  été vérifié de ce que seul un déploiement confirmerait. La ligne T7.2 de « Handed to later tasks » passe à
  *landed*.

**Vérifié pour de vrai, pas supposé.** Les deux commandes ont été lancées **depuis `web/`**, le répertoire de travail
que Vercel utilise avec ce Root Directory : l'installation résout les deux paquets, `npm run build --prefix ..` écrit
`dist/`, et `next build` produit ensuite `web/.next` avec `/asset` et `/audit` en dynamique et `/` en statique — le
routage que D15 demande. Ce qui reste hors de portée est nommé comme tel dans D16 et dans `.loop/BLOCKED.md` : le
comportement de la plateforme elle-même.

**Un test nouveau, qui mord.** `tests/vercel-config.test.ts` (12 cas) tient le fichier aux scripts auxquels il
délègue (renommer `build` ou `web:build` le fait échouer), compare le bloc `json` du README **au fichier** clé par
clé, refuse tout mot ressemblant à un identifiant dans `web/vercel.json`, et surtout : il lit la liste des variables
d'environnement **dans `src/web/`** et exige que chacune figure dans la section du README. J'ai vérifié qu'il mord
dans les deux sens — en retirant la ligne `SECOND_OPINION_RWA_INDEX` du README (échec, la variable est nommée) et en
simulant une variable ajoutée au code sans ligne de doc (échec, elle est nommée aussi). C'est le seul mécanisme qui
empêche un réglage d'exister sans que personne le sache.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **997 tests, 61 fichiers** (contre
986 / 60 au début de l'itération) · `npm run web:lint` ✅ · `npm run web:typecheck` ✅ ·
`scripts/check-secrets.sh` ✅. La clé réelle de `.env` apparaît **0 fois** dans chacun des fichiers touchés.

**Fichiers modifiés :** `web/vercel.json` (nouveau), `tests/vercel-config.test.ts` (nouveau), `README.md` (section
`## The web interface`), `docs/DECISIONS.md` (D16 + ligne T7.2), `TASKS.md` (T7.2 cochée), `.loop/PROGRESS.md`,
`.loop/BLOCKED.md`.

**Commit toujours refusé** par le hook global `gitflow-asin` (vingt-troisième itération) : l'ajout à l'index est
refusé sur la branche `master`. Le message de la commande de secours de `.loop/BLOCKED.md` devient T0.1–T7.2 ; la
liste de fichiers, elle, n'a pas bougé (`web/vercel.json` est couvert par `web`, le test par `tests`).

**Prochaine tâche :** T8.1 — README anglais complet (problème, solution, démarrage < 5 min, config MCP,
architecture, endpoints utilisés). Point d'attention : le README existant couvre déjà le démarrage, la config MCP,
les sept contrôles, la calibration et maintenant le déploiement, mais il ne dit **ni le problème ni l'architecture**,
et ne nomme aucun endpoint — c'est ce qui manque, plus un lien vers `docs/ENDPOINTS.md` pour les endpoints vérifiés.
Attention aussi à `tests/mcp-config-doc.test.ts`, qui parse **tous** les blocs ```json du README (chacun doit rester
du JSON valide), et à `tests/vercel-config.test.ts`, qui exige que la section `## The web interface` garde son titre
exact et son bloc de réglages.

## 2026-09-28 — T8.1 README anglais (problème, solution, démarrage, MCP, architecture, endpoints) ✅

**Ce que la tâche demandait, et ce qui manquait vraiment.** Le README existait depuis T5.2 et couvrait déjà quatre
des six points : le démarrage en quatre lignes, la configuration MCP pour les deux hôtes, les sept contrôles, la
calibration, puis le déploiement depuis T7.2. Trois points manquaient, et ce sont exactement ceux que le règlement
regarde : **le problème** n'était énoncé nulle part (le texte d'ouverture décrivait la solution sans jamais dire à
quoi elle répond), **l'architecture** n'apparaissait pas, et **aucun endpoint CMC n'était nommé** — or « nommer
explicitement les endpoints utilisés » est une exigence de la soumission (section 7 du cahier des charges).

**Trois sections ajoutées, aucune réécriture.** `## The problem` ouvre le document juste après le titre et tient sur
un cas réel plutôt que sur une généralité : l'ordre `Buy 25,000 USD of tokenised gold. The ticker is XAU.` est celui
que l'agent de démonstration reçoit vraiment, et les deux constats qui l'arrêtent (XAU résout vers XAU9999 Meme,
CMC 37470, à ~1e-11 USD ; 25 000 USD dépassent deux fois la profondeur du pool le plus profond) sont repris **mot
pour mot de `src/demo/scenarios.ts`**, donc de la capture du 2026-09-26. Rien d'inventé : le README ne dit pas une
chose que le dépôt ne montre pas. `## Architecture` décrit les onze dossiers de `src/` en une ligne chacun, et dit
où vivent les seuils (`config/checks.json`) et les réponses enregistrées (`fixtures/`). `## The CMC endpoints it
reads` est le tableau des dix-sept endpoints que le client peut appeler : identifiant, chemin, contrôles alimentés,
et ce pour quoi il est lu — plus les quatre refusés par le plan (E04, E12, E15, E21), nommés comme tels.

**Le point délicat : ne pas surpromettre sur les endpoints.** Six des dix-sept (E07, E08, E09, E13, E16, E17) ne
sont **pas** sur le chemin d'un verdict — ils sont normalisés, enregistrés, et lus par `npm run audit` ou par la
sélection de l'actif de démonstration. Je l'ai vérifié en lisant les appels réels (`src/checks/assess.ts`,
`src/rwa/wrapper-index.ts`, `src/calibration/panel.ts`, `src/cmc/client.ts`) plutôt qu'en recopiant D1, et le
tableau le dit ligne par ligne au lieu de laisser croire que les dix-sept servent le verdict. Cas particulier
d'E13 : D1 annonçait qu'il serait ajouté au plan de `check_rwa_token`, mais le code résout finalement un wrapper par
l'index D6 (E18/E19), parce qu'E13 ne résout qu'un symbole RWA — la ligne du README décrit ce qui est, pas ce qui
était prévu.

**Un test nouveau, qui mord.** `tests/readme.test.ts` (11 cas) épingle chaque section à ce qu'elle décrit, parce
qu'un README ne se compile pas : la liste d'endpoints est comparée à `ENDPOINTS` de `src/cmc/endpoints.ts` (ajouter
un endpoint au client sans ligne au README échoue), les chemins aux chemins réellement envoyés, la colonne
« contrôles » à ce que `explainCheck` répond pour C1–C7, les dossiers cités à ceux qui existent dans `src/`, l'ordre
de la section « problème » à `SCENARIOS`, les endpoints refusés à ceux que `docs/ENDPOINTS.md` marque `refused`, et
chaque lien relatif au fichier qu'il vise. Vérifié qu'il mord dans les deux sens : retirer `C7` de la ligne E06
échoue en nommant E06, supprimer la ligne `src/rwa/` échoue en nommant le dossier manquant.

**Contraintes respectées sans les casser.** Deux tests lisent déjà ce fichier et imposent des formes précises :
`tests/mcp-config-doc.test.ts` extrait les outils MCP par le motif `| \`nom_outil\` |` et les contrôles par
`| C\d | titre |`, donc le nouveau tableau commence ses lignes par `| E01 |` pour ne rien capturer par accident, et
ne contient aucune ligne débutant par `| C1 |` ; il vérifie aussi que tout `npm run <script>` cité existe dans
`package.json` (les nouveaux — `demo`, `calibrate`, `audit`, `rwa:index` — sont tous définis).
`tests/vercel-config.test.ts` exige que `## The web interface` garde son titre exact : les sections nouvelles sont
insérées avant `## Requirements` et avant `## Calibration`, sans y toucher.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **1008 tests, 62 fichiers** (contre
997 / 61 au début de l'itération) · `scripts/check-secrets.sh` ✅. La clé réelle de `.env` apparaît **0 fois** dans
`README.md` et dans `tests/readme.test.ts`.

**Fichiers modifiés :** `README.md` (3 sections ajoutées, 232 → 318 lignes), `tests/readme.test.ts` (nouveau),
`TASKS.md` (T8.1 cochée), `.loop/PROGRESS.md`, `.loop/BLOCKED.md`.

**Commit toujours refusé** par le hook global `gitflow-asin` (vingt-quatrième itération) : l'ajout à l'index de
`README.md tests/readme.test.ts TASKS.md` est refusé sur la branche `master`. Le message de la commande de secours
de `.loop/BLOCKED.md` devient T0.1–T8.1 ; la liste de fichiers n'a pas bougé (le test est couvert par `tests`, le
README est déjà nommé).

**Prochaine tâche :** T8.2 — `docs/EVIDENCE.md` : extraits de code accompagnés des réponses réelles correspondantes.
Point d'attention : la matière existe déjà en quantité (392 réponses enregistrées dans `fixtures/`, citées une par
une par `docs/API_AUDIT.md`), donc le travail est de **choisir** — le règlement demande la preuve d'un vrai appel,
pas un catalogue. Prévoir un test du même genre que celui de cette itération : chaque extrait de code cité doit
exister tel quel dans `src/`, et chaque réponse citée doit exister dans `fixtures/` avec la clé masquée.

## 2026-09-29 — T8.2 `docs/EVIDENCE.md` (extraits de code + réponses réelles correspondantes) ✅

**Le point de départ n'était pas une page blanche.** L'itération précédente avait été interrompue après avoir
écrit `docs/EVIDENCE.md` (17 Ko, sept sections) mais **avant** d'écrire le test que le document lui-même promet
deux fois — « `tests/evidence-doc.test.ts` reads both back from the files they name » et la commande
`npx vitest run tests/evidence-doc.test.ts` de la section « Checking it yourself ». Le document annonçait donc une
garantie qui n'existait pas, et T8.2 était restée `[ ]`. Cette itération a d'abord **tout revérifié à la main**,
puis corrigé ce qui ne tenait pas, puis écrit le test.

**Ce que la revérification a confirmé.** Les neuf extraits de code (`src/cmc/client.ts:203-210`,
`src/cmc/fixtures.ts:52-55` et `64-69`, `src/cmc/endpoints.ts:24-28`, `src/checks/assess.ts:102-108`,
`src/checks/c4-liquidity.ts:261-262` et `286-299`, `src/checks/c5-rwa.ts:4-8`, `src/cmc/status.ts:24-28`)
correspondent caractère pour caractère à leurs plages. Les neuf blocs JSON sont bien des sous-ensembles exacts des
fixtures citées. L'arithmétique de la section 2 tombe juste : entre les deux instantanés `/v1/key/info`
(16:03:35 et 16:08:10 UTC), **24 réponses** enregistrées, somme des `credit_count` = **15**, et le compteur du
compte passe de 0 à 15. Les quatre refus (E04, E12, E15, E21) ont bien les codes annoncés, et les 17 clés de
`ENDPOINTS` sont exactement les lignes `verified` de `docs/ENDPOINTS.md`. Le corpus fait bien 392 réponses pour
288 crédits. La phrase de C4 (`An order of 25000 USD is 219.83 % of the 11372.541 USD held by E11 pool liquidity
of XAU/WETH on Uniswap v2; limit: 25 %.`) est celle que `npm run demo` imprime réellement.

**Trois choses ne tenaient pas, et sont corrigées.**
1. **Un compte faux.** La section 4 disait « Four recorded answers take it from that instruction to a refusal ».
   Le verdict sur XAU repose en réalité sur **six** réponses (E01, E02, E05, E06, E10, E11) et le document en
   déroule **trois**. Réécrit pour dire exactement cela.
2. **Un tableau tronqué sans le dire.** Le bloc E14 de la section 5 montre 3 wrappers sur les **7** que la réponse
   contient. Un lecteur pouvait croire que l'or n'a que trois wrappers. La légende porte maintenant
   `(tokens: 3 of 7)`, une convention expliquée en tête de document — et c'est le test qui vérifie le compte.
3. **Un total ambigu.** « 392 recorded answers […] are in this repository » laissait entendre que 392 est tout ce
   qu'il y a sur le disque. Il y en a **732** : les deux marches de calibration interrompues (217 fichiers en
   vrac + 123 dans `live-2026-09-26/`) traînent toujours, faute d'avoir pu les supprimer. Reformulé en « Five
   captures, 392 recorded answers, are what this project reads », avec un paragraphe qui nomme les deux marches
   partielles et renvoie à D14 — la décision que `src/audit/run.ts` applique déjà pour les exclure du corpus.

**Le test : 52 cas, et il mord.** `tests/evidence-doc.test.ts` **parse** le document plutôt que de recopier ses
valeurs. Les extraits de code sont relus depuis la plage de lignes nommée. Les blocs JSON passent par une
comparaison de **sous-ensemble** : un champ omis est permis (le paragraphe ne parle que de quelques-uns), un champ
dont la valeur diffère ou que le fichier ne porte pas ne l'est pas — et un tableau raccourci doit être déclaré
dans la légende, sinon échec. La phrase de C4 n'est comparée à aucune copie d'elle-même : la réponse enregistrée
est normalisée, le vrai `runLiquidityCheck` tourne dessus avec les vrais seuils de `config/checks.json` et
l'`ORDER_SIZE_USD` des scénarios, et c'est **son** message qui doit correspondre. Les nombres de la prose (24, 15,
392, 288, les comptes par capture) sont extraits par regex et recalculés depuis les fixtures.

**Vérifié que le test échoue quand il doit.** Huit mutations du document, chacune rattrapée : un caractère changé
dans un extrait de code ; un prix modifié dans un bloc JSON ; un wrapper retiré du bloc E14 en gardant la
déclaration ; `219.83 %` → `219.84 %` ; `17` → `18` dans le tableau du corpus ; `15` → `16` crédits ; la
déclaration `(tokens: 3 of 7)` retirée en gardant le tableau court ; un lien pointé sur un fichier inexistant. Et
le cas qui compte vraiment pour la pourriture documentaire : **une ligne insérée dans `src/cmc/status.ts`
au-dessus d'une plage citée** fait échouer le cas correspondant. Document restauré à chaque fois, 52/52 au final.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **1060 tests, 63 fichiers** (contre
1008 / 62 au début de l'itération) · `scripts/check-secrets.sh` ✅. La clé réelle de 32 caractères apparaît
**0 fois** dans `docs/EVIDENCE.md` et dans `tests/evidence-doc.test.ts`, et un cas du test le contrôle lui-même
en relisant `.env` quand il existe.

**Fichiers modifiés :** `docs/EVIDENCE.md` (3 corrections + la convention de troncature, 424 → 435 lignes),
`tests/evidence-doc.test.ts` (nouveau, 526 lignes, 52 cas), `TASKS.md` (T8.2 cochée), `.loop/PROGRESS.md`,
`.loop/BLOCKED.md`.

**Commit toujours refusé** par le hook global `gitflow-asin` (vingt-cinquième itération) : l'ajout à l'index de
`docs/EVIDENCE.md tests/evidence-doc.test.ts TASKS.md` est refusé sur la branche `master`. Le message de la
commande de secours de `.loop/BLOCKED.md` devient T0.1–T8.2 ; la liste de fichiers n'a pas bougé (le test est
couvert par `tests`, le document par `docs`).

**Prochaine tâche :** T8.3 — `docs/API_FEEDBACK.md` : ce que l'API a permis, ce qui a gêné, suggestions.
Point d'attention : la matière est déjà là et **prouvée** — les 24 constats de `docs/API_AUDIT.md` et leurs
133 affirmations, plus les quatre refus de plan. Le risque n'est donc pas le manque de matière mais **le ton** :
la règle 6 de `CLAUDE.md` est non négociable et le cahier des charges la répète (« data quality signals », jamais
« CMC is wrong »). Prévoir, comme pour l'audit en T6.2, un test qui relit chaque affirmation du document jusqu'à
la fixture qui la porte, et qui refuse une suggestion qui ne s'appuie sur aucun constat enregistré.

## 2026-09-29 — T8.3 · `docs/API_FEEDBACK.md`

**Tâche :** T8.3 — la note que le règlement demande sur ce que l'API a permis et ce qui a gêné, nourrie par
l'audit (F9). Dernière pièce de la section 7 du cahier des charges que la boucle pouvait produire seule.

**Ce qui a été fait.** Le document est écrit en trois temps : cinq sections **G** (ce que l'API a rendu
possible), onze sections **W** (ce qui a coûté du travail) et dix suggestions **S**, plus une section finale sur
ce que la note ne prétend pas mesurer. Rien n'y est une impression : chaque section se termine par les réponses
enregistrées dont elle sort.

**Le point difficile était la vérifiabilité, pas la rédaction.** `docs/API_FEEDBACK.md` est le seul livrable de
`docs/` qui soit de la prose pure — rien ne le génère, et les deux choses sur lesquelles il s'engage (ses
chiffres viennent de réponses enregistrées, son ton reste constructif) sont exactement celles qu'un lecteur ne
peut pas vérifier sans rouvrir chaque fichier. Quatre conventions rendent cela mécanique :

- `**Measured:**` — une mesure **recopiée mot pour mot** depuis `docs/API_AUDIT.md`. Un `npm run audit` sur un
  corpus plus large change un nombre, la ligne cesse de correspondre, le test tombe. Douze lignes de ce type.
- `**From:**` — la provenance : `A<n>` (entrée de l'audit), `D<n>` (décision), ou un chemin du dépôt.
- `**Answers:**` — sur une suggestion, l'observation à laquelle elle répond.
- `**No suggestion:**` — sur une observation qui n'en porte pas, pourquoi. Le silence se lirait pareil qu'un cas
  pesé ou oublié : W7 (la traîne des latences) est la seule dans ce cas et le dit.

**Le test : 19 cas, et il mord.** `tests/api-feedback-doc.test.ts` ne compare rien à une copie de lui-même. Les
lignes `**Measured:**` sont cherchées telles quelles dans `docs/API_AUDIT.md` ; les `A<n>` cités doivent être des
entrées réellement imprimées (comptées contre `run.findings.length`) et les `D<n>` des décisions existantes ;
tous les chemins cités doivent exister. Les chiffres de la prose sont **recalculés** : 392 réponses, 17
endpoints, 21 inventoriés, 288 crédits et les 5 captures depuis `docs/api_audit.json` ; les deux formes de
`status` en relisant le type JSON de `error_code` dans une réponse par endpoint ; les champs intermittents
(5/18/12/25/2) et toujours nuls (3/3/8) depuis le run, total compris ; les 500 des endpoints DEX, les 14 actifs
touchés, les 7 `unreadable_field` et les 19 verdicts à couverture mince depuis la passe moteur. Le reste est lu
dans les réponses elles-mêmes : la marche du catalogue (25 émetteurs, 2 393 tokens, 1 437 liés, 30 crédits)
recomptée sur `fixtures/rwa-index`, les trois espaces d'identifiants relus dans les quatre réponses nommées, les
100 paires et les 3 paires PAXG de E08, les prix des wrappers GOLD et leur moyenne. Chaque message de l'API cité
entre guillemets est relu depuis la réponse qui le porte. Enfin le ton passe par `toneIssues` de
`src/audit/review.ts` — la même porte que l'audit s'applique à lui-même (règle 6 de `CLAUDE.md`).

**Vérifié que le test échoue quand il doit.** Douze mutations du document, chacune rattrapée : une mesure
changée, `288` → `289` crédits, `25` → `26` émetteurs, un `A7` remplacé par un `A99` inexistant, le mot
« misleading » inséré hors citation, une ligne `**Answers:**` retirée, `4255.05` → `4255.06`, un message de
l'API reformulé, `src/cmc/credits.ts` mal orthographié, `13` → `12` endpoints à enveloppe `string`, `19` → `20`
verdicts minces, et le total `62` désaligné de ses cinq composantes. Document restauré à chaque fois.

**Vérifications :** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **1079 tests, 64 fichiers** (contre
1060 et 63 avant) · `scripts/check-secrets.sh` ✅ · scan ciblé des deux nouveaux fichiers ✅.

**Fichiers :** `docs/API_FEEDBACK.md` (nouveau), `tests/api-feedback-doc.test.ts` (nouveau), `TASKS.md` (T8.3
cochée), `.loop/BLOCKED.md` (vingt-sixième itération sans commit).

**Commit : toujours refusé.** L'ajout à l'index des trois fichiers est refusé par le hook global
`gitflow-asin` (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution »,
branche `master`) ; non contourné. Détail et commande de rattrapage dans `.loop/BLOCKED.md`.

**Prochaine tâche prévue :** T8.4 — `docs/SUBMISSION.md`, le texte prêt à coller dans DoraHacks (track,
description, endpoints nommés, liens à compléter par l'humain).

---

## 2026-09-29 — T8.4 · `docs/SUBMISSION.md`

**Tâche :** T8.4 — le texte prêt à coller dans la page BUIDL de DoraHacks : track, description, endpoints nommés,
emplacements pour les liens que seul l'humain peut produire.

**Ce que j'ai trouvé en ouvrant l'itération.** `docs/SUBMISSION.md` existait déjà, complet (216 lignes), écrit par
une itération interrompue avant d'écrire son test — et la tâche était restée `[ ]`. Sa section « What keeps this
text true » promettait nommément `tests/submission-doc.test.ts`, qui n'existait pas. Le travail de cette itération
a donc été de **vérifier chaque affirmation du document contre le dépôt**, puis d'écrire ce test.

**Deux affirmations étaient fausses et sont corrigées.**

- « `fixtures/` holds 392 recorded answers over those 17 endpoints » : `fixtures/` contient **732** fichiers.
  392 est le corpus que l'audit lit (5 sessions : 32 + 32 + 11 + 17 + 300) ; les 340 autres sont les deux
  tentatives de calibration interrompues, que rien ne lit (voir le ménage à faire dans `.loop/BLOCKED.md`). Et
  ces 392 réponses couvrent **21** chemins, pas 17 : 385 sur les 17 endpoints accessibles et **7 refus** des
  quatre que le plan n'ouvre pas. La phrase dit maintenant exactement cela.
- « The same order on PAXG [...] raises no observation » : la passe rejouée montre **trois constats `info`** sur
  C5 (unité inférée pour CGO et VNXAU, deux wrappers écartés du spread faute de volume). Aucun ne pèse sur le
  score — 100/100 — mais « aucun constat » était faux. La phrase devient « none of them raising a warning ».

**Tout le reste est vérifié exact**, et rien n'a été pris pour argent comptant : les 21 endpoints inventoriés /
17 vérifiés / 4 refusés et leurs chemins (`docs/ENDPOINTS.md`), les sept titres de contrôles (mot pour mot ceux de
`CHECK_TITLES`), les seuils 75 / 40 (`config/checks.json`), 47 `ACT` sur 50 à 94 % contre la cible de 90 %
(`docs/calibration.json`, les trois autres portent bien un constat critique), les quatre entrées sous le symbole
XAU et le prix 9,61e-12 USD de CMC 37470 (réponses de `fixtures/demo`), les 24 entrées d'audit en 9 / 14 / 1 et
les 133 énoncés relus (`docs/api_audit.json`), les 288 crédits déclarés et les 0 dépensés, les dix suggestions de
`docs/API_FEEDBACK.md`, et le coût d'un verdict à froid — **3 crédits** pour une pièce sans contrat, **5** pour un
token qui en a un, **6** pour un wrapper lié à un actif réel — recalculé en additionnant les `status.credit_count`
des deux runs `check` enregistrés le 2026-09-25.

**Le test (38 cas) ne compare rien à une copie de lui-même.** La table des endpoints est relue depuis `ENDPOINTS`
(les seuls chemins que le client peut envoyer), celle des contrôles depuis `CHECK_TITLES`, les endpoints refusés
depuis l'inventaire qui a enregistré leur refus. Chaque chiffre est **recalculé** depuis `docs/api_audit.json`,
`docs/calibration.json` ou les réponses enregistrées elles-mêmes ; le paragraphe de démonstration est obtenu en
**rejouant les deux ordres** à travers `preflight_trade` hors ligne (part de l'ordre dans le pool le plus profond
> 200 % côté refus, 6 contrôles sur 7 et aucun `warning` côté accord) ; les nombres écrits en mots sont comparés à
une table d'orthographes, donc « Seventeen » sur seize endpoints tombe. Chaque commande est cherchée dans
`package.json`, chaque chemin sur le disque, `--replay=fixtures/check` est aussi celui du README, et
`dist/mcp/server.js` est comparé au script `mcp`. Les quatre emplacements `{{...}}` doivent être déclarés une fois
et utilisés une fois — un cinquième tombe — et aucun lien `http` ne doit traîner dans le texte à coller. Le ton
passe par `toneIssues` de `src/audit/review.ts`, la même porte que l'audit.

**Vérifié qu'il mord : 23 mutations du document, 23 attrapées** (un chiffre du corpus, une ligne d'endpoint
retirée, un mot-nombre, un seuil, la part `ACT`, un cinquième emplacement, un mot accusatoire, les trois coûts en
crédits, la liste des endpoints gratuits, un titre de contrôle, le point d'entrée MCP, le dossier de rejeu, une
commande inexistante, un chemin inexistant, l'ordre de grandeur du prix, le nombre d'entrées d'audit, d'énoncés
relus, de suggestions, de réponses de la page de preuves, de formes du bloc `status`).

**Fichiers :** `docs/SUBMISSION.md` (deux phrases corrigées, section « What keeps this text true » précisée),
`tests/submission-doc.test.ts` (**nouveau**), `TASKS.md` (T8.4 cochée), `.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Vérifications :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ **1117 tests, 65 fichiers**,
`scripts/check-secrets.sh` ✅ (plus un scan ciblé des deux fichiers : ni la clé, ni le motif d'en-tête).

**Commit : toujours refusé.** L'ajout à l'index de `docs/SUBMISSION.md tests/submission-doc.test.ts TASKS.md` est
refusé par le hook global `gitflow-asin` (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`) ; non contourné. Détail et commande de rattrapage dans `.loop/BLOCKED.md`.

**Prochaine tâche prévue :** T8.5 — `docs/VIDEO_SCRIPT.md`, le script d'environ 90 secondes, plan par plan, avec
les commandes à taper.

## 2026-09-29 — T8.5 · `docs/VIDEO_SCRIPT.md`

**Tâche :** T8.5 — le script de la vidéo de démonstration, environ 90 secondes, plan par plan, avec les commandes à
taper. C'est un livrable que personne n'exécute : quelqu'un s'assiéra devant un terminal, tapera ce qui est écrit et
s'attendra à voir apparaître les lignes citées. Le travail a donc consisté autant à **faire tourner chaque plan pour
de vrai** qu'à écrire le texte.

**Huit plans, 90 secondes, tout hors ligne.** 1–4 : `npm run demo`, l'ordre « Buy 25,000 USD of tokenised gold. The
ticker is XAU », les deux appels d'outils, ce vers quoi le symbole résout (**XAU9999 Meme, CMC 37470**), les deux
verdicts (**ACT** seul, **CAUTION 73,1/100** face à l'ordre), le refus (**219,83 %** du pool le plus profond) puis le
même ordre sur PAXG (**ACT 100/100**, 0,15 % du pool). 5 : `npm run check -- PAXG --replay=fixtures/check`, les sept
contrôles et le tableau de preuves. 6 : la page actif du navigateur (**ACT 84,6/100**, avec la mention de rejeu).
7 : la page d'audit (392 réponses, 17 endpoints, 0 crédit, 133 énoncés relus). 8 : carte de fin avec `{{REPO_URL}}`
et `#BuildwithCMC`. Les plans 1 à 7 ne demandent **ni clé, ni réseau, ni crédit** : la vidéo peut être enregistrée
sur un clone dont le `.env` est vide.

**Chaque plan a été filmé avant d'être écrit.** `npm run demo` (104 lignes, 0,74 s une fois construit),
`npm run check -- PAXG --replay=fixtures/check` (36 lignes, 0,11 s), et — ce que rien n'avait fait depuis T7.1 —
**l'interface relancée pour de vrai** : `next dev` sans `CMC_API_KEY`, les quatre routes que la vidéo montre
répondent **HTTP 200** (`/`, `/asset?q=XAU`, `/asset?q=PAXG`, `/audit`), 0 crédit dépensé. C'est là qu'on apprend
deux choses qu'aucune lecture du code ne donnait : la page XAU affiche **ACT 84,6/100, 5 contrôles sur 7** (l'actif
seul n'est pas refusé — c'est la taille de l'ordre qui le fait basculer, et la narration le dit), et `next dev`
choisit un autre port si 3000 est pris, ce que la préparation du tournage mentionne.

**Trois garde-fous écrits dans le document**, parce qu'ils ne se devinent pas : aucune clé à l'écran (aucun plan n'en
a besoin, donc ni `.env`, ni `npm run check:env`, ni historique de shell devant la caméra) ; le transcript imprime
des chemins absolus, donc le répertoire personnel ; et `npm run demo`/`npm run check` compilent avant de s'exécuter
(≈ 4 s de silence), à couper au montage ou à éviter en lançant les points d'entrée déjà construits. Une section
**« What the narration must not say »** fixe les cinq points où la voix off pourrait en dire plus que la mesure :
l'actif seul répond ACT, aucune cause n'est énoncée, rien n'est placé, les chiffres sont enregistrés et non live, et
les deux seuils de taille d'ordre ne sont pas calibrés.

**Le test (20 cas) ne compare rien à une copie de lui-même.** `tests/video-script-doc.test.ts` **rejoue les runs** :
il lance le vrai serveur MCP construit avec `--replay=fixtures/demo`, déroule les deux scénarios sur stdio et rend le
transcript avec `describeRun` ; il exécute `runCheck` sur `fixtures/check` ; il lit la page actif par `lookupAsset`
et la page d'audit par `loadAuditView`. Chaque ligne d'un bloc **Land on** doit apparaître dans le run que son plan
nomme (espaces mis à plat), sinon échec. Autour : la frise doit être contiguë de 0:00 à 1:30 et sommer à 90 s et le
tableau du haut doit dire la même chose ; chaque nombre de mots déclaré doit correspondre à sa narration et tenir
dans la durée (100–180 mots/min par plan, 137 au total) ; le montage court annoncé (plans 1-2-3-4-8) doit sommer aux
62 secondes annoncées ; chaque commande doit exister dans `package.json` et chaque chemin sur le disque ; les deux
emplacements en doubles accolades doivent être déclarés une fois et utilisés une fois ; les seuils 10 % et 25 % cités
sont relus dans `config/checks.json` ; les deux dates de captures sont **recalculées** depuis les `recordedAt` de
`fixtures/check` et `fixtures/demo` ; et le texte passe la porte de ton de `src/audit/review.ts`.

**Vérifié qu'il mord : 17 mutations du document, 17 attrapées** (un chiffre cité dans un bloc Land on, une durée de
plan, un nombre de mots déclaré, un mot ajouté à la narration, un libellé de source, un troisième emplacement, un mot
accusatoire, une commande inexistante, un chemin inexistant, un seuil C4, le score de l'actif seul, une date de
capture, la somme du montage court, une ligne du tableau, un verdict cité, la ligne de crédits, un chiffre de
l'audit).

**Fichiers :** `docs/VIDEO_SCRIPT.md` (**nouveau**, 280 lignes), `tests/video-script-doc.test.ts` (**nouveau**),
`.gitignore` (deux fichiers écrits par `next dev`, voir `.loop/BLOCKED.md`), `TASKS.md` (T8.5 cochée),
`.loop/BLOCKED.md`, `.loop/PROGRESS.md`.

**Vérifications :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ **1137 tests, 66 fichiers** (contre
1117 / 65 à la fin de T8.4), `scripts/check-secrets.sh` ✅, plus un scan ciblé des fichiers touchés (ni la clé réelle,
ni le motif d'en-tête).

**Commit : toujours refusé** par le hook global `gitflow-asin` sur la branche `master` ; non contourné. Détail et
commande de rattrapage dans `.loop/BLOCKED.md`, avec un nouveau point de ménage (`web/AGENTS.md` et `web/CLAUDE.md`,
écrits par `next dev`, que l'environnement m'a refusé de supprimer).

**Prochaine tâche prévue :** T8.6 — `docs/X_POST.md`, le brouillon du post avec les emplacements pour le lien
DoraHacks et la vidéo, et `#BuildwithCMC`. Les emplacements déjà déclarés ailleurs (`X_POST_URL` dans
`docs/SUBMISSION.md`, `REPO_URL` ici) donnent la convention à reprendre.

## 2026-09-29 — T8.6 · `docs/X_POST.md`

**Tâche :** T8.6 — le brouillon du post sur X, avec les emplacements pour le lien DoraHacks et pour la vidéo, et
`#BuildwithCMC`. C'est le plus petit livrable du projet et le plus exposé : il est publié une fois, devant un public
qui ne peut pas ouvrir une fixture, et raccourcir une phrase est exactement la façon dont un chiffre mesuré devient
un chiffre de mémoire.

**Quatre brouillons, comptés comme X les compte.** Le **post 1** porte à lui seul les trois choses que le règlement
demande — `{{BUIDL_URL}}`, `{{VIDEO_URL}}`, `#BuildwithCMC` — et le document le dit, pour que le fil soit facultatif
plutôt que requis. Les posts 2 à 4 sont des réponses sous lui : la méthode (trois familles d'endpoints qui ne
dérivent pas l'une de l'autre, sept contrôles, aucune conclusion sans preuve), l'ordre refusé (XAU, **quatre** actifs
sous le même symbole, celui vers lequel il résout coté autour de **1e-11 USD**, deux lectures indépendantes qui
arrêtent l'ordre), et la calibration avec l'audit (**47 des 50** premiers par capitalisation en ACT, **94 %** ;
**24 entrées** publiées, chacune citant une réponse enregistrée) plus `{{REPO_URL}}` et `{{DEMO_URL}}`.

**Le comptage est la contrainte qui a façonné le texte.** Un post tient 280 caractères et X compte **23** par lien
quelle que soit sa longueur : un emplacement en doubles accolades est plus long que le lien qui le remplacera, donc
compter le brouillon tel qu'écrit donne un nombre que la fenêtre de rédaction ne donnera pas. Les quatre longueurs
déclarées (**274, 250, 248, 272** sur 280) sont recalculées par le test, marge fine assumée.

**Trois choses écrites parce qu'elles ne se devinent pas.** (1) **L'ordre de publication** : deux liens se pointent
l'un l'autre — ce post porte le lien du BUIDL, et la table *Links* du BUIDL porte ce post — donc créer le BUIDL,
publier, puis recoller l'URL du post dans `X_POST_URL` de `docs/SUBMISSION.md` ; et si DoraHacks ne donne pas d'URL
avant soumission, inverser les deux dernières étapes. Dernière vérification avant envoi : chercher `{{` dans la
fenêtre de rédaction. (2) **Si un seul post sort** : c'est le post 1 ; un post dont l'emplacement ne peut pas être
rempli est abandonné, pas publié avec un trou. (3) **Ce qui est volontairement absent** : aucun identifiant de
compte (un handle que ce dépôt ne peut pas vérifier peut pointer ailleurs, alors que toutes les autres affirmations
des quatre posts sont contrôlées), aucune image, aucun mot qu'un lecteur pourrait prendre pour un conseil.

**Le test (21 cas) ne compare rien à une copie de lui-même.** `tests/x-post-doc.test.ts` recalcule chaque chiffre :
la part de calibration depuis `docs/calibration.json`, le nombre d'entrées publiées depuis `docs/api_audit.json`
(avec vérification que chacune cite un fichier présent et que `review.unproven` est vide), le nombre d'actifs sous
le symbole en normalisant la réponse `map` enregistrée, l'ordre de grandeur du prix depuis la cotation enregistrée,
et le refus lui-même **en rejouant l'ordre** par `preflight_trade` hors ligne (C5 `not_applicable`, part du pool le
plus profond > 200 %). Les noms de verdicts viennent de `VERDICTS`, le nombre de contrôles de `CHECK_IDS`, les trois
familles des chemins que le client peut réellement envoyer (et aucun chemin compté dans deux familles). Autour : la
longueur comptée de chaque post est recalculée à la façon de X et doit tenir sous 280 ; les quatre emplacements sont
déclarés une fois et utilisés une fois ; aucun brouillon ne contient d'URL littérale ; chaque chemin cité existe sur
le disque ; la date de clôture citée est relue dans `CAHIER_DES_CHARGES.md` ; et le texte passe la porte de ton de
`src/audit/review.ts`.

**Vérifié qu'il mord : 24 mutations du document, 24 attrapées** (une longueur déclarée, un post poussé au-delà de
280, le hashtag retiré, le lien du BUIDL retiré, un emplacement non déclaré, un emplacement utilisé deux fois, le
nombre d'actifs sous le symbole, l'ordre de grandeur du prix, le nombre d'actifs en ACT, la part de 94 %, la taille
du panel, le nombre d'entrées d'audit, le nombre de contrôles, un nom de verdict, le nombre de familles, une famille
renommée, la date de clôture, le coût d'un lien, un mot accusatoire, une URL réelle dans un brouillon, un chemin
inexistant, ce que fait l'agent de l'ordre, la phrase qui rend le fil facultatif, la promesse de preuve du post 2).

**Deux formulations corrigées** parce que la porte de ton les a refusées : elles employaient le mot « wrong » hors
citation, que ce projet s'interdit d'utiliser au sujet de l'API. Réécrites sans lui.

**Fichiers :** `docs/X_POST.md` (**nouveau**, 129 lignes), `tests/x-post-doc.test.ts` (**nouveau**), `TASKS.md`
(T8.6 cochée), `.loop/BLOCKED.md`, `.loop/PROGRESS.md`. Le `README.md` n'est pas touché : sa section
*Documentation* ne liste que les trois documents qu'un lecteur du code ouvre, pas les pièces de soumission
(`SUBMISSION.md` et `VIDEO_SCRIPT.md` n'y sont pas non plus).

**Vérifications :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ **1158 tests, 67 fichiers** (contre
1137 / 66 à la fin de T8.5), `scripts/check-secrets.sh` ✅, plus un scan ciblé des deux nouveaux fichiers (ni la clé
réelle, ni le motif d'en-tête).

**Commit : toujours refusé** par le hook global `gitflow-asin` sur la branche `master` ; non contourné. Détail et
commande de rattrapage dans `.loop/BLOCKED.md`.

**Prochaine tâche prévue :** T8.7 — `docs/HUMAN_CHECKLIST.md`, la liste ordonnée des actions humaines restantes.
La matière est déjà éparpillée et vérifiable : les tâches `[H]` de `TASKS.md`, la section 9 du cahier des charges,
les étapes « Before pressing submit » de `docs/SUBMISSION.md`, la préparation de tournage de
`docs/VIDEO_SCRIPT.md`, l'ordre de publication de `docs/X_POST.md`, et les points de ménage accumulés dans
`.loop/BLOCKED.md` (activer le hook pre-commit, committer le travail, supprimer les enregistrements partiels et les
deux fichiers écrits par `next dev`). Le travail consiste à les ordonner par dépendance — sans en inventer une.

---

## 2026-09-30 — T8.7 `docs/HUMAN_CHECKLIST.md` : la liste ordonnée des actions humaines restantes

**Fait.** Dix étapes, H1 à H10, ordonnées par dépendance et non par préférence. La matière existait déjà, éparpillée
dans six endroits ; le travail était de l'ordonner sans inventer une dépendance, et de rendre cet ordre vérifiable.

**Ce qui décide de l'ordre :** cinq liens que personne ici ne peut remplir. `{{REPO_URL}}`, `{{DEMO_URL}}`,
`{{VIDEO_URL}}`, `{{BUIDL_URL}}`, `{{X_POST_URL}}` — chacun est produit par une étape et attendu par un ou plusieurs
des trois documents de soumission. La soumission en attend quatre, le post quatre, et l'un de chaque paire pointe
vers l'autre : c'est pourquoi H10 existe (recoller l'URL du post dans le BUIDL) et pourquoi H8 et H9 peuvent
s'échanger si DoraHacks ne donne pas d'URL avant soumission.

**L'ordre retenu :** H1 décider ce qui n'entre pas dans l'historique → H2 activer le hook puis committer → H3 dépôt
public → H4 déploiement Vercel → H5 relire le ton → H6 compte DoraHacks au même e-mail → H7 vidéo → H8 BUIDL →
H9 post X → H10 recoller le post dans le BUIDL. H5 et H6 n'attendent rien et sont placées juste avant H8, la
première étape qui en a besoin. **H1 et H2 ne viennent pas des six lignes `[H]` de `TASKS.md`** mais de
`.loop/BLOCKED.md` : elles passent devant parce que six des huit autres ont besoin d'un dépôt public, qui a besoin
d'un commit.

**Ce que le document dit aussi, parce que la date l'impose :** la clôture est aujourd'hui, 2026-09-30 à 23h59 UTC, et
la liste a été écrite à 08h21 UTC. Une section *shortest path* désigne la seule étape qu'on peut abandonner sans
perdre une exigence du règlement — **H4**, le déploiement : la démo est couverte par la vidéo, et `docs/X_POST.md`
prévoyait déjà ce que devient le post 4 sans déploiement. Un cas de test vérifie que rien d'autre que H8 et H9
n'attend H4.

**Deux choses trouvées en vérifiant, pas en rédigeant :**
1. L'**option 0 de `.loop/BLOCKED.md`** disait de supprimer les deux marches de calibration interrompues avant de
   committer. C'était incomplet : `tests/evidence-doc.test.ts` exige qu'au moins l'une des deux subsiste, pour que la
   phrase de `docs/EVIDENCE.md` qui les décrit parle d'un vrai dépôt. H1 énonce donc la conséquence, les trois
   fichiers à toucher si on tient à les supprimer, et l'ordre ; l'option 0 a été corrigée et renvoie à H1.
2. Leur taille est de **moins de 2 Mo de JSON** (1 969 762 octets), pas les 2,8 Mo que donne `du` — blocs alloués
   contre contenu. Le test recalcule la somme des tailles de fichiers.

**Le test (55 cas) vérifie l'ordre comme un ordre.** `tests/human-checklist-doc.test.ts` construit le graphe des
dépendances depuis le tableau et exige que chaque étape attendue soit définie et placée plus haut dans le document :
un cycle, une référence vers l'avant ou une étape inexistante échouent. Il exige aussi que la ligne
`**Depends on**` de chaque section dise la même chose que sa ligne du tableau, pour que la carte et le terrain ne
divergent pas. Le reste : les cinq emplacements sont exactement ceux que les trois documents déclarent (chacun produit
par une étape et une seule, chaque document annoncé comme en attente le portant vraiment), les six lignes `[H]` sont
relues depuis `TASKS.md` et chacune couverte par une étape définie (pas de septième inventée), la section 9 du cahier
des charges doit en lister autant, et chaque chiffre est recalculé depuis le fichier qui le porte : 217 et 123 fichiers
depuis les dossiers, l'arrêt à 25 actifs sur 50 depuis le journal de la marche, 392 réponses et 288 crédits contre
`docs/EVIDENCE.md`, 7 contrôles et 4 outils depuis le moteur, 50 actifs depuis le panel, 24 entrées depuis
`docs/api_audit.json`, 17 endpoints et 4 refus depuis l'inventaire, 274/280 depuis `docs/X_POST.md`, 8 plans et 90 s
depuis `docs/VIDEO_SCRIPT.md`, les 7 variables d'environnement depuis le `README.md`. Enfin : toute commande `npm run`
existe, tout chemin existe — **sauf `docs/FINAL_CHECK.md`, que le test exige encore absent** puisque le document
annonce que T9.2 l'écrira —, la seule URL du document est `http://localhost:3000`, et le texte passe la porte de ton
de `src/audit/review.ts`.

**Vérifié qu'il mord : 25 mutations du document, 25 attrapées** (une dépendance pointée vers l'avant, un tableau qui
contredit sa section, un mauvais producteur de lien, une ligne `[H]` laissée sans étape, le nombre de fichiers de
chaque marche, l'endroit où la marche s'est arrêtée, leur taille, l'heure de clôture, une URL fabriquée insérée dans
le texte, le nombre de contrôles, la longueur comptée du post 1, un mot accusatoire, un chemin inexistant, une section
renumérotée, le nombre de variables d'environnement, le Root Directory de Vercel, le nombre d'entrées d'audit, la durée
de la vidéo, une tâche de la boucle renommée, la taille du panel, le nombre de brouillons, les sept préparations avant
tournage, les réponses enregistrées, le nombre d'endpoints).

**Fichiers :** `docs/HUMAN_CHECKLIST.md` (**nouveau**), `tests/human-checklist-doc.test.ts` (**nouveau**), `TASKS.md`
(T8.7 cochée), `.loop/BLOCKED.md` (entrée T8.7 + correction de l'option 0), `.loop/PROGRESS.md`. `DEMARRAGE.md`
n'est pas touché : il renvoyait déjà à `docs/HUMAN_CHECKLIST.md`, qui n'existait pas — ce renvoi est maintenant bon.

**Vérifications :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ **1213 tests, 68 fichiers** (contre
1158 / 67 à la fin de T8.6), `scripts/check-secrets.sh` ✅, plus un scan ciblé des deux nouveaux fichiers (ni la clé
réelle, ni le motif d'en-tête).

**Commit : toujours refusé** par le hook global `gitflow-asin` sur la branche `master` ; non contourné. C'est la
vingt-neuvième itération sans commit, et la dernière où ce blocage n'est qu'une note de journal : il est désormais
H1 et H2 de la liste humaine.

**Prochaine tâche prévue :** T9.1 — installation propre dans un dossier temporaire (`npm install`, `npm run build`,
`npm run lint`, `npm run typecheck`, `npm test`). Attention : le dépôt n'ayant qu'un seul commit, un clone ne
copierait que le cahier des charges ; la copie devra se faire depuis le working tree, en excluant `node_modules/`,
`dist/`, `.cache/` et `.env` — et le fait que `.env` soit absent est précisément ce que T9.1 doit vérifier, puisque
toute la suite doit passer sans clé et sans réseau.

## 2026-09-30 — T9.1 Installation propre dans un dossier temporaire : la porte tourne, sur les vrais fichiers

**Tâche : T9.1** — `[x]`. Elle était déjà écrite pour l'essentiel par une itération interrompue plus tôt dans la
journée (`scripts/clean-install-check.sh` et `tests/clean-install.test.ts` datés de 09:58–09:59, sans entrée de
journal) ; ce qui manquait était le seul point qui compte pour cette tâche : **la lancer pour de vrai**.

**Lancée trois fois, verte trois fois.** La vérification part de
`git ls-files -z --cached --others --exclude-standard`, donc de ce qu'un clone porterait, copie dans un dossier
temporaire — `node_modules/`, `dist/`, `.cache/` et surtout `.env` restent derrière, et le script échoue si l'un
d'eux voyage — puis enchaîne les portes sur place :

| Porte | Résultat |
|---|---|
| `npm install` | 225 paquets, **0 vulnérabilité** ; le `prepare` dit proprement « Not the root of a git work tree: git hooks not installed » |
| `npm run build` | ✅ |
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| `npm test` | ✅ **69 fichiers, 1234 tests**, dans `/tmp/second-opinion-clean.*` |
| `npm run check -- PAXG --replay=fixtures/check` | ✅ sans clé |
| `npm run demo` | ✅ 2 scénarios, 1 refusé, 1 simulé, 0 crédit |

**935 fichiers copiés, aucun `.env`.** Le dernier point est l'intérêt de l'exercice : la copie n'a pas de clé, donc
un appel qui partirait vers l'API échouerait sur la clé au lieu d'utiliser silencieusement celle de ce clone.

**Une passe `--with-web` en plus**, non demandée par T9.1 mais promise par le README : `npm run web:install`
(123 paquets, 0 vulnérabilité), `web:lint`, `web:typecheck`, `web:build` — Next.js 16.3.6, compilé en 5,2 s, quatre
routes (`/`, `/_not-found`, `/asset`, `/audit`). Vert aussi. Un juge qui suit le README jusqu'au bout ne se
heurtera pas au mur de l'application web.

**Ce que j'ai ajouté :** la porte existait mais n'était atteignable que par son chemin. Elle est maintenant un
script npm comme les autres (`npm run check:clean`, à côté de `check:env`) et elle est **nommée dans la section
« Verifying a clone » du README**, avec l'option `--with-web`. Deux cas de test la tiennent : l'un épingle la cible
du script npm, l'autre exige que cette section du README la nomme et documente l'option. **Vérifié qu'ils mordent :
deux mutations, deux attrapées** (le script npm pointé vers `check-env.sh` ; l'option retirée du README).

**Un échec observé une fois, non reproduit, non « corrigé ».** Au premier `npm test` de l'itération,
`tests/demo-run.test.ts` a échoué en bloc sur `McpError: MCP error -32000: Connection closed` (28 cas sautés). Le
`dist/` était alors périmé par rapport au `src/` modifié à 09:44. Mécanisme candidat : trois fichiers de test
(`demo-run`, `mcp-config-doc`, `video-script-doc`) lancent chacun `npm run build` dans leur `beforeAll`, en
parallèle, pendant que d'autres workers lancent `dist/mcp/server.js` — des `tsc` concurrents écrivant les mêmes
sorties. **Je n'ai pas réussi à le prouver**, et je n'ai donc rien changé :
- 40 lancements du serveur pendant des `tsc` répétés : 0 échec ;
- 25 lancements × 3 tours pendant **trois `tsc` simultanés** sur un `dist/` forcé sale : 0 échec ;
- 6 suites complètes, dont **3 avec `dist/` entièrement supprimé** (la condition de la machine propre) : 0 échec ;
- 6 tours des trois fichiers en cause ensemble, `dist/` supprimé à chaque fois : 0 échec ;
- les deux copies propres : 0 échec.

Soit **quatorze exécutions vertes après l'unique échec**. Écrire un correctif pour une cause que je n'arrive pas à
établir aurait été inventer ; l'observation est consignée ici avec son mécanisme candidat pour qu'une prochaine
itération puisse trancher si elle le revoit. La déduplication des trois `npm run build` dans un `globalSetup` unique
de Vitest reste la piste : elle est défendable seule (travail redondant, écrivains concurrents sur `dist/`), mais
c'est un refactor de trois fichiers de test, pas T9.1.

**Ce que T9.1 ne prouve pas, et c'est écrit dans `.loop/BLOCKED.md` :** les 935 fichiers copiés sont presque tous
**non suivis**. Un vrai clone ne ramènerait aujourd'hui que le commit `236ed47`. La porte est verte sur le
contenu du working tree et le resterait sur un clone une fois le commit fait — elle ne peut pas prouver le clone
tant que l'index est vide. Dit maintenant pour que T9.2 ne coche pas le critère 1 de la section 8 sur une ambiguïté.

**Fichiers modifiés :** `package.json` (script `check:clean`), `README.md` (section « Verifying a clone »),
`scripts/clean-install-check.sh` (en-tête : la route npm), `tests/clean-install.test.ts` (+2 cas), `TASKS.md`
(T9.1 cochée), `.loop/BLOCKED.md`, `.loop/PROGRESS.md`. Les fichiers laissés par l'itération interrompue sont
conservés tels quels, vérifiés verts : `tests/helpers/rwa-index.ts`, `src/rwa/wrapper-index.ts`,
`tests/{clean-install,demo-agent,demo-run,rwa-wrapper-index,submission-doc,video-script-doc,x-post-doc}.test.ts`,
`tests/helpers/calibration-fixtures.ts`.

**Vérifications :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ **1234 tests, 69 fichiers** (contre
1232 / 69 à l'ouverture de l'itération, 1213 / 68 à la fin de T8.7), `scripts/check-secrets.sh` ✅, et la porte
elle-même ✅ trois fois.

**Commit : toujours refusé** par le hook global `gitflow-asin` sur `master`. L'ajout ciblé que le hook recommande
lui-même est refusé exactement comme un ajout en bloc : c'est la décision `ask` qui bloque, pas la forme de la
commande. Non contourné. Trentième itération sans commit ; c'est H1/H2 de `docs/HUMAN_CHECKLIST.md`.

**Prochaine tâche prévue :** T9.2 — relire chaque critère de la section 8 du cahier des charges et consigner le
résultat dans `docs/FINAL_CHECK.md`. Attention : `tests/human-checklist-doc.test.ts` exige aujourd'hui que
`docs/FINAL_CHECK.md` soit **absent** (le document annonce que T9.2 l'écrira) ; ce cas devra être retourné en même
temps que le fichier sera créé. Et le critère 1 devra être consigné avec la réserve ci-dessus.

## 2026-09-30 — T9.3 Aucune clé dans l'historique git : la portée qui avait quelque chose à lire

**Ce qui a été fait.** `scripts/check-secrets.sh --history` passe sur ce dépôt (« ✅ No secret detected »), et c'est
le critère littéral de la tâche. Mais l'historique porte un seul commit, `236ed47`, et T9.1 puis T9.2 avaient déjà
prévenu que ce vert ne dirait rien des fichiers du projet. En lançant la commande, un second constat est apparu,
celui-là nulle part consigné : **la portée par défaut ne disait rien non plus**. Elle lit `git diff --cached`, et
l'index est vide — les trente et un « `scripts/check-secrets.sh` ✅ » de `.loop/BLOCKED.md` n'ont donc lu aucune
ligne de diff (seul leur contrôle « `.env` est-il suivi ? » gardait un sens ; les scans ciblés faits à la main à
côté étaient le vrai garde-fou). Cocher la case sur deux scans qui ne lisent rien aurait été cocher du vide, donc
deux défauts ont été corrigés, chacun avec ses tests :

1. **Une troisième portée, `--worktree`**, qui lit ce qu'un clone recevrait — `git ls-files --cached --others
   --exclude-standard` — au lieu de commits qui n'existent pas encore. Mesuré : elle atteint exactement les
   **944 fichiers** que la porte d'installation propre de T9.1 copie, `.env` restant écarté par `.gitignore:5`.
   Elle nomme les fichiers en faute, parce qu'une liste de chemins est ce dont on a besoin pour agir.
2. **Une portée mal tapée est refusée** au lieu de retomber sur la portée par défaut. `scripts/check-secrets.sh
   --histry` imprimait « ✅ No secret detected » et sortait en 0 ; il sort maintenant en 2 avec `Unknown scope`.
   Deux portées à la fois sont refusées de même.

**Ce qui prouve que la nouvelle portée lit vraiment.** Une valeur fausse en forme de clé a été plantée dans un
fichier non suivi du dépôt : la portée par défaut a répondu « ✅ No secret detected », `--worktree` a échoué en
nommant le fichier. Le fichier a été supprimé aussitôt et n'a jamais approché l'index. Une vérification annexe a
corrigé un commentaire écrit trop vite : `--text` n'est pas ce qui garde un fichier binaire dans le scan —
`git grep -l` le signale de toute façon —, et le commentaire du script le dit maintenant correctement.

**Vérification :** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ — **1 270 tests dans 70 fichiers**, dont
22 dans `tests/git-hooks.test.ts`, qui relit désormais les trois portées **sur ce dépôt** à chaque exécution : la
réponse de T9.3 ne peut plus se périmer en silence. Les trois portées de `scripts/check-secrets.sh` ✅. Aucun appel
réseau, **0 crédit dépensé** ; 494 restants sur 500, inchangés depuis T9.2.

**Fichiers modifiés :** `scripts/check-secrets.sh` (troisième portée, refus d'une portée inconnue),
`tests/git-hooks.test.ts` (six cas neufs plus la relecture du dépôt sous les trois portées),
`tests/human-checklist-doc.test.ts` (les deux cas qui lisaient « une tâche reste à la boucle » retournés, un cas
neuf sur la troisième portée), `docs/FINAL_CHECK.md` (critère 8 : la portée ajoutée, la réserve resserrée à ce qui
dépend encore de H2), `docs/HUMAN_CHECKLIST.md` (« ce que la boucle doit encore » : plus rien ; `--worktree` offert
à l'étape H2 avant de stager), `README.md` (les trois portées), `TASKS.md` (T9.3 cochée), `.loop/BLOCKED.md`,
`.loop/PROGRESS.md`, `.loop/DONE` (créé).

**Commit :** refusé, comme aux trente et une itérations précédentes. Le hook global `gitflow-asin` refuse l'ajout à
l'index (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche
`master`) et personne ne peut confirmer en session autonome. Non contourné. C'est H1/H2 de
`docs/HUMAN_CHECKLIST.md`.

**Une lacune du journal, constatée en écrivant ceci :** ce fichier n'a **aucune entrée T9.2**. La tâche est faite et
cochée, et sa trace existe ailleurs — `docs/FINAL_CHECK.md` (le livrable), sa mise à jour du 2026-09-30 dans
`.loop/BLOCKED.md`, et `tests/final-check-doc.test.ts`. L'entrée manquante n'est pas reconstituée ici : je n'ai pas
assisté à cette itération et ne vais pas lui inventer un récit.

**Prochaine tâche prévue :** aucune. T9.3 était la dernière tâche non humaine du backlog ; toutes les lignes de
`TASKS.md` sont `[x]` sauf les six `[H]`, et `.loop/DONE` a été créé avec le résumé final et les actions humaines
restantes.
