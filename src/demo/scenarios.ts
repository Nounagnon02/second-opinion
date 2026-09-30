/**
 * The two scenarios of specification F7, and what the recorded answers behind them actually show.
 *
 * Both orders are the same order — buy 25 000 USD of tokenised gold — given under two tickers. That is the whole
 * demonstration: the instruction a user would write is identical, and only a second opinion on the data separates
 * the one worth acting on from the one that is not.
 *
 * `recorded` says what this agent did when the answers were captured. It is reported, never enforced: the run
 * prints a mismatch rather than hiding it, and nothing in `agent.ts` reads it. A scenario whose verdict moved is
 * information about the market, not a broken demonstration.
 *
 * **On the refusal being `CAUTION` rather than `DO_NOT_ACT`.** F7 asks for a `DO_NOT_ACT`, and allows the most
 * telling case found when no token produces one at capture time. None did, and the reason is in the engine rather
 * than in the sample: `DO_NOT_ACT` is what a run that measured nothing at all answers (D11), while a run that
 * measured plenty and found a critical problem is held at `CAUTION` by `capWithCritical`. The refusal is no
 * weaker for it — this agent acts on `ACT` only — but the distinction is stated rather than papered over.
 */
import type { Action, Order } from './agent.js';

/** One scenario: an order, why it is in the demonstration, and what it did when it was captured. */
export interface Scenario {
  /** Short name, for the transcript and for a test that has to name a failure. */
  id: string;
  title: string;
  order: Order;
  /** What the recorded answers show. Prose: it asserts nothing and is never compared against anything. */
  note: string;
  /** What this agent did when the answers were captured; reported on a mismatch, never enforced. */
  recorded: Action;
}

/** The size both orders carry: one number, so that the two scenarios differ in the asset and in nothing else. */
export const ORDER_SIZE_USD = 25_000;

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'rwa-refusal',
    title: 'The ticker a user would reach for does not carry the gold they meant',
    order: {
      instruction: 'Buy 25,000 USD of tokenised gold. The ticker is XAU.',
      asset: 'XAU',
      side: 'buy',
      sizeUsd: ORDER_SIZE_USD,
      realWorldAsset: true,
    },
    note:
      'XAU is the ISO code of an ounce of gold, so it is the ticker an instruction about tokenised gold reaches ' +
      'for. CoinMarketCap carries four entries under it, and the one E01 resolves the symbol to is XAU9999 Meme ' +
      '(CMC 37470), a meme token priced around 1e-11 USD. Two independent readings of the recorded answers stop ' +
      'the order: C5 links CMC 37470 to no real-world asset at all, and C4 reports that 25,000 USD is more than ' +
      'twice the depth of the deepest pool behind that price. Captured live on 2026-09-26 at about 19:00 UTC.',
    recorded: 'refused',
  },
  {
    id: 'rwa-accept',
    title: 'The same order on a wrapper the checks can follow',
    order: {
      instruction: 'Buy 25,000 USD of tokenised gold. The ticker is PAXG.',
      asset: 'PAXG',
      side: 'buy',
      sizeUsd: ORDER_SIZE_USD,
      realWorldAsset: true,
    },
    note:
      'PAX Gold is a gold wrapper the index links to rwa_id 1, so C5 runs and reads it against the average ' +
      'tokenized price across the other gold wrappers. Six of the seven checks run, none of them raises an ' +
      'observation, and the order is a small share of a deep pool. Captured live on 2026-09-26 at about ' +
      '19:05 UTC, in the same session as the refusal above.',
    recorded: 'simulated',
  },
];
