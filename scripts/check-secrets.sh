#!/usr/bin/env bash
# Refuse tout commit contenant la clé CMC. Usage : scripts/check-secrets.sh [--history]
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$0"/..)"

KEY=""
[ -f .env ] && KEY="$(grep -E '^CMC_API_KEY=' .env | cut -d= -f2- | tr -d '"' || true)"
PATTERN='X-CMC_PRO_API_KEY["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[0-9a-f]{8}-[0-9a-f]{4}-'
found=0

if [ "${1:-}" == "--history" ]; then
  content="$(git log -p --all 2>/dev/null || true)"
else
  content="$(git diff --cached 2>/dev/null || true)"
fi

if [ -n "$KEY" ] && [ "${#KEY}" -ge 16 ] && grep -qF "$KEY" <<< "$content"; then
  echo "❌ La vraie clé CMC apparaît dans ${1:-les changements indexés}."; found=1
fi
if grep -qE "$PATTERN" <<< "$content"; then
  echo "❌ Motif de clé API détecté."; found=1
fi
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "❌ .env est suivi par git."; found=1
fi

[ "$found" -eq 0 ] && echo "✅ Aucun secret détecté." || exit 1
