/**
 * The normalisers of every verified source (specification F3). One entry point per endpoint, plus
 * `priceObservations` for the endpoints that carry a USD price, which C1, C3 and C6 read against one another.
 *
 * E20 (key info) is not here: it carries no market data and `parseKeyInfo` already reads it for the client.
 */
import type { EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import {
  normalizeListings,
  normalizePriceConversion,
  normalizeQuotes,
  normalizeSimplePrice,
} from './aggregated.js';
import { normalizeDexPairs, normalizeDexTokenPrice } from './dex.js';
import { expectEndpoint, type Normalized, type PriceObservation, type SourceResponse } from './model.js';
import { normalizeRwaQuotes } from './rwa.js';

export * from './aggregated.js';
export * from './dex.js';
export * from './identity.js';
export * from './model.js';
export * from './rwa.js';
export * from './values.js';

/** The verified endpoints that carry a USD price in the common model. */
export const PRICE_SOURCES = ['E02', 'E03', 'E06', 'E07', 'E08', 'E09', 'E10', 'E14'] as const satisfies readonly EndpointId[];

export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(endpoint: EndpointId): endpoint is PriceSource {
  return (PRICE_SOURCES as readonly EndpointId[]).includes(endpoint);
}

/**
 * Every USD price an answer carries, in the common model. For E14 these are the wrapper tokens of the assets it
 * returned; the RWA aggregates they are compared with stay in `normalizeRwaQuotes` (D6).
 */
export function priceObservations(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, ...PRICE_SOURCES);
  switch (response.endpoint) {
    case 'E02':
      return normalizeQuotes(response);
    case 'E03':
      return normalizeListings(response);
    case 'E06':
      return normalizeSimplePrice(response);
    case 'E07':
      return normalizePriceConversion(response);
    case 'E08':
    case 'E09':
      return normalizeDexPairs(response);
    case 'E10':
      return normalizeDexTokenPrice(response);
    case 'E14': {
      const quotes = normalizeRwaQuotes(response);
      return {
        source: quotes.source,
        items: quotes.items.flatMap((quote) => quote.wrappers),
        issues: quotes.issues,
        page: quotes.page,
      };
    }
    default:
      throw new CmcError('invalid_response', `${response.endpoint} carries no USD price to normalise.`, {
        endpoint: response.endpoint,
      });
  }
}
