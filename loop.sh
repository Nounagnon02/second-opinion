#!/usr/bin/env bash
# Boucle autonome Claude Code pour Second Opinion.
# Chaque itération lance une session headless neuve qui traite UNE tâche de TASKS.md.
# Arrêt : fichier .loop/DONE créé, nombre max d'itérations atteint, ou blocage détecté.
set -uo pipefail

MAX_ITER="${MAX_ITER:-60}"          # nombre maximal d'itérations
MAX_TURNS="${MAX_TURNS:-80}"        # tours d'agent max par itération
STALL_LIMIT="${STALL_LIMIT:-3}"     # itérations consécutives sans progrès avant arrêt
PAUSE="${PAUSE:-5}"                 # secondes entre itérations
MODEL="${MODEL:-}"                  # ex. MODEL=opus ; vide = modèle par défaut
# Mode de permission. Par défaut : contournement total, à n'utiliser QUE dans un conteneur/VM jetable.
# Alternative plus sûre si votre version la propose : PERMISSION_FLAGS="--permission-mode auto"
PERMISSION_FLAGS="${PERMISSION_FLAGS:---dangerously-skip-permissions}"

cd "$(dirname "$0")"
mkdir -p .loop/logs

command -v claude >/dev/null || { echo "Claude Code (commande 'claude') introuvable."; exit 1; }
[ -f PROMPT.md ] && [ -f TASKS.md ] || { echo "PROMPT.md ou TASKS.md manquant."; exit 1; }

if [[ "$PERMISSION_FLAGS" == *dangerously* && "${SANDBOXED:-0}" != "1" ]]; then
  echo "⚠️  Mode sans permissions demandé hors bac à sable."
  echo "   Lancez dans un conteneur/VM jetable puis relancez avec SANDBOXED=1,"
  echo "   ou utilisez PERMISSION_FLAGS=\"--permission-mode auto\"."
  exit 1
fi

[ -d .git ] || { git init -q && git add -A && git commit -qm "chore: initial spec and loop" ; }

trap 'echo; echo "Interrompu. Relancez ./loop.sh pour reprendre."; exit 130' INT

tasks_hash() { sha1sum TASKS.md | cut -d" " -f1; }
stall=0

for ((i=1; i<=MAX_ITER; i++)); do
  if [ -f .loop/DONE ]; then
    echo "✅ Travail terminé. Résumé :"; cat .loop/DONE; exit 0
  fi

  before="$(tasks_hash)"
  log=".loop/logs/iter-$(printf '%03d' "$i").log"
  echo "▶ Itération $i/$MAX_ITER — $(date '+%F %T') — log : $log"

  args=(-p "$(cat PROMPT.md)" --max-turns "$MAX_TURNS")
  [ -n "$MODEL" ] && args+=(--model "$MODEL")
  # shellcheck disable=SC2206
  args+=($PERMISSION_FLAGS)

  if ! claude "${args[@]}" > "$log" 2>&1; then
    echo "  ⚠️  La session a échoué (quota, réseau ?). Pause de 60 s puis nouvel essai."
    tail -n 5 "$log"
    sleep 60
  fi

  after="$(tasks_hash)"
  if [ "$before" == "$after" ]; then
    stall=$((stall+1))
    echo "  Aucune progression dans TASKS.md ($stall/$STALL_LIMIT)."
    if (( stall >= STALL_LIMIT )); then
      echo "⛔ Boucle bloquée. Consultez .loop/BLOCKED.md et le dernier log."
      exit 2
    fi
  else
    stall=0
    echo "  Progrès : $(grep -c '^- \[x\]' TASKS.md) tâches faites, $(grep -c '^- \[ \]' TASKS.md) restantes, $(grep -c '^- \[!\]' TASKS.md) bloquées."
  fi
  sleep "$PAUSE"
done

echo "Nombre maximal d'itérations atteint ($MAX_ITER). Relancez ./loop.sh pour continuer."
