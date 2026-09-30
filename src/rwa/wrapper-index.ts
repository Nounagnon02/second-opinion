/**
 * The token to real-world-asset index: which RWA each tokenised wrapper wraps.
 *
 * C5 compares a wrapper with the other wrappers of its asset, which means one E14 call on the `rwa_id` of that
 * asset. E13 resolves an RWA symbol (`GOLD`) at no credit cost, but a user asks about a wrapper (`PAXG`), and no
 * verified endpoint maps a wrapper to its asset directly. The one route is E18, which lists the issuers, and E19,
 * which lists the tokens of one issuer with an `rwa_id` next to each `crypto_id` (D6).
 *
 * That route is a whole-catalogue walk, not a per-asset call, so the index is built once and cached; what building
 * it costs is measured and reported by `WrapperIndexStats`, never estimated. Both endpoints page the same way
 * (`start`, 1-based, and `limit`), verified for E19 in `E19-rwa-issuer-backed-start1-limit250` and
 * `E19-rwa-issuer-backed-start1001-limit250`.
 *
 * A token E19 lists without a `crypto_id` or without an `rwa_id` cannot enter the index. Those are counted and
 * reported rather than dropped quietly: the count says how much of the catalogue this route can actually resolve.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CmcClient } from '../cmc/client.js';
import { PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import type { SourceRef } from '../normalize/model.js';
import { normalizeRwaIssuer, normalizeRwaIssuers, type RwaIssuer } from '../normalize/rwa.js';
import { isRecord } from '../normalize/values.js';

/** Where a built index is cached. Under `.cache/`, which git ignores: the evidence is the recorded answers. */
export const DEFAULT_INDEX_FILE = join(PROJECT_ROOT, '.cache', 'rwa', 'wrapper-index.json');

/** The page size used for both endpoints. E19 refuses 1000: "Must be an integer between 1 and 250". */
export const MAX_PAGE_SIZE = 250;

/** A page count no catalogue should need, so that a `has_more` that never turns false cannot loop for ever. */
const MAX_PAGES = 40;

/** One wrapper, and the real-world asset it wraps. */
export interface WrapperIndexEntry {
  /** `tokens[].crypto_id`: the same identifier E02 and E14 `tokens[]` use. */
  cmcId: number;
  /** `tokens[].rwa_id`: what E14 is called with to read the wrapper's siblings. */
  rwaId: number;
  symbol: string | null;
  name: string | null;
  issuerId: string | null;
  issuerName: string | null;
}

/** What building the index cost and covered, as the answers reported it. */
export interface WrapperIndexStats {
  /** Issuers E18 listed, from its `total_size` when it gives one, else the number read. */
  issuers: number;
  /** Issuers E19 was called for: those reporting at least one token. */
  issuersRead: number;
  /** Requests the client sent for this build; a client that served an answer from its cache does not count it. */
  calls: number;
  /** Credits the answers reported (`status.credit_count`), summed by the client's meter. */
  credits: number;
  /**
   * Credits of attempts that came back without an answer, at the cost the endpoint is expected to charge. The API
   * never said whether it charged them, so they are reported apart rather than added in or dropped: E20 read before
   * and after the walk is what settles the real total.
   */
  creditsUnconfirmed: number;
  /** Tokens E19 listed, across every issuer. */
  tokens: number;
  /** Tokens whose `crypto_id` or `rwa_id` the answer left unreadable: they are outside the index. */
  tokensWithoutLink: number;
}

/** A built index, with everything needed to say when it was built and what it cost. */
export interface WrapperIndex {
  /** `status.timestamp` of the first answer read, never the local clock (D4). */
  builtAt: string;
  entries: WrapperIndexEntry[];
  stats: WrapperIndexStats;
  /** Every answer read, in order: the evidence the index rests on. */
  sources: SourceRef[];
}

/** Two names of the same thing, compared the way the API writes them. */
function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The entries a wrapper identifier matches: by CMC identifier when the caller has one, else by symbol.
 *
 * A symbol can match more than once - the catalogue holds tokenised wrappers of different assets under close names -
 * so every match is returned and the caller decides, as the E01 resolver does for coins (D3).
 */
export function lookupWrapper(
  index: WrapperIndex,
  selector: { cmcId?: number | null; symbol?: string | null },
): WrapperIndexEntry[] {
  const { cmcId, symbol } = selector;
  if (cmcId !== null && cmcId !== undefined) return index.entries.filter((entry) => entry.cmcId === cmcId);
  if (symbol) return index.entries.filter((entry) => entry.symbol !== null && sameText(entry.symbol, symbol));
  return [];
}

/** The tokens of one issuer that carry both identifiers, and how many did not. */
export function entriesOfIssuer(issuer: RwaIssuer): {
  entries: WrapperIndexEntry[];
  tokens: number;
  withoutLink: number;
} {
  const entries: WrapperIndexEntry[] = [];
  let withoutLink = 0;
  for (const token of issuer.tokens) {
    if (token.cmcId === null || token.rwaId === null) {
      withoutLink += 1;
      continue;
    }
    entries.push({
      cmcId: token.cmcId,
      rwaId: token.rwaId,
      symbol: token.symbol,
      name: token.name,
      issuerId: issuer.issuerId,
      issuerName: issuer.name,
    });
  }
  return { entries, tokens: issuer.tokens.length, withoutLink };
}

export interface BuildOptions {
  /** Page size for both endpoints, 1 to `MAX_PAGE_SIZE`. */
  pageSize?: number;
}

/**
 * Walks E18 and then E19 for every issuer, and returns the index with what the walk cost.
 *
 * `client` should be one this build has to itself: the call and credit counts are read from its meter, which is what
 * makes them measurements rather than estimates.
 *
 * Paging stops when an answer reports `has_more: false`, when a page comes back empty, or when what has been read
 * reaches the `total_size` the answer states. A page limit guards each loop, because a `has_more` that stayed true
 * would otherwise spend credits without end.
 */
export async function buildWrapperIndex(client: CmcClient, options: BuildOptions = {}): Promise<WrapperIndex> {
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new CmcError('config', `The page size must be an integer between 1 and ${MAX_PAGE_SIZE}, got ${pageSize}.`);
  }

  const sources: SourceRef[] = [];
  const issuers: RwaIssuer[] = [];
  let issuerTotal: number | null = null;

  for (let start = 1, page = 1; page <= MAX_PAGES; page += 1) {
    const listed = normalizeRwaIssuers(await client.get('E18', { start, limit: pageSize }));
    sources.push(listed.source);
    issuers.push(...listed.items);
    issuerTotal ??= listed.page?.totalSize ?? null;
    start += listed.items.length;
    if (listed.items.length === 0 || listed.page?.hasMore !== true) break;
    if (issuerTotal !== null && issuers.length >= issuerTotal) break;
  }

  const entries: WrapperIndexEntry[] = [];
  let issuersRead = 0;
  let tokens = 0;
  let tokensWithoutLink = 0;

  for (const issuer of issuers) {
    // An issuer reporting no token has nothing to page, and a call for it would spend a credit on an empty list.
    if (issuer.issuerId === null || (issuer.numTokens !== null && issuer.numTokens <= 0)) continue;
    issuersRead += 1;
    for (let start = 1, page = 1; page <= MAX_PAGES; page += 1) {
      const read = normalizeRwaIssuer(await client.get('E19', { issuer_id: issuer.issuerId, start, limit: pageSize }));
      sources.push(read.source);
      const [one] = read.items;
      if (one === undefined) break;
      const counted = entriesOfIssuer(one);
      entries.push(...counted.entries);
      tokens += counted.tokens;
      tokensWithoutLink += counted.withoutLink;
      start += counted.tokens;
      if (counted.tokens === 0 || read.page?.hasMore !== true) break;
      const total = read.page?.totalSize ?? null;
      if (total !== null && start > total) break;
    }
  }

  const [first] = sources;
  if (first === undefined) {
    throw new CmcError('invalid_response', 'E18 answered no page at all, so no wrapper index could be built.', {
      endpoint: 'E18',
    });
  }
  const { charged, unconfirmed, requests } = client.credits();
  return {
    builtAt: first.observedAt,
    entries,
    stats: {
      issuers: issuerTotal ?? issuers.length,
      issuersRead,
      calls: requests,
      credits: charged,
      creditsUnconfirmed: unconfirmed,
      tokens,
      tokensWithoutLink,
    },
    sources,
  };
}

/** The index as a file holds it: two spaces, a trailing newline, and the answers it rests on. */
export function serializeWrapperIndex(index: WrapperIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function fail(file: string, detail: string): never {
  throw new CmcError('config', `${file}: ${detail}`);
}

function readEntry(value: unknown, file: string, at: number): WrapperIndexEntry {
  if (!isRecord(value)) fail(file, `entries[${at}] is not an object.`);
  const { cmcId, rwaId, symbol, name, issuerId, issuerName } = value;
  if (!Number.isInteger(cmcId) || !Number.isInteger(rwaId)) {
    fail(file, `entries[${at}] needs an integer cmcId and rwaId.`);
  }
  const text = (field: unknown): string | null => (typeof field === 'string' ? field : null);
  return {
    cmcId: cmcId as number,
    rwaId: rwaId as number,
    symbol: text(symbol),
    name: text(name),
    issuerId: text(issuerId),
    issuerName: text(issuerName),
  };
}

/**
 * Reads a cached index. The file is validated rather than trusted: a damaged cache read as an empty index would make
 * every wrapper look unknown, and a run would report C5 as `not_applicable` instead of saying that the index needs
 * rebuilding.
 */
export function parseWrapperIndex(text: string, file = DEFAULT_INDEX_FILE): WrapperIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    return fail(file, `the cached wrapper index is not valid JSON (${String(cause)}).`);
  }
  if (!isRecord(parsed)) fail(file, 'the cached wrapper index is not a JSON object.');
  const { builtAt, entries, stats, sources } = parsed;
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) {
    fail(file, 'the cached wrapper index has no valid builtAt timestamp.');
  }
  if (!Array.isArray(entries)) fail(file, 'the cached wrapper index has no entries array.');
  if (!isRecord(stats)) fail(file, 'the cached wrapper index has no stats object.');
  return {
    builtAt,
    entries: entries.map((entry, at) => readEntry(entry, file, at)),
    stats: stats as unknown as WrapperIndexStats,
    sources: Array.isArray(sources) ? (sources as SourceRef[]) : [],
  };
}

/** Counts the writes of this process, so that two concurrent ones cannot pick the same temporary name. */
let writes = 0;

/**
 * Writes the index to its cache file, creating the directory.
 *
 * Written beside the target and renamed over it, because more than one writer is normal: `npm run demo` rebuilds the
 * cache when it is missing, and so does every test file that spawns the server. `loadWrapperIndex` treats a file it
 * cannot parse as an error rather than as an absent index — rightly, a damaged cache should be reported — so a reader
 * that caught another writer mid-`write` would fail instead of waiting. A rename is atomic within a filesystem.
 */
export function saveWrapperIndex(index: WrapperIndex, file = DEFAULT_INDEX_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writes += 1;
  const partial = `${file}.${String(process.pid)}-${String(writes)}.part`;
  try {
    writeFileSync(partial, serializeWrapperIndex(index), 'utf8');
    renameSync(partial, file);
  } catch (cause) {
    rmSync(partial, { force: true });
    throw cause;
  }
}

/** Reads the cached index, or `null` when there is none yet. Anything else is reported, not swallowed. */
export function loadWrapperIndex(file = DEFAULT_INDEX_FILE): WrapperIndex | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return fail(file, `the cached wrapper index could not be read (${String(cause)}).`);
  }
  return parseWrapperIndex(text, file);
}

/** One line per number, for the command that builds the index and for the cost recorded in D6. */
export function describeWrapperIndex(index: WrapperIndex): string[] {
  const { stats } = index;
  const linked = stats.tokens - stats.tokensWithoutLink;
  const share = stats.tokens === 0 ? 0 : (linked / stats.tokens) * 100;
  return [
    `Built from answers dated ${index.builtAt}: ${stats.issuers} issuer(s) listed, ${stats.issuersRead} read.`,
    `${stats.calls} request(s), ${stats.credits} credit(s) reported by the answers` +
      (stats.creditsUnconfirmed > 0
        ? `, and ${stats.creditsUnconfirmed} credit(s) of attempts that came back without one, which the answers ` +
          'never confirmed either way.'
        : '.'),
    `${stats.tokens} token(s) listed, ${linked} carrying both a crypto_id and an rwa_id (${share.toFixed(1)} %), ` +
      `${stats.tokensWithoutLink} without.`,
    `${index.entries.length} wrapper(s) in the index.`,
  ];
}
