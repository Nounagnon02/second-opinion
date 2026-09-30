#!/usr/bin/env bash
# Boucle de vérification avant soumission.
# À chaque itération : contrôles mécaniques (presubmit.sh), puis une session Claude Code qui corrige UN problème.
# Arrêt : .loop/READY présent ET presubmit.sh vert (vérifié ici, pas sur parole), blocage, ou limite atteinte.
set -uo pipefail

MAX_ITER="${MAX_ITER:-25}"
MAX_TURNS="${MAX_TURNS:-60}"
STALL_LIMIT="${STALL_LIMIT:-3}"
MODEL="${MODEL:-}"
PERMISSION_FLAGS="${PERMISSION_FLAGS:---dangerously-skip-permissions}"

cd "$(dirname "$0")"
mkdir -p .loop/logs .verify
command -v claude >/dev/null || { echo "Commande 'claude' introuvable."; exit 1; }

if [[ "$PERMISSION_FLAGS" == *dangerously* && "${SANDBOXED:-0}" != "1" ]]; then
  echo "⚠️  Mode sans permissions hors bac à sable. Utilisez SANDBOXED=1 dans un conteneur, ou PERMISSION_FLAGS=\"--permission-mode auto\"."
  exit 1
fi

git add scripts/presubmit.sh VERIFY_PROMPT.md VERIFY_CHECKLIST.md verify-loop.sh 2>/dev/null
git diff --cached --quiet || git commit -qm "chore: add pre-submission verification loop"

guard() { sha1sum scripts/presubmit.sh VERIFY_PROMPT.md verify-loop.sh | sha1sum | cut -d" " -f1; }
GUARD="$(guard)"
state() { cat VERIFY_CHECKLIST.md .verify/report.txt 2>/dev/null | sha1sum | cut -d" " -f1; }
trap 'echo; echo "Interrompu. Relancez ./verify-loop.sh pour reprendre."; exit 130' INT
stall=0

for ((i=1; i<=MAX_ITER; i++)); do
  echo "▶ Itération $i/$MAX_ITER — $(date '+%F %T')"
  scripts/presubmit.sh > .verify/presubmit.log 2>&1
  ok=$?
  grep -E '^(FAIL|RESULT)' .verify/report.txt | sed 's/^/  /'

  if [ $ok -eq 0 ] && [ -f .loop/READY ]; then
    echo "✅ Prêt à soumettre. Lisez docs/SUBMISSION_READINESS.md puis docs/HUMAN_CHECKLIST.md."
    exit 0
  fi
  [ -f .loop/READY ] && [ $ok -ne 0 ] && { echo "  READY présent mais presubmit échoue : READY supprimé."; rm -f .loop/READY; }

  before="$(state)"
  args=(-p "$(cat VERIFY_PROMPT.md)" --max-turns "$MAX_TURNS")
  [ -n "$MODEL" ] && args+=(--model "$MODEL")
  # shellcheck disable=SC2206
  args+=($PERMISSION_FLAGS)
  log=".loop/logs/verify-$(printf '%03d' "$i").log"
  claude "${args[@]}" > "$log" 2>&1 || { echo "  ⚠️  Session en échec, pause 60 s."; tail -n 5 "$log"; sleep 60; }

  if [ "$(guard)" != "$GUARD" ]; then
    echo "  ⛔ Fichiers de contrôle modifiés par la session : restauration."
    git checkout -- scripts/presubmit.sh VERIFY_PROMPT.md verify-loop.sh
    git commit -qam "verify: restore protected verification files" || true
  fi

  scripts/presubmit.sh > .verify/presubmit.log 2>&1
  if [ "$(state)" == "$before" ]; then
    stall=$((stall+1)); echo "  Aucun progrès ($stall/$STALL_LIMIT)."
    (( stall >= STALL_LIMIT )) && { echo "⛔ Bloqué. Voir .loop/BLOCKED.md, .verify/report.txt et $log"; exit 2; }
  else
    stall=0
    echo "  Checklist : $(grep -c '^- \[x\]' VERIFY_CHECKLIST.md) faites, $(grep -c '^- \[ \]' VERIFY_CHECKLIST.md) restantes, $(grep -c '^- \[!\]' VERIFY_CHECKLIST.md) bloquées."
  fi
done
echo "Limite d'itérations atteinte. Relancez ./verify-loop.sh pour continuer."
