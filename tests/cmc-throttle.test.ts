/**
 * The per-minute request limit (T4.1). A panel of fifty assets sends about five requests each, well past the
 * `plan.rate_limit_minute` of 50 E20 reports for this key, so the pacing is what keeps a calibration run from
 * collecting HTTP 429s.
 *
 * Time is scripted here: a clock the test moves and a `sleep` that records what it was asked to wait. Nothing waits
 * in real time, so the sliding window is checked at the boundaries rather than around them.
 */
import { describe, expect, it } from 'vitest';
import type { Transport, TransportRequest, TransportResponse } from '../src/cmc/client.js';
import { CmcError } from '../src/cmc/errors.js';
import { RATE_WINDOW_MS, throttledTransport } from '../src/cmc/throttle.js';

/** A clock the test moves, and a `sleep` that moves it rather than waiting. */
function scriptedClock(): { now: () => number; sleep: (ms: number) => Promise<void>; waits: number[] } {
  let clock = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => clock,
    sleep: (ms) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    waits,
  };
}

function answer(): TransportResponse {
  return { status: 200, statusText: 'OK', headers: {}, text: '{}' };
}

/** A network that records when each request reached it, on the scripted clock. */
function counting(now: () => number): Transport & { sentAt: number[] } {
  const sentAt: number[] = [];
  const transport: Transport = () => {
    sentAt.push(now());
    return Promise.resolve(answer());
  };
  return Object.assign(transport, { sentAt });
}

function request(at: number): TransportRequest {
  return {
    url: new URL(`https://pro-api.coinmarketcap.com/v2/simple/price?id=${String(at)}`),
    headers: {},
    signal: AbortSignal.abort(),
  };
}

describe('throttledTransport', () => {
  it('refuses a limit that is not a whole number of requests per minute', () => {
    const cases = [0, -1, 1.5, Number.NaN];
    for (const perMinute of cases) {
      expect(() => throttledTransport(counting(Date.now), { perMinute })).toThrow(CmcError);
    }
  });

  it('sends requests without waiting while the window has room', async () => {
    const { now, sleep, waits } = scriptedClock();
    const network = counting(now);
    const paced = throttledTransport(network, { perMinute: 3, now, sleep });

    for (let n = 0; n < 3; n += 1) await paced(request(n));

    expect(network.sentAt).toHaveLength(3);
    expect(waits).toEqual([]);
  });

  it('holds the request that would cross the limit until the oldest leaves the window', async () => {
    const { now, sleep, waits } = scriptedClock();
    const network = counting(now);
    const paced = throttledTransport(network, { perMinute: 2, now, sleep });
    const first = now();

    for (let n = 0; n < 3; n += 1) await paced(request(n));

    expect(waits).toEqual([RATE_WINDOW_MS]);
    // The third request leaves exactly one window after the first one, which is when that slot frees.
    expect(network.sentAt[2]).toBe(first + RATE_WINDOW_MS);
  });

  it('never lets more than the limit leave in any one window', async () => {
    const { now, sleep } = scriptedClock();
    const network = counting(now);
    const perMinute = 4;
    const paced = throttledTransport(network, { perMinute, now, sleep });

    await Promise.all(Array.from({ length: 13 }, (_value, n) => paced(request(n))));

    expect(network.sentAt).toHaveLength(13);
    const crowded = network.sentAt.filter(
      (sentAt) => network.sentAt.filter((other) => other > sentAt - RATE_WINDOW_MS && other <= sentAt).length > perMinute,
    );
    expect(crowded).toEqual([]);
    // Thirteen requests at four per window need three full windows before the last one can leave.
    expect((network.sentAt[12] ?? 0) - (network.sentAt[0] ?? 0)).toBe(3 * RATE_WINDOW_MS);
  });

  it('serialises parallel calls so two of them never take the same free slot', async () => {
    const { now, sleep } = scriptedClock();
    const network = counting(now);
    const paced = throttledTransport(network, { perMinute: 2, now, sleep });

    await Promise.all([paced(request(1)), paced(request(2)), paced(request(3)), paced(request(4))]);

    // Two slots at the start, two a window later: the parallel callers queued rather than reading the same room.
    const first = network.sentAt[0] ?? 0;
    expect(network.sentAt).toEqual([first, first, first + RATE_WINDOW_MS, first + RATE_WINDOW_MS]);
  });

  it('lets the requests behind a failed one through, and reports the failure to its own caller', async () => {
    const { now, sleep } = scriptedClock();
    const failure = new Error('connection reset');
    let calls = 0;
    const network: Transport = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(failure) : Promise.resolve(answer());
    };
    const paced = throttledTransport(network, { perMinute: 5, now, sleep });

    await expect(paced(request(1))).rejects.toThrow('connection reset');
    await expect(paced(request(2))).resolves.toEqual(answer());
  });

  it('forgets the requests that left the window rather than counting them for ever', async () => {
    const { now, sleep, waits } = scriptedClock();
    const network = counting(now);
    const paced = throttledTransport(network, { perMinute: 2, now, sleep });

    await paced(request(1));
    await paced(request(2));
    // Waiting past the window frees both slots, so the next two go out without any wait of their own.
    await sleep(RATE_WINDOW_MS + 1);
    await paced(request(3));
    await paced(request(4));

    expect(waits).toEqual([RATE_WINDOW_MS + 1]);
    expect(network.sentAt).toHaveLength(4);
  });
});
