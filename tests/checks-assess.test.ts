/**
 * `assessAsset` (T3.7): the call plan of D1 for one asset, the seven checks of `src/checks/` on what it read, and
 * the score that weighs them.
 *
 * Every run below is offline, replaying the answers two live runs of 2026-09-25 recorded into `fixtures/check`, so
 * the plan is exercised on real bodies. The runs that had to lose an answer lose it by replaying a directory that
 * holds every fixture but that endpoint's, never by a hand-written error.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assessAsset,
  DEFAULT_POOL_SIZE,
  describeSubject,
  parseSubject,
  readContract,
  resolveCandidates,
  type AssessOptions,
  type AssetAssessment,
} from '../src/checks/assess.js';
import { CHECK_IDS, type CheckId, type CheckStatus } from '../src/checks/model.js';
import type { EndpointId } from '../src/cmc/endpoints.js';
import { CmcError } from '../src/cmc/errors.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { normalizeAssetInfo, type AssetCandidate, type AssetContracts } from '../src/normalize/identity.js';
import { sourceRef, type SourceRef } from '../src/normalize/model.js';
import { BTC_ID, CHECK_FIXTURES, copyCheckFixtures, PAXG_ID, paxosIndex } from './helpers/check-fixtures.js';
import { recordedSource } from './helpers/normalize.js';

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-assess-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A replay run over the recorded `check` answers, with the index the PAXG run was read with. */
async function assess(named: string, options: AssessOptions = {}, dir = CHECK_FIXTURES): Promise<AssetAssessment> {
  const client = createClientForMode({ kind: 'replay', dir }, {});
  return assessAsset(client, parseSubject(named), { wrapperIndex: paxosIndex(), ...options });
}

/** The same run, with the answers of the endpoints named missing from the fixture directory. */
async function assessWithout(
  named: string,
  without: readonly EndpointId[],
  options: AssessOptions = {},
): Promise<AssetAssessment> {
  const dir = scratch();
  expect(copyCheckFixtures(dir, without)).toBeGreaterThan(0);
  return assess(named, options, dir);
}

function statusOf(assessment: AssetAssessment): Record<string, CheckStatus> {
  return Object.fromEntries(assessment.checks.map((check) => [check.id, check.status]));
}

function reasonOf(assessment: AssetAssessment, id: CheckId): string {
  const result = assessment.checks.find((check) => check.id === id);
  if (result === undefined) throw new Error(`${id} is missing from the run.`);
  if (result.reason === null) throw new Error(`${id} ran; it has no reason.`);
  return result.reason;
}

function endpointsRead(assessment: AssetAssessment): string[] {
  return assessment.sources.map((source: SourceRef) => source.endpoint);
}

/** A clock that hands back the given readings in order: `assessAsset` reads it at the start and at the end. */
function clock(...readings: number[]): () => number {
  let next = 0;
  return () => readings[Math.min(next++, readings.length - 1)] ?? 0;
}

const e01 = sourceRef(recordedSource('E01', 'E01-map-btc-paxg'));

/** One entry of an E01 answer, in the shape resolution ranks. */
function candidate(
  cmcId: number | null,
  symbol: string | null,
  parts: { rank?: number | null; isActive?: boolean | null } = {},
): AssetCandidate {
  return {
    source: e01,
    asset: { cmcId, symbol, name: symbol, slug: null },
    rank: parts.rank ?? null,
    isActive: parts.isActive ?? true,
    platform: null,
    issues: [],
  };
}

describe('parseSubject', () => {
  it('reads a symbol the way the API writes it, trimmed and upper-cased', () => {
    expect(parseSubject('  paxg ')).toEqual({ kind: 'symbol', symbol: 'PAXG' });
  });

  it('reads digits only as a CMC ID, which skips resolution (D3)', () => {
    expect(parseSubject('4705')).toEqual({ kind: 'cmcId', cmcId: 4705 });
  });

  it('reads anything that is not digits only as a symbol, never as a number', () => {
    expect(parseSubject('1INCH')).toEqual({ kind: 'symbol', symbol: '1INCH' });
    expect(parseSubject('4705.0')).toEqual({ kind: 'symbol', symbol: '4705.0' });
  });

  it('refuses a name that is only spaces, rather than calling the API with it', () => {
    expect(() => parseSubject('   ')).toThrow(CmcError);
    expect(() => parseSubject('')).toThrow(/give a symbol/);
  });

  it('refuses a number that cannot be a CMC ID', () => {
    expect(() => parseSubject('0')).toThrow(/not a CMC ID/);
    expect(() => parseSubject('99999999999999999999')).toThrow(/not a CMC ID/);
  });
});

describe('describeSubject', () => {
  it('names a symbol as it stands and an identifier as the outputs write it', () => {
    expect(describeSubject({ kind: 'symbol', symbol: 'PAXG' })).toBe('PAXG');
    expect(describeSubject({ kind: 'cmcId', cmcId: 4705 })).toBe('CMC 4705');
  });
});

describe('resolveCandidates', () => {
  it('chooses the active entry with the lowest rank and lists the others', () => {
    const resolution = resolveCandidates(
      [
        candidate(1, 'BTC', { rank: 1 }),
        candidate(38552, 'BTC', { rank: 3296 }),
        candidate(30938, 'BTC', { rank: null, isActive: false }),
      ],
      'BTC',
    );
    expect(resolution.asset?.cmcId).toBe(1);
    expect(resolution.reason).toBeNull();
    expect(resolution.others.map((other) => other.asset.cmcId)).toEqual([38552, 30938]);
  });

  it('prefers an active entry over an inactive one that ranks better', () => {
    const resolution = resolveCandidates(
      [candidate(2, 'BTC', { rank: 1, isActive: false }), candidate(1, 'BTC', { rank: 900 })],
      'BTC',
    );
    expect(resolution.asset?.cmcId).toBe(1);
  });

  it('puts an entry CMC left unranked behind every ranked one', () => {
    const resolution = resolveCandidates([candidate(2, 'BTC'), candidate(1, 'BTC', { rank: 3296 })], 'BTC');
    expect(resolution.asset?.cmcId).toBe(1);
  });

  it('settles a tie on the identifier, so two runs on one answer choose the same asset', () => {
    const order = [candidate(38552, 'BTC', { rank: 7 }), candidate(1, 'BTC', { rank: 7 })];
    expect(resolveCandidates(order, 'BTC').asset?.cmcId).toBe(1);
    expect(resolveCandidates([...order].reverse(), 'BTC').asset?.cmcId).toBe(1);
  });

  it('lists, never chooses, an entry carrying another symbol or no identifier', () => {
    const resolution = resolveCandidates(
      [candidate(999, 'WBTC', { rank: 1 }), candidate(null, 'BTC', { rank: 2 }), candidate(1, 'btc', { rank: 3 })],
      'BTC',
    );
    // Case does not count in a symbol, but a missing identifier and a different symbol both do.
    expect(resolution.asset?.cmcId).toBe(1);
    expect(resolution.others).toHaveLength(2);
  });

  it('settles on no asset when no entry is usable, and says the identifier skips the step', () => {
    const resolution = resolveCandidates([candidate(null, 'BTC')], 'BTC');
    expect(resolution.asset).toBeNull();
    expect(resolution.others).toHaveLength(1);
    expect(resolution.reason).toContain('BTC');
    expect(resolution.reason).toContain('numeric CMC ID skips this step');
  });
});

describe('readContract', () => {
  /** An E05 entry in the shape `readContract` reads, with nothing else filled in. */
  function info(parts: Partial<AssetContracts>): AssetContracts {
    return {
      source: e01,
      asset: { cmcId: 1, symbol: 'X', name: null, slug: null },
      category: null,
      platform: null,
      contracts: [],
      issues: [],
      ...parts,
    };
  }

  it('takes the primary platform slug with its token address (D3)', () => {
    const lookup = readContract(
      info({ platform: { cmcId: null, name: 'Ethereum', slug: 'ethereum', symbol: null, tokenAddress: '0xabc' } }),
    );
    expect(lookup).toEqual({ contract: { platform: 'ethereum', address: '0xabc' }, skip: null });
  });

  it('falls back to the first listed contract carrying both a slug and an address', () => {
    const lookup = readContract(
      info({
        contracts: [
          { address: null, platformName: 'Ethereum', platformSlug: 'ethereum' },
          { address: '0xdef', platformName: 'BNB', platformSlug: 'bnb' },
        ],
      }),
    );
    expect(lookup.contract).toEqual({ platform: 'bnb', address: '0xdef' });
  });

  it('reports a coin as a check this asset cannot have, naming its category (D3)', () => {
    const lookup = readContract(info({ category: 'coin' }));
    expect(lookup.contract).toBeNull();
    expect(lookup.skip?.status).toBe('not_applicable');
    expect(lookup.skip?.reason).toContain('category coin');
  });

  it('reports a platform it could not read as unavailable, not as an asset without a venue', () => {
    const lookup = readContract(
      info({ platform: { cmcId: null, name: 'Ethereum', slug: 'ethereum', symbol: null, tokenAddress: null } }),
    );
    expect(lookup.contract).toBeNull();
    expect(lookup.skip?.status).toBe('unavailable');
  });

  it('reads the recorded E05 answer: PAXG has an Ethereum contract, BTC has none', () => {
    const items = normalizeAssetInfo(recordedSource('E05', 'E05-info-btc-paxg')).items;
    const paxg = items.find((item) => item.asset.cmcId === PAXG_ID);
    const btc = items.find((item) => item.asset.cmcId === BTC_ID);
    if (paxg === undefined || btc === undefined) throw new Error('the recorded answer is missing an asset.');
    expect(readContract(paxg).contract).toEqual({
      platform: 'ethereum',
      address: '0x45804880de22913dafe09f4980848ece6ecbaf78',
    });
    expect(readContract(btc).contract).toBeNull();
    expect(readContract(btc).skip?.status).toBe('not_applicable');
  });
});

describe('assessAsset, on the recorded PAXG run', () => {
  it('hands the score the seven checks, once each, in the order of CHECK_IDS', async () => {
    const assessment = await assess('PAXG');
    expect(assessment.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    expect(assessment.score.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
  });

  it('evaluates every check this key can reach and leaves only C2 out (D2)', async () => {
    const assessment = await assess('PAXG');
    expect(statusOf(assessment)).toEqual({
      C1: 'evaluated',
      C2: 'unavailable',
      C3: 'evaluated',
      C4: 'evaluated',
      C5: 'evaluated',
      C6: 'evaluated',
      C7: 'evaluated',
    });
    expect(assessment.score.coverage).toEqual({ evaluated: 6, total: 7, label: '6 of 7 checks evaluated' });
    expect(assessment.score.score).toBe(100);
    expect(assessment.score.verdict).toBe('ACT');
    expect(reasonOf(assessment, 'C2')).toContain('not available with the current API plan');
  });

  it('names the asset as the answers name it, with the contract and the real-world asset behind it', async () => {
    const assessment = await assess('PAXG');
    expect(assessment.asset).toMatchObject({ cmcId: PAXG_ID, symbol: 'PAXG' });
    expect(assessment.contract).toEqual({
      platform: 'ethereum',
      address: '0x45804880de22913dafe09f4980848ece6ecbaf78',
    });
    expect(assessment.wrapper).toMatchObject({ cmcId: PAXG_ID, rwaId: 1, issuerName: 'Paxos' });
  });

  it('cites the seven answers it read, once each, and no call came back empty', async () => {
    const assessment = await assess('PAXG');
    expect(endpointsRead(assessment)).toEqual(['E01', 'E02', 'E06', 'E05', 'E14', 'E10', 'E11']);
    expect(assessment.failures).toEqual([]);
    expect(assessment.sources.every((source: SourceRef) => source.fixture !== null)).toBe(true);
  });

  it('reports the credits the recorded answers charged, so a replay shows what the live run cost', async () => {
    const assessment = await assess('PAXG');
    expect(assessment.credits.requests).toBe(7);
    expect(assessment.credits.charged).toBe(6);
    expect(assessment.credits.unconfirmed).toBe(0);
  });

  it('skips E01 when given the identifier, and still reads the asset back from the answers (D3)', async () => {
    const assessment = await assess(String(PAXG_ID));
    expect(assessment.subject).toEqual({ kind: 'cmcId', cmcId: PAXG_ID });
    expect(endpointsRead(assessment)).not.toContain('E01');
    expect(assessment.resolution.others).toEqual([]);
    expect(assessment.asset).toMatchObject({ cmcId: PAXG_ID, symbol: 'PAXG' });
    expect(assessment.score.verdict).toBe('ACT');
    expect(assessment.credits.requests).toBe(6);
  });

  it('asks E11 for the number of pools the recorded answer was read with', async () => {
    const assessment = await assess('PAXG', { poolSize: DEFAULT_POOL_SIZE });
    expect(assessment.failures).toEqual([]);
    const other = await assess('PAXG', { poolSize: DEFAULT_POOL_SIZE + 15 });
    expect(other.failures.map((failure) => failure.endpoint)).toEqual(['E11']);
  });

  it('measures the run against the clock it was given, never against the response timestamps', async () => {
    const assessment = await assess('PAXG', { now: clock(1_000, 9_400) });
    expect(assessment.elapsedMs).toBe(8_400);
  });
});

describe('assessAsset, on the recorded BTC run', () => {
  it('reports the checks a coin cannot have, each with the reason it gives (D9)', async () => {
    const assessment = await assess('BTC');
    expect(statusOf(assessment)).toEqual({
      C1: 'not_applicable',
      C2: 'unavailable',
      C3: 'evaluated',
      C4: 'not_applicable',
      C5: 'not_applicable',
      C6: 'evaluated',
      C7: 'evaluated',
    });
    expect(reasonOf(assessment, 'C1')).toContain('category coin');
    expect(reasonOf(assessment, 'C4')).toContain('no token contract');
    expect(reasonOf(assessment, 'C5')).toContain('not in the token to real-world-asset index');
    expect(assessment.contract).toBeNull();
    expect(assessment.wrapper).toBeNull();
  });

  it('still forms a verdict on the three checks that ran, and says how much of the engine that was', async () => {
    const assessment = await assess('BTC');
    expect(assessment.score.coverage.label).toBe('3 of 7 checks evaluated');
    expect(assessment.score.score).toBe(100);
    expect(assessment.score.verdict).toBe('ACT');
  });

  it('lists the other twelve entries E01 returned for the symbol without merging any of them in (D3)', async () => {
    const assessment = await assess('BTC');
    expect(assessment.asset?.cmcId).toBe(BTC_ID);
    expect(assessment.resolution.others).toHaveLength(12);
    expect(assessment.resolution.others.map((other) => other.asset.cmcId)).not.toContain(BTC_ID);
  });

  it('makes no DEX call for an asset E05 gave no contract for', async () => {
    const assessment = await assess('BTC');
    expect(endpointsRead(assessment)).toEqual(['E01', 'E02', 'E06', 'E05']);
  });
});

describe('assessAsset, when a call brings nothing back', () => {
  it('still forms a verdict, and the failed call becomes the reason of the checks that needed it (D9)', async () => {
    const assessment = await assessWithout('PAXG', ['E02']);
    expect(assessment.failures.map((failure) => failure.endpoint)).toEqual(['E02']);
    expect(assessment.failures[0]?.kind).toBe('replay_miss');
    expect(statusOf(assessment)).toMatchObject({ C1: 'unavailable', C6: 'unavailable', C3: 'evaluated' });
    expect(reasonOf(assessment, 'C1')).toContain('E02');
    expect(assessment.score.score).not.toBeNull();
    expect(assessment.score.coverage.evaluated).toBeGreaterThan(0);
  });

  it('carries no API key into the reason it prints', async () => {
    const assessment = await assessWithout('PAXG', ['E02']);
    expect(reasonOf(assessment, 'C1')).not.toMatch(/X-CMC_PRO_API_KEY/);
  });

  it('reports the DEX checks as unreached, not as an asset without a venue, when E05 failed', async () => {
    const assessment = await assessWithout('PAXG', ['E05']);
    expect(statusOf(assessment)).toMatchObject({ C1: 'unavailable', C4: 'unavailable' });
    expect(reasonOf(assessment, 'C4')).toContain('E05');
    expect(assessment.contract).toBeNull();
  });

  it('reports C5 as unreached when the index linked the token but E14 did not answer', async () => {
    const assessment = await assessWithout('PAXG', ['E14']);
    expect(assessment.wrapper).toMatchObject({ rwaId: 1 });
    expect(statusOf(assessment)).toMatchObject({ C5: 'unavailable' });
    expect(reasonOf(assessment, 'C5')).toContain('E14');
  });

  it('rests no verdict on nothing when resolution itself failed: no score, and every reason named', async () => {
    const assessment = await assessWithout('PAXG', ['E01']);
    expect(assessment.asset).toBeNull();
    expect(assessment.score.score).toBeNull();
    expect(assessment.score.verdict).toBe('DO_NOT_ACT');
    expect(assessment.score.coverage.evaluated).toBe(0);
    expect(assessment.checks.every((check) => check.status !== 'evaluated')).toBe(true);
    expect(assessment.checks.every((check) => check.reason !== null)).toBe(true);
    expect(reasonOf(assessment, 'C3')).toContain('E01');
  });
});

describe('assessAsset, and the token to real-world-asset index (D6)', () => {
  it('reports C5 as unreached and points at the command that builds the index when there is none', async () => {
    const assessment = await assess('PAXG', { wrapperIndex: null });
    expect(assessment.wrapper).toBeNull();
    expect(statusOf(assessment)).toMatchObject({ C5: 'unavailable' });
    expect(reasonOf(assessment, 'C5')).toContain('npm run rwa:index -- --build');
  });

  it('makes no E14 call when no index links the token, rather than guessing a real-world asset', async () => {
    const assessment = await assess('PAXG', { wrapperIndex: null });
    expect(endpointsRead(assessment)).not.toContain('E14');
    expect(assessment.failures).toEqual([]);
  });

  it('reports a token the index does not list as a check it cannot have, not as one that failed', async () => {
    const assessment = await assess('PAXG', { wrapperIndex: { ...paxosIndex(), entries: [] } });
    expect(statusOf(assessment)).toMatchObject({ C5: 'not_applicable' });
    expect(reasonOf(assessment, 'C5')).toContain('not in the token to real-world-asset index');
  });

  it('turns an index file it cannot read into a reason, without ending the run', async () => {
    const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
    const assessment = await assessAsset(client, parseSubject('PAXG'), { indexFile: join(scratch(), 'absent.json') });
    expect(statusOf(assessment)).toMatchObject({ C5: 'unavailable' });
    expect(assessment.score.score).not.toBeNull();
  });
});
