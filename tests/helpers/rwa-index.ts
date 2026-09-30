/**
 * The token to real-world-asset index, rebuilt from the recorded walk rather than read from the cache of this clone.
 *
 * C5 needs an index, and a real build leaves it at `.cache/rwa/wrapper-index.json` — a path git ignores, so a fresh
 * checkout does not have one. A test that let the engine fall back to that cache passed on the machine that had
 * built it and failed on a clean clone, which is what T9.1 found: sixteen cases of five files reported C5 as
 * `unavailable` instead of the status they assert. Every test that needs an index therefore builds one here, from
 * the E18 / E19 walk recorded in `fixtures/rwa-index/`: the same walk `npm run rwa:index -- --build` makes against
 * the API, with no network, no key and no credit.
 *
 * Built once per test file: the walk parses thirty-two answers, and nothing in a file changes it.
 */
import { join } from 'node:path';
import type { CmcClient } from '../../src/cmc/client.js';
import { DEFAULT_FIXTURE_DIR } from '../../src/cmc/config.js';
import { createClientForMode } from '../../src/cmc/mode.js';
import { buildWrapperIndex, type WrapperIndex } from '../../src/rwa/wrapper-index.js';

/** Where the recorded issuer walk the index is built from lives. */
export const RWA_INDEX_FIXTURES = join(DEFAULT_FIXTURE_DIR, 'rwa-index');

/** A client that answers only from the recorded fixtures of `dir`. */
export function replayClient(dir: string): CmcClient {
  return createClientForMode({ kind: 'replay', dir }, { CMC_CREDIT_BUDGET: '100000' });
}

let index: Promise<WrapperIndex> | null = null;

/** The wrapper index C5 reads, rebuilt from the recorded walk (D6). */
export function replayIndex(): Promise<WrapperIndex> {
  index ??= buildWrapperIndex(replayClient(RWA_INDEX_FIXTURES));
  return index;
}
