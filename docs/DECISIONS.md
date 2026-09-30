# Decisions — checks adapted to the verified endpoints

**T1.3 (2026-09-24).** The checks C1–C7 of the specification were written before any call to the API. This file
adapts them to what the hackathon key can actually reach, as recorded in [`docs/ENDPOINTS.md`](ENDPOINTS.md) (T1.2,
plus E21 in T1.3). Every decision cites the fixtures it rests on (`fixtures/discovery/<label>.json`).

The check IDs stay C1–C7, so that the specification, the code and the outputs keep the same names. A check that
cannot run is kept in the list and reported as such, never silently dropped.
`tests/decisions-doc.test.ts` checks that every source below is `verified` in `docs/ENDPOINTS.md`, that every cited
fixture exists, and that the evidence of an `unavailable` check contains refusals only.

## Summary

Decision values: `kept` (as specified), `adapted` (sources or scope changed), `unavailable` (no verified source:
reported in every output, not scored).

| Check | Decision | Sources | Evidence |
|---|---|---|---|
| C1 | adapted | E02, E05, E10 | `E08-dex-spot-pairs-paxg`, `E08-dex-spot-pairs-paxg-uniswap`, `E09-dex-pair-quotes-paxg-weth`, `E10-dex-token-price-paxg`, `E05-info-btc-paxg` |
| C2 | unavailable | none | `E04-market-pairs-btc`, `E04-market-pairs-btc-minimal`, `E15-rwa-market-pairs-gold`, `E21-exchange-market-pairs-binance-paxg` |
| C3 | kept | E02, E06, E10, E14 | `E02-quotes-latest-btc-paxg`, `E06-simple-price-btc-paxg`, `E10-dex-token-price-paxg`, `E14-rwa-quotes-gold` |
| C4 | adapted | E10, E11 | `E12-dex-token-liquidity-paxg`, `E12-dex-token-liquidity-paxg-minimal`, `E10-dex-token-price-paxg`, `E11-dex-token-pools-paxg` |
| C5 | adapted | E13, E14 | `E14-rwa-quotes-gold`, `E15-rwa-market-pairs-gold`, `E13-rwa-map-gold` |
| C6 | adapted | E02, E06, E14 | `E02-quotes-latest-btc-paxg`, `E06-simple-price-btc-paxg`, `E14-rwa-quotes-gold` |
| C7 | adapted | E01, E02, E05, E06, E10, E11, E13, E14 | `E02-quotes-latest-btc-paxg`, `E10-dex-token-price-paxg`, `E11-dex-token-pools-paxg` |

Support calls, which feed no check by themselves: E01 (symbol → CMC ID), E05 (CMC ID → token contract), E13 (RWA
symbol → `rwa_id`), E20 (credit counter).

## D1 — Call plan of one `check`, within 10 seconds

The latencies are the ones measured in T1.2 (client side, network included).

| Stage | Calls, in parallel | Credits | Slowest T1.2 latency |
|---|---|---|---|
| 0. Resolve | E01 `symbol` (skipped for a numeric CMC ID; cached) | 0 | 864 ms |
| 1. Aggregated data | E02 `id`, E06 `id`, E05 `id` (static metadata, long cache) | 3 (2 when E05 is cached) | 1,446 ms (E05) |
| 2. DEX data, only with a token contract | E10 `platform` + `address`, E11 `platform` + `address` | 2 | 5,132 ms (E10) |

- Cold, this adds up to about 7.4 s and 5 credits for a token, 3 credits for a coin without contract. E10 is the
  critical path.
- Every call gets a timeout from the configuration. A call that fails or times out makes the checks that need it
  `unavailable` for this run (D9); it does not hold the verdict past the budget.
- `check_rwa_token` adds E13 (0 credit) and E14 (1 credit) to stage 1. The sibling wrappers are read from that single
  E14 response: no DEX call per sibling (D6).
- Calibration (T4.1) takes its panel from E03 (top 50 in one call, 1 credit; 5.9 s, too slow for the per-asset path)
  and then runs each asset through this same plan, so that it measures what a user gets.

**Measured end to end (T3.7).** The first live `check` runs, recorded into `fixtures/check` on 2026-09-25, took
**7.83 s** for PAXG (seven answers, the whole plan) and **4.63 s** for BTC (four answers: no token contract, no
wrapper), both inside the budget, so acceptance criterion 2 holds with a real key. The total matches the estimate
above; the distribution does not. E01 answered in 4,688 ms rather than 864 ms and E10 in 646 ms rather than
5,132 ms, so the critical path of these runs was resolution, not the DEX call — the table's ranking of the slowest
call is an observation of T1.2, not a property of the endpoints. The four stage-1 requests left within 4 ms of one
another and the stage-2 pair within 1 ms, which is the parallelism the plan assumes. PAXG leaves about 2.2 s of
margin, and the call that consumed most of the budget is the one a numeric CMC ID skips.

## D2 — C2 is `unavailable` with this key

**Evidence.** Every source of per-exchange CEX prices is refused with 403 / `1006` ("Your API Key subscription plan
doesn't support this endpoint."): E04 cryptocurrency market pairs (`E04-market-pairs-btc`, also with only
`id=1&limit=10` in `E04-market-pairs-btc-minimal`), E15 RWA market pairs (`E15-rwa-market-pairs-gold`) and, tried in
T1.3 as a replacement, E21 exchange market pairs filtered on PAXG (`E21-exchange-market-pairs-binance-paxg`).
The documentation pages of all three list the Startup plan (observation 2 of `docs/ENDPOINTS.md`).

**Decision.**
- C2 stays in the list with the status `unavailable` and the reason "per-exchange prices are not available with the
  current API plan". It appears in every output and never counts in the score (D9).
- No proxy takes its name. E02 `cex_volume_24h` / `dex_volume_24h` are volumes, not prices: a check built on them
  would measure something else under the C2 label.
- If a later key reaches E04, C2 comes back once E04 is re-verified in `docs/ENDPOINTS.md`; until then the endpoint
  test keeps E04, E15 and E21 out of `src/`.

## D3 — C1 compares the aggregated price with the DEX token price (E10), not with E08

**Evidence.**
- E08 cannot serve one asset: without `dex_id` / `dex_slug` it answers HTTP 400 (`E08-dex-spot-pairs-paxg`); with
  them, `limit=10` returned 100 pairs and the base-asset filters did not narrow them (3 PAXG pairs out of 100,
  `E08-dex-spot-pairs-paxg-uniswap`, `E08-dex-spot-pairs-paxg-by-contract`).
- E10 `p` for PAXG (4264.153800061066, `E10-dex-token-price-paxg`) is exactly the USD price of the PAXG/WETH
  Uniswap v2 pool read with E09 (`E09-dex-pair-quotes-paxg-weth`), which E11 lists as the deepest pool
  (16.26 M USD, `E11-dex-token-pools-paxg`). E10 `mc` equals that pool's `fully_diluted_value` too.

**Decision.**
- C1 = gap between E02 `quote[].price` and E10 `p` for the same token. In the T1.2 sample: 4253.2261 vs 4264.1538,
  +0.26 % (observation 10).
- E09 is not called by `check`: in the sample it repeats E10 at the cost of one more credit and one more round
  trip. It stays verified for the audit (E10 vs deepest pool) and for pool-level work later.
- C1 needs a token contract, taken from E05 (`platform.token_address`, else `contract_address[]`), with the E05
  platform slug as the E10 `platform` parameter (`ethereum` worked). Without a contract, C1 is `not_applicable`: BTC
  has `platform: null` and no `contract_address` (`E05-info-btc-paxg`), and 4 of the top 5 in
  `E03-listings-latest-top5` (BTC, ETH, BNB, XRP) have `platform: null`. When E05 lists several contracts, only the
  primary platform is queried.
- Symbol resolution: E01 returned 14 entries for `symbol=BTC,PAXG`, 13 of them named BTC (`E01-map-btc-paxg`). The
  resolver keeps the active entry with the lowest `rank`, lists the others in the output, and accepts a numeric CMC ID
  to skip resolution.

## D4 — C3 freshness uses the response clock

**Evidence.** Timestamps come as ISO strings in E02 (`last_updated`, `quote[].last_updated`), E06
(`quotes[].last_updated`) and E14 (`last_updated`), and as a millisecond epoch in a string in E10 (`ts`,
`E10-dex-token-price-paxg`). Every response carries `status.timestamp`.

**Decision.**
- Age = `status.timestamp` of the same response minus the data timestamp. The local clock is never used: replayed
  fixtures give the same result every time, and network time is not counted as staleness.
- Two threshold families in `config/`: aggregated quotes (documented update every 60 s) and DEX prices (E10 `ts`,
  which follows trading activity and can be old for a quiet token without being wrong). Values are set in T3.1 and
  calibrated in T4.2.

## D5 — C4 works on the latest snapshot only

**Evidence.** E12, the liquidity history, is refused: HTTP 400 "Parameter error" with the documented parameters, and
also with `platform` and `address` only (`E12-dex-token-liquidity-paxg`, `E12-dex-token-liquidity-paxg-minimal`). The
allowed `interval` values are not documented, so none was guessed.

**Decision.**
- C4 uses E10 `l` (liquidity, USD) and `v24h` (24 h volume) for the token, and E11 `liqUsd` / `v24` for each pool
  (decimal strings, parsed as numbers; `E11-dex-token-pools-paxg`).
- Signals: 24 h volume against liquidity (token and deepest pool), and for `preflight_trade` the order size against the
  liquidity of the deepest pool. No trend over time can be claimed.
- Like C1, C4 is `not_applicable` without a token contract.
- E08 carries a natural case (BULL/WETH: about 171 USD of liquidity for about 40 M USD of 24 h volume, observation 11).
  Its pairs have the E09 shape, so it is used as unit-test input for C4, never as a per-asset source.

## D6 — C5 measures dispersion between the wrappers of one RWA

**Evidence.**
- No reference price of the underlying asset is reachable. The E14 documentation page
  (<https://pro.coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets/quotes-latest-5.md>, read
  again on 2026-09-25) describes `tradfi_markets` items as `exchange` (`exchange_id`, `name`, `slug`), `ticker` and
  `market_url`: no price field. For GOLD the array is empty (`E14-rwa-quotes-gold`). E15 is refused
  (`E15-rwa-market-pairs-gold`).
- The unit of each token is not stated. In `E14-rwa-quotes-gold`, five GOLD wrappers are priced within 0.3 % of
  `average_tokenized_price` 4255.05 (PAXG 4253.42, XAUt 4258.25, XAUM 4248.17, XAUT0 4258.88, XAU 4259.59) and two
  near 137 USD (CGO 136.68, VNXAU 137.27).
- XAU ("Gold (Derivatives)", issuer "NA (Derivatives)") has `market_cap` 0 and `volume_24h` 0.

**Decision.**
- "Premium or discount against the reference asset" becomes "premium or discount against the average tokenized
  price" of the RWA (E14), plus the spread between wrappers. Outputs call this reference "average tokenized price",
  never an underlying market price. How CMC computes the average is not documented; the check assumes no method.
- Units, in this order:
  1. an explicit unit table in `config/`, where each entry cites its source (URL or fixture); empty at first;
  2. otherwise, a token priced within a configured band around the average is compared directly;
  3. otherwise, if the price times a conversion factor listed in `config/` (troy ounce = 31.1034768 g) falls in the
     band, the token is compared after conversion and flagged "unit inferred". GOLD sample: CGO → 4251.30 USD
     (−0.09 % vs the average), VNXAU → 4269.50 USD (+0.34 %);
  4. otherwise, a warning "price level not explained by a known unit", with the ratio. It is shown, not dropped: the
     API gives no way to tell a different unit from a real deviation.
- Tokens whose `volume_24h` is below a configured minimum (XAU in the sample) are listed but left out of the spread.
- `check_rwa_token` evaluates the requested wrapper against its siblings from one E14 call; C1 and C4 run on the
  requested wrapper only. An RWA symbol resolves through E13 (0 credit, `E13-rwa-map-gold`). A wrapper symbol needs
  a token → RWA index: E19 gives `tokens[].crypto_id` with `rwa_id` per issuer, E18 lists the issuers.

**Measured (T3.4, 2026-09-25).** The index was built once against the live API with `npm run rwa:index -- --build`,
and the whole walk recorded in `fixtures/rwa-index/`, so it replays offline and these numbers are re-derived by
`tests/rwa-wrapper-index.test.ts` rather than copied here by hand.

| Measure | Value |
|---|---|
| Answers | 30: one E18 page (25 issuers, `has_more` false) and 29 E19 pages, at 250 tokens a page |
| Attempts | 32. Two came back without an answer and the client retried them; the recorder writes a fixture for any HTTP reply, including a refusal, and none was written for those two, so they failed below HTTP. The walk took 8.3 s in all, under the 8 s per-attempt timeout, so they failed fast rather than timing out |
| Credits | 30, one per answer, plus 2 the failed attempts may or may not have cost. E20 read before and after settles it: `current_month.credits_used` went from 18 to 48, so those two attempts were not charged |
| Issuers | 22 of the 25 called on E19; the other three report `num_tokens` 0, and a call for them would spend a credit on an empty list |
| Tokens | 2393 listed; 1437 (60.1 %) carry both `crypto_id` and `rwa_id` and enter the index; 956 (39.9 %) carry at most one |
| Wall clock | 8.3 s between the first and the last answer, median latency 276 ms, inside the 50 requests per minute of the plan |

**What follows from it.** The walk is a whole-catalogue pass, not a per-asset call, so the index is built once and
cached in `.cache/rwa/wrapper-index.json`, never rebuilt inside a `check`: 30 credits is 0.2 % of the monthly
allowance, but 8.3 s alone would eat the 10-second budget of D1. The 956 tokens the walk cannot resolve bound what
C5 can answer: a wrapper among them is reported as outside the index, never guessed at. That share is an
observation for the audit (T6.1), with the recorded pages as its evidence.

PAX Gold is in the index (`crypto_id` 4705 → `rwa_id` 1, issuer Paxos), and `rwa_id` 1 is what
`E14-rwa-quotes-gold` was read with, so the chain wrapper symbol → asset → sibling wrappers holds end to end on
recorded data.

## D7 — C6 compares aggregated values with aggregated values

**Evidence.** For PAXG, E02 and E06 agree (4253.226063661451, E02 `quote[].last_updated` and E06
`quotes[].last_updated` both 16:02:03, `E02-quotes-latest-btc-paxg`, `E06-simple-price-btc-paxg`; the E02 item-level
`last_updated` is 16:03:00); E14 `tokens[]` gives 4253.420091887455 for the same `crypto_id` 4705
(`E14-rwa-quotes-gold`) and carries no per-token `last_updated`.

**Decision.**
- In `check`: E02 against E06 (price and `last_updated` for the same CMC ID; E06 is batchable). For an RWA wrapper:
  E14 `tokens[].price` against E02 on the same `crypto_id`.
- E02 against E10 belongs to C1 (market divergence) and is not repeated in C6, so one gap is never counted twice.
- A gap is a contradiction only between values of the same snapshot: when both sides have a `last_updated`, they must
  match within a configured tolerance, otherwise the result is "different snapshots" (info). E14 `tokens[]` have no
  timestamp, so for them only a relative price tolerance applies.
- Left to the audit (T6.1), because they cost extra credits per asset and describe the API rather than one asset:
  E07 vs E02, E03 vs E02, E14 vs E16 aggregates, E17 vs E14 identity fields, E18 `num_tokens` vs E19 tokens, E10 vs
  E09 deepest pool.

## D8 — C7 scores what the verdict needs; API-wide shapes go to the audit

**Decision.**
- Scored per asset: a field that the verdict relies on is absent, `null`, or not a finite number after
  normalisation. These are the prices (E02 `quote[].price`, E10 `p`, E14 `tokens[].price`), the timestamps of C3 and
  the liquidity and volume of C4.
- Not scored, reported by the audit (T6): shapes that are the same for every asset and that the normalisers handle.
  These are `status.error_code` as a number or a string (observation 1), epoch strings in E10 (`ts`, `fpt`, `fpct`,
  `E10-dex-token-price-paxg`) and E11 (`pubAt`), decimal strings in E11 (`E11-dex-token-pools-paxg`), the platform
  ID spaces (observation 8), the fields missing from E03 but present in E02 (observation 9), and `base_asset_id: null`
  in E08 / E09 (observation 13).
  Scoring them would lower every asset by the same amount and break the calibration without saying anything about
  the asset.
- The expected schema of each endpoint is the "Observed fields" table of `docs/ENDPOINTS.md`.

## D9 — Checks that cannot run

**Decision.**
- Every check result has a status: `evaluated` (with a severity `info`, `warning` or `critical`), `not_applicable`
  (C1 and C4 without a token contract, C5 for an asset that is not an RWA wrapper) or `unavailable` (C2 with this key;
  any check whose call failed or timed out).
- The score uses the evaluated checks only, with their weights renormalised. The output lists the other checks with
  their reason and shows the coverage (for example "3 of 7 checks evaluated").
- No automatic verdict cap for low coverage at this stage. Coins without contract (4 of the top 5 in
  `E03-listings-latest-top5`) can never run C1, C2, C4 or C5; a cap would push them below `ACT` for a reason unrelated
  to data quality. T4.2 reviews this with the calibration results.

## D10 — Endpoints outside the per-asset path

| Endpoint | Role |
|---|---|
| E03 | Calibration panel (T4.1); 5.9 s in T1.2, too slow for `check` |
| E07, E09, E16, E17 | Audit comparisons (D7); E16 also RWA demo selection (T5.3), where its documented `sort_dir` (`asc`, `desc`) is still to be tried (observation 12) |
| E08 | Audit and unit-test input only (D3, D5) |
| E18, E19 | Audit, and the token → RWA index of D6 |
| E13 | RWA symbol → `rwa_id`, 0 credit |
| E20 | Credit counter of the client (T2.1), 0 credit |
| E04, E12, E15, E21 | Refused: never called by the code (enforced by `tests/endpoints-doc.test.ts`) |

## D11 — The score, and what it answers when it measured little or nothing

**Decision.** The score (`src/score/`, T3.6) weighs the checks that ran into one number out of 100, reads the
verdict off two boundaries, and holds that verdict back when a check reported something the verdict cannot rest on.

- **A check scores on its worst finding alone.** `severity` is already defined as the worst of a check's findings
  (`src/checks/model.ts`); nothing recorded so far measures what a second warning on the same check should cost.
- **Only the checks that ran are weighed**, renormalised over themselves (D9). Coverage — "2 of 7 checks
  evaluated" — is reported beside the score, never folded into it, and every check that did not run keeps its
  reason and its weight in the output, so that what was not measured stays visible.
- **A critical finding holds the verdict at `CAUTION` or below** (`score.capWithCritical`), whatever the weighted
  mean says. Without it, a run scores 75 — the `ACT` boundary — on the strength of one clean check while another
  reports that the price itself could not be read: C3 weighs 15, C7 weighs 5, and the mean of 100 and 0 over those
  two weights is exactly 75. The cap is not a coverage cap: it is the definition of `critical` applied to the
  verdict. It stops at `CAUTION` rather than `DO_NOT_ACT` because one unusable source among seven is a reason to
  look before acting, not a measurement that the data is wrong; the score still chooses between `CAUTION` and
  `DO_NOT_ACT` underneath it.
- **A run where no check could be evaluated has no score and answers `DO_NOT_ACT`.** This is not the low-coverage
  cap D9 leaves to T4.2, which is about a thin verdict; this is the absence of any measurement to rest one on. The
  summary says so in those words and lists the reason each check gave.

**Where the numbers live.** Weights, the points each severity scores, the two boundaries and the cap are the
`score` section of `config/checks.json`, which says where each number comes from. The boundaries are the ones the
specification states (F5): `ACT` at or above 75, `CAUTION` at or above 40. The weights and the 50 points of a
warning are placeholders — nothing recorded measures them — and T4.2 settles them on the top 50.

**Refused rather than guessed.** The score is given the seven checks, once each: a result missing from the list
would shift every renormalised weight with no output saying so, and a check that cannot run already has a way to
say it (D9). A weight of zero, or a check absent from the weight table, is refused at load for the same reason.

## D12 — The four MCP tools answer from one assessment, and say what they did not weigh

**Decision.** The MCP server (`src/mcp/`, T5.1) exposes the four tools of F6 over stdio. None of them measures
anything of its own: `check_asset`, `check_rwa_token` and `preflight_trade` are one `assessAsset` of D1 each — the
same call plan `npm run check` runs — rendered two ways, as text for a model to read and as structured content for
it to act on. An agent and a reviewer therefore never read two different numbers for one asset.

- **The three asset tools differ only in what they detail.** Measurements are bulky, and an answer buried in them is
  one an agent will not read: `check_asset` carries the findings alone, `check_rwa_token` adds every measurement of
  C5, `preflight_trade` adds every measurement of C4. Nothing else changes between them.
- **`preflight_trade` weighs the order through C4, not beside it.** The size is passed to `assessAsset` as
  `orderSizeUsd`, and the share it reports is read back off the measurement C4 produced rather than divided a second
  time here, so the number the agent reads is the number the verdict was formed on.
- **The side of an order is echoed and changes no measurement.** The depth read is one total per venue — `l` in E10,
  `liqUsd` in E11 — and no recorded answer splits it into bid and ask, so the share of a pool an order takes is the
  same for a buy and for a sell of the same size. Every `preflight_trade` answer says this in those words rather
  than letting a `side` argument imply a directional reading the data does not support.
- **The two order-size limits are still placeholders, and every answer says so.** T4.2 calibrated the four market
  limits of C4 on the top 50 and left `warnOrderSharePercent` and `criticalOrderSharePercent` untouched, because a
  panel of assets does not exercise an order size. This tool is their first reader: the share is measured, where the
  line belongs is not.
- **`explain` reads its limits from the configuration, never restates them.** Every number in an explanation comes
  out of the `ChecksConfig` the run was given, and the `notes` of each section travels with it as the provenance of
  the limit. A threshold written into the prose would be a second copy of `config/checks.json`, and the first one to
  go stale.
- **A failure is an answer, not an exception.** A missing key, a fixture directory that is not there, a symbol no
  endpoint knows: each comes back as a tool result marked as an error, carrying the reason and the fixture behind it
  when there is one. An exception would reach the host as a broken tool rather than as a finding about the data.
- **The server starts without a key.** The client is built inside each call, so a missing `CMC_API_KEY` is reported
  by the tool that needed it while `explain` keeps working. A host showing four tools and one clear message is more
  use than one showing nothing.
- **One client per call.** `CMC_CREDIT_BUDGET` is a ceiling per run (F2) and a server lives for many calls; a shared
  client would spend the ceiling once and refuse every later call. A fresh client per call keeps the budget and the
  credit report per call, and still reads the cache on disk that earlier calls filled.
- **stdout belongs to the protocol.** A stdio server speaks JSON-RPC on stdout, so no module of `src/mcp` writes
  there; the one start-up line goes to stderr. `tests/mcp-server.test.ts` reads the source to keep it that way, and
  for the same reason a host must launch `node dist/mcp/server.js` rather than `npm run mcp`, since npm prints its
  own banner to stdout.

**Where the run mode comes from.** The server reads `--replay[=dir]` and `--record[=dir]` exactly as `check` does,
so the same binary answers from recorded fixtures with no key and no network. That is what lets T5.3 demonstrate the
two agent scenarios offline, on captured answers rather than on a live market.

## D13 — The demonstration agent speaks MCP for real, and says what its captured data does not show

**Decision.** The demonstration of F7 (`src/demo/`, T5.3) spawns the built server as a child process and talks to
it over stdio with the SDK's own client, exactly as the README's configuration tells Claude Desktop to. Calling
`preflightTrade` from `src/mcp/tools.ts` directly would be shorter and would demonstrate nothing: the claim of this
project is that an agent gets its second opinion *through* MCP, and a demonstration that skips the protocol cannot
show the handshake, the tools the server declares, or a tool error arriving as an answer rather than as a crash.
`npm run demo` replays `fixtures/demo` by default — offline, deterministic, free — and `--live` points the same
agent at the API as it is today.

- **It lives under `src/`, not under `demo/`.** The architecture sketch of the specification puts it in
  `demo/agent/`. It is in `src/demo/` instead, so that one `tsconfig`, one ESLint run and one build cover it like
  everything else; a second toolchain root for two hundred lines would be the first thing to drift.
- **The agent's policy is two rules, both written down.** It acts on `ACT` only — `CAUTION` is not a weaker yes —
  and an order whose instruction names a tokenised real-world asset needs C5 to have run. The second rule is the
  interesting one: a verdict alone does not say that the thing being bought is linked to no real-world asset, and
  that is a different failure from a bad price.
- **Every reason it gives is read out of the tool answer.** The agent measures nothing. It reports the verdict, the
  findings the checks raised, the share of the pool the order would take as C4 measured it, and the reason each
  check that did not run gave (D9). What it cannot read, it does not say.
- **It places nothing.** There is no wallet, no venue, no signature and no key anywhere in `src/demo/`. A simulated
  decision is a ticket printed and thrown away, and both the transcript and the accepted decision say so in words.

**What the capture of 2026-09-26 actually found**, recorded in `fixtures/demo` and replayed by
`tests/demo-run.test.ts`:

- **`XAU` does not resolve to gold.** Asked for the ticker an instruction about tokenised gold reaches for, E01
  returns four entries and the run settles on XAU9999 Meme (CMC 37470), a meme token priced around 1e-11 USD. The
  gold wrapper is CMC 39344, five ranks down the same answer. The refusal rests on two independent readings of it:
  C5 links CMC 37470 to no real-world asset, and C4 reports that 25 000 USD is 219.83 % of the 11 372.54 USD held
  by the deepest pool behind that price.
- **The refusal is `CAUTION`, not the `DO_NOT_ACT` F7 asks for.** No recorded asset produced one, and the reason is
  in the engine rather than in the sample: D11 gives `DO_NOT_ACT` to a run that measured nothing at all, while a
  run that measured plenty and found a critical problem is held at `CAUTION` by `capWithCritical`. F7 allows the
  most telling case found when nothing produces a `DO_NOT_ACT` at capture time; this is it, and the scenario
  catalogue, the transcript and this decision all say so rather than dressing the verdict up.
- **An observation for the audit (T6).** CMC 39344, the entry that does carry gold under this ticker, was recorded
  in the same session. It reports a market capitalisation of 0 and a 24 h volume of 0, and still scores ACT
  100/100 — on 4 of the 7 checks, because E05 lists no token contract for it, so C1 and C4 are `not_applicable` and
  nothing else the verdict reads looks at volume. That is a gap in this engine's coverage, not a fault of the API:
  an asset nobody trades passes every check that can still run. It is left as an observation rather than patched
  into a rule here, because D9 already settled that low coverage does not cap a verdict, and T4.2 measured what
  re-opening that would cost on the top 50. Its answers stay in `fixtures/demo` as the evidence behind the
  observation, although no scenario replays them.

## D14 — The audit measures recorded answers and sends no request

**Decision.** `npm run audit` (T6.1) reads the answers this project already captured and makes no call of its own.

- **Why.** Specification F9 states that a finding without captured evidence is not published. If the audit called
  the API while it ran, its strongest statements would rest on answers a reader has no way to open. Reading the
  corpus instead makes the rule enforceable rather than promised: `auditFindings` drops any entry whose evidence
  list names no file, and the report prints how many it dropped. It also means the report costs 0 credits and
  reproduces on a clone with no API key.
- **The corpus is a named list of captures, not `fixtures/` as a whole.** Two partial recordings of the
  calibration walk sit in the repository — a run of 2026-09-25 left loose at the root of `fixtures/calibration/`,
  and `live-2026-09-26/`, stopped at 25 assets of 50. Counting them would report one request several times over
  and attribute the answers of one walk to another, which is the same reason
  `tests/helpers/calibration-fixtures.ts` replays one dated directory.
- **Latency is reported twice.** A run that paces itself against the per-minute limit waits for a free slot inside
  the measured interval, so its recorded latencies are upper bounds. The report states the measurement from the
  captures recorded one call at a time and the upper bound from the paced one, and never mixes them.
- **Field comparison runs in one direction only.** The baseline is the "Observed fields" table of
  `docs/ENDPOINTS.md` (D8): a name it records that no answer carries is publishable; everything an answer carries
  that the table omits is not, because the table says "fields of interest" and never claimed to be exhaustive.
  Three of its rows state their fields by reference ("the same fields as E14, without `tokens`"); resolving that
  mechanically would mean deciding what becomes of the names nested inside the excluded field, so those rows are
  carried through uncompared and the report says so.
- **Only accepted answers are read for shape.** A refusal carries a `status` block and no `data`, so counting it
  would report every field of the endpoint as one that comes and goes. Refusals are measured in their own entry.
- **The engine pass covers C3, C6 and C7 only.** Those three describe the data rather than one asset's venues.
  C1, C4 and C5 stay in `check`; C2 has no source with this key (D2).
- **No entry states a cause.** An answer that did not arrive is counted as an answer that did not arrive. Why is
  not something a corpus of recorded answers can establish.

## D15 — The web interface is its own package, and serves recorded answers when it has no key

**Decision.** The application of F8 lives in `web/` as a separate npm package that depends on this one
(`"second-opinion": "file:.."`), and every decision it renders is made in `src/web/` rather than in `web/app`.

- **Why a second package rather than a folder of this one.** The two need incompatible TypeScript projects: this
  one compiles Node ES modules with `nodenext` resolution and no JSX, the application needs `jsx: react-jsx` and
  `moduleResolution: bundler`. Holding both in one project means weakening the root project to the looser of the
  two, which would relax the settings every other file here is checked under. They therefore keep one `tsconfig`
  and one ESLint configuration each, and the root linter ignores `web/`. The root delegates: `npm run web:build`
  builds the engine first, so the application reads `dist/` and never `src/`.
- **Why the browser half holds markup only.** `npm test` never loads `web/`, so anything decided there would be
  decided where the offline suite cannot reach it. What a reader sees — the tone of a verdict, the words of a
  check, the unit a number is printed in, what the audit page counts — is settled in `src/web/` and covered by
  `tests/web-view.test.ts`, `tests/web-lookup.test.ts`, `tests/web-settings.test.ts` and
  `tests/web-audit-view.test.ts`. `tests/web-app.test.ts` then reads the application as source, to check that it
  stays that way and that every name it imports is really exported here.
- **The key stays on the server, held by two locks rather than one.** Next.js inlines every `NEXT_PUBLIC_*`
  variable into the browser bundle, which is the only way the key could leave this server. `readWebSettings`
  refuses to start a deployment that puts a credential — by name, or by value — under that prefix, and
  `tests/web-app.test.ts` refuses to let the browser half name the key, name that prefix, read `process.env` or
  ship a client component at all. There is no client component in the application, so there is nothing to leak
  into.
- **No key means replay, not an error.** A clone with no `CMC_API_KEY` serves the recorded answers of
  `fixtures/` and says so on the page, in the sentence under the verdict. `SECOND_OPINION_MODE` forces either
  mode; `record` is refused, because recording writes files and spends credits per visitor, which is not
  something an HTTP endpoint should do.
- **Neither page is cached, and both run on Node.** A verdict is about the data as it is now: a cached `ACT` is
  the exact failure this project exists to prevent. The audit page is dynamic for a different reason — which
  report it reads is a setting (`SECOND_OPINION_AUDIT_FILE`), and `outputFileTracingIncludes` traces
  `docs/api_audit.json` into the deployment precisely so that it can be read at request time; prerendering it
  would freeze the build's environment and leave that tracing with no reader.
- **Two things a request never does.** It never builds the wrapper index, which costs a walk of the RWA issuers
  and 8.3 s of a 10-second budget (D6): a cached one is read from disk, failing which it is rebuilt once per
  process, in memory, from the recorded walk in `fixtures/rwa-index`, so a host with a read-only filesystem still
  answers C5. And it never caches under `.cache/cmc`, which a serverless deployment cannot write to: a live
  interface caches under the system temporary directory instead, and a replay uses no disk cache at all.

**Measured end to end (T7.1, 2026-09-27).** Built with `npm run web:build` and served with `next start`, with no
`CMC_API_KEY` in the environment, so the deployment ran in replay. Six routes answered HTTP 200: the search page;
the audit page, printing the 24 published entries of `docs/api_audit.json` with the recorded answers each cites;
`PAXG` (`ACT`, 100 / 100, 6 of 7 checks evaluated, read from `fixtures/check`); the numeric CoinMarketCap ID
`4705`, which resolves to that same asset and verdict without the resolution call (D3); a symbol that resolves to
nothing (`DO_NOT_ACT`, no score, 0 of 7, each check carrying the reason it did not run, per D9); and the asset
page with no query. The API key held in `.env` — 32 characters — appears **0 times** in the HTML of all six, as
does the `X-CMC_PRO_API_KEY` header name. The slowest of the six took 151 ms and the run spent **0 credits**.

## D16 — The deployment is the app directory with the repository behind it, and two settings live outside the file

**Decision.** The Vercel project takes `web/` as its Root Directory, and `web/vercel.json` overrides the install
and build commands so that the engine is installed and compiled before the application is built against it:

```json
{
  "installCommand": "npm install --prefix .. && npm install",
  "buildCommand": "npm run build --prefix .. && npm run build"
}
```

- **Why the Root Directory is `web/` and not the repository.** The Next.js application is there: `next` is a
  dependency of `web/package.json` and of nothing else, and Vercel's Next.js preset builds the directory it is
  given. Vercel reads `vercel.json` from that Root Directory — the file is at `web/vercel.json` for the same
  reason Vercel's own monorepo documentation writes `apps/web/vercel.json` — so a copy at the repository root
  would never be read.
- **Why both commands are overridden.** Left alone, Vercel would run `npm install` and then `next build` inside
  `web/`, and the application would be built against a `dist/` that does not exist: it depends on this package as
  `file:..`, whose `exports` point at `dist/` (D15). Both commands therefore take the parent first. They are the
  two steps of `npm run web:build` seen from `web/` rather than from the root — deliberately the same path the
  repository is verified with, so that a deployment is not a second, untested build.
- **Nothing else is overridden.** The output stays where the preset expects it, `web/.next`. `engines.node`
  (`>=20.19`) is a range Vercel resolves to its current default, Node 24.x, so no version is pinned in the
  dashboard. The default function duration, 300 s, is far above the 10-second budget of one assessment (D1), so
  no `maxDuration` is set.
- **Two settings cannot be expressed in the file, and are therefore prose.** Vercel's configuration has a
  property for neither the Root Directory nor **Include source files outside of the Root Directory in the Build
  Step**, which is what lets the build reach `..` — for the engine, and for the three things a request reads
  above the application: `config/checks.json`, `fixtures/` and `docs/api_audit.json` (D15). Vercel enables that
  option by default on projects created after 27 August 2020; the README tells an operator to check it rather
  than assume it, because with it off the build cannot see the parent at all and nothing here works.
- **The key is never in the repository.** `CMC_API_KEY` is set on the deployment, and a deployment with no key
  serves the recorded answers of `fixtures/` instead of failing (D15). `web/vercel.json` holds four build
  settings and no value that could be a credential.

**What was verified, and what a deploy alone can confirm.** Both commands were run from `web/` as the working
directory, which is where Vercel runs them: the install resolved both packages, `npm run build --prefix ..` wrote
`dist/`, and `next build` then produced `web/.next` with `/asset` and `/audit` dynamic and `/` static — the
routing D15 asks for. `tests/vercel-config.test.ts` holds the settings to the scripts they delegate to, and holds
the README to the environment variables `src/web/` actually reads, so neither can drift from the other in
silence. What remains unverified is the platform's own behaviour — that the Root Directory and the
outside-the-root option compose as documented — because deploying is a human task (specification section 9), and
this repository has never been deployed.


## Handed to later tasks

- **T2.1:** accept both shapes of the `status` block (observation 1); per-call timeout; long cache TTL for E01, E05
  and E13.
- **T2.3:** normalisers parse E10 / E11 numeric strings and epoch strings (D8), and keep `status.timestamp` for C3
  (D4).
- **T3.1–T3.5:** *landed.* Threshold families of D4, snapshot tolerance of D7, unit band and conversion factors of
  D6 all sit in `config/checks.json`, each section saying where its numbers come from.
- **T3.6:** *landed.* Check statuses and renormalised score (D9), with the weights, the boundaries and the
  critical cap in `config/checks.json` (D11).
- **T3.7:** *landed.* The plan of this decision runs in `src/checks/assess.ts`, and `src/cli/check.ts` prints it:
  the verdict, each check with the share of the score it carried or the reason it did not run, and the answer behind
  every line.
- **T4.2:** *landed.* Low coverage does not cap the verdict (D9); the weights, the points a warning costs and the two
  boundaries of D11 were read against the top 50 and kept, with what the panel does and does not settle written into
  the `notes` of `config/checks.json`.
- **T5.1:** *landed.* The four tools of F6 over stdio (D12), each answering from one `assessAsset` of D1.
- **T5.3:** *landed.* The two scenarios of F7 run over a real MCP pipe against captured answers (D13). Both limits
  flagged when this line was written are still placeholders and the transcript prints both caveats every run: the
  order-size limits of C4 that `preflight_trade` is the first reader of (D12), and the RWA limits of C5 that rest
  on one recorded asset (D6).
- **T6.1:** *landed.* `npm run audit` measures the recorded corpus and writes `docs/API_AUDIT.md` and
  `docs/api_audit.json` (D14). The note D13 left — an entry reaching ACT on reduced coverage — is generalised
  rather than special-cased: the audit reports every asset of its sample that reaches `ACT` on fewer than five of
  the seven checks, with the answer each verdict was read from.
- **T6.2:** every entry of the report is to be reread for proof, wording and neutrality, and any entry that does
  not hold is to be removed. The generators are in `src/audit/findings.ts`, one function per kind of entry.
- **T7.1:** *landed.* The interface of F8 is its own package (D15), serving the search page, the verdict with
  every check and its evidence, and the published audit — from `src/web/`, which the offline suite covers, with
  the key held on the server and the deployment falling back to replay when it has none.
- **T7.2:** *landed.* `web/vercel.json` and the README's deployment section (D16) give the host the seven
  variables it may set — the four named here, plus `CMC_API_KEY`, `SECOND_OPINION_FIXTURES` and
  `SECOND_OPINION_ROOT` — and the Root Directory the build runs from, with the option that lets it read
  `config/`, `fixtures/` and `docs/api_audit.json` above its own folder. Deploying itself stays a human task.
