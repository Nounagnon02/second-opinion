#!/usr/bin/env bash
# Enables the versioned git hooks in .githooks/ for this clone. Run automatically by `npm install` (prepare).
# Does nothing outside a git work tree, or when the project is nested inside another repository.
set -euo pipefail
cd "$(dirname "$0")/.."
here="$(pwd -P)"

top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$here" ]; then
  echo "Not the root of a git work tree: git hooks not installed."
  exit 0
fi

git config core.hooksPath .githooks
echo "✅ Git hooks enabled (core.hooksPath=.githooks)."
