/**
 * Normalisers of the Real World Assets endpoints: E13 map, E14 quotes, E16 assets list, E17 info, E18 issuers list
 * and E19 one issuer.
 *
 * C5 rests on E14: the wrapper tokens of an asset and the `average_tokenized_price` they are compared with. That
 * average is CMC's own aggregate over the wrappers, not a price of the underlying asset, and the model never calls
 * it one (D6).
 */
import {
  expectEndpoint,
  pickUsd,
  readPage,
  sourceRef,
  type Normalized,
  type PriceObservation,
  type SourceRef,
  type SourceResponse,
} from './model.js';
import { ageSeconds, Reader, type FieldIssue } from './values.js';

/** A real-world asset, as every RWA endpoint identifies it. */
export interface RwaAssetRef {
  rwaId: number | null;
  symbol: string | null;
  name: string | null;
  slug: string | null;
  /** `asset_type`, for example `commodity` or `etf`. */
  assetType: string | null;
  /** `rwa_rank`. */
  rank: number | null;
  hasTokens: boolean | null;
}

/** One tokenised wrapper of a real-world asset (E14 `tokens[]`). */
export interface RwaWrapper extends PriceObservation {
  kind: 'rwa_wrapper';
  issuerId: string | null;
  issuerName: string | null;
}

/** The aggregates of one real-world asset (E14, E16), with its wrappers when the endpoint lists them. */
export interface RwaQuote {
  source: SourceRef;
  asset: RwaAssetRef;
  /** `average_tokenized_price`: CMC's average across the wrappers. How it is computed is not documented (D6). */
  averageTokenizedPriceUsd: number | null;
  tokenizedMarketCapUsd: number | null;
  tokenizedVolume24hUsd: number | null;
  lastUpdated: string | null;
  ageSeconds: number | null;
  /** The wrappers (E14); E16 carries none. */
  wrappers: RwaWrapper[];
  /**
   * How many traditional-finance venues the answer listed. The array was empty in every recorded answer
   * (`E14-rwa-quotes-gold`), so its items are left unread: their fields have not been observed, and the project
   * publishes nothing it has not seen (D6).
   */
  tradfiMarketCount: number | null;
  issues: FieldIssue[];
}

/** The descriptive page of a real-world asset (E17). */
export interface RwaProfile {
  source: SourceRef;
  asset: RwaAssetRef;
  /** `about.description`. */
  description: string | null;
  /** `about.date_added`. */
  addedAt: string | null;
  /**
   * `website`, `employees`, `founded`, `industry`, `cik`, `primary_exchange`, `about.logo` and `about.website` were
   * all `null` in the recorded answer (`E17-rwa-info-gold`), so their types have not been observed and no check
   * reads them.
   */
  issues: FieldIssue[];
}

/** A token an issuer has issued (E19 `tokens[]`). */
export interface RwaIssuerToken {
  cmcId: number | null;
  rwaId: number | null;
  symbol: string | null;
  name: string | null;
}

/** An issuer of tokenised real-world assets (E18, E19). */
export interface RwaIssuer {
  source: SourceRef;
  issuerId: string | null;
  name: string | null;
  website: string | null;
  numTokens: number | null;
  /** The issuer's tokens; E18 lists none, E19 does. */
  tokens: RwaIssuerToken[];
  issues: FieldIssue[];
}

function readAssetRef(asset: Reader): RwaAssetRef {
  return {
    rwaId: asset.integer('rwa_id', true),
    symbol: asset.text('symbol', true),
    name: asset.text('name'),
    slug: asset.text('slug'),
    assetType: asset.text('asset_type'),
    rank: asset.integer('rwa_rank'),
    hasTokens: asset.flag('has_tokens'),
  };
}

/** The assets of an answer whose `data` holds an `rwa_assets` array, with the paging that comes with them. */
function rwaAssets(response: SourceResponse): {
  source: SourceRef;
  container: Reader;
  assets: Reader[];
  issues: FieldIssue[];
} {
  const issues: FieldIssue[] = [];
  const container = new Reader(response.data, 'data', issues, true);
  return {
    source: sourceRef(response),
    container,
    assets: Reader.list(container.raw('rwa_assets'), 'data.rwa_assets', issues, true),
    issues,
  };
}

/** E13 `/v5/real-world-assets/map`: symbol to `rwa_id`, at no credit cost (D10). */
export function normalizeRwaMap(response: SourceResponse): Normalized<RwaAssetRef> {
  expectEndpoint(response, 'E13');
  const { source, container, assets, issues } = rwaAssets(response);
  return { source, items: assets.map(readAssetRef), issues, page: readPage(container) };
}

function readWrapper(token: Reader, source: SourceRef): RwaWrapper {
  return {
    kind: 'rwa_wrapper',
    source,
    asset: {
      cmcId: token.integer('crypto_id', true),
      symbol: token.text('symbol', true),
      name: token.text('name'),
      slug: null,
    },
    priceUsd: token.number('price', true),
    volume24hUsd: token.number('volume_24h', true),
    liquidityUsd: null,
    marketCapUsd: token.number('market_cap'),
    // E14 gives its tokens no timestamp of their own (D7): only the asset-level one below is dated.
    lastUpdated: null,
    ageSeconds: null,
    venue: null,
    issuerId: token.text('issuer_id'),
    issuerName: token.text('issuer_name'),
    issues: token.issues,
  };
}

/**
 * E14 `/v5/real-world-assets/quotes/latest` and E16 `/v5/real-world-assets/assets/list`.
 *
 * The aggregates are read from the USD entry of `quotes[]`, which carries the timestamp of the price; the
 * asset-level fields answer when there is no USD entry. Both held the same three values in the recorded answers
 * (`E14-rwa-quotes-gold`, `E16-rwa-assets-list`).
 */
export function normalizeRwaQuotes(response: SourceResponse): Normalized<RwaQuote> {
  expectEndpoint(response, 'E14', 'E16');
  const wrappersListed = response.endpoint === 'E14';
  const { source, container, assets, issues } = rwaAssets(response);
  const items = assets.map((asset): RwaQuote => {
    const aggregates = pickUsd(asset.items('quotes')) ?? asset;
    const lastUpdated = aggregates.timestamp('last_updated', true);
    const tradfi = asset.raw('tradfi_markets');
    return {
      source,
      asset: readAssetRef(asset),
      averageTokenizedPriceUsd: aggregates.number('average_tokenized_price', true),
      tokenizedMarketCapUsd: aggregates.number('tokenized_market_cap'),
      tokenizedVolume24hUsd: aggregates.number('tokenized_volume_24h'),
      lastUpdated,
      ageSeconds: ageSeconds(source.observedAt, lastUpdated),
      wrappers: Reader.list(asset.raw('tokens'), `${asset.path}.tokens`, asset.issues, wrappersListed).map((token) =>
        readWrapper(token, source),
      ),
      tradfiMarketCount: Array.isArray(tradfi) ? tradfi.length : null,
      issues: asset.issues,
    };
  });
  return { source, items, issues, page: readPage(container) };
}

/** E17 `/v5/real-world-assets/info`: the descriptive page of an asset, read by the audit (D10). */
export function normalizeRwaInfo(response: SourceResponse): Normalized<RwaProfile> {
  expectEndpoint(response, 'E17');
  const { source, container, assets, issues } = rwaAssets(response);
  const items = assets.map((asset): RwaProfile => {
    const about = asset.child('about');
    return {
      source,
      asset: readAssetRef(asset),
      description: about.text('description'),
      addedAt: about.timestamp('date_added'),
      issues: asset.issues,
    };
  });
  return { source, items, issues, page: readPage(container) };
}

function readIssuerTokens(issuer: Reader): RwaIssuerToken[] {
  return Reader.list(issuer.raw('tokens'), `${issuer.path}.tokens`, issuer.issues).map((token) => ({
    cmcId: token.integer('crypto_id', true),
    rwaId: token.integer('rwa_id', true),
    symbol: token.text('symbol', true),
    name: token.text('name'),
  }));
}

function readIssuer(issuer: Reader, source: SourceRef): RwaIssuer {
  return {
    source,
    issuerId: issuer.text('issuer_id', true),
    name: issuer.text('name'),
    website: issuer.text('website'),
    numTokens: issuer.integer('num_tokens'),
    tokens: readIssuerTokens(issuer),
    issues: issuer.issues,
  };
}

/** E18 `/v5/real-world-assets/issuers/list`: the issuers, without their tokens. */
export function normalizeRwaIssuers(response: SourceResponse): Normalized<RwaIssuer> {
  expectEndpoint(response, 'E18');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const container = new Reader(response.data, 'data', issues, true);
  const items = Reader.list(container.raw('issuers'), 'data.issuers', issues, true).map((issuer) =>
    readIssuer(issuer, source),
  );
  return { source, items, issues, page: readPage(container) };
}

/**
 * E19 `/v5/real-world-assets/issuers`: one issuer and its tokens. Its `tokens[].crypto_id` with `rwa_id` is the
 * wrapper-to-asset index C5 needs to answer on a wrapper symbol (D6); T3.4 builds and measures it.
 */
export function normalizeRwaIssuer(response: SourceResponse): Normalized<RwaIssuer> {
  expectEndpoint(response, 'E19');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const issuer = new Reader(response.data, 'data', issues, true);
  if (!issuer.present) return { source, items: [], issues, page: null };
  return { source, items: [readIssuer(issuer, source)], issues: [], page: readPage(issuer) };
}
