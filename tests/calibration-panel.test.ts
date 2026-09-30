/**
 * The calibration panel (T4.1): the assets the specification names — the first fifty by market capitalisation —
 * read from one E03 answer.
 *
 * Every case works from a recorded answer: the top-5 page of T1.2 and, where an unreadable item has to be
 * exercised, a copy of it with one field removed. No CMC body is written by hand.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_SIZE, MAX_PANEL_SIZE, describeMember, readPanel } from '../src/calibration/panel.js';
import { CmcClient, type Transport, type TransportResponse } from '../src/cmc/client.js';
import { CmcError } from '../src/cmc/errors.js';
import { fixtureResponse, jsonResponse } from './helpers/transport.js';

const TOP5 = 'E03-listings-latest-top5';

/** A client answering every request with `answer`, and keeping the requests it was given. */
function clientWith(answer: TransportResponse): CmcClient & { seen: URL[] } {
  const seen: URL[] = [];
  const transport: Transport = ({ url }) => {
    seen.push(url);
    return Promise.resolve({ ...answer, headers: { ...answer.headers } });
  };
  const client = new CmcClient({ apiKey: 'a-test-key-long-enough', transport, creditBudget: 100 });
  return Object.assign(client, { seen });
}

/** The recorded top-5 answer with its `data` array edited. */
function edited(edit: (items: Record<string, unknown>[]) => void): TransportResponse {
  const answer = fixtureResponse(TOP5);
  const body = JSON.parse(answer.text) as { data: Record<string, unknown>[] };
  edit(body.data);
  return { ...answer, text: JSON.stringify(body) };
}

describe('readPanel', () => {
  it('asks E03 for the assets it was given, ranked from the first', async () => {
    const client = clientWith(fixtureResponse(TOP5));

    await readPanel(client, 5);

    const [url] = client.seen;
    expect(url?.pathname).toBe('/v3/cryptocurrency/listings/latest');
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({ start: '1', limit: '5', convert: 'USD' });
  });

  it('asks for the fifty the specification names when no size is given', async () => {
    const client = clientWith(fixtureResponse(TOP5));

    const panel = await readPanel(client);

    expect(client.seen[0]?.searchParams.get('limit')).toBe(String(DEFAULT_PANEL_SIZE));
    // The recorded answer holds five items, and the panel reports what came back, not what was asked for.
    expect(panel.requested).toBe(DEFAULT_PANEL_SIZE);
    expect(panel.members).toHaveLength(5);
  });

  it('keeps the rank, the identifier and the capitalisation E03 gave each asset', async () => {
    const panel = await readPanel(clientWith(fixtureResponse(TOP5)), 5);

    expect(panel.members.map((member) => ({ rank: member.rank, symbol: member.symbol }))).toEqual([
      { rank: 1, symbol: 'BTC' },
      { rank: 2, symbol: 'ETH' },
      { rank: 3, symbol: 'USDT' },
      { rank: 4, symbol: 'BNB' },
      { rank: 5, symbol: 'XRP' },
    ]);
    const [first] = panel.members;
    expect(first?.cmcId).toBe(1);
    expect(first?.name).toBe('Bitcoin');
    expect(first?.marketCapUsd).toBeGreaterThan(0);
  });

  it('cites the answer it read, so every line of the report can point at it', async () => {
    const panel = await readPanel(clientWith(fixtureResponse(TOP5)), 5);

    expect(panel.source.endpoint).toBe('E03');
    expect(panel.source.observedAt).toBe('2026-09-24T16:04:52.629Z');
  });

  it('counts the ranks of the items that carry no CMC ID instead of assessing them', async () => {
    const answer = edited((items) => {
      delete items[1]?.id;
      delete items[3]?.id;
    });

    const panel = await readPanel(clientWith(answer), 5);

    expect(panel.withoutId).toEqual([2, 4]);
    expect(panel.members.map((member) => member.rank)).toEqual([1, 3, 5]);
  });

  it('refuses an answer where no item carries a CMC ID, rather than reporting an empty panel', async () => {
    const answer = edited((items) => {
      for (const item of items) delete item.id;
    });

    await expect(readPanel(clientWith(answer), 5)).rejects.toThrow(/no asset with a CMC ID/);
  });

  it('refuses a size outside 1 to the documented page', async () => {
    const client = clientWith(fixtureResponse(TOP5));

    for (const size of [0, -1, 2.5, MAX_PANEL_SIZE + 1]) {
      await expect(readPanel(client, size)).rejects.toThrow(CmcError);
    }
    expect(client.seen).toEqual([]);
  });

  it('lets a refused E03 through: a panel that could not be read is not a panel', async () => {
    const refusal = jsonResponse(429, {
      status: { timestamp: '2026-09-24T16:04:52.629Z', error_code: 1008, error_message: 'rate limit' },
    });

    await expect(readPanel(clientWith(refusal), 5)).rejects.toThrow(CmcError);
  });
});

describe('describeMember', () => {
  it('names an asset by its symbol, and by its identifier when E03 gave none', () => {
    expect(describeMember({ rank: 1, cmcId: 1, symbol: 'BTC', name: 'Bitcoin', marketCapUsd: null })).toBe('BTC');
    expect(describeMember({ rank: 2, cmcId: 1027, symbol: null, name: null, marketCapUsd: null })).toBe('CMC 1027');
  });
});
