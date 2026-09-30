# Submission — the text for the DoraHacks BUIDL page

Second Opinion is submitted to **Build with CMC: API Hackathon** (DoraHacks × CoinMarketCap), in the
**AI Agents and Automation** track.

Everything between the two `submission text` markers below is the submission, ready to paste. Everything outside
them is for the person pasting it and is not part of it.

## The four links to fill in

The text carries four placeholders, written `{{LIKE_THIS}}`. Each is a link that does not exist until an account, a
deployment or a recording exists, so none of them can be filled in here.

| Placeholder | What to put there | It exists once |
| --- | --- | --- |
| `{{REPO_URL}}` | The public GitHub repository | The repository is created and this code is pushed to it |
| `{{DEMO_URL}}` | The deployed web interface | The Vercel project is deployed, as the README describes under *Deploy it to Vercel* |
| `{{VIDEO_URL}}` | The demonstration video, about 90 seconds | The video is recorded and uploaded |
| `{{X_POST_URL}}` | The post on X carrying the BUIDL link, the video and `#BuildwithCMC` | The post is published |

## Before pressing submit

1. Replace all four placeholders. A search for `{{` in the pasted text has to come back empty.
2. Check that the DoraHacks account and the CoinMarketCap account are registered under the same e-mail address:
   that is what ties the submission to the key every measurement below was taken with.
3. Open `{{REPO_URL}}` in a logged-out window. If it 404s it is still private, and every link below it is dead.
4. Re-read the tone of `docs/API_AUDIT.md` and of the *What the API made possible, and what took work* section
   below. Both are written for the team that owns the API, as observations rather than complaints; that reading is
   a human one and the code cannot do it.

## What keeps this text true

`tests/submission-doc.test.ts` reads the text below against the repository it describes: the endpoint table against
the paths the client may actually send, the check table against the titles the outputs use, the refused endpoints
against the inventory that recorded their refusal, every figure against the generated reports or the recorded
answers that hold it — the demonstration paragraph by replaying both orders offline — every command against
`package.json`, and every path against the filesystem. The wording goes through the same tone gate as the audit
report. It also declares the four placeholders above and refuses any other. Nothing here is compared against a
copy of itself.

---

<!-- submission text: paste from here -->

## Second Opinion

**A trust layer on the CoinMarketCap API.** It cross-checks CMC data against itself, scores what it finds out of 100
and answers `ACT`, `CAUTION` or `DO_NOT_ACT` — with the endpoint answers behind every statement. It is built for the
moment before an agent acts on a price.

### Track: AI Agents and Automation

The product is a tool for agents. It speaks MCP over stdio and registers four tools an agent calls before it acts:
`check_asset`, `check_rwa_token`, `preflight_trade` and `explain`. The demonstration is an agent refusing an order
it was given. The web interface and the command line are the same engine with a different way in, so a verdict never
depends on who asked for it.

### The problem

Market data is read as though it were one fact. It is not. An aggregated price, a pool on a decentralised exchange
and a tokenised claim on a real-world asset are three measurements of the same thing, taken at different moments by
different venues. An answer carrying one of them says nothing about whether it agrees with the other two. Nothing in
a well-formed response says that the quote is hours old, that the venue behind the price holds less than the order
about to be sent, or that the ticker resolved to a different asset from the one that was meant.

An agent is the worst placed to notice. It reads one number, has no second reading to hold it against, and acts.

### What it does

Seven consistency checks, each reading one CoinMarketCap source against another:

| Id | What it reads against what |
| --- | --- |
| C1 | Aggregated price against the DEX token price |
| C2 | Aggregated price against centralised exchange pairs |
| C3 | Freshness of the timestamps |
| C4 | Liquidity against reported volume |
| C5 | RWA wrapper against the average tokenized price |
| C6 | Consistency between endpoints |
| C7 | Fields the verdict reads that could not be read |

Each check returns what it measured, the limit it was read against, and the recorded answers behind it. A check that
cannot run says why instead of scoring zero: what ran is weighed into a score out of 100 — `ACT` at 75 and above,
`CAUTION` from 40, `DO_NOT_ACT` below it — and the coverage is reported beside the score, so a verdict never hides
how much of it could be measured. Thresholds live in `config/checks.json`, each one beside the measurement it was
settled on, never in the code.

Six of the seven run on real answers. C2 would read per-exchange prices, which the Startup plan does not answer; it
reports that in every output rather than measuring something else under the same name.

**It was calibrated before it was demonstrated.** On the first fifty cryptocurrencies by market capitalisation, read
live on 2026-09-26, 47 of the 50 reach `ACT` — 94 %, against the 90 % target — while three stay below it on a
critical observation. A tool that cries wolf on Bitcoin is of no use before an order; the panel, every threshold and
the measurements each one was settled on are in `docs/CALIBRATION.md`.

### The demonstration

`npm run demo` gives an agent the same order under two tickers, and only a second opinion on the data separates them:

> Buy 25,000 USD of tokenised gold. The ticker is XAU.

`XAU` is the ISO code of an ounce of gold, so it is the ticker such an instruction reaches for. On the answers
recorded live on 2026-09-26, `/v1/cryptocurrency/map` returns four assets under that symbol, and the one the symbol
resolves to is XAU9999 Meme (CMC 37470), a token priced around 1e-11 USD. Two independent readings stop the order:
C5 links CMC 37470 to no real-world asset at all, and C4 reports that 25,000 USD is more than twice the depth of the
deepest pool behind that price. The agent refuses, and names the readings that refused it.

The same order on PAXG — a wrapper the index links to gold — runs six of the seven checks, none of them raising a
warning, and the agent simulates the buy. Both scenarios replay from recorded answers: no key, no network, no credit.

The agent places no order, signs nothing and holds no wallet. It is a demonstration of the verdict, not a trading
system.

### The CoinMarketCap endpoints it calls

Twenty-one endpoints were inventoried and called with a real key before any code was written against them.
Seventeen answered on the Startup plan and are the only paths this code may send; four were refused by the plan, and
the client cannot call them at all. `docs/ENDPOINTS.md` carries every one with its status, its cost in credits, its
latency and the recorded answer it was read from.

| ID | Endpoint | Read for |
| --- | --- | --- |
| E01 | `GET /v1/cryptocurrency/map` | The CMC ID a symbol names, and the other assets sharing that symbol |
| E02 | `GET /v3/cryptocurrency/quotes/latest` | The aggregated price, volume and timestamp: the reading the others are held against |
| E03 | `GET /v3/cryptocurrency/listings/latest` | The calibration panel: the first assets by market capitalisation, in one call |
| E05 | `GET /v2/cryptocurrency/info` | The token contract, which decides whether an asset has DEX venues to read |
| E06 | `GET /v2/simple/price` | A second aggregated price for the same asset |
| E07 | `GET /v2/tools/price-conversion` | A third aggregated price, read by the audit |
| E08 | `GET /v4/dex/spot-pairs/latest` | DEX pairs at a named venue, read by the audit |
| E09 | `GET /v4/dex/pairs/quotes/latest` | One DEX pool, quoted; read by the audit |
| E10 | `GET /v1/dex/token/price` | The price of the token at its DEX venues, and the liquidity behind it |
| E11 | `GET /v1/dex/token/pools` | The pools behind that price, and how deep each one is |
| E13 | `GET /v5/real-world-assets/map` | A real-world asset symbol to its `rwa_id`, at no credit cost |
| E14 | `GET /v5/real-world-assets/quotes/latest` | The wrappers of one real-world asset and their average tokenized price |
| E16 | `GET /v5/real-world-assets/assets/list` | The catalogue of tokenized assets |
| E17 | `GET /v5/real-world-assets/info` | What a real-world asset is |
| E18 | `GET /v5/real-world-assets/issuers/list` | The issuer catalogue, walked once to build the token-to-asset index |
| E19 | `GET /v5/real-world-assets/issuers` | The tokens of each issuer: what maps a wrapper symbol back to its asset |
| E20 | `GET /v1/key/info` | The credit counter and the plan's limits, at no credit cost |

Called and refused by the plan, each refusal recorded: E04 `/v2/cryptocurrency/market-pairs/latest`,
E12 `/v1/dex/token-liquidity/query`, E15 `/v5/real-world-assets/market-pairs/list` and
E21 `/v1/exchange/market-pairs/latest`. E04 and E21 are the per-exchange pairs C2 would have read.

A cold verdict costs 3 credits for a coin with no token contract, 5 for a token with one, and 6 when that token is a
wrapper linked to a real-world asset. E01, E13 and E20 report no credit cost, and a repeated question costs nothing
while the cache holds it.

### Proof of real API calls

`docs/EVIDENCE.md` walks one call from the request the client builds to the file the answer was written to, then
from four recorded answers to the sentence they produce, with every quotation re-read from the file it names.

The corpus behind all of it lives in `fixtures/`: it is 392 recorded answers, captured in five sessions between
2026-09-24 and 2026-09-26, with the API key masked in every one — 385 over those 17 endpoints and 7 refusals of
the four the plan does not answer. They are what the tests, the demonstration and the audit all run on, which is
why the whole suite passes with no key and no network.

### The API audit

`npm run audit` reads those recorded answers and writes `docs/API_AUDIT.md` and `docs/api_audit.json`. It sends no
request, so it costs 0 credits and reproduces on a clone with no API key at all. The captures it reads reported 288
credits between them when they were first taken.

This run published 24 entries — 9 measurements, 14 things a consumer has to plan for, and 1 suggestion. Every entry
cites a recorded answer that is in the repository, and every entry was re-opened against the answer it cites before
publication: 133 statements were read back that way, and a statement citing no answer, or citing one that does not
carry it, is dropped rather than published. Both counts of dropped statements are printed at the end of the report;
in this run both were zero.

`docs/API_FEEDBACK.md` is the developer's side of the same corpus: what the API made possible, what took work, and
ten suggestions, each with the recorded answers it comes from.

### Running it yourself, in five minutes and with no key

```
npm install
npm test                                        # the whole suite, offline: the network is disabled while it runs
npm run check -- PAXG --replay=fixtures/check   # a verdict, replayed from a recorded live run
npm run demo                                    # the refused order and the simulated one
npm run audit                                   # regenerates the audit report from the recorded answers
```

With a key in `.env`, `npm run check -- <symbol>` asks the API. To use it from an MCP host, `npm run build` then
point the host at `dist/mcp/server.js`; the README carries the configuration for Claude Desktop and Claude Code, and
a test launches the server from that very configuration and drives it over stdio.

### What the API made possible, and what took work

Three families of endpoints answer about the same asset without deriving from one another — aggregated quotes, DEX
pools, and the real-world-asset catalogue. That is the whole premise of this project: a second opinion needs a
second source, and this key has two more. Every call reports its own cost in `status.credit_count`, resolving an
identifier is free, the RWA catalogue can be walked to its end, and a refusal comes back as a recorded answer rather
than a silence — all four are what made a budgeted, reproducible corpus possible in the first place.

What took work sat in the envelope and in the reference rather than in the data: the `status` envelope arrives in
two shapes, some fields come and go between answers to the same question, one 400 names no parameter, and three
pages list a plan the key did not confirm. None of it stopped the project, and all of it was found by calling.
`docs/API_FEEDBACK.md` sets out each observation with the answers it was read from, and pairs it with a suggestion.

### What it does not do

It places no order, signs nothing, holds no wallet and stores no user data. It reads CoinMarketCap and answers a
question about what it read. The API key is read on the server only — the web interface has no client component, and
a deployment that puts a credential under a `NEXT_PUBLIC_` name refuses to start. The key is never committed:
`scripts/check-secrets.sh` refuses a commit carrying one, and every recorded answer has it masked.

### Links

| | |
| --- | --- |
| Repository | {{REPO_URL}} |
| Live demo | {{DEMO_URL}} |
| Video, about 90 seconds | {{VIDEO_URL}} |
| Post on X | {{X_POST_URL}} |

Built with the CoinMarketCap Pro API on the Startup plan. #BuildwithCMC

<!-- submission text: paste to here -->
