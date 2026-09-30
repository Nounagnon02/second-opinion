#!/usr/bin/env bash
# Contrôles mécaniques de pré-soumission. NE PAS MODIFIER depuis la boucle (verify-loop.sh vérifie son empreinte).
# Sortie : .verify/report.txt ; code 0 si aucun FAIL.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p .verify
REPORT=.verify/report.txt
: > "$REPORT"
fails=0
pass() { echo "PASS $1 — $2" | tee -a "$REPORT"; }
fail() { echo "FAIL $1 — $2" | tee -a "$REPORT"; fails=$((fails+1)); }
warn() { echo "WARN $1 — $2" | tee -a "$REPORT"; }

# S1 Fichiers requis non vides
for f in README.md docs/ENDPOINTS.md docs/EVIDENCE.md docs/API_FEEDBACK.md docs/API_AUDIT.md \
         docs/CALIBRATION.md docs/SUBMISSION.md docs/VIDEO_SCRIPT.md docs/X_POST.md docs/HUMAN_CHECKLIST.md .env.example; do
  [ -s "$f" ] && pass S1 "$f présent" || fail S1 "$f manquant ou vide"
done
[ -f LICENSE ] && pass S1 "LICENSE présent" || warn S1 "pas de LICENSE (recommandé pour un dépôt public)"

# S2 Secrets
if scripts/check-secrets.sh --history >/dev/null 2>&1; then pass S2 "aucune clé dans l'historique git"; else fail S2 "clé ou .env détecté dans l'historique (scripts/check-secrets.sh --history)"; fi
KEY="$( [ -f .env ] && grep -E '^CMC_API_KEY=' .env | cut -d= -f2- | tr -d '"' || true)"
if [ -n "$KEY" ] && [ "${#KEY}" -ge 16 ] && grep -rqF "$KEY" --exclude=.env --exclude-dir=node_modules --exclude-dir=.git . ; then
  fail S2 "la clé apparaît en clair dans un fichier du dépôt"
else pass S2 "clé absente des fichiers suivis et non suivis"; fi

# S3 Tests non désactivés
if grep -rnE '\b(it|test|describe)\.(skip|only)\(|\bxit\(|\bxdescribe\(' --include=*.ts --include=*.tsx --include=*.js . \
     --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next >/dev/null 2>&1; then
  fail S3 "tests désactivés ou .only trouvés"
else pass S3 "aucun test désactivé"; fi

# S4 Clone propre, sans .env (mode replay)
TMP="$(mktemp -d)"
if git clone -q . "$TMP/repo" 2>/dev/null; then
  (
    cd "$TMP/repo" || exit 1
    unset CMC_API_KEY
    if [ -f package-lock.json ]; then npm ci --silent >/dev/null 2>&1; else npm install --silent >/dev/null 2>&1; fi || { echo install; exit 1; }
    for s in build lint typecheck test; do
      npm run -s "$s" >/dev/null 2>&1 || { echo "$s"; exit 1; }
    done
  ) > "$TMP/out" 2>&1
  if [ $? -eq 0 ]; then pass S4 "clone propre : install, build, lint, typecheck, test OK sans clé"
  else fail S4 "clone propre : échec à l'étape '$(tail -n1 "$TMP/out")'"; fi
else fail S4 "impossible de cloner le dépôt (commits manquants ?)"; fi
rm -rf "$TMP"

# S5 Fichiers non commités
if [ -z "$(git status --porcelain)" ]; then pass S5 "arbre de travail propre"; else warn S5 "changements non commités (le clone S4 ne les inclut pas)"; fi

# S6 Marqueurs non résolus (seuls [[HUMAN: ...]] sont autorisés)
if grep -rnE '\b(TODO|FIXME|TBD|XXX)\b|lorem ipsum|<insert|<your' README.md docs/ >/dev/null 2>&1; then
  fail S6 "marqueurs non résolus dans README/docs : $(grep -rlE '\b(TODO|FIXME|TBD|XXX)\b|lorem ipsum|<insert|<your' README.md docs/ | tr '\n' ' ')"
else pass S6 "aucun marqueur non résolu"; fi
n_h="$(grep -roE '\[\[HUMAN:[^]]*\]\]' README.md docs/ 2>/dev/null | wc -l)"
echo "INFO S6 — $n_h emplacement(s) [[HUMAN: ...]] à compléter à la main" | tee -a "$REPORT"

# S7 Exigences du règlement visibles
grep -qi 'AI Agents and Automation' docs/SUBMISSION.md 2>/dev/null && pass S7 "track indiqué" || fail S7 "track absent de SUBMISSION.md"
grep -q '#BuildwithCMC' docs/X_POST.md 2>/dev/null && pass S7 "hashtag présent" || fail S7 "#BuildwithCMC absent de X_POST.md"
grep -qE '/v[0-9]+/' docs/SUBMISSION.md 2>/dev/null && pass S7 "endpoints nommés dans SUBMISSION.md" || fail S7 "aucun endpoint nommé dans SUBMISSION.md"

# S8 Tests de fumée bout en bout (écrits par la boucle, tâche V0)
if [ -x scripts/smoke.sh ]; then
  if scripts/smoke.sh > .verify/smoke.log 2>&1; then pass S8 "smoke.sh OK"; else fail S8 "smoke.sh échoue (voir .verify/smoke.log)"; fi
else fail S8 "scripts/smoke.sh absent ou non exécutable"; fi

echo "RESULT — $fails échec(s)" | tee -a "$REPORT"
[ "$fails" -eq 0 ]
