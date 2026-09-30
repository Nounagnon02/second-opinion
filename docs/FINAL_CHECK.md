# Final check — the eight acceptance criteria of section 8

Section 8 of `CAHIER_DES_CHARGES.md` lists eight conditions the project has to satisfy before it is submitted.
This file reads each one against a command, and records what that command answered on **2026-09-30**.

Nothing here is an opinion about the project. Every line below is the output of something that was run, and every
command is written out so it can be run again. Where a criterion cannot be settled from inside this repository,
the entry says so and names the step that settles it, rather than reading as met.

`tests/final-check-doc.test.ts` reads this file back against the artefacts it cites: the figures it quotes from
`docs/calibration.json`, `docs/api_audit.json` and `fixtures/final-check/` are recomputed from those files, the
documents it says exist are looked for, and the wording goes through the tone gate of `src/audit/review.ts` like
every other document in `docs/`.

## The result

| # | What section 8 asks | Result | The number that says so |
|---|---|---|---|
| 1 | `npm install && npm run build && npm test` on a clean machine | met, with one reservation | 944 files copied, five gates green, exit 0 |
| 2 | `npm run check -- <symbol>` under ten seconds with a real key | met | read in 2.7 s, 6.50 s end to end, 6 credits |
| 3 | The MCP server works from the configuration the README gives | met, with one reservation | handshake, 4 tools, 4 calls, 380 ms |
| 4 | The calibration of F5 reached and documented | met | 47 of 50 at `ACT`, 94 % against a target of 90 % |
| 5 | The demonstration agent runs both scenarios end to end | met | 2 scenarios, 1 refused, 1 simulated, 0.79 s |
| 6 | One real finding in `docs/API_AUDIT.md`, proven and tactfully put | met | 24 entries, 102 citations, 0 unproven, 0 tone flags |
| 7 | Every document section 7 lists exists and is complete | met | 6 of 6 present, each read back by a test |
| 8 | No key in the git history | met, with one reservation | no secret detected, over one commit and 944 files |

**Five criteria are met outright. Three are met on everything that can be measured from inside this repository,
and each of the three names what is left.** None is unmet. The three reservations reduce to two human steps:
**H1/H2** of `docs/HUMAN_CHECKLIST.md`, which put this work into the git index and a public repository, and the
one-time registration of the server in a Claude client.

## How this was reproduced

```
npm run check:clean                                   # criterion 1
npm run check -- PAXG --record=fixtures/final-check   # criterion 2, live, one real key
node dist/mcp/server.js --replay=fixtures/check       # criterion 3, driven over stdio
node -e '…docs/calibration.json…'                     # criterion 4
node dist/demo/run.js                                 # criterion 5
node -e '…docs/api_audit.json…'                       # criterion 6
scripts/check-secrets.sh --history                    # criterion 8
scripts/check-secrets.sh --worktree                   # criterion 8, over the files a clone would carry
npm run lint && npm run typecheck && npm test         # the gate of CLAUDE.md, criteria 1 and 7
```

Criterion 2 is the only one that reached the network. It spent **6 credits**; every other line above ran offline,
from answers recorded earlier.

---

## 1. `npm install && npm run build && npm test` on a clean machine

`npm run check:clean` (`scripts/clean-install-check.sh`, written for T9.1) builds the file list from
`git ls-files --cached --others --exclude-standard`, so the copy holds what a clone would hold, and nothing a
machine builds for itself.

- **944 files copied** into a temporary directory. `.env`, `node_modules/`, `dist/`, `.cache/` and `.git/` were
  each checked to be absent from the copy; `package.json`, `package-lock.json`, `fixtures/`, `config/checks.json`,
  `tests/` and `src/` were each checked to be present.
- In that copy: `npm install`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` —
  **70 test files, 1258 tests, all passing** — then the two commands the README's quick start promises work with
  no key and no network, `npm run check -- PAXG --replay=fixtures/check` and `npm run demo`. **Exit 0.**

**The reservation.** The index of this repository holds one commit, `236ed47`. The 944 files are almost all
untracked, so this gate proves the content a clone *will* hold once **H2** commits it — not a clone taken today.
The check is the strongest one available before that step, and it is the same check after it.

## 2. `npm run check -- <symbol>` under ten seconds with a real key

One live run, with the key from `.env`, recording every answer:

```
npm run check -- PAXG --record=fixtures/final-check
```

- **Verdict `ACT`, 100 out of 100**, 6 of the 7 checks evaluated, none of them raising an observation, on
  PAXG — PAX Gold — CMC 4705.
- **Read in 2.7 s, within the 10 s budget of D1**, 7 attempts for 7 answers. End to end the command took
  **6.50 s**, which includes the `npm run build` the script runs first: the budget is met with either figure.
- **6 credits charged**, 494 left of the 500 of `CMC_CREDIT_BUDGET`.
- The seven answers are in `fixtures/final-check/`, one file each, from E01, E02, E05, E06, E10, E11 and E14.
  All seven answered **HTTP 200**, with per-answer latencies between **697 ms and 954 ms**, and the run spans
  from `2026-09-30T14:39:17.784Z` to `2026-09-30T14:39:19.633Z`.
- Every one of the seven carries `"X-CMC_PRO_API_KEY": "***"` in its recorded request. The key itself appears in
  none of them, which was checked against the value in `.env` before anything was written here.

## 3. The MCP server works from the configuration the README gives

The server was started with exactly the command and arguments of the second configuration block of the README —
the offline one, so the probe needed no key:

```
node dist/mcp/server.js --replay=fixtures/check
```

and driven over stdio as a client drives it:

- `initialize` answered with `serverInfo` **`second-opinion` 0.1.0** on protocol **2024-11-05**.
- `tools/list` answered with **exactly the four tools of F6**: `check_asset`, `check_rwa_token`,
  `preflight_trade`, `explain`. No fifth, none missing.
- Four `tools/call`, one per tool, all with `isError: false`: `check_asset(BTC)` → `ACT — BTC — Bitcoin — CMC 1`;
  `check_rwa_token(PAXG)` → `ACT — PAXG — PAX Gold — CMC 4705`;
  `preflight_trade(PAXG, buy, 25 000 USD)` → `ACT — PAXG — PAX Gold — CMC 4705`;
  `explain(C4)` → `C4 — Liquidity against reported volume`.
- **380 ms** for the handshake and the four calls together.

**The reservation.** A script driving stdio is not a Claude client. What this settles is the transport, the
handshake, the tool list and the four answers, from the arguments the README publishes. Registering that
configuration inside Claude Desktop or Claude Code writes to a file outside this repository, which rule 4 of
`CLAUDE.md` reserves for a person; it is a one-time paste of the block the README already carries, and
`tests/mcp-config-doc.test.ts` keeps that block in step with the server by booting it.

## 4. The calibration of F5, reached and documented

Recomputed from `docs/calibration.json`, the run `npm run calibrate` wrote:

| | |
|---|---|
| Assets in the panel | 50 |
| `ACT` | 47 |
| `CAUTION` | 3 |
| `DO_NOT_ACT` | 0 |
| Share at `ACT` | **94 %**, against the **90 %** F5 requires |
| `meetsTarget` | `true` |
| Score | min 57.7, median 100, max 100, mean 97, 0 unscored |

`docs/CALIBRATION.md` states the same share, lists every asset of the panel with the checks behind its verdict,
and records which threshold was settled where. The panel was read on `2026-09-26T10:44:11.282Z`.

The second half of T4.2 holds as well: **the engine is not blinded.** Three assets stay below `ACT` — BNB, LEO
and GRAM — each held there by a `warning` or a `critical` on a named check, and
`tests/calibration-doc.test.ts` turns red if a widened limit lets one of them through. A panel at 100 % would
have meant the limits had been opened until nothing could be seen.

## 5. The demonstration agent, both scenarios end to end

`node dist/demo/run.js`, from recorded answers, in **0.79 s**:

- **Scenario 1 — refused.** The instruction to buy 25 000 USD of tokenised gold under the ticker `XAU`.
  `preflight_trade` came back `DO_NOT_ACT`; the agent refused the order and printed why, including the two
  checks it could not measure and the reason each was not measured.
- **Scenario 2 — simulated.** The same instruction under the ticker `PAXG`. `check_rwa_token` and
  `preflight_trade` both came back `ACT`; the order size is 0.15 % of the deepest pool read; the agent
  proceeded, as a simulation.
- Both scenarios call the engine over MCP, and the run reports what it did not cover: no recorded answer splits
  depth into bid and ask, so the side of the order changes no measurement, and the two order-size limits of C4
  are still placeholders because the calibration ran on assets rather than on orders.
- **No transaction.** The run ends by stating it places no order, holds no wallet, signs nothing and reaches no
  venue. It spent **0 credits**; the 11 credits it names are what the recorded answers cost when captured.

## 6. One real finding in `docs/API_AUDIT.md`, proven and tactfully put

Recomputed from `docs/api_audit.json`:

| | |
|---|---|
| Entries published | **24** (A1–A24) |
| Citations behind them | **102**, and **all 102 name a file that exists** |
| Entries withheld for want of proof | 0 |
| Claims read back by `src/audit/review.ts` | 133, of which **0 unproven** |
| Tone flags raised by the same gate | **0** |
| Answers read | 392, of which 301 accepted, across 17 endpoints |
| Credits | 288 reported by the answers, 0 spent by the audit run itself |

The criterion asks for at least one real finding, proven by a fixture. There are twenty-four, and the rule that
produced that number is the one the specification asks for: **an entry with no captured proof is not published.**
The report also records what it measured and found nothing to report on, so a reader can tell the two apart.

Run separately over the document itself, the tone gate of `src/audit/review.ts` returns **no flag** for
`docs/API_AUDIT.md`. The same gate returns no flag for `README.md` and for every other document in `docs/` that
carries a submission — the two exceptions are noted at the end of this file.

## 7. Every document section 7 lists exists and is complete

The six documents named in section 7 of the specification, each present and each read back by a test suite of
its own rather than only by a person:

| Document | Size | Read back by |
|---|---|---|
| `docs/ENDPOINTS.md` | 3 560 words | `tests/endpoints-doc.test.ts`, `tests/audit-inventory.test.ts` |
| `docs/EVIDENCE.md` | 2 527 words | `tests/evidence-doc.test.ts` |
| `docs/API_FEEDBACK.md` | 3 642 words | `tests/api-feedback-doc.test.ts` |
| `docs/SUBMISSION.md` | 2 365 words | `tests/submission-doc.test.ts` |
| `docs/VIDEO_SCRIPT.md` | 2 043 words | `tests/video-script-doc.test.ts` |
| `docs/X_POST.md` | 1 194 words | `tests/x-post-doc.test.ts` |

Four more documents carry the rest of the work and are gated the same way: `docs/API_AUDIT.md` with
`docs/api_audit.json` (criterion 6), `docs/CALIBRATION.md` with `docs/calibration.json` (criterion 4),
`docs/DECISIONS.md`, and `docs/HUMAN_CHECKLIST.md`.

**What is deliberately not filled in.** Five link placeholders remain across the submission documents —
`REPO_URL`, `DEMO_URL`, `VIDEO_URL`, `BUIDL_URL`, `X_POST_URL`. Each names an address that does not exist until a
person creates it, and `docs/HUMAN_CHECKLIST.md` orders the steps so that each link is produced before the
document waiting for it is needed. A test refuses to let a literal address take the place of any of them: an
invented link would be worse than an unfilled one.

## 8. No key in the git history

```
scripts/check-secrets.sh --history       # ✅ No secret detected.
scripts/check-secrets.sh --worktree      # ✅ No secret detected. (every file a clone would carry)
scripts/check-secrets.sh                 # ✅ No secret detected. (the staged changes, what the pre-commit hook runs)
```

The scan looks for three things: the literal value configured in `.env`, any key-shaped value assigned to a CMC key
name, and a tracked `.env`. It found none of them. `.env` is not tracked — `.gitignore` excludes it, which is also
why the middle scope, which reads the working tree, never opens it.

**T9.3 added that middle scope**, because when the time came to run this criterion as a task of its own, the other
two had nothing to read: the index is empty and the history holds one commit, so each printed a clean result about
no file of this project. `--worktree` reads what `git ls-files --cached --others --exclude-standard` lists — the same
set criterion 1 copies, and the content the first commit will turn into history. It is green over all of it, and a
planted key-shaped value was seen to fail it before that was claimed. `tests/git-hooks.test.ts` now runs all three
scopes over this repository on every `npm test`, so this answer cannot quietly go stale.

**The reservation.** The history itself still holds one commit. `--history` will have demonstrated nothing about
this project's own files until **H2** puts them there; what stands in for it today is the scope above, which reads
those files directly rather than through a commit that does not exist yet.

---

## Two words the tone gate finds outside the report

Run over all eleven documents rather than only over the audit, the gate of `src/audit/review.ts` raises **four
occurrences across two files**: one in `docs/CALIBRATION.md` and three in `docs/DECISIONS.md`. Both words are
entries of the `ACCUSATORY` list in that module — the first and the second of the eighteen.

They are recorded here rather than removed, because in all four places the sentence **denies** the word instead of
applying it: three of the four read "not … " or "without being … " about the data, and the fourth describes what
an exception would look like to a host if the server let one escape. The gate matches a substring and does not
read polarity, so a sentence that rules the word out registers the same as one that uses it.

Neither document is inside the gate in its own tests, which is why the occurrences were not seen before: the tone
rule of the specification covers what is said **about the API**, and the documents it gates —
`docs/API_AUDIT.md`, `docs/API_FEEDBACK.md`, `docs/SUBMISSION.md`, `docs/HUMAN_CHECKLIST.md` and this file — are
clean. `docs/CALIBRATION.md` and `docs/DECISIONS.md` are internal records of how this engine was settled.
`tests/final-check-doc.test.ts` pins the count at four, so the observation cannot quietly grow.

## What no command here settles

- **Whether the wording of `docs/API_AUDIT.md` reads as helpful to the team that owns the API.** The gate checks a
  word list and the presence of proof. It cannot judge a tone. That reading is the sixth line `TASKS.md` reserves
  for a person, and it is **H5** of `docs/HUMAN_CHECKLIST.md`.
- **Whether the two order-size limits of C4 are in the right place.** They are placeholders, as scenario 2 of the
  demonstration says out loud: the calibration ran on assets, not on orders.
- **Whether a judge finds the demonstration convincing.** Criterion 5 checks that both scenarios run to the end
  and that the refusal is grounded in a measurement, not that the story lands.
- **The deployed web application.** Criterion 1 covers the Next.js package on request
  (`npm run check:clean -- --with-web`); a running deployment is **H4**, and `docs/X_POST.md` already says what
  the post does when that step does not happen.

## Where this leaves the backlog

With this file written, **T9.2** is done and **T9.3** is the last entry of `TASKS.md` that is not reserved for a
person. Everything else that stands between this repository and a submission is in `docs/HUMAN_CHECKLIST.md`, in
the order its dependencies allow, starting with the commit that criteria 1 and 8 are both waiting on.
