# Evidence — the code that called the API, and the answers that came back

The hackathon rules ask for proof of a real API call: the code that made it, and the response it received. This
file is that proof, read end to end on one call and then followed as far as a verdict.

**Nothing below is retyped by hand.** Every code block is a line range of a file in this repository. Every JSON
block is part of an answer CoinMarketCap actually sent, recorded at the moment it arrived with the API key
replaced by `***`. `tests/evidence-doc.test.ts` reads both back from the files they name and fails if a single
character has drifted — so a quote here cannot outlive the thing it quotes.

A JSON block shows the fields that matter to the paragraph around it; the file holds more, and the test allows
that. What it does not allow is a shortened list passed off as a whole one: where a block shows the first few
entries of an array that runs longer in the file, the caption says so — `(tokens: 3 of 7)` — and the test checks
that count against the file too, so an entry cannot be dropped in silence.

The wider corpus is elsewhere: [`docs/ENDPOINTS.md`](ENDPOINTS.md) has the inventory of every endpoint that was
called and what it answered, and [`docs/API_AUDIT.md`](API_AUDIT.md) measures all 392 recorded answers at once.
This file is the short path through one of them.

## Checking it yourself

```
npx vitest run tests/evidence-doc.test.ts   # re-reads every quote below from the file it names
npm run demo                                # replays sections 4 and 5, offline, with no key and no credit
```

Neither command sends a request. The answers are already in `fixtures/`.

## 1. One call, from the request to the file it was written to

### 1.1 The request the client sends

One client makes every call. The key is read from the environment, never written down, and goes out in the
`X-CMC_PRO_API_KEY` header the API expects:

**Code — `src/cmc/client.ts:203-210`**

```ts
      raw = await Promise.race([
        this.transport({
          url,
          headers: { Accept: 'application/json', [KEY_HEADER]: this.apiKey },
          signal: controller.signal,
        }),
        timeout,
      ]);
```

### 1.2 What happens to the answer before anything reads it

In record mode the raw exchange is written to `fixtures/` first. The key header is replaced on the way out, and
the whole serialized exchange is passed over once more in case the key appears anywhere else in it:

**Code — `src/cmc/fixtures.ts:64-69`**

```ts
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      name.toLowerCase() === KEY_HEADER.toLowerCase() ? MASK : value,
    ]),
  );
```

**Code — `src/cmc/fixtures.ts:52-55`**

```ts
/** Serializes an exchange for fixtures/: indented JSON, the secret masked everywhere, final newline. */
export function serializeExchange(exchange: RecordedExchange, secret: string): string {
  return `${maskSecret(JSON.stringify(exchange, null, 2), secret)}\n`;
}
```

### 1.3 The file that came out

This is the first market call this project ever made, on 2026-09-24 at 16:04:03 UTC: Bitcoin and PAX Gold in one
request. The request block is what went out, the status block is what CMC answered with it:

**Answer — `fixtures/discovery/E02-quotes-latest-btc-paxg.json`**

```json
{
  "label": "E02-quotes-latest-btc-paxg",
  "recordedAt": "2026-09-24T16:04:03.700Z",
  "request": {
    "method": "GET",
    "url": "https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?id=1%2C4705&convert=USD",
    "path": "/v3/cryptocurrency/quotes/latest",
    "query": {
      "id": "1,4705",
      "convert": "USD"
    },
    "headers": {
      "Accept": "application/json",
      "X-CMC_PRO_API_KEY": "***"
    }
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "latencyMs": 1184,
    "body": {
      "status": {
        "timestamp": "2026-09-24T16:04:03.419Z",
        "error_code": "0",
        "error_message": "",
        "elapsed": 4,
        "credit_count": 1
      }
    }
  }
}
```

And this is the asset the rest of this file follows, taken from the `data` array of that same answer:

**Answer — `fixtures/discovery/E02-quotes-latest-btc-paxg.json` → `response.body.data[1]`**

```json
{
  "id": 4705,
  "name": "PAX Gold",
  "symbol": "PAXG",
  "last_updated": "2026-09-24T16:03:00.000Z",
  "quote": [
    {
      "id": 2781,
      "symbol": "USD",
      "price": 4253.226063661451,
      "volume_24h": 224109937.5151175,
      "market_cap": 1849743426.8168826,
      "last_updated": "2026-09-24T16:02:03.000Z"
    }
  ]
}
```

Fields the blocks above leave out are in the files; nothing shown has been altered.

## 2. The account those calls were billed to

A recorded answer proves a request was answered. What proves it reached the real API is the account it was
charged to. `/v1/key/info` (E20) costs no credit, so it can be read on both sides of a run without changing what
it measures. It was called once before the discovery run and once after.

**Answer — `fixtures/discovery/E20-key-info-before.json` → `response.body.data`**

```json
{
  "plan": {
    "credit_limit_monthly": 15000,
    "credit_limit_monthly_reset_timestamp": "2026-10-01T00:00:00.000Z",
    "rate_limit_minute": 50
  },
  "usage": {
    "current_month": {
      "credits_used": 0,
      "credits_left": 15000
    }
  }
}
```

**Answer — `fixtures/discovery/E20-key-info-after.json` → `response.body.data`**

```json
{
  "plan": {
    "credit_limit_monthly": 15000,
    "credit_limit_monthly_reset_timestamp": "2026-10-01T00:00:00.000Z",
    "rate_limit_minute": 50
  },
  "usage": {
    "current_month": {
      "credits_used": 15,
      "credits_left": 14985
    }
  }
}
```

Between those two snapshots — 16:03:35 and 16:08:10 UTC on 2026-09-24 — this project recorded **24 answers**,
and the `credit_count` those answers report adds up to exactly **15**. The account's own counter moved by the
same 15. The test checks that arithmetic against the files rather than trusting this paragraph.

## 3. What the plan refused, in the API's own words

Four candidate endpoints were called and did not come back with data. Their refusals are recorded like any other
answer, because a refusal is evidence too — it is why two of the seven checks measure what they measure:

| ID | Path | HTTP | `error_code` | Recorded refusal |
| --- | --- | --- | --- | --- |
| E04 | `/v2/cryptocurrency/market-pairs/latest` | 403 | 1006 | `fixtures/discovery/E04-market-pairs-btc.json` |
| E12 | `/v1/dex/token-liquidity/query` | 400 | 400 | `fixtures/discovery/E12-dex-token-liquidity-paxg.json` |
| E15 | `/v5/real-world-assets/market-pairs/list` | 403 | 1006 | `fixtures/discovery/E15-rwa-market-pairs-gold.json` |
| E21 | `/v1/exchange/market-pairs/latest` | 403 | 1006 | `fixtures/discovery/E21-exchange-market-pairs-binance-paxg.json` |

**Answer — `fixtures/discovery/E04-market-pairs-btc.json` → `response.body.status`**

```json
{
  "timestamp": "2026-09-24T16:04:53.676Z",
  "error_code": 1006,
  "error_message": "Your API Key subscription plan doesn't support this endpoint.",
  "credit_count": 0
}
```

Those four IDs are then absent from the one table that says what the client may call. The list holds the
`verified` rows of [`docs/ENDPOINTS.md`](ENDPOINTS.md) and nothing else, which is why it steps from E03 to E05:

**Code — `src/cmc/endpoints.ts:24-28`**

```ts
export const ENDPOINTS = {
  E01: { path: '/v1/cryptocurrency/map', credits: 0, cache: 'static' },
  E02: { path: '/v3/cryptocurrency/quotes/latest', credits: 1, cache: 'market' },
  E03: { path: '/v3/cryptocurrency/listings/latest', credits: 1, cache: 'market' },
  E05: { path: '/v2/cryptocurrency/info', credits: 1, cache: 'static' },
```

C2, the per-exchange price divergence, has no reachable source as a result and reports itself `unavailable`
naming those three refusals, rather than passing silently. The reasoning is recorded as D2 in
[`docs/DECISIONS.md`](DECISIONS.md).

## 4. From a recorded answer to a refused order

The demonstration agent is given `Buy 25,000 USD of tokenised gold. The ticker is XAU.` The verdict that refuses
it rests on six recorded answers — E01, E02, E05, E06, E10 and E11. Three of them carry the whole walk, from the
instruction to the sentence that stops it, and those three are below. `npm run demo` replays all six.

### 4.1 The symbol resolves to four different assets

**Answer — `fixtures/demo/E01-8d6f0741-20260926T190050290Z.json` → `response.body.data`**

```json
[
  { "id": 37470, "name": "XAU9999 Meme", "symbol": "XAU", "slug": "xau9999-meme", "rank": 7400, "is_active": 1 },
  { "id": 39344, "name": "Gold (Derivatives)", "symbol": "XAU", "slug": "gold-derivatives", "rank": 7576, "is_active": 1 },
  { "id": 851, "name": "Xaucoin", "symbol": "XAU", "slug": "xaucoin", "rank": null, "is_active": 0 },
  { "id": 3575, "name": "Gold Troy Ounce", "symbol": "XAU", "slug": "gold-troy-ounce", "rank": null, "is_active": 0 }
]
```

XAU is the ISO code for an ounce of gold, so it is the ticker an instruction about tokenised gold reaches for.
The answer offers four assets under it and states no preference. The engine picks the one a caller is most
likely to have meant — active first, then the lowest `rank`, then the lowest identifier so two runs on one
answer never differ — and shows the rest beside it instead of merging them in:

**Code — `src/checks/assess.ts:102-108`**

```ts
function betterCandidate(left: AssetCandidate, right: AssetCandidate): number {
  if (left.isActive !== right.isActive) return left.isActive === false ? 1 : -1;
  const rank = (candidate: AssetCandidate): number => candidate.rank ?? Number.MAX_SAFE_INTEGER;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  const id = (candidate: AssetCandidate): number => candidate.asset.cmcId ?? Number.MAX_SAFE_INTEGER;
  return id(left) - id(right);
}
```

On this answer that is CMC 37470, XAU9999 Meme — not gold.

### 4.2 What that asset is priced at

**Answer — `fixtures/demo/E02-28e6bd6d-20260926T190050689Z.json` → `response.body.data[0].quote[0]`**

```json
{
  "id": 2781,
  "symbol": "USD",
  "price": 9.614444201187e-12,
  "volume_24h": 263.82907871,
  "cex_volume_24h": 0,
  "dex_volume_24h": 263.82907871,
  "market_cap": 0,
  "last_updated": "2026-09-26T18:59:59.000Z"
}
```

### 4.3 What stands behind that price

**Answer — `fixtures/demo/E11-cf67552b-20260926T190051345Z.json` → `response.body.data[0]`**

```json
{
  "addr": "0x86a44d32c2f141eee3f9d24a0712187d782dd465",
  "v24": "263.829078712792728946",
  "t0": { "n": "XAU9999", "sym": "XAU" },
  "t1": { "n": "Wrapped Ether", "sym": "WETH" },
  "exn": "Uniswap v2",
  "liqUsd": "11372.541248403951494517"
}
```

Three pools were returned; this is the deepest. An order is weighed against a pool, because a pool is what can
take one:

**Code — `src/checks/c4-liquidity.ts:261-262`**

```ts
  const depth = deepest?.liquidityUsd ?? null;
  const share = depth !== null && depth > 0 ? (orderSizeUsd / depth) * 100 : null;
```

**Code — `src/checks/c4-liquidity.ts:286-299`**

```ts
  const critical = share > config.criticalOrderSharePercent;
  const limit = critical ? config.criticalOrderSharePercent : config.warnOrderSharePercent;
  return {
    measurement,
    finding: {
      code: 'order_above_liquidity_share',
      severity: critical ? 'critical' : 'warning',
      message:
        `An order of ${formatUsd(orderSizeUsd)} is ${formatPercent(share)} of the ${formatUsd(depth)} held by ` +
        `${deepest?.label ?? 'the deepest pool read'}; limit: ${formatPercent(limit)}.`,
      measurement,
      evidence: [evidence(source)],
    },
  };
```

### 4.4 The sentence those four answers produce

Run over the recorded pools with the 25,000 USD of the scenario, that code writes:

**Finding — `C4` on `fixtures/demo/E11-cf67552b-20260926T190051345Z.json`**

```
An order of 25000 USD is 219.83 % of the 11372.541 USD held by E11 pool liquidity of XAU/WETH on Uniswap v2; limit: 25 %.
```

The test does not compare that line to a copy of itself: it normalises the recorded answer, runs the real check
over it with the real thresholds of `config/checks.json`, and compares the message the check returns to the line
printed above. A different answer, a different threshold or a different formula, and this sentence changes.

The order is refused. The agent places nothing in any case — it holds no wallet, signs nothing and reaches no
venue — and the refusal is a printed decision, not a cancelled trade.

## 5. The same order on a wrapper the checks can follow

The second scenario gives the identical instruction under the ticker `PAXG`. That one resolves to PAX Gold,
CMC 4705, which the index links to `rwa_id` 1, so C5 runs. What it reads is one E14 answer:

**Answer — `fixtures/demo/E14-626f8f59-20260926T190550895Z.json` → `response.body.data.rwa_assets[0]` (tokens: 3 of 7)**

```json
{
  "name": "Gold",
  "symbol": "GOLD",
  "rwa_id": 1,
  "asset_type": "commodity",
  "average_tokenized_price": 4275.56745455707,
  "tokenized_market_cap": 4898799428.583867,
  "last_updated": "2026-09-26T19:04:43.183Z",
  "tokens": [
    { "symbol": "PAXG", "name": "PAX Gold", "price": 4275.775159710677, "crypto_id": 4705, "issuer_name": "Paxos" },
    { "symbol": "XAUt", "name": "Tether Gold", "price": 4277.823680538738, "crypto_id": 5176, "issuer_name": "Tether Holdings" },
    { "symbol": "XAUM", "name": "Matrixdock Gold", "price": 4275.114988458228, "crypto_id": 34212, "issuer_name": "Matrixdock" }
  ]
}
```

PAXG at 4275.775 against an average of 4275.567 is a premium of about 0.005 %, and no check raises an
observation: the verdict is `ACT`, 100 out of 100, and the order is 0.15 % of the deepest pool read.

One thing that answer does **not** carry is a price of gold itself, and the check says so where a reader will
see it rather than quietly treating the average as one:

**Code — `src/checks/c5-rwa.ts:4-8`**

```ts
 * The specification asks for the premium or discount against the reference asset (F4). No reachable endpoint carries
 * a price of the underlying asset: `tradfi_markets` lists venues without prices and is empty for GOLD, and E15 is
 * refused with this key. So the reference here is E14 `average_tokenized_price`, CMC's own average over the
 * wrappers, and the outputs call it exactly that - never an underlying market price (D6). Beside it, the spread
 * between the wrappers of one asset says how much the wrappers disagree, which needs no external reference at all.
```

## 6. Two things the answers show that a consumer has to plan for

Both are observations, both are recorded, and neither is a defect: they are the kind of thing a client library
has to handle, and naming them is more useful than working around them silently. The full set is in
[`docs/API_AUDIT.md`](API_AUDIT.md).

**`status.error_code` arrives in two shapes.** In the E02 answer of section 1.3 it is the string `"0"`; in the
E01 answer of section 4.1 it is the number `0`, and that answer carries a `notice` field the other does not. Both
are accepted, from one place, so no caller has to know which endpoint sends which:

**Code — `src/cmc/status.ts:24-28`**

```ts
function toErrorCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}
```

**A field present on one pool can be absent on the next.** In the E11 answer of section 4.3, `data[0]` carries
`v24` and `data[1]` does not. C7 reports that as an unreadable field, names where it saw it, and lets the rest of
the answer be used — rather than rejecting a payload that is otherwise fine.

## 7. Where the rest of the evidence is

Five captures, 392 recorded answers, are what this project reads. Each is a raw exchange in the shape of
section 1.3, with the key masked:

| Capture | Directory | Answers | What it is |
| --- | --- | --- | --- |
| discovery | `fixtures/discovery` | 32 | T1.2 and T1.3: every candidate endpoint called once, one call at a time, on 2026-09-24 |
| rwa-index | `fixtures/rwa-index` | 32 | T3.4: the walk of the whole issuer catalogue through E18 and E19, on 2026-09-25 |
| check | `fixtures/check` | 11 | T3.7: the first live runs of the `check` command, on 2026-09-25 |
| demo | `fixtures/demo` | 17 | T5.3: the answers the two demonstration scenarios are replayed from, on 2026-09-26 |
| calibration | `fixtures/calibration/live-20260926T1044Z` | 300 | T4.1: the fifty assets of the calibration panel, paced at 40 requests per minute, on 2026-09-26 |

Two earlier recordings of that same calibration walk also sit under `fixtures/calibration/` — one loose at its
root, one under `live-2026-09-26/`. Both were interrupted part-way, and nothing reads either: the corpus is a
named list of complete captures rather than everything under `fixtures/`, because counting a partial walk would
report the same request twice and credit one walk with another's answers (D14). No figure on this page counts
them.

The five captures reported 288 credits between them when they were captured, which is what this project cost the
account. Replaying them costs nothing, which is why the tests, the demonstration and the audit all run on a clone with no
API key at all.

- [`docs/ENDPOINTS.md`](ENDPOINTS.md) — every endpoint called, what it answered, what it cost, which fields it
  really returned.
- [`docs/DECISIONS.md`](DECISIONS.md) — what was changed because of those answers, and why.
- [`docs/API_AUDIT.md`](API_AUDIT.md) — all 392 answers measured at once, every entry citing the file it was read
  from.
- [`docs/CALIBRATION.md`](CALIBRATION.md) — the score run over the 50 largest assets, so that the verdicts above
  can be read against a baseline.
