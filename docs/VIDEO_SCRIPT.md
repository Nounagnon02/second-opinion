# Demonstration video — the 90-second script

What this video has to show is that the thing runs: an agent asking the question before it acts, getting a
refusal, and the evidence behind it. Every frame below comes out of a command in this repository, replayed from
answers recorded live on 2026-09-25 and 2026-09-26 — nothing is staged and nothing is re-enacted. Shots 1 to 7
need no API key, send no request and spend no credit, so the whole recording can be made on a clone with an empty
`.env`.

Eight shots, 90 seconds, in the order they are recorded.

## The two links the end card cannot carry yet

Written in double braces, the same convention as `docs/SUBMISSION.md`. Neither exists until an account or a
deployment does, so neither can be filled in here.

| Placeholder | What to put there | It exists once |
| --- | --- | --- |
| `{{REPO_URL}}` | The public GitHub repository | The repository is created and this code is pushed to it |
| `{{DEMO_URL}}` | The deployed web interface | The Vercel project is deployed, as the README describes under *Deploy it to Vercel* |

The video's own link goes the other way: once it is uploaded it fills the `VIDEO_URL` placeholder of
`docs/SUBMISSION.md`.

## Before you hit record

1. **Build once**, so that no shot films a compiler: `npm install`, then `npm run web:install`, then
   `npm run build`.
2. **Two terminals.** The one on camera sits at the root of the repository with its scrollback cleared. The other,
   off camera, runs `npm run web:dev` and stays running; it prints the port it took — 3000, unless something else
   already holds it.
3. **A browser with both tabs already loaded**: `http://localhost:3000/asset?q=XAU` and
   `http://localhost:3000/audit`. Loading them before recording keeps the first compile of a dev server out of the
   video.
4. **Terminal geometry**: about 110 columns by 40 rows, font at 18 pt or more. The transcript wraps at 100
   columns, and its figures are the whole point of the video — they have to survive compression.
5. **No key on screen.** Every shot runs on recorded answers, so no `CMC_API_KEY` is needed anywhere: do not open
   `.env`, do not run `npm run check:env`, do not film an environment listing or a shell history. Nothing in this
   project prints the key — that is what `scripts/check-secrets.sh` and the masked fixtures are for — but a video
   is not the place to rely on it.
6. **The transcript prints absolute paths** from the clone it runs in, home directory included. Record from a path
   you are willing to publish.
7. `npm run demo` and `npm run check` compile before they run: about 4 seconds of silence on the machine this was
   written on. Cut it in the edit, or — step 1 having already built — run the built entry points directly,
   `node dist/demo/run.js` and `node dist/cli/check.js PAXG --replay=fixtures/check`, which print the same lines
   with no wait.

## The eight shots

| # | In | Out | Length | On screen |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | 0:09 | 9 s | The order, and the MCP server coming up in replay mode |
| 2 | 0:09 | 0:26 | 17 s | The two tool calls, what the ticker resolved to, and the two verdicts |
| 3 | 0:26 | 0:43 | 17 s | Why the agent refused, and the refusal itself |
| 4 | 0:43 | 0:54 | 11 s | The same order on PAX Gold, acted on |
| 5 | 0:54 | 1:07 | 13 s | The same engine on the command line, with its evidence |
| 6 | 1:07 | 1:15 | 8 s | The asset page of the web interface |
| 7 | 1:15 | 1:22 | 7 s | The published API audit: 24 entries, 9 observed, 14 signals, 1 suggestion |
| 8 | 1:22 | 1:30 | 8 s | End card |

Each shot below gives what to type, the lines to land on, and what to say over it. **Land on** is quoted from a
real run; it is what to let the viewer read, not a transcript to read aloud.

### Shot 1 — 0:00 → 0:09 (9 s) · The order an agent would take

**Checked against** `demo transcript`

**Type**

```
npm run demo
```

**Land on**

```
Server: second-opinion 0.1.0 listening on stdio in replay mode; tools: check_asset, check_rwa_token, preflight_trade, explain.
Instruction  "Buy 25,000 USD of tokenised gold. The ticker is XAU."
```

**Say** (23 words)

> An agent is told to buy 25,000 dollars of tokenised gold. The ticker is XAU. One number, one call, and it would
> act.

### Shot 2 — 0:09 → 0:26 (17 s) · What the second reading answered

**Checked against** `demo transcript`

**Type**

Nothing: the same output, scrolled to the tool calls.

**Land on**

```
    check_rwa_token(asset="XAU")
      → ACT — XAU — XAU9999 Meme — CMC 37470
    preflight_trade(asset="XAU", side="buy", size_usd=25000)
      → CAUTION — XAU — XAU9999 Meme — CMC 37470
    Verdict    CAUTION, 73.1/100, 5 of 7 checks evaluated
               the asset on its own answers ACT; weighed against this order it answers CAUTION
```

**Say** (33 words)

> Second Opinion is the second reading, asked over MCP before anything happens. The ticker resolves to XAU9999
> Meme, CoinMarketCap ID 37470. On its own the data answers ACT. Weighed against this order, CAUTION.

### Shot 3 — 0:26 → 0:43 (17 s) · Why it refused

**Checked against** `demo transcript`

**Type**

Nothing: the same output, scrolled to *Why the agent refused*.

**Land on**

```
    Order size 25000 USD is 219.83 % of the deepest pool read (warning above 10 %, critical above 25 %)
    - C4 critical order_above_liquidity_share: An order of 25000 USD is 219.83 % of the 11372.541 USD held by
    E11 pool liquidity of XAU/WETH on Uniswap v2; limit: 25 %.
  DECISION Order refused: buy 25000 USD of XAU was not placed.
```

**Say** (44 words)

> Here is why. 25,000 dollars is 219 percent of the deepest pool behind that price: the order is larger than the
> venue it would be filled at. And the wrapper check never ran. Both readings come out of CoinMarketCap's own
> answers. The agent refuses.

### Shot 4 — 0:43 → 0:54 (11 s) · The same order, on a wrapper the checks can follow

**Checked against** `demo transcript`

**Type**

Nothing: the same output, scrolled to scenario 2.

**Land on**

```
    Verdict    ACT, 100/100, 6 of 7 checks evaluated
    Order size 25000 USD is 0.15 % of the deepest pool read (warning above 10 %, critical above 25 %)
  DECISION Order simulated: buy 25000 USD of PAXG
11 credit(s) are what the recorded answers cost when they were captured; this run spent none.
```

**Say** (26 words)

> The same order on PAX Gold: 100 out of 100, and 0.15 percent of the pool. The agent proceeds — simulated. This
> project places no order.

### Shot 5 — 0:54 → 1:07 (13 s) · The engine on the command line, with its evidence

**Checked against** `check output`

**Type**

```
npm run check -- PAXG --replay=fixtures/check
```

**Land on**

```
PAXG — PAX Gold, CMC 4705
Token 0x45804880de22913dafe09f4980848ece6ecbaf78 on ethereum. Wraps rwa_id 1, issued by Paxos.
ACT: 100 out of 100, 6 of 7 checks evaluated, and none of them raised an observation.
  C5  info     RWA wrapper against the average tokenized price (100 points, 18.8 % of the score)
  E14  /v5/real-world-assets/quotes/latest
Credits this run: 6 charged, 0 unconfirmed, 494 left of 500 (CMC_CREDIT_BUDGET).
```

**Say** (25 words)

> The same engine from the command line, offline. Seven checks, the weight each one carries, and under Evidence the
> recorded endpoint answer behind every line.

### Shot 6 — 1:07 → 1:15 (8 s) · The same verdict in a browser

**Checked against** `asset page`

**Type**

Nothing: switch to the tab on `http://localhost:3000/asset?q=XAU`. On a deployment, `{{DEMO_URL}}` serves the same
page from the same engine.

**Land on**

```
XAU — XAU9999 Meme — CMC 37470
ACT: 84.6 out of 100, 5 of 7 checks evaluated, worst observation a warning from C4 and C7.
Replay: no CMC_API_KEY is set on this server, so every figure comes from an answer recorded earlier.
```

**Say** (18 words)

> The web interface reads the same verdict, and says outright when a figure was replayed rather than fetched.

### Shot 7 — 1:15 → 1:22 (7 s) · What the same answers say about the API

**Checked against** `audit page`

**Type**

Nothing: switch to the tab on `http://localhost:3000/audit`.

**Land on**

```
392 Recorded answers read
17 Endpoints covered
0 Credits this report spent
133 Claims checked against their evidence
```

**Say** (20 words)

> And one report for the API team: 392 recorded answers, 17 endpoints, no credits, every claim checked against its
> evidence.

### Shot 8 — 1:22 → 1:30 (8 s) · End card

**Checked against** `title card`

**Type**

Nothing. A still card, held to the end:

```
Second Opinion — the check an agent runs before it acts
Built on the CoinMarketCap API · AI Agents and Automation
{{REPO_URL}}
#BuildwithCMC
```

**Say** (16 words)

> Second Opinion: the second reading an agent takes before it acts. Built on the CoinMarketCap API.

## If the cut has to be shorter

Shots 1, 2, 3, 4 and 8 are the demonstration and the close; they hold together on their own at about 62 seconds.
Shots 5, 6 and 7 are what makes it more than a transcript — the same engine reached three other ways — and are the
ones to shorten rather than to drop.

## What the narration must not say

The wording above is careful on five points, and a re-write should stay careful on the same five.

- **The asset on its own is not refused.** `check_rwa_token` answers ACT for XAU, at 84.6 out of 100. What turns
  it into CAUTION is the size of the order against the depth of the venue, and the transcript says so on its own
  line. Saying the data was "rejected" would be a stronger claim than the run makes.
- **No cause is stated.** The video shows what the answers contain: a symbol that resolved to another asset than
  the one the instruction meant, a pool holding less than the order. Why either is so is not something a corpus of
  recorded answers can establish, and the audit report is written to the same rule.
- **Nothing is placed.** The agent simulates. It holds no wallet, signs nothing and reaches no venue, and the
  transcript prints that under both decisions.
- **The figures are recorded, not live.** They come from answers captured on 2026-09-25 and 2026-09-26. Say
  "recorded", not "right now": an asset moves, and a viewer who checks the ticker a month later has to be able to
  tell why the numbers differ.
- **Two of the limits behind shot 3 are not calibrated.** The share of the pool an order takes is measured; the
  10 % and 25 % lines it is read against were set by hand in `config/checks.json`, because the calibration ran on
  assets rather than on orders. The transcript admits it under *What these answers do not cover*, and the narration should not claim
  more.

## What keeps this script true

`tests/video-script-doc.test.ts` reads this file against the repository it describes. It spawns the real MCP
server in replay mode, runs both demonstration scenarios over stdio and renders the transcript, replays the
`check` command, reads the asset page through `lookupAsset` and the audit page through `loadAuditView` — then
requires every **Land on** line to appear in the run its shot names. It also checks that the shots are contiguous
and add up to 90 seconds, that each declared word count matches its narration and reads at a speakable rate, that
every command is one `package.json` defines and every path exists, that the two placeholders are each declared
once and used once, and that the wording passes the tone gate `src/audit/review.ts` applies to the audit report.

```
npm test -- video-script-doc
```
