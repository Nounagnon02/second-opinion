/**
 * The consistency engine (specification F4): one file per check, all returning the same `CheckResult`.
 *
 * Landed so far: C3 freshness and C7 unreadable fields (T3.1), C1 price divergence and C2, which reports that the
 * current plan reaches no per-exchange price (T3.2), C4 liquidity against reported volume (T3.3), C5 the wrappers
 * of a real-world asset against their average tokenized price (T3.4), and C6 the same asset read from two
 * endpoints (T3.5). `src/score/` weighs them into a score and a verdict (T3.6), and `assess.ts` runs the whole plan
 * of D1 for one asset and hands the seven results to that score (T3.7). `docs/DECISIONS.md` says what each check
 * rests on and why.
 */
export * from './assess.js';
export * from './c1-dex-divergence.js';
export * from './c2-cex-divergence.js';
export * from './c3-freshness.js';
export * from './c4-liquidity.js';
export * from './c5-rwa.js';
export * from './c6-consistency.js';
export * from './c7-schema.js';
export * from './config.js';
export * from './model.js';
export * from './prices.js';
export * from './units.js';
