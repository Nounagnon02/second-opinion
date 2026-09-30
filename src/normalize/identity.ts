/**
 * Normalisers of the two support endpoints that turn what a user typed into what the market endpoints need:
 * E01 map (symbol to CMC ID) and E05 info (CMC ID to token contract).
 *
 * Neither feeds a check by itself. E01 returned 14 entries for `symbol=BTC,PAXG`, 13 of them named BTC
 * (`E01-map-btc-paxg`), so every candidate is returned here and the resolver of T3.7 picks among them (D3).
 */
import {
  expectEndpoint,
  sourceRef,
  type AssetRef,
  type Normalized,
  type PlatformRef,
  type SourceRef,
  type SourceResponse,
} from './model.js';
import { Reader, type FieldIssue } from './values.js';

/** One entry E01 returned for a symbol. */
export interface AssetCandidate {
  source: SourceRef;
  asset: AssetRef;
  /** `rank`: D3 keeps the active candidate with the lowest rank and lists the others. */
  rank: number | null;
  isActive: boolean | null;
  platform: PlatformRef | null;
  issues: FieldIssue[];
}

/** One contract address of an asset (E05 `contract_address[]`). */
export interface ContractRef {
  address: string | null;
  platformName: string | null;
  platformSlug: string | null;
}

/** What E05 says about where an asset lives on chain. */
export interface AssetContracts {
  source: SourceRef;
  asset: AssetRef;
  /** `category`: `coin` or `token`. A coin has no contract, so C1 and C4 cannot run on it (D3, D5). */
  category: string | null;
  /** The primary platform, whose `slug` and `tokenAddress` are the pair E10 and E11 are called with (D3). */
  platform: PlatformRef | null;
  /** Every contract listed, in the order the answer gives them. */
  contracts: ContractRef[];
  issues: FieldIssue[];
}

/** Reads a `platform` object; `null` when the asset has none, which is how a coin is reported. */
function readPlatform(owner: Reader): PlatformRef | null {
  const platform = owner.child('platform');
  if (!platform.present) return null;
  return {
    cmcId: platform.integer('id'),
    name: platform.text('name'),
    slug: platform.text('slug', true),
    symbol: platform.text('symbol'),
    tokenAddress: platform.text('token_address', true),
  };
}

/** E01 `/v1/cryptocurrency/map`: every asset a symbol matches, at no credit cost. */
export function normalizeAssetMap(response: SourceResponse): Normalized<AssetCandidate> {
  expectEndpoint(response, 'E01');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const items = Reader.list(response.data, 'data', issues, true).map((entry): AssetCandidate => ({
    source,
    asset: {
      cmcId: entry.integer('id', true),
      symbol: entry.text('symbol', true),
      name: entry.text('name'),
      slug: entry.text('slug'),
    },
    rank: entry.integer('rank'),
    isActive: entry.flag('is_active'),
    platform: readPlatform(entry),
    issues: entry.issues,
  }));
  return { source, items, issues, page: null };
}

/**
 * E05 `/v2/cryptocurrency/info`: the contracts of each requested asset. `data` is an object keyed by CMC ID, so the
 * items are its values, in the order the answer lists them.
 */
export function normalizeAssetInfo(response: SourceResponse): Normalized<AssetContracts> {
  expectEndpoint(response, 'E05');
  const source = sourceRef(response);
  const issues: FieldIssue[] = [];
  const container = new Reader(response.data, 'data', issues, true);
  const items = container.keys.map((key): AssetContracts => {
    const asset = new Reader(container.raw(key), `data.${key}`, [], true);
    return {
      source,
      asset: {
        cmcId: asset.integer('id', true),
        symbol: asset.text('symbol', true),
        name: asset.text('name'),
        slug: asset.text('slug'),
      },
      category: asset.text('category'),
      platform: readPlatform(asset),
      contracts: Reader.list(asset.raw('contract_address'), `${asset.path}.contract_address`, asset.issues).map(
        (contract) => ({
          address: contract.text('contract_address', true),
          platformName: contract.child('platform').text('name'),
          platformSlug: contract.child('platform').child('coin').text('slug'),
        }),
      ),
      issues: asset.issues,
    };
  });
  return { source, items, issues, page: null };
}
