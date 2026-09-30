/**
 * Normalisers of the aggregated market endpoints: E02 quotes, E03 listings, E06 simple price and E07 price
 * conversion.
 *
 * All four carry a USD price inside a quote block that has its own `last_updated`. That timestamp is the one read
 * here, because it dates the price: for PAXG in the T1.2 sample it is 16:02:03 in E02, E06 and E07 alike, while the
 * item-level `last_updated` of E02 reads 16:03:00 (D7).
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

/** The USD quote of an item, or a reader on nothing so that each field it should have carried is written down. */
function usdQuote(item: Reader, field: string): Reader {
  const quotes = item.items(field, true);
  return pickUsd(quotes) ?? new Reader(undefined, `${item.path}.${field}[${USD_SYMBOL}]`, item.issues, true);
}

/**
 * One item of E02 or E03. E03 items carry neither `is_active` nor `is_fiat` (observation 9), which no check reads,
 * so the two endpoints share this reader.
 */
function readQuoteItem(item: Reader, source: SourceRef): PriceObservation {
  const quote = usdQuote(item, 'quote');
  const lastUpdated = quote.timestamp('last_updated', true);
  return {
    kind: 'aggregate',
    source,
    asset: {
      cmcId: item.integer('id', true),
      symbol: item.text('symbol', true),
      name: item.text('name'),
      slug: item.text('slug'),
    },
    priceUsd: quote.number('price', true),
    volume24hUsd: quote.number('volume_24h', true),
    liquidityUsd: null,
    marketCapUsd: quote.number('market_cap'),
    lastUpdated,
    ageSeconds: ageSeconds(source.observedAt, lastUpdated),
    venue: null,
    issues: item.issues,
  };
}

function normalizeQuoteList(response: SourceResponse): Normalized<PriceObservation> {
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const items = Reader.list(response.data, 'data', issues, true).map((item) => readQuoteItem(item, source));
  return { source, items, issues, page: null };
}

/** E02 `/v3/cryptocurrency/quotes/latest`: the aggregated price of each requested asset. */
export function normalizeQuotes(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E02');
  return normalizeQuoteList(response);
}

/** E03 `/v3/cryptocurrency/listings/latest`: the same items, ranked; the calibration panel reads them (D10). */
export function normalizeListings(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E03');
  return normalizeQuoteList(response);
}

/** E06 `/v2/simple/price`: price and timestamp only, which C6 compares with E02 (D7). */
export function normalizeSimplePrice(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E06');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const items = Reader.list(response.data, 'data', issues, true).map((item): PriceObservation => {
    const quote = usdQuote(item, 'quotes');
    const lastUpdated = quote.timestamp('last_updated', true);
    return {
      kind: 'aggregate',
      source,
      asset: {
        cmcId: item.integer('id', true),
        symbol: item.text('symbol', true),
        name: item.text('name'),
        slug: item.text('slug'),
      },
      priceUsd: quote.number('price', true),
      volume24hUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      lastUpdated,
      ageSeconds: ageSeconds(source.observedAt, lastUpdated),
      venue: null,
      issues: item.issues,
    };
  });
  return { source, items, issues, page: null };
}

/**
 * E07 `/v2/tools/price-conversion`: the value of `amount` units of an asset. The price is brought back to one unit,
 * which is what the common model holds (F3); when `amount` cannot be read, the price cannot be scaled and stays
 * `null`, with the issue on `amount` saying why.
 */
export function normalizePriceConversion(response: SourceResponse): Normalized<PriceObservation> {
  expectEndpoint(response, 'E07');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const item = new Reader(response.data, 'data', issues, true);
  if (!item.present) return { source, items: [], issues, page: null };

  const amount = item.number('amount', true);
  const quote = item.child('quote', true).child(USD_SYMBOL, true);
  const price = quote.number('price', true);
  const lastUpdated = quote.timestamp('last_updated', true);
  const observation: PriceObservation = {
    kind: 'conversion',
    source,
    asset: {
      cmcId: item.integer('id', true),
      symbol: item.text('symbol', true),
      name: item.text('name'),
      slug: item.text('slug'),
    },
    priceUsd: price === null || amount === null || amount === 0 ? null : price / amount,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    lastUpdated,
    ageSeconds: ageSeconds(source.observedAt, lastUpdated),
    venue: null,
    issues,
  };
  return { source, items: [observation], issues: [], page: null };
}
