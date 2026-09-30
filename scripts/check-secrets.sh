#!/usr/bin/env bash
# Fails when the CMC API key would be committed. Usage: scripts/check-secrets.sh [--history|--worktree]
#   (default)   scans the staged changes; this is what the pre-commit hook runs.
#   --history   scans every commit of every branch.
#   --worktree  scans every file a clone would carry: tracked plus untracked, ignored files left out.
#               This is the scope with something to read before the work is committed. An empty index makes
#               the default scan read nothing, and a one-commit history makes --history read nothing either;
#               both then print a clean result that says more about the scope than about the files.
# Detects the key configured in .env, plus any key-shaped value (32 hex digits, or a UUID)
# assigned to a CMC key name (request header, query parameter or env variable, any case),
# and a tracked .env file.
set -euo pipefail

usage="Usage: scripts/check-secrets.sh [--history|--worktree]"
if [ "$#" -gt 1 ]; then
  echo "❌ One scope at a time. $usage" >&2
  exit 2
fi
case "${1:-}" in
  '') scope="the staged changes" ;;
  --history) scope="the git history" ;;
  --worktree) scope="the files a clone would carry" ;;
  # A mistyped scope used to fall through to the default one and report a clean scan: that is silence, not an answer.
  *) echo "❌ Unknown scope: $1. $usage" >&2; exit 2 ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  echo "❌ Not inside a git work tree: nothing was scanned." >&2
  exit 1
fi
cd "$root"

KEY=""
[ -f .env ] && KEY="$(grep -E '^CMC_API_KEY=' .env | cut -d= -f2- | tr -d "\"'\r" || true)"
PATTERN='CMC(_PRO)?_API_KEY["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-)'
found=0
# Anything shorter is a placeholder rather than a credential, and matching it would flag every mention of the name.
scannable_key=0
if [ -n "$KEY" ] && [ "${#KEY}" -ge 16 ]; then scannable_key=1; fi

if [ "$scope" == "the files a clone would carry" ]; then
  # The same set scripts/clean-install-check.sh copies, which is what a clone receives. A binary file that matches
  # is reported like any other, --text only keeping the output uniform with the two scopes above; and matching
  # paths are named, because a file list is what someone needs in order to act on a hit.
  matching_files() {
    git --no-pager grep --untracked --no-color --text --files-with-matches "$@" || true
  }
  if [ "$scannable_key" -eq 1 ]; then
    hits="$(matching_files -F -e "$KEY")"
    if [ -n "$hits" ]; then
      echo "❌ The real CMC API key appears in $scope:"; sed 's/^/   /' <<< "$hits"; found=1
    fi
  fi
  hits="$(matching_files -iE -e "$PATTERN")"
  if [ -n "$hits" ]; then
    echo "❌ API key pattern detected in $scope:"; sed 's/^/   /' <<< "$hits"; found=1
  fi
else
  # Raw, uncoloured patches, binary files included, whatever the user's git config says.
  if [ "$scope" == "the git history" ]; then
    content="$(git log -p --all --no-color --no-ext-diff --text)"
  else
    content="$(git diff --cached --no-color --no-ext-diff --text)"
  fi
  if [ "$scannable_key" -eq 1 ] && grep -qF -- "$KEY" <<< "$content"; then
    echo "❌ The real CMC API key appears in $scope."; found=1
  fi
  if grep -qiE "$PATTERN" <<< "$content"; then
    echo "❌ API key pattern detected in $scope."; found=1
  fi
fi

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "❌ .env is tracked by git."; found=1
fi

[ "$found" -eq 0 ] && echo "✅ No secret detected." || exit 1
