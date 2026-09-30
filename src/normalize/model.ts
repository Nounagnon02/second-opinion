/**
 * The common model every verified source is brought back to (specification F3): CMC identifier, symbol, USD price,
 * timestamp, volume, liquidity and the source that carries them, with the evidence behind it.
 *
 * Two rules shape it:
 * - a value is either read from an answer or `null`; nothing is filled in from another source or from a default;
 * - a field the answer could not provide leaves a `FieldIssue`, so that C7 and the audit can see it (D8).
 */
import { ENDPOINTS, type EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import type { FixtureRef } from '../cmc/fixtures.js';
import { parseStatus, type CmcStatus } from '../cmc/status.js';
import { isRecord, type FieldIssue, type Reader } from './values.js';

/** What a normaliser reads: one answer of a verified endpoint. A `CmcResponse` of the client is one. */
export interface SourceResponse {
  endpoint: EndpointId;
  status: CmcStatus;
  /** `body.data`, whatever shape the endpoint uses. */
  data: unknown;
  fixture?: FixtureRef | undefined;
}

/** Where an observation comes from, and the recorded answer that proves it. */
export interface SourceRef {
  endpoint: EndpointId;
  path: string;
  /** `status.timestamp` of the answer: the clock every age is measured against, never the local one (D4). */
  observedAt: string;
  /** The recorded exchange behind the answer, in record and replay modes; `null` on a live call. */
  fixture: FixtureRef | null;
}

export function sourceRef(response: SourceResponse): SourceRef {
  return {
    endpoint: response.endpoint,
    path: ENDPOINTS[response.endpoint].path,
    observedAt: response.status.timestamp,
    fixture: response.fixture ?? null,
  };
}

/** Which asset an observation is about, as the answer named it. Every part is `null` when the answer omits it. */
export interface AssetRef {
  cmcId: number | null;
  symbol: string | null;
  name: string | null;
  slug: string | null;
}

/** A chain or platform an asset lives on, as one endpoint names it. */
export interface PlatformRef {
  /**
   * The platform ID of this answer. The endpoints do not share one ID space (Ethereum is 1 in E01, 1027 in E02 and
   * "1027" in E05, observation 8 of docs/ENDPOINTS.md), so it is never compared across sources; `slug` is.
   */
  cmcId: number | null;
  name: string | null;
  slug: string | null;
  symbol: string | null;
  tokenAddress: string | null;
}

/** Where a price was formed, when the source says so. */
export interface Venue {
  /** DEX or platform name: E08 / E09 `dex_slug`, E10 `pdex`, E11 `exn`. */
  name: string | null;
  /** Pool or token address: E08 / E09 `contract_address` (the pool), E10 `a` (the token), E11 `addr` (the pool). */
  address: string | null;
  /** Network the venue runs on: E08 / E09 `network_slug`, E10 `pdex`. */
  network: string | null;
  /** Pair label such as `PAXG/WETH` (E08 / E09 `name`). */
  pair: string | null;
}

/** Which kind of source a price comes from; the checks read prices of different kinds against each other. */
export type PriceKind = 'aggregate' | 'conversion' | 'dex_token' | 'dex_pair' | 'rwa_wrapper';

/** One USD price of one asset, from one source, with everything the checks need around it. */
export interface PriceObservation {
  kind: PriceKind;
  source: SourceRef;
  asset: AssetRef;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  /**
   * Market capitalisation, where the source reports one (E02 / E03 `market_cap`, E10 `mc`, E14 `tokens[].market_cap`).
   * `null` for the pair sources: their `fully_diluted_value` measures something else and is not renamed here.
   */
  marketCapUsd: number | null;
  /** Timestamp of the price itself, ISO 8601 UTC. */
  lastUpdated: string | null;
  /** `observedAt` minus `lastUpdated`, in seconds; `null` when either is missing (D4). */
  ageSeconds: number | null;
  venue: Venue | null;
  issues: FieldIssue[];
}

/** Paging reported next to the items (E13, E16, E18, E19). */
export interface Page {
  totalSize: number | null;
  hasMore: boolean | null;
}

/** What a normaliser returns: the items it could read, and the problems it met above item level. */
export interface Normalized<T> {
  source: SourceRef;
  items: T[];
  /** Problems with the container itself, for example a `data` that is not the expected array. */
  issues: FieldIssue[];
  page: Page | null;
}

/** The CMC identifier and symbol of the US dollar, as seen in the `quote` blocks of every priced endpoint. */
export const USD_SYMBOL = 'USD';
export const USD_CMC_ID = 2781;

/** The field names under which a quote block names its conversion currency, across the verified endpoints. */
const USD_ID_FIELDS = ['id', 'convert_id', 'crypto_id'] as const;

/** The USD entry of a `quote` / `quotes` array: by `symbol` when there is one, else by the CMC ID of USD. */
export function pickUsd(quotes: Reader[]): Reader | undefined {
  const bySymbol = quotes.find((quote) => quote.text('symbol') === USD_SYMBOL);
  if (bySymbol) return bySymbol;
  return quotes.find((quote) => USD_ID_FIELDS.some((name) => quote.integer(name) === USD_CMC_ID));
}

/** Reads the paging fields of a container; `null` when the endpoint reports none. */
export function readPage(container: Reader): Page | null {
  if (!container.keys.includes('total_size') && !container.keys.includes('has_more')) return null;
  return { totalSize: container.integer('total_size'), hasMore: container.flag('has_more') };
}

/** Refuses an answer that does not come from one of the endpoints a normaliser was written for. */
export function expectEndpoint(response: SourceResponse, ...endpoints: EndpointId[]): void {
  if (!endpoints.includes(response.endpoint)) {
    throw new CmcError(
      'invalid_response',
      `Normaliser of ${endpoints.join(' / ')} received a ${response.endpoint} answer.`,
      { endpoint: response.endpoint },
    );
  }
}

/**
 * Reads a raw response body, in the shape fixtures store it, into the input of a normaliser. The audit (T6) and the
 * tests work from recorded bodies; the client hands its `CmcResponse` to the normalisers directly.
 */
export function sourceFromBody(endpoint: EndpointId, body: unknown, fixture?: FixtureRef): SourceResponse {
  const status = parseStatus(body);
  if (!status) {
    throw new CmcError('invalid_response', `${endpoint}: this body carries no readable status block.`, { endpoint });
  }
  const data = isRecord(body) ? body.data : undefined;
  return fixture ? { endpoint, status, data, fixture } : { endpoint, status, data };
}
