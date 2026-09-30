import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CmcClient, type Transport, type TransportResponse } from '../src/cmc/client.js';
import { CmcError } from '../src/cmc/errors.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { normalizeRwaIssuer } from '../src/normalize/rwa.js';
import {
  buildWrapperIndex,
  DEFAULT_INDEX_FILE,
  describeWrapperIndex,
  entriesOfIssuer,
  loadWrapperIndex,
  lookupWrapper,
  MAX_PAGE_SIZE,
  parseWrapperIndex,
  saveWrapperIndex,
  serializeWrapperIndex,
  type WrapperIndex,
} from '../src/rwa/wrapper-index.js';
import { projectRoot } from './helpers/endpoints-doc.js';
import { recordedSource } from './helpers/normalize.js';
import { fixtureResponse } from './helpers/transport.js';

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-rwa-index-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The body of a recorded answer, so a test can serve a part of it without writing a CMC body by hand. */
function recordedBody(label: string): Record<string, unknown> {
  const file = join(projectRoot, 'fixtures', 'discovery', `${label}.json`);
  const exchange = JSON.parse(readFileSync(file, 'utf8')) as RecordedExchange;
  return structuredClone(exchange.response.body) as Record<string, unknown>;
}

function asResponse(body: unknown): TransportResponse {
  return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, text: JSON.stringify(body) };
}

interface IssuerListBody {
  data: { issuers: Record<string, unknown>[]; total_size: number; has_more: boolean };
}

/** The recorded issuer list, narrowed to the issuers a test has recorded token pages for. */
function issuerList(names: readonly string[], overrides: Record<string, unknown> = {}): IssuerListBody {
  const body = recordedBody('E18-rwa-issuers-list') as unknown as IssuerListBody;
  body.data.issuers = body.data.issuers.filter((issuer) => names.includes(issuer.name as string));
  body.data.total_size = body.data.issuers.length;
  Object.assign(body.data, overrides);
  return body;
}

/** The identifiers the recorded issuer list gives the two issuers whose token pages are recorded. */
const BACKED = '6878977dcbbf471de3366e85';
const PAXOS = '68904c24abae9b5b9fb35815';

/** One request the transport saw: the endpoint path and the parameters it carried. */
interface Seen {
  path: string;
  query: Record<string, string>;
}

/**
 * A transport that answers from `answers`, keyed by `<path>?<issuer_id>:<start>`, and keeps every request.
 * Anything it has no answer for fails the test loudly rather than quietly returning an empty page, which would
 * make a missing page look like the end of a catalogue.
 */
function routedTransport(answers: Record<string, unknown>): Transport & { seen: Seen[] } {
  const seen: Seen[] = [];
  const transport: Transport = (request) => {
    const query = Object.fromEntries(request.url.searchParams);
    seen.push({ path: request.url.pathname, query });
    const key = `${request.url.pathname}?${query.issuer_id ?? ''}:${query.start ?? ''}`;
    const answer = answers[key];
    if (answer === undefined) return Promise.reject(new Error(`no scripted answer for ${key}`));
    return Promise.resolve(asResponse(answer));
  };
  return Object.assign(transport, { seen });
}

function clientWith(transport: Transport): CmcClient {
  return new CmcClient({ apiKey: 'a-test-key-long-enough', transport, maxRetries: 0, creditBudget: 500 });
}

const E18_PATH = '/v5/real-world-assets/issuers/list';
const E19_PATH = '/v5/real-world-assets/issuers';

/**
 * A walk over two issuers of the recorded list. Backed Assets is paged: the two recorded 250-token pages are served
 * as page 1 and page 2, so the offset bookkeeping and the stop on `has_more: false` run on real bodies.
 */
function twoIssuerWalk(): Transport & { seen: Seen[] } {
  return routedTransport({
    [`${E18_PATH}?:1`]: issuerList(['Backed Assets', 'Paxos']),
    [`${E19_PATH}?${BACKED}:1`]: recordedBody('E19-rwa-issuer-backed-start1-limit250'),
    [`${E19_PATH}?${BACKED}:251`]: recordedBody('E19-rwa-issuer-backed-start1001-limit250'),
    [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
  });
}

describe('entriesOfIssuer', () => {
  it('keeps the tokens carrying both identifiers, and counts the ones that do not', () => {
    // The recorded first page of Backed Assets lists 250 tokens, 97 of them without an rwa_id.
    const [issuer] = normalizeRwaIssuer(recordedSource('E19', 'E19-rwa-issuer-backed-start1-limit250')).items;
    if (issuer === undefined) throw new Error('the recorded answer carries no issuer.');
    const counted = entriesOfIssuer(issuer);
    expect(counted.tokens).toBe(250);
    expect(counted.withoutLink).toBe(97);
    expect(counted.entries).toHaveLength(153);
    expect(counted.entries[0]).toEqual({
      cmcId: 36989,
      rwaId: 82,
      symbol: 'COINX',
      name: 'Coinbase tokenized stock (xStock)',
      issuerId: BACKED,
      issuerName: 'Backed Assets',
    });
  });

  it('carries the issuer onto each of its tokens, so a wrapper can be traced back to who issued it', () => {
    const [issuer] = normalizeRwaIssuer(recordedSource('E19', 'E19-rwa-issuer-paxos')).items;
    if (issuer === undefined) throw new Error('the recorded answer carries no issuer.');
    expect(entriesOfIssuer(issuer).entries).toEqual([
      { cmcId: 4705, rwaId: 1, symbol: 'PAXG', name: 'PAX Gold', issuerId: PAXOS, issuerName: 'Paxos' },
    ]);
  });
});

describe('buildWrapperIndex', () => {
  it('walks the issuers, pages their tokens, and reports what the walk cost', async () => {
    const transport = twoIssuerWalk();
    const index = await buildWrapperIndex(clientWith(transport));

    // 250 + 176 tokens for Backed Assets and 1 for Paxos; 97 + 166 of them carry no rwa_id.
    expect(index.stats).toEqual({
      issuers: 2,
      issuersRead: 2,
      calls: 4,
      credits: 4,
      creditsUnconfirmed: 0,
      tokens: 427,
      tokensWithoutLink: 263,
    });
    expect(index.entries).toHaveLength(164);
    // The date comes from the first answer's own `status.timestamp`, never from the local clock (D4).
    expect(index.builtAt).toBe('2026-09-24T16:05:13.004Z');
    expect(index.sources.map((source) => source.endpoint)).toEqual(['E18', 'E19', 'E19', 'E19']);
  });

  it('reports the credits the answers charged, not the attempts it took to get them', async () => {
    // The live walk of 2026-09-25 took 32 attempts for 30 answers and was charged 30 credits (D6). Counting
    // attempts instead would have written 32 into that table and overstated what the index costs, so the two
    // numbers are held apart here: one E19 attempt fails below HTTP, the retry answers, and `calls` and `credits`
    // part company.
    const answers: Record<string, unknown> = {
      [`${E18_PATH}?:1`]: issuerList(['Paxos']),
      [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
    };
    let refused = 0;
    const transport: Transport = (request) => {
      const query = Object.fromEntries(request.url.searchParams);
      const key = `${request.url.pathname}?${query.issuer_id ?? ''}:${query.start ?? ''}`;
      if (request.url.pathname === E19_PATH && refused === 0) {
        refused += 1;
        return Promise.reject(new Error('socket hang up'));
      }
      const answer = answers[key];
      if (answer === undefined) return Promise.reject(new Error(`no scripted answer for ${key}`));
      return Promise.resolve(asResponse(answer));
    };
    const client = new CmcClient({
      apiKey: 'a-test-key-long-enough',
      transport,
      maxRetries: 1,
      creditBudget: 500,
      sleep: () => Promise.resolve(),
    });

    const index = await buildWrapperIndex(client);

    // Three attempts reached the network, two came back with an answer, and only those two were charged.
    expect(index.stats.calls).toBe(3);
    expect(index.stats.credits).toBe(2);
    expect(index.stats.creditsUnconfirmed).toBe(1);
    expect(index.stats.credits).not.toBe(index.stats.calls);
    // The retry is not a lost page: the token the failed attempt was after is in the index.
    expect(lookupWrapper(index, { symbol: 'PAXG' }).map((entry) => entry.rwaId)).toEqual([1]);
  });

  it('asks for the next page from where the last one stopped', async () => {
    const transport = twoIssuerWalk();
    await buildWrapperIndex(clientWith(transport));
    const backed = transport.seen.filter((request) => request.query.issuer_id === BACKED);
    expect(backed.map((request) => request.query.start)).toEqual(['1', '251']);
    expect(backed.every((request) => request.query.limit === String(MAX_PAGE_SIZE))).toBe(true);
  });

  it('stops paging an issuer as soon as an answer reports no more, and asks it nothing else', async () => {
    const transport = twoIssuerWalk();
    await buildWrapperIndex(clientWith(transport));
    // E19-rwa-issuer-paxos says has_more false on its only page: one call, never a second.
    expect(transport.seen.filter((request) => request.query.issuer_id === PAXOS)).toHaveLength(1);
  });

  it('spends no call on an issuer that reports no token', async () => {
    const list = issuerList(['Paxos', 'Fidelity Investments Assets']);
    for (const issuer of list.data.issuers) {
      if (issuer.name !== 'Paxos') issuer.num_tokens = 0;
    }
    const transport = routedTransport({
      [`${E18_PATH}?:1`]: list,
      [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
    });
    const index = await buildWrapperIndex(clientWith(transport));
    expect(index.stats.issuers).toBe(2);
    expect(index.stats.issuersRead).toBe(1);
    expect(transport.seen.filter((request) => request.path === E19_PATH)).toHaveLength(1);
  });

  it('pages the issuer list itself when one page does not hold it', async () => {
    const transport = routedTransport({
      [`${E18_PATH}?:1`]: issuerList(['Paxos'], { has_more: true, total_size: 2 }),
      [`${E18_PATH}?:2`]: issuerList(['Backed Assets'], { has_more: false, total_size: 2 }),
      [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
      [`${E19_PATH}?${BACKED}:1`]: recordedBody('E19-rwa-issuer-backed-start1-limit250'),
      [`${E19_PATH}?${BACKED}:251`]: recordedBody('E19-rwa-issuer-backed-start1001-limit250'),
    });
    const index = await buildWrapperIndex(clientWith(transport));
    expect(transport.seen.filter((request) => request.path === E18_PATH).map((request) => request.query.start)).toEqual(
      ['1', '2'],
    );
    expect(index.stats.issuersRead).toBe(2);
  });

  it('stops asking for issuers once it has read as many as the answer says there are', async () => {
    // A list that keeps saying `has_more` would otherwise spend a credit a page until the page guard stops it.
    const transport = routedTransport({
      [`${E18_PATH}?:1`]: issuerList(['Paxos'], { has_more: true, total_size: 1 }),
      [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
    });
    await buildWrapperIndex(clientWith(transport));
    expect(transport.seen.filter((request) => request.path === E18_PATH)).toHaveLength(1);
  });

  it('refuses a page size the endpoint would refuse, before spending anything', async () => {
    const transport = twoIssuerWalk();
    for (const pageSize of [0, -1, 2.5, MAX_PAGE_SIZE + 1, 1000]) {
      await expect(buildWrapperIndex(clientWith(transport), { pageSize })).rejects.toThrow(CmcError);
    }
    // E19 answered "Must be an integer between 1 and 250" to limit=1000 (E19-rwa-issuer-backed-limit1000).
    await expect(buildWrapperIndex(clientWith(transport), { pageSize: 1000 })).rejects.toThrow(
      /page size must be an integer between 1 and 250/,
    );
    expect(transport.seen).toEqual([]);
  });

  it('asks for the page size it was given', async () => {
    const transport = routedTransport({
      [`${E18_PATH}?:1`]: issuerList(['Paxos']),
      [`${E19_PATH}?${PAXOS}:1`]: recordedBody('E19-rwa-issuer-paxos'),
    });
    await buildWrapperIndex(clientWith(transport), { pageSize: 10 });
    expect(transport.seen.every((request) => request.query.limit === '10')).toBe(true);
  });

  it('lets a failed call through rather than returning half a catalogue as a whole one', async () => {
    const transport = routedTransport({ [`${E18_PATH}?:1`]: issuerList(['Paxos']) });
    await expect(buildWrapperIndex(clientWith(transport))).rejects.toThrow(/no scripted answer/);
  });
});

describe('lookupWrapper', () => {
  const index: WrapperIndex = {
    builtAt: '2026-09-24T16:05:13.004Z',
    entries: [
      { cmcId: 4705, rwaId: 1, symbol: 'PAXG', name: 'PAX Gold', issuerId: PAXOS, issuerName: 'Paxos' },
      { cmcId: 20245, rwaId: 1, symbol: 'CGO', name: 'Comtech Gold', issuerId: null, issuerName: null },
      { cmcId: 99999, rwaId: 82, symbol: 'CGO', name: 'A namesake', issuerId: null, issuerName: null },
      { cmcId: 12345, rwaId: 82, symbol: null, name: 'No symbol', issuerId: null, issuerName: null },
    ],
    stats: { issuers: 1, issuersRead: 1, calls: 1, credits: 1, creditsUnconfirmed: 0, tokens: 4, tokensWithoutLink: 0 },
    sources: [],
  };

  it('answers on a CMC identifier, which names one wrapper', () => {
    expect(lookupWrapper(index, { cmcId: 4705 }).map((entry) => entry.rwaId)).toEqual([1]);
    expect(lookupWrapper(index, { cmcId: 1 })).toEqual([]);
  });

  it('returns every wrapper a symbol matches, and leaves the choice to the caller (D3)', () => {
    expect(lookupWrapper(index, { symbol: 'CGO' }).map((entry) => entry.cmcId)).toEqual([20245, 99999]);
    expect(lookupWrapper(index, { symbol: ' paxg ' }).map((entry) => entry.cmcId)).toEqual([4705]);
  });

  it('prefers the identifier when the caller has one, and matches nothing on an empty selector', () => {
    expect(lookupWrapper(index, { cmcId: 4705, symbol: 'CGO' }).map((entry) => entry.cmcId)).toEqual([4705]);
    expect(lookupWrapper(index, {})).toEqual([]);
    expect(lookupWrapper(index, { cmcId: null, symbol: null })).toEqual([]);
  });
});

describe('the cached index file', () => {
  it('is kept outside git, next to the other caches', () => {
    expect(DEFAULT_INDEX_FILE).toBe(join(projectRoot, '.cache', 'rwa', 'wrapper-index.json'));
    expect(readFileSync(join(projectRoot, '.gitignore'), 'utf8')).toMatch(/^\.cache\/?$/m);
  });

  it('survives a round trip through the file, entry for entry', async () => {
    const index = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const file = join(scratch(), 'wrapper-index.json');
    saveWrapperIndex(index, file);
    const read = loadWrapperIndex(file);
    expect(read?.entries).toEqual(index.entries);
    expect(read?.builtAt).toBe(index.builtAt);
    expect(read?.stats).toEqual(index.stats);
    expect(serializeWrapperIndex(index).endsWith('\n')).toBe(true);
  });

  it('creates the directory it writes into', async () => {
    const index = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const file = join(scratch(), 'rwa', 'wrapper-index.json');
    saveWrapperIndex(index, file);
    expect(loadWrapperIndex(file)?.entries).toHaveLength(index.entries.length);
  });

  // `npm run demo` rebuilds this cache when it is missing, and so does every test file that spawns the server, so
  // two writers at once is normal. A reader that caught one mid-write would throw rather than see no index (T9.1).
  it('leaves nothing half-written behind, however many writers there are', async () => {
    const index = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const dir = scratch();
    const file = join(dir, 'wrapper-index.json');
    for (let round = 0; round < 5; round += 1) saveWrapperIndex(index, file);
    expect(readdirSync(dir)).toEqual(['wrapper-index.json']);
    expect(loadWrapperIndex(file)?.entries).toEqual(index.entries);
  });

  it('overwrites an index already there rather than failing on it', async () => {
    const first = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const file = join(scratch(), 'wrapper-index.json');
    saveWrapperIndex(first, file);
    const second: WrapperIndex = { ...first, entries: first.entries.slice(0, 1) };
    saveWrapperIndex(second, file);
    expect(loadWrapperIndex(file)?.entries).toHaveLength(1);
  });

  it('reports a write it could not finish, and keeps no fragment of it', async () => {
    const index = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const dir = scratch();
    // A directory where the file belongs: the rename fails, and the fragment beside it has to go with it.
    const file = join(dir, 'wrapper-index.json');
    mkdirSync(file);
    expect(() => saveWrapperIndex(index, file)).toThrow();
    expect(readdirSync(dir)).toEqual(['wrapper-index.json']);
  });

  it('reports no index rather than an empty one when the file is not there yet', () => {
    expect(loadWrapperIndex(join(scratch(), 'never-written.json'))).toBeNull();
  });

  it('refuses a damaged cache instead of reading it as an empty index', () => {
    const dir = scratch();
    const write = (text: string): string => {
      const file = join(dir, 'wrapper-index.json');
      writeFileSync(file, text);
      return file;
    };
    expect(() => loadWrapperIndex(write('{not json'))).toThrow(/not valid JSON/);
    expect(() => loadWrapperIndex(write('[]'))).toThrow(/not a JSON object/);
    expect(() => loadWrapperIndex(write('{"entries":[],"stats":{}}'))).toThrow(/no valid builtAt/);
    expect(() => loadWrapperIndex(write('{"builtAt":"yesterday","entries":[],"stats":{}}'))).toThrow(
      /no valid builtAt/,
    );
    expect(() => loadWrapperIndex(write('{"builtAt":"2026-09-24T16:05:13.004Z","stats":{}}'))).toThrow(
      /no entries array/,
    );
    expect(() => loadWrapperIndex(write('{"builtAt":"2026-09-24T16:05:13.004Z","entries":[]}'))).toThrow(
      /no stats object/,
    );
  });

  it('names the entry it could not read, so a damaged cache can be found rather than guessed at', () => {
    const good = '{"cmcId":4705,"rwaId":1,"symbol":"PAXG","name":"PAX Gold","issuerId":null,"issuerName":null}';
    const text = `{"builtAt":"2026-09-24T16:05:13.004Z","stats":{},"entries":[${good},{"cmcId":4705}]}`;
    expect(() => parseWrapperIndex(text, 'example.json')).toThrow(/entries\[1\] needs an integer cmcId and rwaId/);
    expect(() => parseWrapperIndex(text, 'example.json')).toThrow(CmcError);
  });

  it('reads an entry whose optional names the answer left out', () => {
    const text = '{"builtAt":"2026-09-24T16:05:13.004Z","stats":{},"entries":[{"cmcId":4705,"rwaId":1}]}';
    expect(parseWrapperIndex(text, 'example.json').entries[0]).toEqual({
      cmcId: 4705,
      rwaId: 1,
      symbol: null,
      name: null,
      issuerId: null,
      issuerName: null,
    });
  });
});

/** An index of nothing, for the lines `describeWrapperIndex` writes whatever the walk found. */
function bareIndex(): WrapperIndex {
  return {
    builtAt: '2026-09-24T16:05:13.004Z',
    entries: [],
    stats: { issuers: 0, issuersRead: 0, calls: 1, credits: 1, creditsUnconfirmed: 0, tokens: 0, tokensWithoutLink: 0 },
    sources: [],
  };
}

describe('describeWrapperIndex', () => {
  it('states what the walk cost and how much of the catalogue it could resolve', async () => {
    const index = await buildWrapperIndex(clientWith(twoIssuerWalk()));
    const lines = describeWrapperIndex(index);
    expect(lines[0]).toContain('2026-09-24T16:05:13.004Z');
    expect(lines[1]).toBe('4 request(s), 4 credit(s) reported by the answers.');
    // 427 tokens read, 164 of them carrying both identifiers.
    expect(lines[2]).toBe('427 token(s) listed, 164 carrying both a crypto_id and an rwa_id (38.4 %), 263 without.');
    expect(lines[3]).toBe('164 wrapper(s) in the index.');
  });

  it('divides nothing by an empty catalogue', () => {
    expect(describeWrapperIndex(bareIndex())[2]).toContain('(0.0 %)');
  });

  it('keeps apart what the answers reported and what an attempt without an answer may have cost', () => {
    // The live walk of 2026-09-25 took 32 attempts for 30 answers (D6): reporting only the 30 confirmed credits as
    // the whole cost would understate it, and adding the two in would state a charge no answer ever confirmed.
    const index = bareIndex();
    expect(describeWrapperIndex(index)[1]).toBe('1 request(s), 1 credit(s) reported by the answers.');
    index.stats.calls = 3;
    index.stats.creditsUnconfirmed = 2;
    expect(describeWrapperIndex(index)[1]).toBe(
      '3 request(s), 1 credit(s) reported by the answers, and 2 credit(s) of attempts that came back without one, ' +
        'which the answers never confirmed either way.',
    );
  });
});

describe('the recorded evidence behind the index', () => {
  it('rests on answers that are in the repository', () => {
    // Every body the tests above serve comes from one of these files; a walk built on a body nobody recorded would
    // prove nothing about the endpoints.
    for (const label of [
      'E18-rwa-issuers-list',
      'E19-rwa-issuer-paxos',
      'E19-rwa-issuer-backed-start1-limit250',
      'E19-rwa-issuer-backed-start1001-limit250',
    ]) {
      expect(fixtureResponse(label).status, label).toBe(200);
    }
    // The page size the endpoint refused, recorded: it is why MAX_PAGE_SIZE is 250 and not more.
    const refused = fixtureResponse('E19-rwa-issuer-backed-limit1000');
    expect(refused.status).toBe(400);
    expect(refused.text).toContain('between 1 and 250');
  });
});

describe('the recorded catalogue walk', () => {
  // The whole walk of 2026-09-25 is in fixtures/rwa-index, so the numbers D6 records are replayed here rather than
  // copied: a fixture that changes, or one that goes missing, fails this test instead of quietly aging in a document.
  const RECORDED_WALK = join(projectRoot, 'fixtures', 'rwa-index');

  async function replayWalk(): Promise<WrapperIndex> {
    return buildWrapperIndex(createClientForMode({ kind: 'replay', dir: RECORDED_WALK }, {}));
  }

  it('reaches the whole catalogue in one pass, for the cost D6 records', async () => {
    const { stats } = await replayWalk();
    // Live on 2026-09-25 the same walk took 32 attempts for these 30 answers: two timed out at 8 s and were retried.
    // CMC's own counter agrees with the 30 credits (E20 current_month.credits_used went from 18 to 48).
    expect(stats).toEqual({
      issuers: 25,
      issuersRead: 22,
      calls: 30,
      credits: 30,
      // Replaying the recorded answers, every attempt gets one; the two the live walk lost are in D6, not here.
      creditsUnconfirmed: 0,
      tokens: 2393,
      tokensWithoutLink: 956,
    });
  });

  it('resolves 60 % of the catalogue: the rest is tokens the answers left without an identifier', async () => {
    const index = await replayWalk();
    expect(index.entries).toHaveLength(1437);
    expect(index.stats.tokens - index.stats.tokensWithoutLink).toBe(index.entries.length);
    expect(describeWrapperIndex(index)[2]).toContain('(60.1 %)');
  });

  it('answers the wrapper symbol the demo asks about with the asset C5 then reads', async () => {
    const [paxg, ...others] = lookupWrapper(await replayWalk(), { symbol: 'PAXG' });
    expect(others).toEqual([]);
    expect(paxg).toMatchObject({ cmcId: 4705, rwaId: 1, symbol: 'PAXG', issuerName: 'Paxos' });
    // The other end of the chain: the recorded GOLD answer C5 runs on was read with exactly that rwa_id.
    const gold = JSON.parse(
      readFileSync(join(projectRoot, 'fixtures', 'discovery', 'E14-rwa-quotes-gold.json'), 'utf8'),
    ) as RecordedExchange;
    expect(gold.request.query).toEqual({ rwa_id: String(paxg?.rwaId) });
  });

  it('cites the recorded answers it was built from, and nothing else', async () => {
    const { sources } = await replayWalk();
    expect(sources).toHaveLength(30);
    expect(sources.filter((source) => source.endpoint === 'E18')).toHaveLength(1);
    for (const source of sources) {
      expect(source.fixture?.file, source.endpoint).toMatch(/^fixtures\/rwa-index\/E1[89]-/);
    }
  });
});
