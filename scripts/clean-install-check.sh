#!/usr/bin/env bash
# Verifies that a fresh checkout of this repository works on a clean machine (T9.1).
# Usage: scripts/clean-install-check.sh [--keep] [--with-web]
#        npm run check:clean -- [--keep] [--with-web]
#
# Copies the repository-visible files — tracked plus untracked, with .gitignore applied — into a
# temporary directory, so node_modules/, dist/, .cache/ and .env stay behind. Then, in that copy:
# npm install, npm run build, npm run lint, npm run typecheck, npm test, and finally the offline
# quick start the README promises, which has to answer with no key and no network.
#   --keep      leaves the temporary directory in place instead of deleting it.
#   --with-web  also installs and builds web/, the Next.js application (its own package).
set -euo pipefail
cd "$(dirname "$0")/.."

keep=0
with_web=0
for arg in "$@"; do
  case "$arg" in
    --keep) keep=1 ;;
    --with-web) with_web=1 ;;
    *) echo "❌ Unknown option: $arg (expected --keep or --with-web)." >&2; exit 2 ;;
  esac
done

fail() {
  echo "❌ $1" >&2
  exit 1
}

# The file list comes from git, so the copy holds exactly what a clone would hold.
here="$(pwd -P)"
top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$top" ] || fail "Not inside a git work tree: the file list cannot be established."
[ "$(cd "$top" && pwd -P)" = "$here" ] || fail "Not the root of the git work tree: run this script from the project root."

dest="$(mktemp -d "${TMPDIR:-/tmp}/second-opinion-clean.XXXXXXXX")"
cleanup() {
  if [ "$keep" -eq 1 ]; then
    echo "Temporary directory kept: $dest"
  else
    rm -rf "$dest"
  fi
}
trap cleanup EXIT

echo "== Copying the repository-visible files into $dest"
git ls-files -z --cached --others --exclude-standard | tar --null --files-from=- -cf - | tar -xf - -C "$dest"
files="$(find "$dest" -type f | wc -l)"
echo "   $files files copied."

# What must not have travelled: the key, and everything a clean machine builds for itself.
for absent in .env node_modules dist .cache .git; do
  [ ! -e "$dest/$absent" ] || fail "$absent reached the copy: it is not what a clone would hold."
done
# What must have travelled, because the offline gates read it.
for present in package.json package-lock.json fixtures config/checks.json tests src; do
  [ -e "$dest/$present" ] || fail "$present is missing from the copy: the gates cannot run without it."
done

run() {
  echo
  echo "== $*"
  ( cd "$dest" && "$@" ) || fail "\`$*\` failed in the clean copy."
}

run npm install
run npm run build
run npm run lint
run npm run typecheck
run npm test

# The README quick start, offline: no .env in the copy, so these prove the replay path needs no key.
run npm run check -- PAXG --replay=fixtures/check
run npm run demo

if [ "$with_web" -eq 1 ]; then
  run npm run web:install
  run npm run web:lint
  run npm run web:typecheck
  run npm run web:build
fi

echo
echo "✅ Clean install verified in $dest ($files files, no .env, no network key)."
