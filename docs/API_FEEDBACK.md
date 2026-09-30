# API feedback — what the CoinMarketCap API made possible, and what took work

This note is the developer's side of the same corpus `docs/API_AUDIT.md` measures. The audit says what the
recorded answers contain; this file says what building on them was like, which is what the submission asks for
and what a report of numbers alone does not carry.

It is written for the team that owns the API, under the rule the audit states of itself: an observation, never
an accusation, and never a cause. A corpus of recorded answers can say what arrived; it cannot say why.

**Nothing here is an impression.** Every section ends with the answers it was read from:

- `**Measured:**` — a measurement quoted **word for word** from `docs/API_AUDIT.md`. If a fresh `npm run audit`
  produces a different number, the line stops matching and `tests/api-feedback-doc.test.ts` fails.
- `**From:**` — where the section comes from: `A<n>` is an entry of `docs/API_AUDIT.md`, `D<n>` a decision of
  `docs/DECISIONS.md`, and a backticked path is a file of this repository.
- `**Answers:**` — on a suggestion, the observation below that it responds to.
- `**No suggestion:**` — on an observation that carries none, why it carries none. Silence would read the same
  whether a case had been weighed or forgotten, so the test asks for one line or the other.

Every number in the prose is recomputed from `docs/api_audit.json` or from the recorded answers themselves by
that same test, and the wording is put through the tone gate of `src/audit/review.ts` — the one the audit
applies to its own entries.

## The short version

The key reached 17 of the 21 endpoints inventoried, and those 17 answer about one asset from three families
that do not derive from one another — aggregated quotes, DEX pools, and the RWA catalogue. That is the whole
premise of this project: a second opinion needs a second source, and this key has two more. Six of the seven
checks the specification asks for run on real answers; the seventh has no source with this plan and says so in
every output.

What took work sat in the envelope and in the reference rather than in the data: `status` arrives in two
shapes, fields come and go between answers to the same question, one 400 names no parameter, and three pages
list a plan that the key did not confirm. None of it stopped the project. All of it was found by calling, which
is the part a page could have saved.

The whole of it — 392 recorded answers over 17 endpoints, in 5 captures — reported **288 credits**.

## What the API made possible

### G1 · Three families of endpoints answer about the same asset

Every check in the specification rests on one property: two sources that describe the same asset without one
being derived from the other. This key has three. The aggregated quotes (E02, E03, E06, E07), the DEX
endpoints (E08 to E11) and the RWA catalogue (E13, E14, E16 to E19) each answer about an asset in their own
terms, at their own moment, with their own identifiers. C1 compares an aggregated price with a DEX one, C6
compares four aggregated sources with each other, and neither would exist on a key that returned one number
per asset.

**From:** `docs/ENDPOINTS.md`, D3, D7

### G2 · The cost of a call is reported on the call itself

Every accepted answer carried `status.credit_count`, and on 17 of 17 endpoints it matched the cost this
project reserves before sending. A budget can therefore be held by the client rather than reconciled
afterwards: `src/cmc/credits.ts` holds back the declared cost, and the answer confirms it. E20
(`/v1/key/info`) reads the same counter from the account side, which is how the catalogue walk of T3.4 was
checked twice over — 30 answers reporting one credit each, and the monthly counter moving from 18 to 48.

**Measured:** endpoints whose reported cost matched: 17 of 17

**From:** A18, `src/cmc/credits.ts`, `docs/ENDPOINTS.md`

### G3 · Resolving an identifier is free

E01 (`/v1/cryptocurrency/map`), E13 (`/v5/real-world-assets/map`) and E20 (`/v1/key/info`) reported
`credit_count` 0 on every recorded answer. Turning a symbol into an identifier is the first step of every
command this project runs, and it costs nothing, so the budget goes on data. For a tool that is called before
each decision rather than once a day, that is the difference between running it always and running it
sometimes.

**From:** A18, `fixtures/discovery/E01-map-btc-paxg.json`, `fixtures/discovery/E13-rwa-map-gold.json`

### G4 · The RWA catalogue can be walked, and the answer says when to stop

E18 and E19 both take `start` and `limit`, and both answer `data.total_size` and `data.has_more`, so the whole
issuer catalogue is readable without guessing where it ends. The one walk this project makes read 25 issuers
and 2,393 tokens for 30 credits, and it is what gives C5 a link from a wrapper token to the asset it
represents. An issuer whose entry reports `num_tokens` 0 has no page to read, so the walk skips it rather than
spending a credit on an empty list — again, because the count is in the answer.

**From:** `fixtures/rwa-index`, D6

### G5 · A refusal is a recorded answer, not a silence

The endpoints this key could not call answered with a well-formed JSON envelope: an HTTP status, an
`error_code`, and a message. That is what let this project record a refusal on 2026-09-24 and quote it
here rather than describe it from memory. Four paths in the corpus are refusals kept for
exactly that reason, and every statement this file makes about an endpoint the key could not reach opens one
of them.

**From:** A1, `fixtures/discovery/E04-market-pairs-btc-minimal.json`,
`fixtures/discovery/E15-rwa-market-pairs-gold.json`, `fixtures/discovery/E21-exchange-market-pairs-binance-paxg.json`

## What took work

### W1 · A page lists a plan, and the key did not always confirm it

3 of the 21 endpoints inventoried answered HTTP 403 with `error_code` 1006 — "Your API Key subscription plan
doesn't support this endpoint." — although their documentation pages list the plan this key is on: E04
(`/v2/cryptocurrency/market-pairs/latest`), E15 (`/v5/real-world-assets/market-pairs/list`) and E21
(`/v1/exchange/market-pairs/latest`). Each refusal was recorded rather than inferred.

The consequence here is concrete. C2 compares the aggregated price with per-exchange prices on centralised
venues; no verified endpoint on this key returns one, so C2 is reported `unavailable` in every output and is
kept out of the score rather than quietly dropped (D2). C5 lost its reference in the same movement: E15 is the
RWA market-pairs endpoint and `tradfi_markets` was empty for GOLD, so C5 measures dispersion between the
wrappers of one asset instead of a premium against the asset itself (D6). Two of the seven checks changed
shape on this one observation, and the observation cost three calls to make.

**Measured:** endpoints refused for the plan: 3 of 21

**From:** A1, D2, D6

### W2 · A 400 that names no parameter

E12 (`/v1/dex/token-liquidity/query`) answered HTTP 400 with `error_code` `"400"` and `error_message`
`"Parameter error"` to every call recorded here, including one sent with its two documented parameters alone,
`platform` and `address`. The message names no parameter, so there is no value to correct and no next call to
try; the `interval` parameter its page documents lists no allowed values, so there was nothing to vary either.
E12 is the only endpoint that returns a liquidity history, so C4 reads the latest snapshot only (D5).

The contrast is inside the same API. E19 refused `limit=1000` with `error_code` `"4001"`, `category`
`"VALIDATION"` and `error_detail` `"limit: '1000' is not valid. Must be an integer between 1 and 250."` — one
line, and the next call was a correction rather than a guess. Paging E18 and E19 was settled in one attempt;
E12 is still unused.

**From:** A2, `fixtures/discovery/E12-dex-token-liquidity-paxg-minimal.json`,
`fixtures/discovery/E19-rwa-issuer-backed-limit1000.json`, D5

### W3 · The `status` envelope arrives in two shapes

`status.error_code` arrives as a string on 13 endpoints, with no `notice` field beside it, and as a number on
4, with one. Both shapes carry `timestamp`, `elapsed` and `credit_count`, and both were observed on accepted
calls, so the difference is in the envelope rather than in what it reports.

A client that compares `status.error_code` with the number 0 succeeds on one group of endpoints and reads a
refusal as a success on the other — and it does so silently, since both shapes are valid JSON. One comparison
that accepts both settles it at the edge of the client, which is what `src/cmc/status.ts` is; the cost is that
every consumer writes it, and that the ones who have not met the second shape yet do not know they need it.

**Measured:** shapes of the status block: 2 of 17

**From:** A7, A8, `src/cmc/status.ts`

### W4 · Fields that come and go between answers to the same question

Comparing only answers to requests made with the same parameter names — so that a parameter which adds a field
is not counted — 5 fields of E02, 18 of E05, 12 of E10, 25 of E11 and 2 of E19 were carried by some accepted
answers and absent from others. On E02 they are the five `data.platform.*` fields, present on 31 of 56
answers: a coin has no platform and a token does, which reads as sound once seen, and is not something the
field name says.

For a consumer these are optional fields whatever a page calls them, and reading one means handling its
absence. This is the largest single source of defensive reading in `src/normalize/`, and it is also what C7
reports on the asset being checked: a field a verdict needed and could not read.

**Measured:** E11 fields that come and go: 25

**From:** A10, A11, A12, A13, A14, `src/normalize/values.ts`

### W5 · Fields that were null on every recorded answer

E08 and E09 each sent 3 fields that were `null` on every accepted answer — `data.base_asset_id`,
`data.created_at` and `data.quote_asset_id` — and E17 sent 8, among them `cik`, `employees`, `founded` and
`industry`. The field is present, so a consumer cannot tell a value that is empty from one this capture never
happened to see filled, and the two call for opposite handling. A line on the page saying when the field is
populated would settle it; so would a wider capture, which is why this is recorded as an observation about
this corpus rather than about the endpoint.

**Measured:** E08 fields always null: 3

**Measured:** E09 fields always null: 3

**Measured:** E17 fields always null: 8

**From:** A15, A16, A17

### W6 · A busy answer on the DEX endpoints during a paced run

During the calibration capture — the 50 assets of the panel, paced at 40 requests per minute — E10 and E11
each answered HTTP 500 with `error_code` `"500"` and "The system is busy, please try again later!" on 41 of
their 77 recorded answers, touching 14 assets of the 50.

What that does to a verdict is visible downstream. C7 raised `unreadable_field` on 7 of 50 assets, and 19 of
50 reached `ACT` with fewer than 5 of the seven checks evaluated. The score renormalises over the checks that
ran and prints the coverage beside the verdict, so nothing is hidden; but a verdict read on three checks is a
different reading from one read on seven, and a consumer that ignores the coverage line will not notice. No
cause is stated here: HTTP 500 is what the answers carried, and a corpus cannot say more.

**Measured:** E10 answers not accepted: 41 of 77

**Measured:** E11 answers not accepted: 41 of 77

**Measured:** C7 `unreadable_field`: 7 of 50

**Measured:** assets at ACT on thin coverage: 19 of 50

**From:** A4, A5, A21, A24, `fixtures/calibration/live-20260926T1044Z`

### W7 · The tail of the latency, against a ten-second budget

One `check` is allowed 10 s end to end (D1). Measured on the captures recorded one call at a time, where
nothing but the API is inside the interval, 9 endpoints have an answer taking at least half of that budget,
the slowest at 9.5 s. The medians are an order of magnitude below — 485 ms for E02, 362 ms for E19 — so it is
the tail, not the typical answer, that the call plan has to absorb.

That shaped the design rather than obstructing it: the independent calls of one asset go out in parallel, the
slowest endpoints are kept off the per-asset path, and a call that overruns makes the checks that needed it
`unavailable` for that run rather than holding the verdict past the budget (D1, D9, D10).

**No suggestion:** a tail is a property of any call over a network, and absorbing it is the caller's work. This
is here because it is the observation that shaped the call plan, not because anything is asked of it.

**Measured:** slowest answer called one at a time: 9.5 s of a 10 s budget

**From:** A19, A20, D1, D10

### W8 · Filters that did not narrow the answer

E08 (`/v4/dex/spot-pairs/latest`) was called with `limit=10` and answered 100 pairs; neither
`base_asset_ucid=4705` nor `base_asset_contract_address` narrowed the result, which held 3 PAXG pairs among
the 100. Called without `dex_id` or `dex_slug` it answered HTTP 400 with "Please provide either a dex id or
dex slug.", although no parameter is marked required on its page.

A per-token filter on that endpoint would give C1 the venue-by-venue prices of one asset in a single call. As
recorded, reading 3 useful pairs means receiving 100, so C1 takes its DEX price from E10 and its pools from
E11 instead (D3).

**From:** `fixtures/discovery/E08-dex-spot-pairs-paxg-uniswap.json`,
`fixtures/discovery/E08-dex-spot-pairs-paxg.json`, D3

### W9 · One platform, several identifier spaces

For Ethereum tokens, `platform.id` arrives as `1` in E01, as the number `1027` in E02, and as the string
`"1027"` in E05; the DEX endpoints name the same chain `network_id` `"1"` (E08, E09) and `pid` `1` (E10). Each
answer is internally consistent, and a join across two of them on that field is not.

So the join this project makes between an aggregated answer and a DEX one goes through the contract address,
which every family spells the same way, and the platform is carried as a slug rather than an identifier
(D3). That works; it is one indirection that a single identifier space would remove.

**From:** `fixtures/discovery/E01-map-btc-paxg.json`, `fixtures/discovery/E02-quotes-latest-btc-paxg.json`,
`fixtures/discovery/E05-info-btc-paxg.json`, `fixtures/discovery/E10-dex-token-price-paxg.json`, D3

### W10 · The unit a tokenised price is quoted in is not in the answer

In the E14 answer for GOLD, the seven wrapper tokens are priced either at about 4,250 USD (PAXG, XAUt, XAUM,
XAUT0, XAU) or at about 137 USD (CGO, VNXAU), and `average_tokenized_price` is 4255.05. Nothing in the answer
states what one token represents — a troy ounce, a gram, some other fraction — so the arithmetic that compares
them has no common denominator to work from.

This is the field C5 wanted most. A wrapper priced 31 times below another is either a discount worth a
critical verdict or a different unit, and the two are indistinguishable from this answer alone. C5 therefore
compares wrappers within the group that agrees, and reports the others apart rather than scoring them (D6). A
unit per token would turn that into the premium the specification originally asked for.

**From:** `fixtures/discovery/E14-rwa-quotes-gold.json`, D6

### W11 · Coverage of the link from a token to its asset

Walking the whole issuer catalogue through E18 and E19 returned 2,393 tokens, of which 1,437 (60.1 %) carry
both a `crypto_id` and an `rwa_id`. The remaining 956 carry at most one, and no other verified endpoint links
a wrapper to the asset it represents, so a symbol alone does not resolve those. C5 answers `not_applicable`
for them rather than guessing a sibling set.

This is a measurement of one walk on one day, over the answers in `fixtures/rwa-index`, and it is reported as
coverage rather than as anything else. It is also the measurement that says what the RWA catalogue would be
worth with the link complete: the same walk would resolve every tokenised wrapper of every asset in it.

**From:** `fixtures/rwa-index`, D6

## Suggestions

Each of these answers one observation above. Each is a suggestion and not a request: the project runs on the
API as it is, and every one of these was worked around rather than waited for.

### S1 · One shape for the `status` envelope

Publishing `error_code` as one JSON type across all endpoints, with `notice` either always present or always
absent, removes the comparison every consumer has to get right once and can get right silently late. The
alternative that costs nothing on the server is a line in the reference saying which endpoints send which
shape.

**Answers:** W3

### S2 · Name the parameter in a 400, the way E19 already does

E19's refusal carries `category`, and an `error_detail` that names the parameter, the value and the accepted
range. Applying that shape to the other 400s would turn a dead end into a retry. E12 is the case that matters
most here, since its message names nothing at all.

**Answers:** W2

### S3 · List the allowed values of `interval` on E12

The page documents the parameter and describes it as a time interval without giving a value. One line of
allowed values, or one worked example, is the difference between an endpoint a consumer uses and one a
consumer records a refusal from and moves past.

**Answers:** W2

### S4 · Mark on the page which fields are optional, and when the always-null ones fill

A consumer reading a response reference cannot tell a field that is sometimes absent from one that is always
present, nor an empty value from a value this capture did not happen to see. Both distinctions are cheap to
state and expensive to discover: 62 field names across five endpoints came and went between answers to the
same question here, and they were found by comparing captures.

**Answers:** W4, W5

### S5 · State the unit of a tokenised price

One field on each entry of E14 `tokens[]` — what one token represents of the underlying asset — makes the
premium or discount of a wrapper computable. Without it, the comparison between wrappers of one asset is a
comparison of numbers that may not be denominated alike, and a tool that values caution has to decline the
question.

**Answers:** W10

### S6 · Let a key report the endpoints it may call

E20 already answers the plan's credit limits and rate limit. Adding the endpoints the key may call, or making
the plan matrix on each page the same source of truth the gateway reads, removes a class of discovery work: 3
of 21 pages listed this plan and the key answered 1006. One verifying call per endpoint is a reasonable
practice in any case, and it is a better first experience when it confirms the page instead of correcting it.

**Answers:** W1

### S7 · Give the busy answer a distinct code or a retry hint

The DEX endpoints answered HTTP 500 with a generic `error_code` `"500"` on a paced run. A code that separates
"retry shortly" from "this request will never succeed", or a `Retry-After`, would let a client back off
precisely instead of treating every 500 the same way. As recorded, the client cannot tell the two apart, so it
degrades the verdict and reports the coverage — a correct answer, and a thinner one than the data needed to
be.

**Answers:** W6

### S8 · Say what E08's base-asset filters and `limit` do

`limit=10` returned 100 pairs and the two base-asset filters did not narrow the answer. Whether those
parameters are unsupported on this path, or supported with a meaning this project did not find, is a line on
the page either way — and if they filter, E08 becomes the single call that answers C1 for one asset.

**Answers:** W8

### S9 · Name the identifier space each platform field uses

`platform.id`, `network_id` and `pid` all name Ethereum, with three values and two JSON types between them. A
single space across families is the clean version; naming the space each field belongs to in the reference is
the version that costs one sentence per field and makes a join safe to write.

**Answers:** W9

### S10 · Carry `crypto_id` and `rwa_id` on every token of E19

The two identifiers are what turn an issuer's catalogue into a map from a wrapper token to the asset it
represents, and 1,437 of 2,393 tokens carry both. Every token that carries both is one more asset a tool can
answer about from a symbol; the walk that reads them is already one credit per issuer, and it would resolve the
whole catalogue rather than three fifths of it.

**Answers:** W11

## What this feedback does not claim

- **It measures one corpus, not the API.** 392 recorded answers over 17 endpoints, in 5 captures made between
  2026-09-24 and 2026-09-26 by the runs this project made for its own purposes. Nothing here measures an
  endpoint on a day it was not called, or with a parameter it was not called with.
- **It measures one key on one plan.** What this key could reach says nothing about another plan, and the
  three refusals of W1 are recorded as what this key received.
- **No cause is stated.** An answer that did not arrive is counted as an answer that did not arrive.
- **Latencies from the calibration capture are upper bounds.** That run waits for a free request slot, and the
  wait falls inside the measured interval (A20).
- **The verdict numbers cover 50 assets**, the calibration panel replayed from
  `fixtures/calibration/live-20260926T1044Z`. C1, C4 and C5 are about the venues and the wrappers of a single
  asset and are exercised by `npm run check`, not by that pass.
- **What the API said is quoted, not paraphrased.** Every message in quotation marks above is in the recorded
  answer cited beside it, and the test opens the file to check it.
