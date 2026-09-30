/**
 * Normalisers of the DEX endpoints: E08 and E09 spot pairs, E10 token price and E11 token pools.
 *
 * These answers use short field names and send numbers and timestamps as strings (E10 `ts`, E11 `liqUsd`, `v24`,
 * `pubAt`); `values.ts` reads both shapes, and the audit reports the shapes themselves (D8).
 */
import {
  expectEndpoint,
  pickUsd,
  sourceRef,
  USD_SYMBOL,
  type Normalized,
  type PriceObservation,
  type SourceRef,
  type SourceResponse,
} from './model.js';
import { ageSeconds, Reader, type FieldIssue } from './values.js';

/** One side of a pool, as E11 reports it. */
export interface PoolToken {
  address: string | null;
  symbol: string | null;
  name: string | null;
  /** `liq`: the balance held by the pool, in units of the token. */
  liquidity: number | null;
  liquidityUsd: number | null;
}

/** One liquidity pool of a token (E11). C4 reads the deepest one (D5). */
export interface PoolObservation {
  source: SourceRef;
  /** `addr`: the pool contract. */
  address: string | null;
  /** `exn`: the DEX the pool belongs to. */
  exchange: string | null;
  exchangeId: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  /** `pubAt`: when the pool was published. It does not date any price, so C3 never reads it. */
  publishedAt: string | null;
  /** The two sides of the pool, in the order the answer lists them (`t0`, then `t1`). */
  tokens: PoolToken[];
  /** `bidx`: which entry of `tokens` is the base asset of the pool, when the answer says so. */
  baseIndex: number | null;
  issues: FieldIssue[];
}

/** The USD quote of a pair, or a reader on nothing so that each field it should have carried is written down. */
function usdQuote(pair: Reader): Reader {
  const quotes = pair.items('quote', true);
  return pickUsd(quotes) ?? new Reader(undefined, `${pair.path}.quote[${USD_SYMBOL}]`, pair.issues, true);
}

/**
 * E08 `/v4/dex/spot-pairs/latest` and E09 `/v4/dex/pairs/quotes/latest`: one price per trading pair, on the base
 * asset of the pair. The two endpoints send the same pair and quote fields, E08 adding a `scroll_id` (T1.2).
 *
 * E08 cannot be narrowed to one asset (D3), so `check` does not call it; its pairs are the input C4 is tested on,
 * and the audit reads them.
 */
export function normalizeDexPairs(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E08', 'E09');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const items = Reader.list(response.data, 'data', issues, true).map((pair): PriceObservation => {
    const quote = usdQuote(pair);
    const lastUpdated = quote.timestamp('last_updated', true);
    return {
      kind: 'dex_pair',
      source,
      asset: {
        cmcId: pair.integer('base_asset_ucid', true),
        symbol: pair.text('base_asset_symbol', true),
        name: pair.text('base_asset_name'),
        slug: null,
      },
      priceUsd: quote.number('price', true),
      volume24hUsd: quote.number('volume_24h', true),
      liquidityUsd: quote.number('liquidity', true),
      // `fully_diluted_value` is not a market capitalisation and is not renamed into one.
      marketCapUsd: null,
      lastUpdated,
      ageSeconds: ageSeconds(source.observedAt, lastUpdated),
      venue: {
        name: pair.text('dex_slug'),
        address: pair.text('contract_address', true),
        network: pair.text('network_slug'),
        pair: pair.text('name'),
      },
      issues: pair.issues,
    };
  });
  return { source, items, issues, page: null };
}

/**
 * E10 `/v1/dex/token/price`: the DEX price of one token, which C1 compares with the aggregated price (D3).
 *
 * The answer names no CMC identifier and no symbol (T1.2): the token is identified by the contract address it was
 * queried with, kept here as the venue address, and the caller pairs the observation with the asset it asked for.
 */
export function normalizeDexTokenPrice(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E10');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const item = new Reader(response.data, 'data', issues, true);
  if (!item.present) return { source, items: [], issues, page: null };

  const lastUpdated = item.timestamp('ts', true);
  const platform = item.text('pdex');
  const observation: PriceObservation = {
    kind: 'dex_token',
    source,
    asset: { cmcId: null, symbol: null, name: null, slug: null },
    priceUsd: item.number('p', true),
    volume24hUsd: item.number('v24h', true),
    liquidityUsd: item.number('l', true),
    marketCapUsd: item.number('mc'),
    lastUpdated,
    ageSeconds: ageSeconds(source.observedAt, lastUpdated),
    venue: { name: platform, address: item.text('a', true), network: platform, pair: null },
    issues,
  };
  return { source, items: [observation], issues: [], page: null };
}

function readPoolToken(side: Reader): PoolToken {
  return {
    address: side.text('addr', true),
    symbol: side.text('sym', true),
    name: side.text('n'),
    liquidity: side.number('liq'),
    liquidityUsd: side.number('liqUsd', true),
  };
}

/** E11 `/v1/dex/token/pools`: the pools of a token, with the liquidity and volume C4 reads (D5). */
export function normalizeDexPools(response: SourceResponse): Normalized<PoolObservation> {
  expectEndpoint(response, 'E11');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const items = Reader.list(response.data, 'data', issues, true).map((pool): PoolObservation => {
    const sides = ['t0', 't1'].map((name) => pool.child(name, true));
    return {
      source,
      address: pool.text('addr', true),
      exchange: pool.text('exn'),
      exchangeId: pool.integer('exid'),
      liquidityUsd: pool.number('liqUsd', true),
      volume24hUsd: pool.number('v24', true),
      publishedAt: pool.timestamp('pubAt'),
      tokens: sides.filter((side) => side.present).map(readPoolToken),
      baseIndex: pool.integer('bidx'),
      issues: pool.issues,
    };
  });
  return { source, items, issues, page: null };
}
