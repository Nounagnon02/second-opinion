/**
 * The CMC endpoints the client may call: the `verified` rows of docs/ENDPOINTS.md, and nothing else.
 * tests/cmc-endpoints.test.ts keeps this table in line with that file and with the recorded fixtures.
 */

/**
 * How long a response may be served from the local cache.
 * - `market`: prices and quotes, CACHE_TTL_SECONDS.
 * - `static`: identifiers and metadata (symbol map, contracts, RWA map), CACHE_STATIC_TTL_SECONDS (D1, D10).
 * - `none`: never cached (the key usage counter).
 */
export type CacheClass = 'market' | 'static' | 'none';

export interface EndpointSpec {
  path: string;
  /**
   * Credits of one call, as reported by `status.credit_count` in the T1.2 fixtures (batches of up to 250 assets).
   * Used to refuse a call before it is sent; the credits actually counted are the ones the response reports.
   */
  credits: number;
  cache: CacheClass;
}

export const ENDPOINTS = {
  E01: { path: '/v1/cryptocurrency/map', credits: 0, cache: 'static' },
  E02: { path: '/v3/cryptocurrency/quotes/latest', credits: 1, cache: 'market' },
  E03: { path: '/v3/cryptocurrency/listings/latest', credits: 1, cache: 'market' },
  E05: { path: '/v2/cryptocurrency/info', credits: 1, cache: 'static' },
  E06: { path: '/v2/simple/price', credits: 1, cache: 'market' },
  E07: { path: '/v2/tools/price-conversion', credits: 1, cache: 'market' },
  E08: { path: '/v4/dex/spot-pairs/latest', credits: 1, cache: 'market' },
  E09: { path: '/v4/dex/pairs/quotes/latest', credits: 1, cache: 'market' },
  E10: { path: '/v1/dex/token/price', credits: 1, cache: 'market' },
  E11: { path: '/v1/dex/token/pools', credits: 1, cache: 'market' },
  E13: { path: '/v5/real-world-assets/map', credits: 0, cache: 'static' },
  E14: { path: '/v5/real-world-assets/quotes/latest', credits: 1, cache: 'market' },
  E16: { path: '/v5/real-world-assets/assets/list', credits: 1, cache: 'market' },
  E17: { path: '/v5/real-world-assets/info', credits: 1, cache: 'market' },
  E18: { path: '/v5/real-world-assets/issuers/list', credits: 1, cache: 'market' },
  E19: { path: '/v5/real-world-assets/issuers', credits: 1, cache: 'market' },
  E20: { path: '/v1/key/info', credits: 0, cache: 'none' },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointId = keyof typeof ENDPOINTS;

/** The endpoint ID of an API path, if it is a verified one. */
export function endpointForPath(path: string): EndpointId | undefined {
  return (Object.keys(ENDPOINTS) as EndpointId[]).find((id) => ENDPOINTS[id].path === path);
}
