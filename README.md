# Second Opinion

A trust layer on top of the CoinMarketCap API. It cross-checks CMC data against itself — the aggregated price
against the DEX pools and the centralised pairs behind it, the timestamps against the answer that carried them, the
depth an order would meet, a tokenised real-world asset against the other wrappers of the same underlying — scores
what it finds out of 100 and answers **ACT**, **CAUTION** or **DO_NOT_ACT** with the endpoint answers behind every
statement.

It is built for the moment before an agent acts on a price. It places no order, signs nothing and holds no wallet.

## The problem

Market data is read as though it were one fact. It is not. An aggregated price, a pool on a decentralised exchange
and a tokenised claim on a real-world asset are three measurements of the same thing, taken at different moments by
different venues, and an answer that carries one of them says nothing about whether it agrees with the other two.
Nothing in a well-formed response says that the quote is hours old, that the venue behind the price holds less than
the order about to be sent, or that the ticker resolved to a different asset from the one that was meant.

An agent is the worst placed to notice. It reads one number, has no second reading to hold it against, and acts. The
demonstration in this repository is that failure exactly. The order is a reasonable one:

```
Buy 25,000 USD of tokenised gold. The ticker is XAU.
```

`XAU` is the ISO code of an ounce of gold, so it is the ticker such an instruction reaches for. On the answers
recorded live on 2026-09-26, the symbol resolves to XAU9999 Meme (CMC 37470), a token priced around 1e-11 USD, and
25,000 USD is more than twice the depth of the deepest pool behind that price. Both readings come out of
CoinMarketCap's own answers; neither is visible in the one field an agent would have read.

Second Opinion is the reading that makes them visible, built from the same API. It crosses CMC's endpoints against
one another, scores what it finds, and cites the recorded answer behind every statement.

```
npm run demo
```

replays that order and the same order on a wrapper the checks can follow — one refused, one acted on — with no key,
no network and no credit.

## Requirements

- Node.js 20.19 or later
- A CoinMarketCap API key. Every measurement in this repository was taken on the Startup plan; which endpoints that
  plan answers and which it refuses is recorded in [docs/ENDPOINTS.md](docs/ENDPOINTS.md).

## Quick start

```
npm install
cp .env.example .env     # paste your key into CMC_API_KEY
npm run check:env        # checks the key is readable; never prints it
npm run check -- PAXG
```

Offline, with no key and no network: the two `check` runs recorded live on 2026-09-25 are replayed out of
`fixtures/check`.

```
npm run check -- PAXG --replay=fixtures/check
npm run check -- BTC --replay=fixtures/check
```

## Use it from an MCP host

The server speaks MCP over stdio and registers four tools. Build it once, then point the host at the built entry
point:

```
npm run build            # writes dist/mcp/server.js
```

### Claude Desktop

Settings → Developer → Edit Config opens `claude_desktop_config.json`. Add the server to it:

```json
{
  "mcpServers": {
    "second-opinion": {
      "command": "node",
      "args": ["/absolute/path/to/second-opinion/dist/mcp/server.js"],
      "env": { "CMC_API_KEY": "your-CoinMarketCap-key" }
    }
  }
}
```

Restart Claude Desktop. The server appears as `second-opinion` with its four tools.

### Claude Code

```
claude mcp add second-opinion -e CMC_API_KEY=your-CoinMarketCap-key -- node /absolute/path/to/second-opinion/dist/mcp/server.js
```

`claude mcp list` then shows whether the server answered, and `/mcp` inside a session lists its tools.

### Three things about that configuration

- **Launch `node dist/mcp/server.js`, not `npm run mcp`.** `npm run` prints its own banner
  (`> second-opinion@0.1.0 mcp`) on **stdout**, and stdout is where the JSON-RPC stream lives: the banner breaks the
  handshake before it starts. The `mcp` script is for a quick look from a terminal, where the banner is harmless; a
  host gets the bare `node` command. Everything the server has to say about itself goes to stderr, which the host
  shows as a server log.
- **The path has to be absolute.** A host starts the server from its own working directory, not from this one.
- **`env` is optional.** At start-up the server loads the `.env` file at the root of this repository, so a key
  already in `.env` is enough. A value given in the host's `env` block takes precedence over the one in `.env`.

### Offline demo: no key, no network, no credit

The same server, pointed at the recorded answers:

```json
{
  "mcpServers": {
    "second-opinion": {
      "command": "node",
      "args": [
        "/absolute/path/to/second-opinion/dist/mcp/server.js",
        "--replay=/absolute/path/to/second-opinion/fixtures/check"
      ]
    }
  }
}
```

In this mode the tools answer for PAXG and BTC, the two assets those runs cover, and for anything else they name the
call that found no recorded answer. A third mode, `--record[=dir]`, makes live calls and writes every answer to a
fixture with the key masked.

### The four tools

| Tool | Arguments | What it answers |
| --- | --- | --- |
| `check_asset` | `asset`: symbol as CoinMarketCap writes it, or a numeric CMC ID | The verdict, the score out of 100, what each of the seven checks observed or why it could not run, and the endpoints read |
| `check_rwa_token` | `asset` | The same assessment with the real-world-asset check in full: how far this wrapper sits from the average tokenized price over the wrappers of the same underlying, and how widely they spread |
| `preflight_trade` | `asset`, `side`: `buy` or `sell`, `size_usd`: above 0 | The same assessment plus the share of the deepest pool read that an order of this size would take |
| `explain` | `check_id`: `C1` … `C7` | What that check measures, the endpoints it reads, the limits it is read against and the recorded measurements those limits were settled on. Needs no API key |

Two notes an agent should read with the answers. `side` is echoed and changes no measurement: no recorded answer
splits the depth of a venue into bid and ask, so the share of a pool an order takes is the same either way. And the
two order-size limits `preflight_trade` reads are the only thresholds the calibration does not exercise — the share
is measured, where the line belongs is not. Both are set out in [docs/DECISIONS.md](docs/DECISIONS.md).

### Checking the configuration before trusting it

`tests/mcp-config-doc.test.ts` reads the JSON above out of this README, launches the server exactly as it describes
and drives it over stdio with the MCP SDK's own client:

```
npm test -- mcp-config-doc
```

## The web interface

Three pages: a search field, the verdict for one asset with every check and the endpoint answers behind it, and the
published API audit. The API key is read on the server only — there is no client component in the application, and a
deployment that puts a credential under a `NEXT_PUBLIC_` name refuses to start.

```
npm run web:install      # once: the interface is its own package (see docs/DECISIONS.md, D15)
npm run web:dev          # builds the engine, then starts Next.js on http://localhost:3000
```

With no `CMC_API_KEY` in the environment it serves the recorded answers of `fixtures/` and says so under the verdict,
so the interface runs with no key, no network and no credit.

### Deploy it to Vercel

The application lives in `web/` and reads three things **above** its own directory — `config/checks.json`,
`fixtures/` and `docs/api_audit.json` — so the repository, not `web/`, is the root the build has to see.
`web/vercel.json` carries the build settings; two project settings have to be set in the dashboard, because
`vercel.json` cannot express either:

| Project setting | Value | Why |
| --- | --- | --- |
| **Root Directory** | `web` | The Next.js app is there, not at the repository root. Vercel reads `web/vercel.json` from it and runs both commands below inside it |
| **Include source files outside of the Root Directory in the Build Step** | enabled | The build reaches `..` for the engine and for the three files above. Vercel enables this by default on projects created after 27 August 2020 — worth checking rather than assuming |

`web/vercel.json` then sets:

```json
{
  "framework": "nextjs",
  "installCommand": "npm install --prefix .. && npm install",
  "buildCommand": "npm run build --prefix .. && npm run build"
}
```

Both run from `web/` and take the same two steps in the same order as `npm run web:build`: the engine is installed
and compiled to `dist/` first, then the application is built against it. What Vercel would otherwise pick for a
Next.js app — `npm install` then `next build`, both inside `web/` — would build the application against a `dist/`
that does not exist yet, which is why both are overridden. Nothing else is: the output stays at `web/.next`, and
`engines.node` (`>=20.19`) leaves Vercel on its current default of Node 24.x.

### Environment variables to set on the deployment

Set these under **Settings → Environment Variables**. Only the first is a secret, and none of them may be given a
`NEXT_PUBLIC_` prefix — that prefix is inlined into the browser bundle, and the interface refuses to start if a
credential appears under it.

| Variable | Set it to | What happens when it is unset |
| --- | --- | --- |
| `CMC_API_KEY` | your CoinMarketCap key | The deployment serves recorded answers instead of calling the API |
| `SECOND_OPINION_MODE` | `live` or `replay` | `live` when a key is set, `replay` when none is. `record` is refused: it would write files and spend credits on every visit |
| `SECOND_OPINION_FIXTURES` | a directory of recorded answers | `fixtures/`, every subdirectory included. Read in replay only |
| `SECOND_OPINION_AUDIT_FILE` | another audit report to publish | `docs/api_audit.json`, the report `npm run audit` writes |
| `SECOND_OPINION_RWA_INDEX` | a cached token-to-RWA index | The index is rebuilt in memory, once per process, from the recorded walk in `fixtures/rwa-index`, so C5 answers on a read-only filesystem |
| `CMC_CACHE_DIR` | a writable directory | The system temporary directory, which a serverless host can write to — unlike the `.cache/cmc` the commands use. A replay caches nothing |
| `SECOND_OPINION_ROOT` | the directory holding `config/` and `fixtures/` | Found from the module's own location, or by walking up from the working directory. Needed only on a host that matches neither |

The client settings of [.env.example](.env.example) — `CMC_CREDIT_BUDGET`, `CACHE_TTL_SECONDS`, `CMC_TIMEOUT_MS` and
the rest — are read here too, and keep their defaults when unset.

One last thing about a live deployment: a verdict reads several endpoints, so each visit spends credits.
`CMC_CREDIT_BUDGET` caps a single request and the cache above makes a repeated question free, but a public URL on a
Startup plan is better pointed at `SECOND_OPINION_MODE=replay` unless the key is meant to be spent.

## The seven checks

| Id | What it reads against what |
| --- | --- |
| C1 | Aggregated price against the DEX token price |
| C2 | Aggregated price against centralised exchange pairs |
| C3 | Freshness of the timestamps |
| C4 | Liquidity against reported volume |
| C5 | RWA wrapper against the average tokenized price |
| C6 | Consistency between endpoints |
| C7 | Fields the verdict reads that could not be read |

A check that cannot run says why instead of scoring zero, and the score is formed on the checks that did run.
`explain` gives the same account of any of them, with the limits the run was configured with.

## Architecture

One engine, four ways in. The MCP server, the command line, the demonstration agent and the web interface all run
the same assessment, so a verdict cannot depend on who asked for it.

- `src/cmc/` — the only code that speaks HTTP to CoinMarketCap: the key read from the environment, retries, CMC's own
  status codes, a disk cache, a credit counter with a ceiling per run, and the three modes — `live`, `record`,
  `replay` — that let everything above it run against recorded answers instead of the network.
- `src/normalize/` — one normaliser per verified endpoint, all producing the same shape: CMC ID, symbol, USD price,
  timestamp, volume, liquidity, and the answer each was read from. Units and epoch formats are settled here, so no
  check ever parses an API response.
- `src/checks/` — one file per check, C1 to C7, each returning the same result: a severity, what it measured, the
  limit it was read against, and the sources behind it. `assess.ts` runs the call plan for one asset and hands the
  seven results on.
- `src/score/` — weighs the checks that ran into one number out of 100 and reads the verdict off it. A check that
  could not run is not scored as a zero; it is left out, and the coverage is reported beside the score.
- `src/rwa/` — the token-to-asset index C5 needs, built by walking the issuer catalogue once and cached on disk.
- `src/mcp/`, `src/cli/`, `src/web/` and `src/demo/` are the four front ends; `src/audit/` and `src/calibration/`
  measure the engine rather than serve it.

Thresholds live in `config/checks.json`, never in the code. Recorded answers live in `fixtures/`, with the key
masked in every one. The Next.js application under `web/` is a separate package holding markup and routing only —
everything it decides is decided in `src/web/`.

## The CMC endpoints it reads

Seventeen, every one of them called with a real key and recorded before any code was written against it. Four more
were called and refused by the plan — E04 and E21, the per-exchange pairs, which is why C2 reports instead of
measuring, plus E12 and E15 — and the client cannot call them at all.

| ID | Endpoint | Checks it feeds | Read for |
| --- | --- | --- | --- |
| E01 | `GET /v1/cryptocurrency/map` | C7 | The CMC ID a symbol names, which every later call carries |
| E02 | `GET /v3/cryptocurrency/quotes/latest` | C1, C3, C6, C7 | The aggregated price, volume and timestamp: the reading the others are held against |
| E03 | `GET /v3/cryptocurrency/listings/latest` | — | The calibration panel, in one call: the first assets by market capitalisation (`npm run calibrate`) |
| E05 | `GET /v2/cryptocurrency/info` | C7 | The token contract, which decides whether an asset has DEX venues to read at all |
| E06 | `GET /v2/simple/price` | C3, C6, C7 | A second aggregated price for the same asset |
| E07 | `GET /v2/tools/price-conversion` | — | A third aggregated price. Recorded and normalised; read by `npm run audit`, not by a verdict |
| E08 | `GET /v4/dex/spot-pairs/latest` | — | DEX pairs at a named venue. Recorded and normalised; read by `npm run audit`, not by a verdict |
| E09 | `GET /v4/dex/pairs/quotes/latest` | — | One DEX pool, quoted. Recorded and normalised; read by `npm run audit`, not by a verdict |
| E10 | `GET /v1/dex/token/price` | C1, C3, C4, C7 | The price of the token at its DEX venues, and the liquidity behind it |
| E11 | `GET /v1/dex/token/pools` | C4, C7 | The pools behind that price, and how deep each one is |
| E13 | `GET /v5/real-world-assets/map` | — | An RWA symbol to its `rwa_id`, at no credit cost. A user asks about a wrapper, which this does not resolve, so E18 and E19 do it instead |
| E14 | `GET /v5/real-world-assets/quotes/latest` | C3, C5, C6, C7 | The wrappers of one real-world asset and their average tokenized price — C5 reads every sibling out of this single answer |
| E16 | `GET /v5/real-world-assets/assets/list` | — | The catalogue of tokenized assets. Read by `npm run audit` and to pick the demonstration asset |
| E17 | `GET /v5/real-world-assets/info` | — | What a real-world asset is. Read by `npm run audit` |
| E18 | `GET /v5/real-world-assets/issuers/list` | — | The issuer catalogue, walked once by `npm run rwa:index` |
| E19 | `GET /v5/real-world-assets/issuers` | — | The tokens of each issuer: what maps a wrapper symbol back to its asset (`npm run rwa:index`) |
| E20 | `GET /v1/key/info` | — | The credit counter and the plan's limits, at no credit cost |

A cold verdict costs 5 credits on a token and 3 on a coin with no contract; E01, E13 and E20 cost none, and a repeated
question costs nothing while the cache holds it. The call plan behind those numbers — three stages, what runs in
parallel, and the latency each was measured at — is [docs/DECISIONS.md](docs/DECISIONS.md) (D1), and the status, cost,
latency and observed fields of all twenty-one endpoints are in [docs/ENDPOINTS.md](docs/ENDPOINTS.md), each line
backed by the answer it was read from.

## Calibration

On the first fifty cryptocurrencies by market capitalisation, read live on 2026-09-26, **94 % reach `ACT`** — above
the 90 % the specification asks for — while three assets stay below it on a critical observation. The panel, every
threshold and the measurements each one was settled on are in [docs/CALIBRATION.md](docs/CALIBRATION.md); the
thresholds themselves live in `config/checks.json`, each beside the note that justifies it.

## Documentation

- [docs/ENDPOINTS.md](docs/ENDPOINTS.md) — every candidate endpoint, what the Startup plan answered, its cost in
  credits and the recorded fixture proving it
- [docs/DECISIONS.md](docs/DECISIONS.md) — what each check reads and why, and what was dropped for lack of access
- [docs/CALIBRATION.md](docs/CALIBRATION.md) — the calibration panel and the thresholds it settled

## Credits, cache and secrets

One run never spends more than `CMC_CREDIT_BUDGET` credits (500 by default) and every answer is cached on disk under
`.cache/cmc` for the lifetimes set in `.env.example`, so a repeated question costs nothing. The API key lives only in
`.env`, which is never committed; `scripts/check-secrets.sh` refuses a commit that carries one, and every recorded
fixture has it masked.

That script takes one scope at a time, and refuses a mistyped one rather than answering for the default:

```
scripts/check-secrets.sh              # the staged changes — what the pre-commit hook runs
scripts/check-secrets.sh --worktree   # every file a clone would carry, committed or not
scripts/check-secrets.sh --history    # every commit of every branch
```

## Verifying a clone

```
npm run lint && npm run typecheck && npm test
```

The whole suite runs offline: the network is disabled while it runs, and every CMC answer it reads is a recorded one.

To check the clone the way a reader receives it, rather than the way this working copy happens to be:

```
npm run check:clean              # add -- --with-web to cover the Next.js application too
```

It copies the repository-visible files into a temporary directory — so `node_modules/`, `dist/`, `.cache/` and
`.env` stay behind — then runs `npm install`, `npm run build`, `npm run lint`, `npm run typecheck` and `npm test`
there, and finishes with the quick start above. That last part is the point: the copy has no key, so a run that
reached the API would fail instead of quietly using yours.
