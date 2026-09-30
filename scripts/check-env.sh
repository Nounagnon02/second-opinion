#!/usr/bin/env bash
# Checks that .env provides a CMC API key, without ever printing it. Usage: scripts/check-env.sh
# Passes when CMC_API_KEY is defined once, optionally quoted, as 32 hex digits or a UUID
# (the key shapes scripts/check-secrets.sh guards). Only a real API call proves the key is valid.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "❌ $1" >&2
  exit 1
}

[ -f .env ] || fail ".env not found: copy .env.example to .env, then set CMC_API_KEY."

count="$(grep -cE '^CMC_API_KEY=' .env || true)"
[ "$count" -gt 0 ] || fail "CMC_API_KEY is not defined in .env."
[ "$count" -eq 1 ] || fail "CMC_API_KEY is defined $count times in .env: keep a single line."

KEY="$(grep -E '^CMC_API_KEY=' .env | cut -d= -f2- | tr -d "\"'\r")"
[ -n "$KEY" ] || fail "CMC_API_KEY is empty in .env."
if ! grep -qiE '^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' <<< "$KEY"; then
  fail "CMC_API_KEY has an unexpected format (${#KEY} characters; expected 32 hex digits or a UUID)."
fi

echo "✅ CMC_API_KEY is set in .env (${#KEY} characters)."
