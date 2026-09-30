/**
 * C2 - the aggregated price against the prices of centralised exchange pairs. No source of per-exchange prices is
 * reachable with the hackathon key: the three candidates tried in T1.2 and T1.3 each answered HTTP 403 with error
 * code 1006, "Your API Key subscription plan doesn't support this endpoint" (D2).
 *
 * The check is therefore kept in the list and reported as `unavailable` in every output, never silently dropped and
 * never counted in the score (D9). Nothing takes its place under its name: the 24-hour volumes E02 reports per
 * venue type are volumes, not prices, and a check built on them would measure something else while wearing the C2
 * label.
 *
 * The endpoints are named here by their inventory identifiers only. None of them appears in `src/` as a path, which
 * `tests/endpoints-doc.test.ts` enforces: a refused endpoint is never called. When a key does reach one of them,
 * re-verifying it in `docs/ENDPOINTS.md` is what brings C2 back.
 */
import { unavailable, type CheckResult } from './model.js';

/**
 * The recorded refusals this decision rests on, one per candidate source: cryptocurrency market pairs (E04), RWA
 * market pairs (E15) and exchange market pairs filtered on one asset (E21).
 */
export const C2_REFUSAL_FIXTURES = [
  'E04-market-pairs-btc',
  'E15-rwa-market-pairs-gold',
  'E21-exchange-market-pairs-binance-paxg',
] as const;

/** Why C2 cannot run, in the words every output shows. */
export const C2_UNAVAILABLE_REASON =
  'Per-exchange prices are not available with the current API plan: the three candidate sources (E04 cryptocurrency ' +
  'market pairs, E15 RWA market pairs, E21 exchange market pairs) each answered HTTP 403 with error code 1006. The ' +
  `refusals are recorded in ${C2_REFUSAL_FIXTURES.map((label) => `fixtures/discovery/${label}.json`).join(', ')} ` +
  '(see docs/DECISIONS.md, D2).';

/**
 * Runs C2. It makes no call and takes no input: with this key there is nothing to read, and saying so in every
 * output is the whole of the check.
 */
export function runCexDivergenceCheck(): CheckResult {
  return unavailable('C2', C2_UNAVAILABLE_REASON);
}
