/**
 * The per-minute request limit of the key, held in front of the network transport.
 *
 * One `check` sends at most seven requests and never meets a limit. A walk over a panel does: E20 reports
 * `plan.rate_limit_minute` = 50 for this key, and the calibration of T4.1 sends about five requests per asset, so a
 * run over fifty assets would cross that limit within the first minute and start collecting HTTP 429s — which the
 * client retries, spending the budget on answers it already had a right to.
 *
 * The window is the one the API states: requests per rolling minute. Sending times are kept, not counted, because a
 * fixed counter reset every sixty seconds allows a burst of twice the limit across a boundary.
 *
 * Admission is serialised through one chain, so that calls the plan sends in parallel take their turn one at a time
 * and two of them never read the same free slot.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { Transport } from './client.js';
import { CmcError } from './errors.js';

/** The window `plan.rate_limit_minute` counts over. */
export const RATE_WINDOW_MS = 60_000;

export interface ThrottleOptions {
  /** Requests allowed per rolling minute. */
  perMinute: number;
  /** Local clock, epoch milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps a transport so that no more than `perMinute` requests leave it in any sixty seconds.
 *
 * A request that has to wait is not refused: it is held until a slot frees. The client's own timeout runs from the
 * moment the request is sent, so waiting here never shortens it.
 */
export function throttledTransport(
  network: Transport,
  { perMinute, now = Date.now, sleep = (ms) => delay(ms) }: ThrottleOptions,
): Transport {
  if (!Number.isInteger(perMinute) || perMinute < 1) {
    throw new CmcError('config', `The request limit must be a whole number of requests per minute, got ${perMinute}.`);
  }
  const sent: number[] = [];

  const admit = async (): Promise<void> => {
    for (;;) {
      const cutoff = now() - RATE_WINDOW_MS;
      let oldest = sent[0];
      while (oldest !== undefined && oldest <= cutoff) {
        sent.shift();
        oldest = sent[0];
      }
      if (oldest === undefined || sent.length < perMinute) break;
      // The oldest request leaves the window at `oldest + RATE_WINDOW_MS`, which is `oldest - cutoff` from now.
      await sleep(Math.max(1, oldest - cutoff));
    }
    sent.push(now());
  };

  let queue: Promise<void> = Promise.resolve();
  return (request) => {
    const turn = queue.then(admit);
    // A failed turn must not stop the ones behind it, and the error still reaches its own caller through `turn`.
    queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn.then(() => network(request));
  };
}
