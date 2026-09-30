# CMC API endpoints — inventory and live verification

This file lists the CoinMarketCap Pro API endpoints that Second Opinion may use, and the checks (C1–C7) each one
feeds. **No endpoint may be used in the code unless its row below says `verified`.**

- **T1.1 (2026-09-24):** candidates selected from the official documentation only.
- **T1.2 (2026-09-24, this version):** every candidate was called with the hackathon key between 16:03 and 16:09 UTC.
  Each raw exchange is saved in `fixtures/discovery/<label>.json` (key masked as `***`), recorded with
  `npm run record -- <label> <api path> [name=value ...]`. Statuses, credit costs, latencies and fields below are
  **observed**, and `tests/endpoints-doc.test.ts` checks them against the fixtures.
- **T1.3 (2026-09-24):** one more candidate, E21 (exchange market pairs, a possible replacement for the refused E04),
  was called at 16:18 UTC and refused. The checks are adapted to these results in [`docs/DECISIONS.md`](DECISIONS.md).

## Sources read

Retrieved on 2026-09-24:

- Endpoint chooser: <https://coinmarketcap.com/api/documentation/pro-api-reference/endpoint-overview>
- Real World Assets reference: <https://coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets>
- Category references (interactive pages, which carry the plan lists and example responses):
  `cryptocurrency`, `exchange`, `token`, `platform`, `holder`, `ohlcv`, `tools`, `crypto-others` and `deprecated`
  under <https://coinmarketcap.com/api/documentation/pro-api-reference/>
- Per-endpoint Markdown pages (the same URL + `.md`, indexed in <https://coinmarketcap.com/llms.txt>), which carry the
  parameter and response schemas; for the DEX endpoints: `token/pairs-listings-latest.md`, `token/get-token-price.md`,
  `token/get-token-pools.md`, `token/query-token-liquidity.md`
- Changelog: <https://coinmarketcap.com/api/documentation/changelog> (Real World Assets category added on 2026-07-07)
- Rate limits and error codes: <https://coinmarketcap.com/api/documentation/guides/errors-and-rate-limits>

All endpoints share the base URL `https://pro-api.coinmarketcap.com`; the key goes in the `X-CMC_PRO_API_KEY` header.
A `403` with error code `1006` means that the plan does not include the endpoint.

## The hackathon key

Observed with E20 (`fixtures/discovery/E20-key-info-before.json`): 15,000 credits per month (reset on
2026-10-01T00:00:00Z) and 50 requests per minute. The response does not name the plan. The T1.2 run consumed
**15 credits** (E20 `current_month.credits_used` went from 0 to 15), which equals the sum of `status.credit_count`
over all the fixtures of the run. The E21 call of T1.3 reported `credit_count` 0.

## Status legend

| Status | Meaning |
|---|---|
| `to verify` | Selected from the documentation, not called yet. Must not be used in the code. |
| `verified` | Called with the hackathon key, HTTP 200, raw response saved in `fixtures/`. |
| `refused` | Called with the hackathon key and rejected (plan, error code or unusable response); cause noted. |

## Inventory

"Startup" is whether the endpoint's documentation page lists the Startup plan. "Credits" is the documented
"Plan credit use". "Update" is the documented cache / update frequency. The observed values are in the next section.

### Aggregated market data (cryptocurrency)

| ID | Endpoint | Startup | Credits | Update | Checks | T1.2 status |
|---|---|---|---|---|---|---|
| E01 | `GET /v1/cryptocurrency/map` | listed | not stated | every 30 s | support (symbol → CMC ID) | verified |
| E02 | `GET /v3/cryptocurrency/quotes/latest` | listed | 1 per 250 assets, +1 per extra `convert` | every 60 s | C1, C2, C3, C6, C7 | verified |
| E03 | `GET /v3/cryptocurrency/listings/latest` | listed | 1 per 250 assets, +1 per extra `convert` | every 60 s | C6, calibration panel (T4.1) | verified |
| E04 | `GET /v2/cryptocurrency/market-pairs/latest` | listed | 1 per 250 pairs, +1 per extra `convert` | every 1 min | C2, C3, C6, C7 | refused |
| E05 | `GET /v2/cryptocurrency/info` | listed | 1 per 250 assets | every 30 s | support (CMC ID → token contract address) | verified |
| E06 | `GET /v2/simple/price` | listed | 1 per 250 assets, +1 per extra `convert` | every 60 s | C6 | verified |
| E07 | `GET /v2/tools/price-conversion` | listed | 1 per call, +1 per extra `convert` | every 60 s | C6 | verified |

### DEX data

| ID | Endpoint | Startup | Credits | Update | Checks | T1.2 status |
|---|---|---|---|---|---|---|
| E08 | `GET /v4/dex/spot-pairs/latest` | not stated | not stated | not stated | C1, C3, C4, C7 | verified |
| E09 | `GET /v4/dex/pairs/quotes/latest` | not stated | not stated | not stated | C1, C4, C6 | verified |
| E10 | `GET /v1/dex/token/price` | not stated | not stated | not stated | C1, C4, C6, C7 | verified |
| E11 | `GET /v1/dex/token/pools` | not stated | not stated | not stated | C4, C7 | verified |
| E12 | `GET /v1/dex/token-liquidity/query` | not stated | not stated | not stated | C4 | refused |

### Real World Assets (RWA)

| ID | Endpoint | Startup | Credits | Update | Checks | T1.2 status |
|---|---|---|---|---|---|---|
| E13 | `GET /v5/real-world-assets/map` | listed | "No credit is needed" | every 30 s | support (symbol → `rwa_id`) | verified |
| E14 | `GET /v5/real-world-assets/quotes/latest` | listed | 1 per 250 assets, +1 per extra `convert` | every 60 s | C3, C5, C6, C7 | verified |
| E15 | `GET /v5/real-world-assets/market-pairs/list` | listed | 1 per 250 pairs, +1 per extra `convert` | every 1 min | C2, C3, C5, C7 | refused |
| E16 | `GET /v5/real-world-assets/assets/list` | listed | 1 per 250 assets, +1 per extra `convert` | every 1 min | C6, RWA demo selection | verified |
| E17 | `GET /v5/real-world-assets/info` | listed | 1 per 250 assets | every 30 s | C6, C7 | verified |
| E18 | `GET /v5/real-world-assets/issuers/list` | listed | 1 per request | every 30 s | C5 (wrapper index), C6, C7 (audit) | verified |
| E19 | `GET /v5/real-world-assets/issuers` | listed | 1 per request | every 30 s | C5 (wrapper index), C6, C7 (audit) | verified |

### Exchange data

| ID | Endpoint | Startup | Credits | Update | Checks | Status |
|---|---|---|---|---|---|---|
| E21 | `GET /v1/exchange/market-pairs/latest` | listed | 1 per 250 pairs, +1 per extra `convert` | every 60 s | C2 | refused |

### Utilities

| ID | Endpoint | Startup | Credits | Update | Checks | T1.2 status |
|---|---|---|---|---|---|---|
| E20 | `GET /v1/key/info` | listed | "No API credit cost" (counts towards the minute rate limit) | no cache | support (plan name, credit usage, credit counter in T2.1) | verified |

## T1.2 results

One row per endpoint (E21 was added in T1.3). "Credits" is the `status.credit_count` of the first fixture listed; "HTTP / error_code" and
"Latency" (client-side, including the network) also refer to it. Further fixtures are the retries described in the notes.

| ID | Result | HTTP / error_code | Credits | Latency | Fixtures | Notes |
|---|---|---|---|---|---|---|
| E01 | verified | 200 / `0` | 0 | 864 ms | `E01-map-btc-paxg` | `symbol=BTC,PAXG`: 14 entries, 13 of them named BTC; Bitcoin is `id=1` (the only one with `rank` 1 and `platform: null`), PAX Gold is `id=4705` |
| E02 | verified | 200 / `"0"` | 1 | 1184 ms | `E02-quotes-latest-btc-paxg` | `id=1,4705&convert=USD`; `data` is an array, `quote` an array of one USD object |
| E03 | verified | 200 / `"0"` | 1 | 5876 ms | `E03-listings-latest-top5` | `start=1&limit=5&convert=USD` |
| E04 | refused | 403 / `1006` | 0 | 907 ms | `E04-market-pairs-btc`, `E04-market-pairs-paxg`, `E04-market-pairs-btc-minimal` | "Your API Key subscription plan doesn't support this endpoint.", also with only `id=1&limit=10` |
| E05 | verified | 200 / `0` | 1 | 1446 ms | `E05-info-btc-paxg` | `data` is an object keyed by CMC ID; PAXG `contract_address[]` gives the Ethereum token address |
| E06 | verified | 200 / `"0"` | 1 | 994 ms | `E06-simple-price-btc-paxg` | `include_last_updated=true` adds `quotes[].last_updated` |
| E07 | verified | 200 / `0` | 1 | 812 ms | `E07-price-conversion-paxg` | `amount=1&id=4705&convert=USD`; `quote` is an object keyed by currency |
| E08 | verified | 200 / `"0"` | 1 | 1363 ms | `E08-dex-spot-pairs-paxg-uniswap`, `E08-dex-spot-pairs-paxg-by-contract`, `E08-dex-spot-pairs-paxg` | Needs `dex_id` or `dex_slug`: without them, HTTP 400 "Please provide either a dex id or dex slug." (`E08-dex-spot-pairs-paxg`). With `dex_id=1069,1348`, 100 pairs came back although `limit=10` was sent, and neither `base_asset_ucid=4705` nor `base_asset_contract_address` narrowed them (3 PAXG pairs out of 100) |
| E09 | verified | 200 / `"0"` | 1 | 1053 ms | `E09-dex-pair-quotes-paxg-weth` | `contract_address` = PAXG/WETH Uniswap v2 pool from E11, `network_slug=ethereum` |
| E10 | verified | 200 / `"0"` | 1 | 5132 ms | `E10-dex-token-price-paxg` | `platform=ethereum` (E05 `platform.slug`) and the PAXG token address |
| E11 | verified | 200 / `"0"` | 1 | 2959 ms | `E11-dex-token-pools-paxg` | `size=10`: 10 pools on Uniswap v2/v3/v4 |
| E12 | refused | 400 / `"400"` | 0 | 1506 ms | `E12-dex-token-liquidity-paxg`, `E12-dex-token-liquidity-paxg-minimal` | "Parameter error", also with only `platform` and `address`. `interval` is documented as "Time interval" without allowed values, so no value was tried |
| E13 | verified | 200 / `"0"` | 0 | 796 ms | `E13-rwa-map-gold` | `symbol=GOLD`: `rwa_id=1`, `asset_type` `commodity` |
| E14 | verified | 200 / `"0"` | 1 | 757 ms | `E14-rwa-quotes-gold` | `rwa_id=1`: 7 wrapper tokens, `tradfi_markets` empty |
| E15 | refused | 403 / `"1006"` | 0 | 624 ms | `E15-rwa-market-pairs-gold` | "Your API Key subscription plan doesn't support this endpoint." |
| E16 | verified | 200 / `"0"` | 1 | 1064 ms | `E16-rwa-assets-list` | `limit=20&sort=tokenized_volume_24h`: `total_size` 7942, `has_more` true |
| E17 | verified | 200 / `"0"` | 1 | 646 ms | `E17-rwa-info-gold` | `rwa_id=1` |
| E18 | verified | 200 / `"0"` | 1 | 654 ms | `E18-rwa-issuers-list` | `limit=50`: 25 issuers, `has_more` false |
| E19 | verified | 200 / `"0"` | 1 | 721 ms | `E19-rwa-issuer-paxos` | `issuer_id` of Paxos, taken from E14 `tokens[].issuer_id` |
| E20 | verified | 200 / `0` | 0 | 1274 ms | `E20-key-info-before`, `E20-key-info-after` | Read before and after the run |
| E21 | refused | 403 / `1006` | 0 | 706 ms | `E21-exchange-market-pairs-binance-paxg` | T1.3, `slug=binance&matched_id=4705&limit=10`: "Your API Key subscription plan doesn't support this endpoint." |

## Observed fields

Field names and JSON types as received; `?` marks a field that was `null` for some items. Identifiers used in the
calls all come from earlier responses: BTC `1` and PAXG `4705` from E01, GOLD `rwa_id=1` from E13, the PAXG token
address and platform slug from E05, pools and DEX IDs from E11, the Paxos `issuer_id` from E14.

| ID | Request parameters used | Response fields of interest (observed) |
|---|---|---|
| E01 | `symbol` | `data[]`: `id`, `name`, `symbol`, `slug`, `rank`, `is_active`, `first_historical_data`, `last_historical_data`, `platform?` (`id`, `name`, `symbol`, `slug`, `token_address`) |
| E02 | `id`, `convert=USD` | `data[]`: `id`, `symbol`, `slug`, `is_active`, `is_fiat`, `num_market_pairs`, `cmc_rank`, `last_updated`, `circulating_supply`, `platform?` (`id` number); `quote[]`: `id`, `symbol`, `price`, `volume_24h`, `cex_volume_24h`, `dex_volume_24h`, `market_cap`, `fully_diluted_market_cap`, `last_updated` (all numbers except the date) |
| E03 | `start`, `limit`, `convert=USD` | Same as E02, without `is_active` and `is_fiat` |
| E05 | `id` | `data.<id>`: `id`, `symbol`, `category`, `platform?` (`id` **string**, `name`, `slug`, `token_address`), `contract_address[]` (`contract_address`, `platform.name`, `platform.coin.id` string) |
| E06 | `id`, `include_last_updated=true` | `data[]`: `id`, `symbol`, `quotes[]` (`symbol`, `price`, `last_updated`) |
| E07 | `amount`, `id`, `convert=USD` | `data`: `id`, `symbol`, `amount`, `last_updated`, `quote.USD` (`price`, `last_updated`) |
| E08 | `dex_id`, `network_slug` (base asset filters and `limit` had no observed effect) | `data[]`: `contract_address`, `name`, `base_asset_ucid?` (string), `base_asset_symbol`, `base_asset_contract_address`, `quote_asset_*`, `dex_id` (string), `dex_slug`, `network_id` (string), `network_slug`, `last_updated`, `scroll_id`, `base_asset_id` (null); `quote[]`: `convert_id` (string), `price`, `price_by_quote_asset`, `volume_24h`, `liquidity`, `fully_diluted_value`, `last_updated` |
| E09 | `contract_address` (pool), `network_slug` | Same pair and quote fields as E08, without `scroll_id` |
| E10 | `platform`, `address` | `data`: `pid` (number), `pdex` (platform name), `a` (address), `p` (price USD), `pc24h`, `v24h`, `l` (liquidity USD), `mc`, `ts`, `fpt`, `fpct` (the last three are millisecond epochs sent as **strings**) |
| E11 | `platform`, `address`, `size` | `data[]`: `addr`, `exid` (number), `exn`, `liqUsd` (string), `v24` (string), `pubAt` (string ms epoch), `bidx`, `fa`, `top`, `mi`, `t0` / `t1` (`addr`, `sym`, `n`, `liq`, `liqUsd`, all strings) |
| E13 | `symbol` | `data.rwa_assets[]`: `rwa_id`, `name`, `symbol`, `slug`, `asset_type`, `rwa_rank`, `has_tokens`, `first_historical_data`, `last_historical_data`; `data.total_size`, `data.has_more` |
| E14 | `rwa_id` | `data.rwa_assets[]`: `rwa_id`, `name`, `symbol`, `asset_type`, `rwa_rank`, `has_tokens`, `average_tokenized_price`, `tokenized_market_cap`, `tokenized_volume_24h`, `last_updated`, `quotes[]` (`symbol`, `crypto_id`, the same three aggregates, `last_updated`), `tokens[]` (`symbol`, `name`, `price`, `crypto_id`, `issuer_id`, `issuer_name`, `market_cap`, `volume_24h`), `tradfi_markets[]` (empty for GOLD) |
| E16 | `limit`, `sort` | `data.rwa_assets[]`: same aggregate fields as E14, without `tokens` and `tradfi_markets`; `data.total_size`, `data.has_more` |
| E17 | `rwa_id` | `data.rwa_assets[]`: `rwa_id`, `name`, `symbol`, `slug`, `asset_type`, `rwa_rank`, `has_tokens`, `primary_exchange?`, `website?`, `employees?`, `founded?`, `industry?`, `cik?`, `about` (`description`, `logo?`, `website?`, `date_added`) |
| E18 | `limit` | `data.issuers[]`: `issuer_id`, `name`, `website?`, `logo?`, `num_tokens`; `data.total_size`, `data.has_more` |
| E19 | `issuer_id` | `data`: `issuer_id`, `name`, `website`, `num_tokens`, `total_size`, `has_more`, `tokens[]` (`name`, `symbol`, `crypto_id`, `rwa_id`) |
| E20 | none | `data.plan` (`credit_limit_monthly`, `credit_limit_monthly_reset`, `credit_limit_monthly_reset_timestamp`, `rate_limit_minute`), `data.usage` (`current_minute.requests_made` / `requests_left`, `current_day.credits_used`, `current_month.credits_used` / `credits_left`) |

The `status` block has two shapes (see observation 1): `error_code` number, `error_message` null and a `notice`
field, or `error_code` string, `error_message` empty string and no `notice`. Both carry `timestamp`, `elapsed` and
`credit_count`.

## Coverage of the checks after T1.2

The gaps below are settled in [`docs/DECISIONS.md`](DECISIONS.md) (T1.3).

| Check | Verified sources | Gap to settle in T1.3 |
|---|---|---|
| C1 — aggregated price vs DEX pairs | E02 + E10, E09, E11 | E08 cannot be filtered on one token in the observed calls; E11 (pools of a token) + E09 (quotes of those pools) or E10 (token price) do it. |
| C2 — aggregated price vs CEX pairs | E02 only | **E04, E15 and E21 (T1.3) are refused with the Startup key**: no per-exchange CEX price is available. E02 still gives `cex_volume_24h` / `dex_volume_24h`. |
| C3 — freshness (`last_updated`) | E02, E06, E07, E08, E09, E14, E16 (`last_updated`); E10 `ts` | None. |
| C4 — phantom liquidity | E08, E09, E11 (`liquidity` / `liqUsd` with `volume_24h` / `v24`), E10 (`l`, `v24h`) | E12 (liquidity history) is unavailable; C4 works on the latest snapshot only. |
| C5 — RWA premium/discount and spread between wrappers | E14 (`tokens[].price` vs `average_tokenized_price`), E02 / E10 on each token's `crypto_id` | No underlying reference price (`tradfi_markets` empty for GOLD; E15 refused). Wrappers of one asset are quoted in different units (observation 7). |
| C6 — cross-endpoint consistency | E02 vs E03 vs E06 vs E07 vs E14 `tokens[]` vs E10 / E09; E14 vs E16 vs E17; E18 `num_tokens` vs E19 | None. |
| C7 — schema anomalies | every verified endpoint | None. |

## Observations to carry into T1.3 and T6

These are **not audit findings** yet: each is a fact seen in one T1.2 fixture, written down so that T1.3 (decisions)
and T6 (audit, which re-checks and words them) can use it.

1. **Two shapes of the `status` block.** E01, E05, E07 and E20 send `error_code` as a number (`0`, and `1006` for
   the E04 and E21 refusals) with `error_message: null` (the refusal text when refused) and a `notice` field; E02, E03, E06, E08–E19 send it as a string
   (`"0"`, `"400"`, `"1006"` for the E15 refusal) with `error_message: ""` and no `notice`. The client must accept both.
2. **Plan coverage differs from the documentation for three endpoints.** E04, E15 and E21 pages list the Startup
   plan, and all three answer 403 / 1006 with the hackathon key (`E04-market-pairs-btc`, `E15-rwa-market-pairs-gold`,
   `E21-exchange-market-pairs-binance-paxg`).
3. **DEX endpoints are available with the Startup key**, at 1 credit per call for E08–E11 (their pages state no plan
   and no cost).
4. **E08 parameters.** No parameter is marked required in the documentation, but the call without `dex_id` /
   `dex_slug` gets HTTP 400; with them, `limit=10` returned 100 pairs and the base-asset filters did not narrow the
   result (`E08-dex-spot-pairs-paxg-uniswap`, `E08-dex-spot-pairs-paxg-by-contract`).
5. **E12 parameters.** HTTP 400 "Parameter error" with the documented parameters; the allowed `interval` values are
   not documented.
6. **E13 credit cost.** `credit_count` 0, and E20 usage matches: the page text ("No credit is needed") is what the
   API does; its example response (`credit_count: 1`) differs.
7. **Units of RWA wrappers.** In E14, GOLD wrappers are priced about 4,250 USD (PAXG, XAUt, XAUM, XAUT0, XAU) or
   about 137 USD (CGO, VNXAU); nothing in the response states the unit (troy ounce, gram…). `average_tokenized_price`
   is 4255.05. A wrapper spread needs a unit per token, which T1.3 must source or restrict.
8. **Same platform, several ID spaces.** For Ethereum tokens, `platform.id` is 1 in E01 (PAXG), 1027 as a number in
   E02 (PAXG) and E03 (USDT), and "1027" as a string in E05 (PAXG); DEX endpoints use `network_id` "1" (E08/E09) or
   `pid` 1 (E10).
9. **E03 vs E02 fields.** E03 items have no `is_active` / `is_fiat`, which E02 items have; the documentation says the
   data of the two endpoints is "otherwise the same".
10. **PAXG price across endpoints (about 16:04–16:07 UTC).** E02, E06 and E07: 4253.2261; E14 `tokens[]`: 4253.4201;
    E10 and E09 (Uniswap v2 PAXG/WETH): 4264.1538 (+0.26 % vs E02). Useful as a first C1 / C6 case.
11. **E08 contains natural C3 / C4 cases**: pairs whose `last_updated` is in May 2025 (e.g. WETH/TRUMP2028), and a
    pair with about 171 USD of liquidity and about 40 M USD of 24 h volume (BULL/WETH).
12. **E16 sort.** With `sort=tokenized_volume_24h`, the 20 assets returned all have `tokenized_volume_24h` 0
    (ascending order, or no sort); `sort_dir` was not tried.
13. **E09 echoes** `network_slug` as "Ethereum" for a request made with `ethereum`, and returns `base_asset_id` null
    next to a string `base_asset_ucid`.
14. **Latency.** Most calls took 0.6–1.5 s end to end; E03 took 5.9 s, E10 5.1 s and E08 3.7 s. This matters for the
    10-second budget of `npm run check`.
15. **Coverage of the token → RWA link (T3.4, 2026-09-25).** Walking E18 and then E19 for every issuer reads the
    whole issuer catalogue: 25 issuers, 2393 tokens. 1437 of them (60.1 %) carry both a `crypto_id` and an `rwa_id`;
    956 (39.9 %) carry at most one, and no other verified endpoint links a wrapper to its asset, so those tokens
    cannot be resolved from a symbol. Recorded in `fixtures/rwa-index/`. This is a coverage measurement, not a
    defect: T6 re-checks it and decides how to word it.

## Paging of E18 and E19, verified in T3.4 (2026-09-25)

The token → RWA index C5 needs (`docs/DECISIONS.md` D6) is the one walk of the whole catalogue this project makes,
so both endpoints were paged for real and the 30 answers recorded in `fixtures/rwa-index/`.

- Both take `start` (1-based) and `limit`, and both answer `data.total_size` and `data.has_more`. E19 refuses
  `limit=1000` with "Must be an integer between 1 and 250" (`E19-rwa-issuer-backed-limit1000`), so 250 is the page
  size used; E18 accepted `limit=250` and returned its 25 issuers in one page with `has_more` false.
- Cost: 1 credit per answer for both, confirmed twice over — the sum of `status.credit_count` over the 30 answers is
  30, and E20 `current_month.credits_used` read before and after the walk went from 18 to 48.
- An issuer whose E18 entry reports `num_tokens` 0 has no page to read; three of the 25 are in that case, and the
  walk skips them rather than spending a credit on an empty list.
- Speed: 8.3 s for the 30 answers, median latency 276 ms, well inside the 50 requests per minute of the plan. Two
  further attempts came back without any answer and were retried; the recorder writes a fixture for any HTTP reply,
  so their absence from `fixtures/rwa-index/` is what says they failed below HTTP, and the E20 counter says they were
  not charged.

## Considered and not retained

| Endpoint(s) | Reason |
|---|---|
| `/v1/cryptocurrency/quotes/latest`, `/v2/cryptocurrency/quotes/latest`, `/v1/cryptocurrency/market-pairs/latest`, `/v1/simple/price`, `/v1/tools/price-conversion`, `/v4/dex/listings/*`, `/v4/dex/pairs/ohlcv/*`, `/v4/dex/pairs/trade/latest` | Listed in the "Deprecated" section; the current versions are used instead. |
| Other `/v1/exchange/*` | The exchange reference page groups them as metadata, rankings, volume data and proof of reserves; only `/v1/exchange/market-pairs/latest` returns per-pair prices, and it is E21, refused. |
| `/v1/dex/token`, `/v1/dex/search`, `POST /v1/dex/token/price/batch`, `POST /v1/dex/tokens/batch-query` | Not needed for C1–C7 at this stage. The batch price endpoint can be reconsidered in T4.1 if calibration needs fewer calls. |
| OHLCV, holders, security, trending, new/meme tokens, platform list | Not used by any check. |
| Derivatives, global metrics, CMC AI, content, community, CMC indices | Out of scope for the checks. |
| WebSocket API (beta) | Out of scope: the checks work on request/response snapshots that can be recorded and replayed. |
| Keyless public API (`/public-api/...` prefix) | The project uses the hackathon key, which the rules require for proof of real API usage. |

## Documentation points from T1.1, answered

1. E13 credit: answered by observation 6.
2. DEX plans and costs: answered by observation 3 (E12 excepted, see observation 5).
3. E11 `liqUsd` / `v24` are strings and E10 `l` / `v24h` numbers, as documented. E10 also returns fields that the
   T1.1 reading did not list (`pid`, `pdex`, `a`, `pc24h`, `mc`, `fpt`, `fpct`) and no `pcid` / `sym`; its `ts`,
   documented as int64, arrives as a string.
4. RWA names: the live E13, E14 and E17 responses all name `rwa_id=1` "Gold"; the E16 sample does not contain GOLD,
   so the documentation example ("GOLD") could not be compared.
5. RWA "historical endpoints": not tested (none is listed in the RWA category).
