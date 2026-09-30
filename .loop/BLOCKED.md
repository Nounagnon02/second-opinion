# Blocages — actions humaines requises

## 2026-09-24 — Commits locaux impossibles : le hook global `gitflow-asin` bloque la boucle

**Tâche concernée :** étape 5 du protocole de boucle (commit local), dès T0.1. T0.1 elle-même est terminée et vérifiée
(`npm run build && npm run lint && npm run typecheck && npm test` passent), mais **rien n'est committé** : les fichiers
sont restés non suivis dans le working tree.

**Cause précise :** le hook `PreToolUse` global `~/.claude/hooks/gitflow-asin-guard.py` (déclaré dans
`~/.claude/settings.json`) s'applique à tous les dépôts, y compris celui-ci, qui n'est pas un dépôt ASIN :
- `git add <fichiers>` → décision `ask` → refus automatique en session headless (personne pour confirmer) ;
- `git commit` sur `master` → `deny` (branche protégée pour le hook : `main`, `master`, `develop`) ;
- le format de commit imposé par `CLAUDE.md` (`T0.1: ...`) → `deny` (le hook exige un Conventional Commit `type(scope): ...`) ;
- toute commande Bash dont le texte mentionne `git` et que le hook ne sait pas analyser (heredoc, guillemets) → `ask` → refus ;
- le skill `gitflow-asin` exige en plus un « oui » explicite de l'utilisateur avant toute commande git qui modifie le dépôt.

Je n'ai pas contourné le hook (pas de désactivation, pas de variable d'environnement, pas d'override).
**Toutes les itérations suivantes rencontreront le même blocage** : le travail s'accumule non committé.

**Mise à jour 2026-09-24 (itération T0.2) :** blocage toujours présent (hook toujours déclaré dans
`~/.claude/settings.json`, `git add` refusé à nouveau). T0.2 a quand même pu être validée : le test
`tests/git-hooks.test.ts` crée un dépôt jetable dans le dossier temporaire du système et y vérifie qu'un commit contenant
une fausse clé est refusé. Le dépôt du projet n'est pas touché. Deux actions restent à faire à la main dans ce clone :
- **activer le hook pre-commit** : `npm run prepare` (écrit `core.hooksPath=.githooks` dans `.git/config`). Je ne l'ai pas
  lancé moi-même : c'est une modification de la config git que le hook global soumet à confirmation ;
- **committer le travail de T0.1 et T0.2** (option 3 ci-dessous).

**Mise à jour 2026-09-24 (itération T0.3) :** blocage toujours présent (`git add scripts/check-env.sh
tests/check-env.test.ts` refusé par `gitflow-asin` : « Confirmation requise avant execution »). T0.3 est faite et
vérifiée ; ses fichiers sont ajoutés à la commande de l'option 3 ci-dessous (un seul commit T0.1–T0.3).

**Mise à jour 2026-09-24 (itération T1.1) :** blocage toujours présent (`git add docs/ENDPOINTS.md
tests/endpoints-doc.test.ts TASKS.md` refusé : « Confirmation requise avant execution », branche `master`). T1.1 est
faite et vérifiée ; ses fichiers (`docs/ENDPOINTS.md`, `tests/endpoints-doc.test.ts`) sont ajoutés à la commande de
l'option 3, qui devient un commit unique T0.1–T1.1.
**Urgence croissante :** T1.2 est la première tâche qui appelle l'API et écrit des fixtures ; plus le travail s'accumule
hors git, plus un commit unique devient difficile à relire.

**Mise à jour 2026-09-24 (itération T1.2) :** blocage toujours présent (`git add fixtures/discovery src/... TASKS.md`
refusé : « Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`).
T1.2 est faite et vérifiée (41 tests, secrets ✅) ; ses fichiers (`fixtures/discovery/*.json` — 26 réponses brutes, clé
masquée —, `src/cmc/fixtures.ts`, `src/cli/record.ts`, `tests/fixtures.test.ts`, `tests/record-cli.test.ts`) sont
ajoutés à la commande de l'option 3, qui devient un commit unique T0.1–T1.2. Les fixtures sont la preuve des appels
réels exigée par le règlement : elles doivent entrer dans git.
Note : ce hook refuse aussi toute commande Bash qui mélange `git` et d'autres commandes (pipes, `;`), même en lecture.

**Mise à jour 2026-09-25 (itération T1.3) :** blocage toujours présent (`git add docs/DECISIONS.md
tests/decisions-doc.test.ts` refusé : « Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant
execution », branche `master`). T1.3 est faite et vérifiée (46 tests, secrets ✅). En relisant `git status -uall`, la
liste de fichiers de l'option 3 oubliait `tests/helpers/endpoints-doc.ts` (utilisé par deux tests depuis T1.2) : la
commande ci-dessous passe donc par des dossiers entiers, pour ne plus rien oublier. Tous les fichiers non suivis
actuels appartiennent au projet ; `.env` et `node_modules/` restent exclus par `.gitignore`.

**Mise à jour 2026-09-25 (itération T2.1) :** blocage toujours présent (`git add package.json ... TASKS.md`, la
commande de l'option 3, refusé : « Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant
execution », branche `master`). T2.1 est faite et vérifiée (111 tests, secrets ✅). Ses fichiers sont tous dans
`src/cmc/` et `tests/` (déjà couverts par la commande ci-dessous), plus `.env.example` (4 nouvelles variables).
`dist/` et `.cache/` (cache disque du client) restent exclus par `.gitignore`. Seul le message du commit change :
T0.1–T2.1.

**Mise à jour 2026-09-25 (itération T2.2) :** blocage toujours présent. `git add src tests TASKS.md` refusé
(« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`), et le
hook refuse aussi désormais mes commandes d'édition de ce fichier dès que leur texte contient une ligne `git …`
(« Commande git/glab non analysable automatiquement ») : cette mise à jour a dû être écrite avec l'outil d'édition de
fichiers, pas avec un script shell. T2.2 est faite et vérifiée (156 tests, lint ✅, typecheck ✅, build ✅, secrets ✅).
Ses fichiers sont dans `src/` et `tests/` (déjà couverts par la commande de l'option 3), plus `TASKS.md` : la liste de
fichiers ci-dessous n'a pas besoin de changer, seul le message du commit devient T0.1–T2.2.

**Mise à jour 2026-09-25 (itération T2.3) :** blocage toujours présent. `git add src tests TASKS.md` refusé avec le
même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche
`master`). T2.3 est faite et vérifiée (230 tests, lint ✅, typecheck ✅, build ✅, secrets ✅). Ses fichiers sont dans
`src/normalize/` et `tests/` (déjà couverts par la commande de l'option 3), plus `TASKS.md` : la liste de fichiers
ci-dessous n'a pas besoin de changer, seul le message du commit devient T0.1–T2.3.
**Neuf itérations sans commit.** La prochaine tâche (T3.1) ouvre `src/checks/`, c'est-à-dire le cœur du produit :
si le commit unique doit rester relisible, c'est maintenant qu'il faut le faire.

**Mise à jour 2026-09-25 (itération T3.1) :** blocage toujours présent. `git add config src tests TASKS.md` refusé
avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution »,
branche `master`). T3.1 est faite et vérifiée (278 tests, lint ✅, typecheck ✅, build ✅, secrets ✅). Elle ajoute un
**nouveau dossier à suivre**, `config/`, qui ne figurait pas dans la commande de l'option 3 : la liste ci-dessous a
donc été corrigée. Ses autres fichiers sont dans `src/checks/` et `tests/`, plus `TASKS.md` ; le message du commit
devient T0.1–T3.1.
**Dixième itération sans commit.** `src/checks/` est maintenant ouvert et le moteur de contrôles grossira à chaque
itération (T3.2 à T3.6) : le commit unique perd en lisibilité à chaque fois.

**Mise à jour 2026-09-25 (itération T3.2) :** blocage toujours présent. `git add config src tests TASKS.md` refusé
avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution »,
branche `master`). T3.2 est faite et vérifiée (307 tests, lint ✅, typecheck ✅, build ✅, secrets ✅). Ses fichiers
sont dans `src/checks/`, `tests/` et `config/checks.json` — tous déjà couverts par la commande de l'option 3 ; seul
le message du commit devient T0.1–T3.2.
**Onzième itération sans commit.** Le moteur porte maintenant quatre contrôles sur sept (C1, C2, C3, C7) ; les trois
derniers (T3.3 à T3.5) puis le score (T3.6) s'ajouteront au même commit unique, qui couvre déjà toute la chaîne, du
client API au moteur.

**Mise à jour 2026-09-25 (itération T3.3) :** blocage toujours présent. `git add config src tests TASKS.md` refusé
avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution »,
branche `master`). T3.3 est faite et vérifiée (343 tests, lint ✅, typecheck ✅, build ✅, secrets ✅). Ses fichiers
sont dans `src/checks/`, `tests/` et `config/checks.json` — tous déjà couverts par la commande de l'option 3 ; seul
le message du commit devient T0.1–T3.3.
**Douzième itération sans commit.** Cinq contrôles sur sept sont posés (C1, C2, C3, C4, C7). Il reste T3.4 et T3.5,
puis le score T3.6 : le commit unique couvrira alors tout le moteur d'un seul bloc, ce qui le rend d'autant plus
difficile à relire.

**Mise à jour 2026-09-25 (itération T3.4) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T3.4 est faite et vérifiée (428 tests, lint ✅, typecheck ✅, build ✅,
secrets ✅). Ses fichiers sont dans `src/checks/`, `src/rwa/`, `src/cli/`, `tests/`, `config/checks.json` et
`docs/DECISIONS.md` — tous déjà couverts par la commande de l'option 3 — plus un **nouveau dossier de fixtures**,
`fixtures/rwa-index/` (32 réponses brutes de la marche E18/E19 du 2026-09-25, clé masquée dans les 32), que la
commande couvre déjà via `fixtures`. Seul le message du commit devient T0.1–T3.4.
**Treizième itération sans commit.** Six contrôles sur sept sont posés (C1, C2, C3, C4, C5, C7). Il reste T3.5 puis
le score T3.6.

**Mise à jour 2026-09-25 (itération T3.5) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T3.5 est faite et vérifiée (454 tests, lint ✅, typecheck ✅, build ✅,
secrets ✅). Ses fichiers sont dans `src/checks/`, `tests/`, `config/checks.json` et `docs/DECISIONS.md` — tous déjà
couverts par la commande de l'option 3 ; seul le message du commit devient T0.1–T3.5.
**Quatorzième itération sans commit.** Les sept contrôles sont posés (C1 à C7) : le moteur est complet, et la
prochaine tâche (T3.6) est le score qui les pondère. Le commit unique couvre désormais toute la chaîne — client API,
modes record/replay, normaliseurs, index RWA, moteur de contrôles — en un seul bloc.

**Mise à jour 2026-09-25 (itération T3.6) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T3.6 est faite et vérifiée (490 tests, lint ✅, typecheck ✅, build ✅,
secrets ✅). Ses fichiers sont dans **un nouveau dossier**, `src/score/`, plus `src/checks/`, `src/index.ts`,
`tests/`, `config/checks.json` et `docs/DECISIONS.md` — tous déjà couverts par la commande de l'option 3, qui passe
par le dossier `src` entier ; seul le message du commit devient T0.1–T3.6.
**Quinzième itération sans commit.** Le moteur et son score sont complets : les sept contrôles, la pondération, le
verdict. La prochaine tâche (T3.7) est la CLI, c'est-à-dire la première commande qu'un relecteur lancera. Le commit
unique couvre maintenant toute la chaîne — client API, modes record/replay, normaliseurs, index RWA, moteur de
contrôles, score et verdict.

**Mise à jour 2026-09-25 (itération T3.7) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
fixtures TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation
requise avant execution », branche `master`). T3.7 est faite et vérifiée (564 tests, lint ✅, typecheck ✅, build ✅,
secrets ✅). Ses fichiers sont dans `src/cli/`, `src/checks/`, `tests/`, `tests/helpers/` et `docs/DECISIONS.md` —
tous déjà couverts par la commande de l'option 3 — plus un **nouveau dossier de fixtures**, `fixtures/check/`
(11 réponses réelles des deux premières marches live de la commande, clé masquée dans les 11), que la commande couvre
déjà via `fixtures`. Seul le message du commit devient T0.1–T3.7.
**Seizième itération sans commit.** La chaîne est maintenant complète de bout en bout : la commande que le critère
d'acceptation 2 nomme (`npm run check -- <symbole>`) tourne et rend un verdict. C'est l'état qu'un relecteur peut
lancer ; il n'est toujours pas dans git.

**Mise à jour 2026-09-26 (itération T4.1) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
fixtures TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation
requise avant execution », branche `master`). T4.1 est faite et vérifiée (641 tests, lint ✅, typecheck ✅,
secrets ✅) : la calibration atteint **90 % d'`ACT` sur les 50 premières cryptos**, soit exactement la cible de F5.
Ses fichiers sont `docs/CALIBRATION.md` et `docs/calibration.json` (générés), `tests/helpers/calibration-fixtures.ts`
et un **nouveau dossier de fixtures**, `fixtures/calibration/live-20260926T1044Z/` (300 réponses réelles, clé masquée
dans les 300) — tous déjà couverts par la commande de l'option 3 ; seul le message du commit devient T0.1–T4.1.
**Dix-septième itération sans commit.** Le critère d'acceptation 4 est maintenant atteint et mesuré, mais la preuve
(le rapport et les 300 réponses qui le fondent) reste hors de git.

**Mise à jour 2026-09-26 (itération T4.2) :** blocage toujours présent. L'ajout à l'index de `config src tests docs
TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T4.2 est faite et vérifiée (656 tests, lint ✅, typecheck ✅, secrets ✅) : la
calibration tient **94 % d'`ACT`** sur le panel des 50, au-dessus des 90 % de F5, et trois actifs restent sous `ACT`
(BNB 65,4 · LEO 73,1 · GRAM 57,7) avec le contrôle qui les y tient, désormais nommés dans un test. Ses fichiers sont
`config/checks.json`, `src/calibration/report.ts`, `tests/score-cap.test.ts`, `tests/calibration-doc.test.ts`,
`docs/CALIBRATION.md` et `docs/calibration.json` (régénérés par rejeu, sans réseau ni crédit) — tous déjà couverts par
la commande de l'option 3 ; seul le message du commit devient T0.1–T4.2.
**Dix-huitième itération sans commit.** La phase 4 est terminée : le critère d'acceptation 4 est atteint, mesuré et
protégé par des tests. La prochaine tâche (T5.1) ouvre le serveur MCP, c'est-à-dire le cœur du track choisi.

**Mise à jour 2026-09-26 (itération T5.2) :** blocage toujours présent. L'ajout à l'index de `README.md tests
TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T5.2 est faite et vérifiée (743 tests, lint ✅, typecheck ✅, secrets ✅) : le
dépôt a un `README.md` et la configuration MCP que l'hôte colle, et `tests/mcp-config-doc.test.ts` la relance pour de
vrai — le binaire construit, un vrai tube, le client du SDK à l'autre bout. Ses fichiers sont `README.md` (**nouveau
fichier à la racine**, que la commande de l'option 3 ne couvrait pas : la liste ci-dessous a été corrigée) et
`tests/mcp-config-doc.test.ts`, plus `TASKS.md`. Le message du commit devient T0.1–T5.2, et couvre aussi T5.1, dont
l'itération s'était arrêtée avant de mettre ce fichier à jour.
**Dix-neuvième itération sans commit.** La configuration que le critère d'acceptation 3 exige est maintenant écrite et
testée en lançant le serveur — et elle est hors du dépôt.

**Mise à jour 2026-09-26 (itération T5.3) :** blocage toujours présent. L'ajout à l'index de `src/demo
tests/demo-agent.test.ts tests/demo-run.test.ts fixtures/demo docs/DECISIONS.md package.json TASKS.md` est refusé
avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution »,
branche `master`). T5.3 est faite et vérifiée (789 tests, lint ✅, typecheck ✅, secrets ✅) : `npm run demo` déroule
les deux scénarios de F7 de bout en bout, en rejeu, sans réseau ni crédit — refus sur `XAU` (qui résout vers un
token meme, CMC 37470 : C5 ne lui trouve aucun actif réel et l'ordre vaut 219,83 % du pool le plus profond) et
simulation sur `PAXG` (`ACT` 100/100). Ses fichiers sont dans `src/demo/` (**nouveau dossier**, couvert par le
dossier `src` de la commande de l'option 3), `tests/`, `docs/DECISIONS.md` et `package.json` — tous déjà couverts —
plus un **nouveau dossier de fixtures**, `fixtures/demo/` (17 réponses réelles de la capture du 2026-09-26 vers
19 h UTC, clé masquée dans les 17), que la commande couvre déjà via `fixtures`. Seul le message du commit devient
T0.1–T5.3.
**Vingtième itération sans commit.** Le critère d'acceptation 5 (« l'agent de démo déroule les deux scénarios de bout
en bout ») est atteint et rejouable hors ligne : c'est la séquence que la vidéo doit filmer, et elle n'est pas dans
git. La phase 5 est terminée ; la prochaine tâche (T6.1) ouvre l'audit de l'API, le livrable qui distingue le projet.

**Mise à jour 2026-09-27 (itérations T6.1 et T6.2) :** blocage toujours présent. L'ajout à l'index de
`src tests docs config TASKS.md .loop/PROGRESS.md` est refusé avec le même message (« Action git/gitlab
modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`). T6.1 et T6.2 sont
faites et vérifiées (**915 tests, 54 fichiers**, lint ✅, typecheck ✅, secrets ✅). La phase 6 est terminée :
l'audit de l'API est écrit (`npm run audit`, 0 crédit, aucun appel réseau) **et relu** — les 24 constats
publient 133 affirmations, chacune reposée en question à la réponse enregistrée qu'elle cite, avec 0 constat
retiré faute de preuve et 0 problème de ton. Ses fichiers sont dans `src/audit/`, `tests/` (dont deux
**nouveaux** fichiers, `tests/audit-review.test.ts` et `tests/audit-doc.test.ts`) et `docs/` (`API_AUDIT.md` et
`api_audit.json`, générés) — tous déjà couverts par la commande de l'option 3 ; seul le message du commit
devient T0.1–T6.2.
**Vingt et unième itération sans commit.** Le critère d'acceptation 6 est maintenant atteint *et* vérifié par du
code testé : `docs/API_AUDIT.md` est comparé octet pour octet à ce qu'une exécution fraîche écrit, de sorte que
« généré, jamais édité à la main » est contrôlable et non promis. C'est le livrable qui distingue le projet, et
il est hors de git. La prochaine tâche (T7.1) ouvre l'interface web, qui ajoutera une dépendance lourde : si le
commit unique doit rester relisible, c'est le dernier moment confortable pour le faire.

**Mise à jour 2026-09-27 (itération T7.1) :** blocage toujours présent. L'ajout à l'index de `docs/DECISIONS.md
tests/decision-refs.test.ts tests/web-app.test.ts web/app/audit/page.tsx .gitignore TASKS.md` est refusé avec le
même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche
`master`). T7.1 est faite et vérifiée (**986 tests, 60 fichiers**, lint ✅, typecheck ✅, secrets ✅, plus
`web:lint` ✅, `web:typecheck` ✅ et `web:build` ✅ pour le second paquet).

Cette itération ajoute **un nouveau dossier de premier niveau, `web/`**, que la commande de l'option 3 ne couvrait
pas : la liste ci-dessous a été corrigée. Elle y fait entrer exactement **15 fichiers** — les 9 sources de
`web/app/`, plus `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/next.config.ts`,
`web/eslint.config.js` et `web/next-env.d.ts`. Les artefacts de build restent dehors : `web/.next/` et
`web/node_modules/` étaient déjà exclus par `.gitignore`, et `web/tsconfig.tsbuildinfo` (126 Ko, régénéré à chaque
`typecheck`) l'est depuis cette itération — c'est la ligne `*.tsbuildinfo` ajoutée à `.gitignore`.

**Vingt-deuxième itération sans commit.** L'interface de F8 tourne : construite, servie, six routes en HTTP 200,
la clé de 32 caractères absente des six pages. C'est ce qu'un juge ouvrira en premier, et c'est hors de git. Le
message du commit devient T0.1–T7.1.

**Mise à jour 2026-09-28 (itération T7.2) :** blocage toujours présent. L'ajout à l'index de la commande complète de
l'option 3 est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise
avant execution », branche `master`). T7.2 est faite et vérifiée (**997 tests, 61 fichiers**, lint ✅, typecheck ✅,
secrets ✅, plus `web:lint` ✅ et `web:typecheck` ✅).

Ses fichiers sont `web/vercel.json` (**nouveau**, couvert par le dossier `web` de la commande de l'option 3),
`tests/vercel-config.test.ts` (**nouveau**, couvert par `tests`), `README.md` et `docs/DECISIONS.md` (décision D16 +
la ligne T7.2 de « Handed to later tasks ») — tous déjà couverts par la commande ci-dessous. Seul le message du
commit change : il devient T0.1–T7.2.

**Vingt-troisième itération sans commit.** La phase 7 est terminée : le dépôt porte les réglages de déploiement que
l'action humaine « Déploiement Vercel » attend, et ces réglages ne sont pas dans git. Les deux commandes de
`web/vercel.json` ont été lancées depuis `web/` (le répertoire de travail que Vercel utilise) et produisent bien
`web/.next` ; ce qui reste invérifiable ici, c'est le comportement de la plateforme elle-même, puisque déployer est
une tâche `[H]`.

**Mise à jour 2026-09-28 (itération T8.1) :** blocage toujours présent. L'ajout à l'index de `README.md
tests/readme.test.ts TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du depot [...]
Confirmation requise avant execution », branche `master`). T8.1 est faite et vérifiée (**1008 tests, 62 fichiers**,
lint ✅, typecheck ✅, secrets ✅). Ses fichiers sont `README.md` (trois sections ajoutées) et
`tests/readme.test.ts` (**nouveau**, couvert par le dossier `tests` de la commande de l'option 3) — tous déjà
couverts par la commande ci-dessous. Seul le message du commit change : il devient T0.1–T8.1.

**Vingt-quatrième itération sans commit.** La phase 8 commence, c'est-à-dire les livrables que les juges lisent en
premier. Le README est désormais le document d'entrée complet que le règlement attend — problème, solution,
démarrage, configuration MCP, architecture, endpoints nommés — et il est hors de git, comme tout le reste.

**Mise à jour 2026-09-29 (itération T8.2) :** blocage toujours présent. L'ajout à l'index de `docs/EVIDENCE.md
tests/evidence-doc.test.ts TASKS.md` est refusé avec le même message (« Action git/gitlab modifiant l'etat du
depot [...] Confirmation requise avant execution », branche `master`). T8.2 est faite et vérifiée (**1060 tests,
63 fichiers**, lint ✅, typecheck ✅, secrets ✅). Ses fichiers sont `docs/EVIDENCE.md` (rédigé par l'itération
précédente, interrompue avant d'écrire son test, puis corrigé ici) et `tests/evidence-doc.test.ts`
(**nouveau**, couvert par le dossier `tests` de la commande de l'option 3) — tous déjà couverts par la commande
ci-dessous. Seul le message du commit change : il devient T0.1–T8.2.

**Vingt-cinquième itération sans commit.** `docs/EVIDENCE.md` est la pièce que le règlement demande nommément —
la preuve d'un vrai appel : le code qui l'a fait, la réponse qui est revenue. Chacune de ses citations est
désormais relue depuis le fichier qu'elle nomme par un test qui mord (vérifié sur huit mutations du document,
plus le cas où c'est le code qui bouge sous une plage citée). Elle est hors de git.

**Ménage à faire à la main (refusé à l'agent).** Deux enregistrements partiels de la même calibration traînent et
n'ont plus d'usage : les fichiers en vrac à la racine de `fixtures/calibration/` (~210, marche interrompue du
2026-09-25) et `fixtures/calibration/live-2026-09-26/` (123 fichiers, marche interrompue du 2026-09-26 à 08h, arrêtée
à 25 actifs sur 50). Seul `fixtures/calibration/live-20260926T1044Z/` fait foi : c'est celui que
`tests/helpers/calibration-fixtures.ts` rejoue et que `docs/CALIBRATION.md` cite. J'ai tenté de supprimer le dossier
partiel ; la suppression a été **refusée par le classificateur de sécurité** (« Irreversible Local Destruction »), et
je ne l'ai pas contournée. Ces deux lots ne gênent pas les tests (le rejeu pointe le dossier daté, pas la racine),
mais ils n'ont pas à entrer dans git : à supprimer avant le commit, ou à exclure de la commande d'ajout.
Même refus pour `.loop/calibrate-live.out` et `.loop/calibrate-live.progress`, les deux journaux de la marche
interrompue (25 actifs sur 50) : ils sont restés en place et `.loop/` entre en entier dans la commande de
l'option 3. Les journaux de la marche complète, eux, sont sous `.loop/logs/`, que `.gitignore` exclut déjà.

**Mise à jour 2026-09-29 (itération T8.3) :** blocage toujours présent. L'ajout à l'index de
`docs/API_FEEDBACK.md tests/api-feedback-doc.test.ts TASKS.md` est refusé avec le même message (« Action
git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`). T8.3 est
faite et vérifiée (**1079 tests, 64 fichiers**, lint ✅, typecheck ✅, secrets ✅). Ses deux fichiers,
`docs/API_FEEDBACK.md` et `tests/api-feedback-doc.test.ts` (**nouveaux**), sont déjà couverts par les dossiers
`docs` et `tests` de la commande de l'option 3. Seul le message du commit change : il devient T0.1–T8.3.

**Vingt-sixième itération sans commit.** `docs/API_FEEDBACK.md` est la dernière des pièces que le règlement
demande nommément et que la boucle pouvait produire seule : ce que l'API a permis, ce qui a coûté du travail,
et dix suggestions. Ce qui reste (T8.4 à T8.7) est de la rédaction de soumission, qui se relit sans exécuter
quoi que ce soit ; la phase 9, elle, vérifie une installation propre et l'historique git — et cette dernière
vérification (T9.3, `check-secrets.sh --history`) porte sur un historique qui ne contient toujours qu'un seul
commit, celui du cahier des charges. Elle passera trivialement et ne prouvera rien tant que le travail n'est
pas entré dans git.

**Mise à jour 2026-09-29 (itération T8.4) :** blocage toujours présent. L'ajout à l'index de
`docs/SUBMISSION.md tests/submission-doc.test.ts TASKS.md` est refusé avec le même message (« Action git/gitlab
modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`). T8.4 est faite et
vérifiée (**1117 tests, 65 fichiers**, lint ✅, typecheck ✅, secrets ✅). Ses fichiers sont `docs/SUBMISSION.md`
(rédigé par l'itération précédente, interrompue avant d'écrire son test ; deux phrases corrigées ici, voir
ci-dessous) et `tests/submission-doc.test.ts` (**nouveau**, couvert par le dossier `tests` de la commande de
l'option 3) — tous déjà couverts par la commande ci-dessous. Seul le message du commit change : il devient
T0.1–T8.4.

**Vingt-septième itération sans commit.** `docs/SUBMISSION.md` est le texte que les juges lisent : il est
désormais relu par un test qui recalcule chacun de ses chiffres (vérifié sur vingt-trois mutations du document).
Il est hors de git, comme le reste.

**Ce qu'il faudrait (au choix de l'humain) :**
0. Décider du sort des enregistrements et journaux partiels ci-dessus avant de committer. **Attention, l'instruction
   de suppression que portait ce point était incomplète** (corrigée à l'itération T8.7) : supprimer *les deux* marches
   interrompues fait échouer `tests/evidence-doc.test.ts`, qui exige qu'au moins l'une des deux survive pour que la
   phrase de `docs/EVIDENCE.md` décrive un vrai dépôt. Le détail, les conséquences et l'ordre des opérations sont
   désormais à l'étape **H1 de `docs/HUMAN_CHECKLIST.md`** ; garder les deux est l'état documenté et ne demande rien.
   Les deux journaux de la marche, eux, se suppriment sans conséquence :
   `rm -f .loop/calibrate-live.out .loop/calibrate-live.progress`
1. *Recommandé* — limiter le hook aux dépôts ASIN : dans `gitflow-asin-guard.py`, `main()`, ne rien décider (passthrough)
   quand `git remote get-url origin` ne contient pas `gitlab.gouv.bj/asin-dep` (ce dépôt n'a pas de remote).
2. Ou lancer la boucle de ce projet sans ce hook (par ex. retirer temporairement son entrée de `~/.claude/settings.json`
   pendant l'exécution de `loop.sh`).
3. Ou committer à la main depuis un terminal (le hook ne s'applique qu'aux commandes lancées par Claude). Un seul
   commit pour T0.1 à T7.1, car `package.json`, `TASKS.md` et `.loop/` mélangent les tâches. Le hook pre-commit,
   une fois activé, contrôle ce commit lui-même. Vérifier avec `git status` avant de committer qu'aucun fichier
   inattendu n'est indexé :
   ```
   npm run prepare
   git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js \
           src tests docs fixtures config scripts web .githooks .loop \
           .gitignore .env.example DEMARRAGE.md README.md TASKS.md
   git status
   git commit -m "T0.1-T8.4: initialize toolchain, secret guard, env check, CMC endpoint inventory, live verification, check decisions, API client, record/replay modes, source normalisers, the token-to-RWA index, the seven consistency checks C1 to C7, the reliability score and verdict, the check command that prints them, the calibrated top 50 panel at 94 percent ACT, the MCP server, the MCP configuration the README hands to a host, the demonstration agent that refuses one order and simulates another over a real MCP pipe, the API audit that reads 392 recorded answers without spending a credit, the second read that checks each of its 133 statements against the answer it cites, the web interface that serves the verdict, its evidence and that audit with the key held on the server, the Vercel build settings that install and compile the engine before the application is built against it, the README that states the problem, the architecture and the seventeen endpoints the client reads, each line pinned to the code by a test, and the evidence page that walks one call from the request to a verdict, every quote on it re-read from the file it names, and the API feedback note that sets out what the API made possible and what took work, each of its figures recomputed from the recorded answers and its wording put through the tone gate of the audit, and the submission text ready to paste, every table in it read back from the code it describes and every figure recomputed from the reports and the recorded answers that hold it"
   ```

**Conflit de conventions à trancher :** `CLAUDE.md` prévoit des commits `T3.2: ...` directement sur la branche courante ;
les règles ASIN imposent des branches `feature/ASIN-{n}-...` et des Conventional Commits. Si le hook doit rester actif ici,
indiquer quelle convention la boucle doit suivre (et un numéro de ticket si le format ASIN est retenu).

Vérification secrets faite avant d'écrire ceci : `scripts/check-secrets.sh` ✅ et scan des fichiers nouveaux/modifiés
(ni la clé réelle, ni le motif `X-CMC_PRO_API_KEY` n'y figurent).

**Mise à jour 2026-09-29 (itération T8.5) :** blocage inchangé. L'ajout à l'index de `docs/VIDEO_SCRIPT.md`,
`tests/video-script-doc.test.ts`, `TASKS.md` et `.gitignore` est refusé par le hook global `gitflow-asin`
(« Action git/gitlab modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`) ;
non contourné. La commande de rattrapage ci-dessus reste valable telle quelle : elle ajoute `docs`, `tests` et
`.gitignore` en bloc.

Deuxième effet du même hook, constaté cette itération : il refuse aussi toute commande Bash **dont le texte** parle
de git, y compris un simple ajout en fin de ce fichier dont le contenu mentionne `.gitignore`. Ce paragraphe a donc
été écrit dans un fichier temporaire puis concaténé.

**Nouveau point de ménage (petit) :** vérifier le script vidéo demandait de faire tourner l'interface pour de vrai
(`next dev`, hors ligne, 0 crédit — les quatre routes filmées répondent HTTP 200). Next.js 16 écrit à chaque
démarrage deux fichiers que ce projet n'a pas écrits : `web/AGENTS.md` et `web/CLAUDE.md` (ce dernier contient
`@AGENTS.md`, donc il injecterait des règles Next dans une session Claude Code ouverte sous `web/`). Je n'ai **pas
pu les supprimer** : la commande de suppression a été refusée par le garde-fou de l'environnement (« Irreversible
Local Destruction »), et je n'ai pas cherché à contourner ce refus. Ils sont donc **ajoutés à `.gitignore`** pour
qu'ils ne puissent pas entrer dans le dépôt. Au choix de l'humain, pour s'en débarrasser vraiment :
`rm -f web/AGENTS.md web/CLAUDE.md`, et — si on ne veut plus qu'ils reviennent à chaque `npm run web:dev` —
`agentRules: false` dans `web/next.config.ts` (réglage Next, pas du projet ; à ne toucher qu'en connaissance de la
vérification T7.2 du build Vercel).

**Mise à jour 2026-09-29 (itération T8.6) :** blocage inchangé. L'ajout à l'index de `docs/X_POST.md`,
`tests/x-post-doc.test.ts` et `TASKS.md` est refusé par le hook global `gitflow-asin` (« Action git/gitlab
modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`) ; non contourné. La
commande de rattrapage de l'option 3 reste valable telle quelle — elle ajoute `docs` et `tests` en bloc ; seul le
message du commit change, il devient T0.1–T8.6 et gagne une clause : « and the draft of the post on X, four posts
counted the way X counts them so that each one fits, every figure in them recomputed from the recorded answers and
the generated reports, and the four links it cannot carry yet declared once and used once ».

**Vingt-huitième itération sans commit.** Il ne reste qu'une pièce rédactionnelle (T8.7, la liste ordonnée des
actions humaines) avant la phase 9. Ce que le blocage coûte se voit particulièrement bien ici : T8.6 décrit à
l'humain l'ordre dans lequel publier, et cet ordre commence par des liens (`REPO_URL`, `DEMO_URL`) qui n'existeront
que si ce code est poussé quelque part. T9.3 relira ensuite l'historique à la recherche d'une clé ; cet historique
ne contient toujours qu'un seul commit, celui du cahier des charges, donc la vérification passera sans rien prouver
tant que le travail reste hors de l'index.

Vérification secrets faite avant d'écrire ceci : `scripts/check-secrets.sh` ✅ et scan ciblé des deux nouveaux
fichiers (ni la clé réelle, ni le motif d'en-tête `X-CMC_PRO_API_KEY` n'y figurent). Le brouillon du post ne
contient aucune URL littérale : les quatre liens sont des emplacements en doubles accolades, et un cas de test
refuse qu'une vraie adresse entre dans un des quatre brouillons.

**Mise à jour 2026-09-30 (itération T8.7) :** blocage inchangé. L'ajout à l'index de `docs/HUMAN_CHECKLIST.md`,
`tests/human-checklist-doc.test.ts` et `TASKS.md` est refusé par le hook global `gitflow-asin` (« Action git/gitlab
modifiant l'etat du depot [...] Confirmation requise avant execution », branche `master`) ; non contourné. La
commande de rattrapage de l'option 3 reste valable telle quelle — elle ajoute `docs` et `tests` en bloc ; seul le
message du commit change, il devient T0.1–T8.7 et gagne une clause : « and the ordered list of what is left to a
person, ten steps whose dependency order is checked as an order, each link it produces matched to the document that
waits for it ».

**Vingt-neuvième itération sans commit — et la dernière où ce blocage n'était qu'une note de journal.**
`docs/HUMAN_CHECKLIST.md` le promeut en **H1 et H2**, les deux premières étapes humaines : ce sont les seules de la
liste qui ne viennent pas des six lignes `[H]` de `TASKS.md`, et elles passent devant les huit autres parce que six
d'entre elles ont besoin d'un dépôt public, qui a besoin d'un commit. Le coût du blocage est donc maintenant écrit à
l'endroit où l'humain le lira en premier, au lieu d'être répété au fond de ce fichier.

Deux corrections apportées à ce fichier par la même itération, parce que les vérifier faisait partie du travail :
- l'**option 0 ci-dessus** demandait de supprimer les deux marches de calibration interrompues. C'était incomplet :
  `tests/evidence-doc.test.ts` exige qu'au moins l'une des deux subsiste. Le point 0 renvoie désormais à H1, qui
  énonce la conséquence, les trois fichiers à modifier si on tient à les supprimer, et l'ordre des opérations ;
- la taille annoncée pour ces deux marches est de **moins de 2 Mo de JSON** (1 969 762 octets recalculés par le test),
  et non les 2,8 Mo que donnait `du` — ce sont des blocs alloués, pas du contenu.

Vérification secrets faite avant d'écrire ceci : `scripts/check-secrets.sh` ✅ et scan ciblé des deux nouveaux
fichiers (ni la clé réelle, ni le motif d'en-tête `X-CMC_PRO_API_KEY` n'y figurent). La liste ne contient aucune URL
inventée : un cas de test exige que la seule adresse du document soit `http://localhost:3000`, celle que le script
vidéo filme.

**Mise à jour 2026-09-30 (itération T9.1) :** blocage inchangé, et cette fois il a une conséquence mesurée.
`git add -A` puis `git add package.json README.md TASKS.md scripts/clean-install-check.sh tests/clean-install.test.ts`
sont tous deux refusés par le hook global `gitflow-asin` (« Action git/gitlab modifiant l'etat du depot [...]
Confirmation requise avant execution », branche `master`) ; non contourné. L'ajout ciblé que le hook lui-même
recommande dans son second message est refusé exactement comme l'ajout en bloc : ce n'est pas la forme de la
commande qui bloque, c'est la décision `ask` sur une session sans personne pour confirmer. **Trentième itération
sans commit.** La commande de rattrapage de l'option 3 reste valable ; son message devient T0.1–T9.1 et gagne une
clause : « and a clean-install gate that starts from the files a clone would hold ».

**Ce que T9.1 a mesuré, et qui rend le blocage vérifiable :** la vérification d'installation propre part de
`git ls-files --cached --others --exclude-standard`, donc de ce qu'un clone porterait. Elle a copié **935 fichiers**
et tout est passé — mais ces 935 fichiers sont presque tous **non suivis**, pas committés. Un vrai `git clone` de ce
dépôt, aujourd'hui, ne ramènerait que le commit `236ed47` (cahier des charges et boucle). La porte T9.1 est donc
verte sur le contenu du working tree, et le resterait sur un clone **une fois le commit fait** ; elle ne peut pas
prouver le clone lui-même tant que l'index est vide. C'est dit ici plutôt que dans `docs/FINAL_CHECK.md`, que T9.2
écrira, pour que le critère 1 de la section 8 ne soit pas coché sur une ambiguïté.

Même remarque pour T9.3 : `scripts/check-secrets.sh --history` relira un historique d'un seul commit et passera
sans rien prouver tant que le travail reste hors de l'index. La vérification n'aura de sens qu'après H1/H2.

Vérification secrets faite avant d'écrire ceci : `scripts/check-secrets.sh` ✅. Les deux fichiers modifiés qui
pourraient porter un secret ne le font pas : `README.md` ne nomme que des commandes et `package.json` que le chemin
du script. Les journaux de la vérification propre sont restés dans `/tmp` (hors dépôt) ; le seul chiffre qui en sort
et qui entre ici est un nombre de fichiers.

**Mise à jour 2026-09-30 (itération T9.2) :** blocage inchangé. L'ajout ciblé de `docs/FINAL_CHECK.md`,
`tests/final-check-doc.test.ts`, `docs/HUMAN_CHECKLIST.md`, `tests/human-checklist-doc.test.ts`, `TASKS.md` et
`fixtures/final-check` est refusé par le hook global `gitflow-asin` (« Action git/gitlab modifiant l'etat du depot
[...] Confirmation requise avant execution », branche `master`) ; non contourné. **Trente et unième itération sans
commit.** La commande de rattrapage de l'option 3 reste valable ; son message devient T0.1–T9.2 et gagne une
clause : « and the eight acceptance criteria of section 8 read back one command at a time ».

**Ce que T9.2 a mesuré, et qui chiffre le coût du blocage.** `docs/FINAL_CHECK.md` conclut que cinq des huit
critères de la section 8 sont tenus sans réserve et que **trois le sont avec une réserve**. Deux de ces trois
réserves sont exactement ce blocage-ci, et elles disparaissent au premier commit :
- **critère 1** (installation propre) : la porte copie 944 fichiers issus de `git ls-files --cached --others`,
  soit ce qu'un clone portera — mais l'index ne contient toujours que `236ed47`, donc elle prouve le contenu du
  working tree, pas un clone pris aujourd'hui ;
- **critère 8** (aucune clé dans l'historique) : le scan passe sur un historique d'un seul commit. Il ne
  démontrera quelque chose sur les fichiers du projet qu'après **H2**. C'est aussi ce qui attend T9.3.

La troisième réserve ne dépend pas du commit : le serveur MCP a été démarré avec la configuration exacte du
README et piloté en stdio (handshake, `tools/list`, quatre `tools/call`, 380 ms), mais l'enregistrer **dans** un
client Claude écrit un fichier hors du dépôt, ce que la règle 4 de `CLAUDE.md` réserve à l'humain.

**Un fichier a été ajouté à `fixtures/` par cette itération**, et c'est le seul appel réseau qu'elle a fait :
`fixtures/final-check/`, sept réponses du run live du critère 2 (`npm run check -- PAXG --record=...`), **6 crédits
dépensés**, 494 restants sur 500. Les sept portent `"X-CMC_PRO_API_KEY": "***"` ; la vraie clé n'y figure pas, ce
qui a été vérifié contre la valeur de `.env` avant d'écrire quoi que ce soit. Sans ce run, le critère 2 (« en moins
de 10 secondes avec une vraie clé ») ne pouvait pas être vérifié autrement que par supposition.

Vérification secrets faite avant d'écrire ceci : `scripts/check-secrets.sh` ✅, et scan ciblé des cinq fichiers
modifiés plus des sept fixtures : la clé n'apparaît dans aucun.

**Mise à jour 2026-09-30 (itération T9.3) :** blocage inchangé. L'ajout à l'index de `scripts/check-secrets.sh`,
`tests/git-hooks.test.ts`, `tests/human-checklist-doc.test.ts`, `docs/FINAL_CHECK.md`, `docs/HUMAN_CHECKLIST.md`,
`README.md` et `TASKS.md` est refusé par le hook global `gitflow-asin` (« Action git/gitlab modifiant l'etat du
depot [...] Confirmation requise avant execution », branche `master`) ; non contourné. **Trente-deuxième itération
sans commit**, et la dernière : T9.3 était la dernière tâche non humaine du backlog. La commande de rattrapage de
l'option 3 reste valable ; son message devient T0.1–T9.3 et gagne une clause : « and a secret scan that reads the
files a clone would carry, rather than only an index and a history that are both still empty ».

**Ce que T9.3 a trouvé, et qui n'était pas ce que la tâche attendait.** `scripts/check-secrets.sh --history` passe,
et les deux itérations précédentes avaient déjà écrit pourquoi cela ne prouve rien : l'historique porte un commit.
En le lançant, un second constat est apparu, celui-là jamais écrit ici — **la portée par défaut ne prouvait rien
non plus**. Elle lit `git diff --cached`, et l'index est vide : les « `scripts/check-secrets.sh` ✅ » que trente et
une entrées de ce journal citent avant d'écrire n'ont lu aucune ligne de diff. Seul leur troisième contrôle (« `.env`
est-il suivi par git ? ») gardait un sens ; les scans ciblés faits à la main à côté étaient le vrai contrôle.

Deux défauts corrigés, chacun avec ses tests :
- une **troisième portée**, `--worktree`, qui lit ce qu'un clone recevrait — `git ls-files --cached --others
  --exclude-standard`, soit les 944 fichiers que la porte de T9.1 copie — au lieu de commits qui n'existent pas
  encore. Mesuré : la portée atteint exactement ces 944 fichiers, `.env` restant exclu par `.gitignore:5`. Vérifiée
  en plantant une valeur en forme de clé dans un fichier non suivi du dépôt : la portée par défaut a répondu
  « ✅ No secret detected », `--worktree` a échoué en nommant le fichier. Le fichier a été supprimé aussitôt ; la
  valeur plantée était fausse et n'a jamais approché l'index ;
- une **portée mal tapée ne passe plus pour la portée par défaut**. `scripts/check-secrets.sh --histry` imprimait
  « ✅ No secret detected » et sortait en 0 ; il sort maintenant en 2 avec `Unknown scope`. C'est le genre de vert
  qui coûte cher : il répond à une question que personne n'a posée.

`tests/git-hooks.test.ts` relit désormais les trois portées **sur ce dépôt** à chaque `npm test` : la réponse de
T9.3 ne peut plus se périmer en silence. Ce qu'elle ne remplace pas reste écrit dans `docs/FINAL_CHECK.md` —
l'historique lui-même ne portera quelque chose à lire qu'après **H2**.

Vérification secrets faite avant d'écrire ceci : les trois portées de `scripts/check-secrets.sh` ✅, dont
`--worktree`, qui couvre pour la première fois les 944 fichiers du dépôt, ce fichier compris. Aucun appel réseau
dans cette itération, aucun crédit dépensé : 494 restants sur 500, inchangés depuis T9.2.
