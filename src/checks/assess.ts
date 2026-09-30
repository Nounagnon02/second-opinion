/**
 * One asset, end to end: the call plan of D1, the seven checks of `src/checks/` on what it read, and the score that
 * weighs them (specification F4 and F5). The `check` command prints this, and the MCP tools of T5.1 will answer with
 * it.
 *
 * Three rules shape it:
 * - **a call that fails never ends the run.** Its error becomes the reason the checks that needed it could not run
 *   (D9), so a verdict still rests on what was read, and the coverage says how much that was;
 * - **nothing stands in for a missing answer.** The identifier, the token contract and the real-world asset each
 *   come from the one answer that carries them — E01, E05, the cached index of D6 — or from nothing at all;
 * - **the plan is the one D1 measured.** Stage 1 goes out in parallel; stage 2 only once E05 has given a contract;
 *   and the token to real-world-asset index is read from its cache, never built inside a check, because that walk
 *   alone took 8.3 s of the 10-second budget (D6).
 *
 * It sits beside the checks rather than above them because it is their entry point: it measures nothing itself, it
 * decides which of the seven can run on what the plan brought back, and hands them to the score.
 */
import type { CmcClient, CmcResponse, Query } from '../cmc/client.js';
import type { CreditUsage } from '../cmc/credits.js';
import type { EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import { normalizeQuotes, normalizeSimplePrice } from '../normalize/aggregated.js';
import { normalizeDexPools, normalizeDexTokenPrice, type PoolObservation } from '../normalize/dex.js';
import {
  normalizeAssetInfo,
  normalizeAssetMap,
  type AssetCandidate,
  type AssetContracts,
} from '../normalize/identity.js';
import type { AssetRef, Normalized, PriceObservation, SourceRef } from '../normalize/model.js';
import { normalizeRwaQuotes, type RwaQuote } from '../normalize/rwa.js';
import {
  DEFAULT_INDEX_FILE,
  loadWrapperIndex,
  lookupWrapper,
  type WrapperIndex,
  type WrapperIndexEntry,
} from '../rwa/wrapper-index.js';
import { scoreChecks, type AssetScore } from '../score/score.js';
import { comparedPrices, runDexDivergenceCheck, type ComparedPrice } from './c1-dex-divergence.js';
import { runCexDivergenceCheck } from './c2-cex-divergence.js';
import { datedPrices, datedRwaQuotes, runFreshnessCheck } from './c3-freshness.js';
import { liquidityOfPools, liquidityOfPrices, runLiquidityCheck } from './c4-liquidity.js';
import { runRwaCheck } from './c5-rwa.js';
import { comparedReadings, referenceReading, runConsistencyCheck } from './c6-consistency.js';
import {
  rwaQuoteInput,
  runSchemaCheck,
  schemaInput,
  schemaIssues,
  type IssueGroup,
  type SchemaInput,
} from './c7-schema.js';
import { loadChecksConfig, type ChecksConfig } from './config.js';
import { distinctSources, notApplicable, unavailable, type CheckId, type CheckResult } from './model.js';
import { pricesOfAsset, type AssetSelector } from './prices.js';

/** What the user asked about. A numeric CMC ID skips resolution; anything else is a symbol to resolve (D3). */
export type Subject = { kind: 'symbol'; symbol: string } | { kind: 'cmcId'; cmcId: number };

/** How many pools E11 is asked for: the number the recorded answer of T1.2 was read with. */
export const DEFAULT_POOL_SIZE = 10;

/** Reads what a user typed: digits only are a CMC ID, anything else a symbol, upper-cased as the API writes them. */
export function parseSubject(text: string): Subject {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new CmcError('config', 'No asset was named: give a symbol, for example PAXG, or a numeric CMC ID.');
  }
  if (!/^[0-9]+$/.test(trimmed)) return { kind: 'symbol', symbol: trimmed.toUpperCase() };
  const cmcId = Number(trimmed);
  if (!Number.isSafeInteger(cmcId) || cmcId <= 0) {
    throw new CmcError('config', `"${trimmed}" is not a CMC ID: a whole number above 0 was expected.`);
  }
  return { kind: 'cmcId', cmcId };
}

/** The subject in the words of the outputs. */
export function describeSubject(subject: Subject): string {
  return subject.kind === 'symbol' ? subject.symbol : `CMC ${String(subject.cmcId)}`;
}

/** Two names of the same thing, compared the way the API writes them: case and surrounding spaces do not count. */
function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** What resolution settled on, and what it set aside (D3). */
export interface Resolution {
  /** The asset every later call is made about; `null` when resolution settled on none. */
  asset: AssetRef | null;
  /** The other entries E01 returned, in the order it gave them: shown, never merged into the answer. */
  others: AssetCandidate[];
  /** Why no asset was settled on; `null` when one was. */
  reason: string | null;
}

/**
 * Ranks the entries E01 returned for a symbol: active first, then the lowest `rank` — an entry CMC left unranked
 * last — then the lowest identifier, so that two runs on the same answer always choose the same asset.
 */
function betterCandidate(left: AssetCandidate, right: AssetCandidate): number {
  if (left.isActive !== right.isActive) return left.isActive === false ? 1 : -1;
  const rank = (candidate: AssetCandidate): number => candidate.rank ?? Number.MAX_SAFE_INTEGER;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  const id = (candidate: AssetCandidate): number => candidate.asset.cmcId ?? Number.MAX_SAFE_INTEGER;
  return id(left) - id(right);
}

/**
 * Which asset a symbol names, out of the entries E01 returned for it: the active one with the lowest rank, the
 * others listed beside it (D3). An entry carrying no identifier is no use to the later calls, so it is listed too.
 */
export function resolveCandidates(candidates: readonly AssetCandidate[], symbol: string): Resolution {
  const usable = candidates.filter(
    (candidate) =>
      candidate.asset.cmcId !== null && candidate.asset.symbol !== null && sameText(candidate.asset.symbol, symbol),
  );
  const [chosen] = [...usable].sort(betterCandidate);
  if (chosen === undefined) {
    return {
      asset: null,
      others: [...candidates],
      reason:
        `E01 returned no asset with the symbol ${symbol} and a CMC ID, so no later call could be made about it. ` +
        'A numeric CMC ID skips this step.',
    };
  }
  return { asset: chosen.asset, others: candidates.filter((candidate) => candidate !== chosen), reason: null };
}

/** How a check reports something the run could not reach: the status D9 gives it, and the reason. */
export interface Skip {
  status: 'not_applicable' | 'unavailable';
  reason: string;
}

/** The token contract the DEX calls are made with (D3), or why this run has none. */
export interface ContractLookup {
  contract: { platform: string; address: string } | null;
  /** How a check that needed it reports the absence; `null` when there is a contract. */
  skip: Skip | null;
}

/**
 * The contract E05 gives for an asset: `platform.token_address` with the platform slug, else the first listed
 * `contract_address[]` carrying both. Only the primary platform is queried when several are listed (D3).
 */
export function readContract(info: AssetContracts): ContractLookup {
  const platform = info.platform;
  if (platform?.slug && platform.tokenAddress) {
    return { contract: { platform: platform.slug, address: platform.tokenAddress }, skip: null };
  }
  const listed = info.contracts.find((entry) => entry.address !== null && entry.platformSlug !== null);
  if (listed?.address && listed.platformSlug) {
    return { contract: { platform: listed.platformSlug, address: listed.address }, skip: null };
  }
  if (platform === null && info.contracts.length === 0) {
    return {
      contract: null,
      skip: {
        status: 'not_applicable',
        reason:
          `E05 lists no token contract for this asset (category ${info.category ?? 'not stated'}), so it has no ` +
          'DEX venue to query (D3).',
      },
    };
  }
  return {
    contract: null,
    skip: {
      status: 'unavailable',
      reason:
        'E05 names a platform for this asset but no pair of platform slug and contract address could be read from ' +
        'it, so no DEX venue could be queried (D3).',
    },
  };
}

/** What `assessAsset` reports beside the score: what it looked at, what it could not reach, and what it cost. */
export interface AssetAssessment {
  subject: Subject;
  /** The asset the run was about, as the answers named it; `null` when resolution settled on none. */
  asset: AssetRef | null;
  resolution: Resolution;
  /** The contract the DEX calls were made with; `null` when the run made none. */
  contract: { platform: string; address: string } | null;
  /** The real-world asset the cached index linked this token to; `null` when it linked none (D6). */
  wrapper: WrapperIndexEntry | null;
  /** The seven checks, in the order of `CHECK_IDS`. */
  checks: CheckResult[];
  /**
   * The fields the normalisers could not read and that C7 leaves unscored, because they are the same shape on
   * every asset and scoring them would lower every asset by the same amount (D8). They describe the API rather
   * than this asset, which is why they are carried beside the checks and read by the audit (T6.1).
   */
  unreadable: IssueGroup[];
  score: AssetScore;
  /** Every answer read, once each, in the order the plan read them. */
  sources: SourceRef[];
  /** The calls that brought nothing back, with the reason each gave. Never carries the API key. */
  failures: { endpoint: EndpointId; kind: string; message: string }[];
  credits: CreditUsage;
  /** Wall clock of the whole run, to read against the 10-second budget of D1. */
  elapsedMs: number;
}

export interface AssessOptions {
  /** Thresholds and weights; `config/checks.json` by default. */
  config?: ChecksConfig;
  /**
   * The cached token to real-world-asset index (D6). Read from `indexFile` when left out; pass `null` for a run that
   * has none, which reports C5 as unavailable rather than guessing at the link.
   */
  wrapperIndex?: WrapperIndex | null;
  indexFile?: string;
  /** The order `preflight_trade` weighs, in USD (T5.1); `null` when the run is about the asset itself (D5). */
  orderSizeUsd?: number | null;
  /** Pools asked of E11. */
  poolSize?: number;
  /** Wall clock, epoch milliseconds; never used to age data, which reads the response clock only (D4). */
  now?: () => number;
}

/** The failures among a list of endpoints, in the order given. */
function missing(failures: ReadonlyMap<EndpointId, CmcError>, endpoints: readonly EndpointId[]): CmcError[] {
  return endpoints.flatMap((endpoint) => {
    const error = failures.get(endpoint);
    return error === undefined ? [] : [error];
  });
}

/** One sentence naming the calls that brought nothing back, with the reason each gave. */
function noAnswerFrom(errors: readonly CmcError[]): string {
  const stated = errors.map((error) => `${error.endpoint ?? 'the API'} (${error.kind}: ${error.message})`);
  return `No answer was read from ${stated.join('; ')}.`;
}

/** A check skipped for a known cause, with the status that cause deserves (D9). */
function skipped(id: CheckId, skip: Skip, sources: readonly SourceRef[]): CheckResult {
  return skip.status === 'not_applicable'
    ? notApplicable(id, skip.reason, sources)
    : unavailable(id, skip.reason, sources);
}

/** The price C1 reads the DEX against: the E02 aggregate, and no other source under its name (D3). */
function aggregateReference(prices: readonly PriceObservation[]): ComparedPrice | null {
  const fromE02 = prices.filter((price) => price.source.endpoint === 'E02');
  return comparedPrices(fromE02, 'reference')[0] ?? null;
}

/**
 * Runs the plan of D1 for one asset and scores what it read.
 *
 * Every call goes through `client`, so the run mode — live, `--record` or `--replay` — is the caller's choice, and
 * this function never knows which one it is in.
 */
export async function assessAsset(
  client: CmcClient,
  subject: Subject,
  options: AssessOptions = {},
): Promise<AssetAssessment> {
  const config = options.config ?? loadChecksConfig();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;

  const failures = new Map<EndpointId, CmcError>();
  const schema: SchemaInput[] = [];
  const sources: SourceRef[] = [];

  /**
   * One call of the plan, normalised. A call that fails and a body the normaliser refuses come back the same way —
   * `null`, with the reason kept — because both leave the checks that needed that answer without it.
   *
   * Each endpoint is called at most once in this plan, so one failure per endpoint is all there is to report.
   */
  const read = async <T>(
    endpoint: EndpointId,
    query: Query,
    normalize: (response: CmcResponse) => Normalized<T>,
  ): Promise<Normalized<T> | null> => {
    try {
      const normalized = normalize(await client.get(endpoint, query));
      sources.push(normalized.source);
      return normalized;
    } catch (error) {
      if (!(error instanceof CmcError)) throw error;
      failures.set(endpoint, error);
      return null;
    }
  };

  // Stage 0 — resolve. A numeric CMC ID skips the call entirely (D3).
  let resolution: Resolution;
  if (subject.kind === 'cmcId') {
    resolution = { asset: { cmcId: subject.cmcId, symbol: null, name: null, slug: null }, others: [], reason: null };
  } else {
    const map = await read('E01', { symbol: subject.symbol }, normalizeAssetMap);
    if (map === null) {
      resolution = { asset: null, others: [], reason: noAnswerFrom(missing(failures, ['E01'])) };
    } else {
      schema.push(schemaInput(map));
      resolution = resolveCandidates(map.items, subject.symbol);
    }
  }
  const cmcId = resolution.asset?.cmcId ?? null;

  // The token to real-world-asset link, read from the cached index: a walk here would spend the whole budget (D6).
  let index: WrapperIndex | null = null;
  let indexSkip: Skip | null = null;
  if (options.wrapperIndex !== undefined) {
    index = options.wrapperIndex;
  } else {
    try {
      index = loadWrapperIndex(options.indexFile ?? DEFAULT_INDEX_FILE);
    } catch (error) {
      if (!(error instanceof CmcError)) throw error;
      indexSkip = { status: 'unavailable', reason: `The wrapper index could not be read: ${error.message}` };
    }
  }
  if (index === null && indexSkip === null) {
    indexSkip = {
      status: 'unavailable',
      reason:
        'No token to real-world-asset index has been built yet, so this token could not be linked to one: build it ' +
        'once with `npm run rwa:index -- --build` (D6).',
    };
  }
  const wrapper = index === null || cmcId === null ? null : (lookupWrapper(index, { cmcId })[0] ?? null);
  if (index !== null && cmcId !== null && wrapper === null) {
    indexSkip = {
      status: 'not_applicable',
      reason:
        `CMC ${String(cmcId)} is not in the token to real-world-asset index, so it has no real-world asset to be ` +
        'compared with. It may be a coin rather than a tokenised wrapper, or a wrapper its issuer listed without an ' +
        'rwa_id (D6).',
    };
  }

  // Stage 1 — the aggregated answers, and the real-world asset when the index named one. All in parallel (D1).
  const [quotes, simple, info, rwa] =
    cmcId === null
      ? [null, null, null, null]
      : await Promise.all([
          read('E02', { id: cmcId, convert: 'USD' }, normalizeQuotes),
          read('E06', { id: cmcId, include_last_updated: 'true' }, normalizeSimplePrice),
          read('E05', { id: cmcId }, normalizeAssetInfo),
          wrapper === null ? Promise.resolve(null) : read('E14', { rwa_id: wrapper.rwaId }, normalizeRwaQuotes),
        ]);
  if (quotes) schema.push(schemaInput(quotes));
  if (simple) schema.push(schemaInput(simple));
  if (info) schema.push(schemaInput(info));
  if (rwa) schema.push(rwaQuoteInput(rwa));

  // Stage 2 — the DEX answers, only for an asset E05 gave a contract for (D3, D5).
  const contracts =
    info === null ? null : (info.items.find((item) => item.asset.cmcId === cmcId) ?? info.items[0] ?? null);
  const lookup: ContractLookup = contracts === null ? { contract: null, skip: null } : readContract(contracts);
  const dexQuery = lookup.contract === null ? null : { ...lookup.contract };
  const [dex, pools] =
    dexQuery === null
      ? [null, null]
      : await Promise.all([
          read('E10', dexQuery, normalizeDexTokenPrice),
          read('E11', { ...dexQuery, size: poolSize }, normalizeDexPools),
        ]);
  if (dex) schema.push(schemaInput(dex));
  if (pools) schema.push(schemaInput(pools));

  // What the checks read: every price of the run that is about this asset, its pools, and its real-world asset.
  const symbol = resolution.asset?.symbol ?? (subject.kind === 'symbol' ? subject.symbol : null);
  const selector: AssetSelector = { cmcId, symbol, contract: lookup.contract?.address ?? null };
  const prices: PriceObservation[] = [
    ...(quotes?.items ?? []),
    ...(simple?.items ?? []),
    ...(dex?.items ?? []),
    ...(rwa?.items ?? []).flatMap((asset) => asset.wrappers),
  ];
  const assetPrices = pricesOfAsset(prices, selector);
  const assetPools: PoolObservation[] = pools?.items ?? [];
  const rwaQuotes: RwaQuote[] = rwa?.items ?? [];
  const quote =
    rwaQuotes.find((asset) => asset.wrappers.some((token) => token.asset.cmcId === cmcId)) ?? rwaQuotes[0] ?? null;

  // A run that settled on no asset made no market call: every measuring check says so rather than guessing a cause.
  const unresolved = resolution.reason;

  const c1 = ((): CheckResult => {
    if (unresolved !== null) return unavailable('C1', unresolved, sources);
    const markets = comparedPrices(assetPrices, 'market');
    if (markets.length === 0) {
      const errors = missing(failures, ['E05', 'E10']);
      if (errors.length > 0) return unavailable('C1', noAnswerFrom(errors), sources);
      if (lookup.skip) return skipped('C1', lookup.skip, sources);
    }
    const reference = aggregateReference(assetPrices);
    if (reference === null && markets.length > 0) {
      const errors = missing(failures, ['E02']);
      if (errors.length > 0) return unavailable('C1', noAnswerFrom(errors), sources);
    }
    return runDexDivergenceCheck(reference, markets, config.C1);
  })();

  const c3 = ((): CheckResult => {
    if (unresolved !== null) return unavailable('C3', unresolved, sources);
    const dated = [...datedPrices(assetPrices), ...datedRwaQuotes(rwaQuotes)];
    if (dated.length === 0) {
      const errors = missing(failures, ['E02', 'E06', 'E10', 'E14']);
      if (errors.length > 0) return unavailable('C3', noAnswerFrom(errors), sources);
    }
    return runFreshnessCheck(dated, config.C3);
  })();

  const c4 = ((): CheckResult => {
    if (unresolved !== null) return unavailable('C4', unresolved, sources);
    const points = [...liquidityOfPrices(assetPrices), ...liquidityOfPools(assetPools)];
    if (points.length === 0) {
      const errors = missing(failures, ['E05', 'E10', 'E11']);
      if (errors.length > 0) return unavailable('C4', noAnswerFrom(errors), sources);
      if (lookup.skip) return skipped('C4', lookup.skip, sources);
    }
    return runLiquidityCheck(points, config.C4, options.orderSizeUsd ?? null);
  })();

  const c5 = ((): CheckResult => {
    if (unresolved !== null) return unavailable('C5', unresolved, sources);
    if (quote === null) {
      const errors = missing(failures, ['E14']);
      if (errors.length > 0) return unavailable('C5', noAnswerFrom(errors), sources);
      if (indexSkip) return skipped('C5', indexSkip, sources);
    }
    return runRwaCheck(quote, { cmcId, symbol }, config.C5);
  })();

  const c6 = ((): CheckResult => {
    if (unresolved !== null) return unavailable('C6', unresolved, sources);
    const others = comparedReadings(assetPrices);
    if (others.length === 0) {
      const errors = missing(failures, ['E06', 'E14']);
      if (errors.length > 0) return unavailable('C6', noAnswerFrom(errors), sources);
    }
    const reference = referenceReading(assetPrices);
    if (reference === null && others.length > 0) {
      const errors = missing(failures, ['E02']);
      if (errors.length > 0) return unavailable('C6', noAnswerFrom(errors), sources);
    }
    return runConsistencyCheck(reference, others, config.C6);
  })();

  const c7 = ((): CheckResult => {
    if (schema.length === 0 && failures.size > 0) {
      return unavailable('C7', noAnswerFrom([...failures.values()]), sources);
    }
    return runSchemaCheck(schema, config.C7);
  })();

  const checks = [c1, runCexDivergenceCheck(), c3, c4, c5, c6, c7];
  return {
    subject,
    asset: resolution.asset === null ? null : (assetPrices[0]?.asset ?? resolution.asset),
    resolution,
    contract: lookup.contract,
    wrapper,
    checks,
    unreadable: schemaIssues(schema).reported,
    score: scoreChecks(checks, config.score),
    sources: distinctSources(sources),
    failures: [...failures].map(([endpoint, error]) => ({ endpoint, kind: error.kind, message: error.message })),
    credits: client.credits(),
    elapsedMs: now() - startedAt,
  };
}
