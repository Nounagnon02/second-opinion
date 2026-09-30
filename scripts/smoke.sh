#!/usr/bin/env bash
# End-to-end smoke tests — VERIFY_CHECKLIST.md, task V0.
#
# What it covers, in the order a reader would meet it:
#   1. the build              dist/ is what every step below runs
#   2. the `check` CLI        two assets that must both come out ACT
#   3. the MCP server         stdio: initialize, tools/list (the four tools), a real check_asset call
#   4. the demonstration      both scenarios: one order refused, one simulated
#   5. the API audit          the recorded corpus re-read, with its two honesty gates asserted
#   6. the web interface      a production build of the Next.js application
#
# Modes. By default every step is replayed out of `fixtures/`: no key, no network, no credit. That is what makes
# this script safe for `scripts/presubmit.sh` to call on every pass, and safe to run in a clean clone. `--live`
# sends the two `check` runs and the MCP call to the real API instead, under a low credit ceiling; it needs
# CMC_API_KEY in the environment or a `.env` beside this repository.
#
# The demonstration and the audit are replayed in both modes: both are defined over answers already captured, and
# neither takes a live switch. The web build never reaches the API.
#
# Exits non-zero at the first failure, printing the tail of that step's output.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

STEPS=7

LIVE=0
case "${1-}" in
  '')     ;;
  --live) LIVE=1 ;;
  *)      echo "Usage: scripts/smoke.sh [--live]" >&2; exit 2 ;;
esac

REPLAY_DIR=fixtures/check
MODE_ARGS=()

if [ "$LIVE" -eq 1 ]; then
  ENV_ARGS=()
  if [ -n "${CMC_API_KEY:-}" ]; then
    :
  elif [ -f .env ] && grep -q '^CMC_API_KEY=' .env; then
    ENV_ARGS=(--env-file=.env)
  else
    echo "--live needs CMC_API_KEY in the environment, or a .env holding it." >&2
    exit 2
  fi
  export CMC_CREDIT_BUDGET="${CMC_CREDIT_BUDGET:-60}"
  NODE_LIVE=(node ${ENV_ARGS[@]+"${ENV_ARGS[@]}"})
  ASSETS=(BTC ETH)
  MODE_LABEL="live against the API, ceiling ${CMC_CREDIT_BUDGET} credits"
else
  MODE_ARGS=(--replay="$REPLAY_DIR")
  # The two `check` runs recorded in fixtures/check are BTC (CMC 1) and PAXG (CMC 4705). ETH was never recorded
  # there, so it is reachable only under --live.
  NODE_LIVE=(env -u CMC_API_KEY node)
  ASSETS=(BTC PAXG)
  MODE_LABEL="replayed from ${REPLAY_DIR}, no key and no network"
fi

# The demonstration and the audit never reach the API, in either mode. Removing the key proves it rather than
# trusting it: a step that tried to call out would fail here instead of quietly spending someone's credits.
NODE_OFFLINE=(env -u CMC_API_KEY node)

LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

step=0
run() {  # run <name> <function> [args...]
  step=$((step + 1))
  local name="$1" fn="$2" log="$LOGS/step${step}.log"
  shift 2
  printf '%d/%d  %-44s ' "$step" "$STEPS" "$name"
  if "$fn" "$@" >"$log" 2>&1; then
    echo 'OK'
  else
    echo 'FAIL'
    { echo; echo "--- ${name}: last 30 lines ---"; tail -30 "$log"; } >&2
    exit 1
  fi
}

smoke_build() { npm run -s build; }

smoke_check() {
  local asset="$1" out
  out="$("${NODE_LIVE[@]}" dist/cli/check.js "$asset" ${MODE_ARGS[@]+"${MODE_ARGS[@]}"} 2>&1)" || {
    printf '%s\n' "$out"
    return 1
  }
  printf '%s\n' "$out"
  if ! grep -qE '^ACT: ' <<<"$out"; then
    echo "expected an ACT verdict for ${asset}; the verdict line was:"
    grep -m1 -E '^(ACT|CAUTION|DO_NOT_ACT)' <<<"$out" || echo '(no verdict line at all)'
    return 1
  fi
}

smoke_mcp() {
  local out tool
  out="$(printf '%s\n%s\n%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_asset","arguments":{"asset":"BTC"}}}' \
    | timeout 120 "${NODE_LIVE[@]}" dist/mcp/server.js ${MODE_ARGS[@]+"${MODE_ARGS[@]}"} 2>/dev/null)"
  printf '%s\n' "$out"
  for tool in check_asset check_rwa_token preflight_trade explain; do
    if ! grep -q "\"name\":\"${tool}\"" <<<"$out"; then
      echo "tools/list does not offer ${tool}"
      return 1
    fi
  done
  if grep -q '"isError":true' <<<"$out"; then
    echo 'the check_asset call came back as an error'
    return 1
  fi
  if ! grep -q 'ACT — BTC' <<<"$out"; then
    echo 'check_asset did not answer ACT for BTC over the pipe'
    return 1
  fi
}

smoke_demo() {
  local out
  out="$("${NODE_OFFLINE[@]}" dist/demo/run.js 2>&1)" || { printf '%s\n' "$out"; return 1; }
  printf '%s\n' "$out"
  if ! grep -q 'Order refused:' <<<"$out"; then echo 'no order was refused'; return 1; fi
  if ! grep -q 'Order simulated:' <<<"$out"; then echo 'no order was simulated'; return 1; fi
  if ! grep -qF '2 scenario(s): 1 refused, 1 simulated' <<<"$out"; then
    echo 'the two scenarios did not both reach a decision'
    return 1
  fi
}

smoke_audit() {
  local out
  out="$("${NODE_OFFLINE[@]}" dist/cli/audit.js 2>&1)" || { printf '%s\n' "$out"; return 1; }
  printf '%s\n' "$out"
  # The gates of F9 and T6.2: a statement with no answer behind it, or an entry whose re-read did not hold, must
  # never be printed. A non-zero count means the report is claiming more than it can show.
  if ! grep -qE 'Statements withheld for citing no answer \(F9\) \| 0' <<<"$out"; then
    echo 'the audit withheld a statement for citing no answer, or stopped reporting that count'
    return 1
  fi
  if ! grep -qE 'Printed entries whose re-read did not hold \| 0' <<<"$out"; then
    echo 'an audit entry did not survive its own re-read'
    return 1
  fi
}

smoke_web() {
  [ -d web/node_modules ] || npm run -s web:install || return 1
  env -u CMC_API_KEY npm run -s web:build
}

echo "Second Opinion — smoke tests (${MODE_LABEL})"
echo

run 'build'                                smoke_build
run "check ${ASSETS[0]} (expects ACT)"     smoke_check "${ASSETS[0]}"
run "check ${ASSETS[1]} (expects ACT)"     smoke_check "${ASSETS[1]}"
run 'MCP over stdio: 4 tools, check_asset' smoke_mcp
run 'demonstration agent: both scenarios'  smoke_demo
run 'API audit over the recorded corpus'   smoke_audit
run 'web interface: production build'      smoke_web

echo
echo "All ${STEPS} steps passed (${MODE_LABEL})."
