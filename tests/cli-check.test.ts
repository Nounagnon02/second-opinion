/**
 * The `check` command (T3.7): acceptance criterion 2 of the specification, "`npm run check -- <symbol>` gives a
 * verdict in under 10 seconds with a real key". It is the first command a reviewer runs, so what it prints is tested
 * as closely as what it computes: the verdict line, the reason of every check that did not run, the evidence behind
 * each one, and the exit status.
 *
 * Every run is offline: replayed from the answers the live runs of 2026-09-25 recorded into `fixtures/check`, or —
 * for the live and record modes, which read the network — through a transport that serves those same answers.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessAsset, parseSubject, type AssetAssessment } from '../src/checks/assess.js';
import { evidence, type Measurement } from '../src/checks/model.js';
import {
  describeAssessment,
  describeMeasurement,
  formatElapsed,
  formatValue,
  LISTED_CANDIDATES,
  parseCheckArgs,
  runCheck,
  VERDICT_BUDGET_MS,
  type CheckArgs,
} from '../src/cli/check.js';
import { WRAP_AT } from '../src/cli/args.js';
import { MemoryCache } from '../src/cmc/cache.js';
import { DEFAULT_FIXTURE_DIR, DEFAULT_RECORD_DIR } from '../src/cmc/config.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { sourceRef } from '../src/normalize/model.js';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import { CHECK_FIXTURES, PAXG_ID, paxosIndex, recordedCheckNetwork } from './helpers/check-fixtures.js';
import { recordedSource } from './helpers/normalize.js';

/** A key that is not a real one: no run below may print it, and no fixture may hold it. */
const KEY = 'test-key-not-a-real-one';

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-check-cli-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The arguments of a replay run over the recorded answers. */
function replayArgs(named = 'PAXG', parts: Partial<CheckArgs> = {}): CheckArgs {
  return {
    subject: parseSubject(named),
    mode: { kind: 'replay', dir: CHECK_FIXTURES },
    json: false,
    details: false,
    indexFile: null,
    ...parts,
  };
}

/** A replay run, with the index the recorded PAXG run was read with. */
async function check(named = 'PAXG', parts: Partial<CheckArgs> = {}): Promise<{ ok: boolean; lines: string[] }> {
  return runCheck(replayArgs(named, parts), {}, {}, { wrapperIndex: paxosIndex() });
}

/** A run in live or record mode: both read the network, served here by the recorded answers. */
async function online(mode: CheckArgs['mode']): Promise<{ ok: boolean; lines: string[]; requests: number }> {
  const network = recordedCheckNetwork();
  const { ok, lines } = await runCheck(
    replayArgs('PAXG', { mode }),
    { CMC_API_KEY: KEY },
    { network, cache: new MemoryCache() },
    { wrapperIndex: paxosIndex() },
  );
  return { ok, lines, requests: network.requests.length };
}

/** The assessment a report is written from, read the way the command reads it. */
async function assessment(named = 'PAXG'): Promise<AssetAssessment> {
  const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
  return assessAsset(client, parseSubject(named), { wrapperIndex: paxosIndex() });
}

function lineWith(lines: readonly string[], needle: string): string {
  const found = lines.find((line) => line.includes(needle));
  if (found === undefined) throw new Error(`no line contains "${needle}" in:\n${lines.join('\n')}`);
  return found;
}

describe('parseCheckArgs', () => {
  it('reads one symbol, live, with the report and the default index', () => {
    expect(parseCheckArgs(['PAXG'])).toEqual({
      subject: { kind: 'symbol', symbol: 'PAXG' },
      mode: { kind: 'live' },
      json: false,
      details: false,
      indexFile: null,
    });
  });

  it('reads the flags and the asset in any order', () => {
    expect(parseCheckArgs(['--json', '--replay', '--details', 'paxg'])).toEqual({
      subject: { kind: 'symbol', symbol: 'PAXG' },
      mode: { kind: 'replay', dir: DEFAULT_FIXTURE_DIR },
      json: true,
      details: true,
      indexFile: null,
    });
  });

  it('reads a numeric asset as a CMC ID, which skips resolution (D3)', () => {
    expect(parseCheckArgs([String(PAXG_ID)]).subject).toEqual({ kind: 'cmcId', cmcId: PAXG_ID });
  });

  it('takes the fixture directory of each mode, or its default', () => {
    expect(parseCheckArgs(['BTC', '--record']).mode).toEqual({ kind: 'record', dir: DEFAULT_RECORD_DIR });
    expect(parseCheckArgs(['BTC', '--replay=fixtures/check'], '/work').mode).toEqual({
      kind: 'replay',
      dir: resolve('/work', 'fixtures/check'),
    });
  });

  it('resolves a relative index file against the working directory, and leaves the default alone', () => {
    expect(parseCheckArgs(['BTC', '--index=cache/index.json'], '/work').indexFile).toBe('/work/cache/index.json');
    expect(parseCheckArgs(['BTC']).indexFile).toBeNull();
    // The default a run falls back to is the cache of D6, not a path this command invents.
    expect(DEFAULT_INDEX_FILE.endsWith(join('.cache', 'rwa', 'wrapper-index.json'))).toBe(true);
  });

  it('refuses a command line it cannot act on, and says how to write it', () => {
    expect(() => parseCheckArgs([])).toThrow(/No asset was named/);
    expect(() => parseCheckArgs([])).toThrow(/Usage: check/);
    expect(() => parseCheckArgs(['BTC', 'PAXG'])).toThrow(/One asset at a time, got BTC, PAXG/);
    expect(() => parseCheckArgs(['BTC', '--verbose'])).toThrow(/Unknown option "--verbose"/);
    expect(() => parseCheckArgs(['BTC', '--index='])).toThrow(/index file path is empty/);
    expect(() => parseCheckArgs(['BTC', '--record', '--replay'])).toThrow(/One mode per run/);
  });
});

describe('formatElapsed', () => {
  it('reads milliseconds under a second, so a replay never reports 0 s', () => {
    expect(formatElapsed(0)).toBe('0 ms');
    expect(formatElapsed(6.4)).toBe('6 ms');
    expect(formatElapsed(999)).toBe('999 ms');
  });

  it('reads one decimal of a second above it, the precision the budget of D1 is read at', () => {
    expect(formatElapsed(1_000)).toBe('1 s');
    expect(formatElapsed(6_234)).toBe('6.2 s');
    expect(formatElapsed(VERDICT_BUDGET_MS)).toBe('10 s');
  });
});

describe('formatValue', () => {
  it('prints every measured value in the unit it was measured in, never a bare number', () => {
    expect(formatValue(1234.5, 'usd')).toBe('1234.5 USD');
    expect(formatValue(2.5, 'percent')).toBe('2.5 %');
    expect(formatValue(45, 'seconds')).toBe('45 s');
    expect(formatValue(7, 'count')).toBe('7');
  });

  it('prints a multiple the way C4 words it, with no unit stuck on the end of it', () => {
    expect(formatValue(3.25, 'ratio')).toBe('3.25 times');
    expect(formatValue(50, 'ratio')).toBe('50 times');
  });

  it('says a value could not be read rather than printing a zero for it', () => {
    expect(formatValue(null, 'usd')).toBe('not readable');
    expect(formatValue(null, 'count')).toBe('not readable');
  });
});

describe('describeMeasurement', () => {
  const source = sourceRef(recordedSource('E02', 'E02-quotes-latest-btc-paxg'));

  function measurement(parts: Partial<Measurement>): Measurement {
    return {
      label: 'E02 aggregated price of PAXG',
      value: 3_800,
      unit: 'usd',
      threshold: null,
      evidence: evidence(source),
      ...parts,
    };
  }

  it('names what was measured and the limit it was read against', () => {
    expect(describeMeasurement(measurement({ value: 2.5, unit: 'percent', threshold: 1 }))).toBe(
      'E02 aggregated price of PAXG: 2.5 % (limit 1 %)',
    );
  });

  it('leaves out a limit the measurement has none of', () => {
    expect(describeMeasurement(measurement({}))).toBe('E02 aggregated price of PAXG: 3800 USD');
  });

  it('says a value it could not measure, with the limit it would have been read against', () => {
    expect(describeMeasurement(measurement({ value: null, threshold: 1_000 }))).toBe(
      'E02 aggregated price of PAXG: not readable (limit 1000 USD)',
    );
  });
});

describe('describeAssessment, on the recorded PAXG run', () => {
  it('opens with the asset as the answers name it, the token and the real-world asset behind it', async () => {
    const lines = describeAssessment(await assessment('PAXG'));
    expect(lines[0]).toBe('PAXG — PAX Gold, CMC 4705');
    expect(lines[1]).toContain('Token 0x45804880de22913dafe09f4980848ece6ecbaf78 on ethereum');
    expect(lines[1]).toContain('Wraps rwa_id 1, issued by Paxos');
  });

  it('states the verdict, the score and how much of the engine ran', async () => {
    const verdict = lineWith(describeAssessment(await assessment('PAXG')), 'ACT:');
    expect(verdict).toContain('100 out of 100');
    expect(verdict).toContain('6 of 7 checks evaluated');
  });

  it('lists each check that ran with the points and the share of the score it carried', async () => {
    const lines = describeAssessment(await assessment('PAXG'));
    expect(lines).toContain('Evaluated');
    expect(lineWith(lines, 'C1  info')).toContain('(100 points, 25 % of the score)');
  });

  it('lists each check that did not run with its status, its weight and the reason it gave (D9)', async () => {
    const lines = describeAssessment(await assessment('PAXG'));
    expect(lines).toContain('Not evaluated');
    expect(lineWith(lines, 'C2  unavailable')).toContain('(weight 20, not scored)');
    expect(lineWith(lines, 'Per-exchange prices are not available')).toBeTruthy();
  });

  it('cites the answer behind every line: the endpoint, the path, when it was observed and the fixture', async () => {
    const lines = describeAssessment(await assessment('PAXG'));
    expect(lines).toContain('Evidence');
    const e11 = lineWith(lines, '/v1/dex/token/pools');
    expect(e11).toContain('E11');
    expect(e11).toContain('fixtures/check/E11-');
    expect(e11).toMatch(/observed 20\d\d-\d\d-\d\dT/);
  });

  it('ends with what the run spent and how it read against the ten seconds of D1', async () => {
    const lines = describeAssessment(await assessment('PAXG'));
    expect(lineWith(lines, 'Credits this run')).toContain('CMC_CREDIT_BUDGET');
    const budget = lineWith(lines, 'budget of D1');
    expect(budget).toContain('within the 10 s budget of D1');
    expect(budget).toContain('7 attempt(s) for 7 answer(s)');
  });

  it('says so when a run went past the budget rather than reporting it as within', async () => {
    const slow = { ...(await assessment('PAXG')), elapsedMs: VERDICT_BUDGET_MS + 1 };
    expect(lineWith(describeAssessment(slow), 'budget of D1')).toContain('past the 10 s budget');
  });

  it('keeps the measurements that raised nothing for --details, so the report stays short by default', async () => {
    const read = await assessment('PAXG');
    const plain = describeAssessment(read);
    const detailed = describeAssessment(read, true);
    expect(detailed.length).toBeGreaterThan(plain.length);
    expect(plain.some((line) => line.includes('the depth held'))).toBe(false);
    expect(detailed.some((line) => line.includes('the depth held'))).toBe(true);
  });

  it('wraps the prose it prints, and leaves the evidence table unbroken so a path stays citeable', async () => {
    const lines = describeAssessment(await assessment('PAXG'), true);
    const prose = lines.filter((line) => line.startsWith('      '));
    expect(prose.length).toBeGreaterThan(0);
    for (const line of prose) expect(line.length).toBeLessThanOrEqual(WRAP_AT);
    // The evidence rows are a table: the fixture name is printed whole, however wide that makes the row.
    expect(lineWith(lines, '/v1/dex/token/pools')).toMatch(/fixtures\/check\/E11-[0-9a-f]+-\d{8}T\d+Z\.json$/);
  });
});

describe('describeAssessment, on the recorded BTC run', () => {
  it('lists the other entries E01 returned, and counts the ones it did not list (D3)', async () => {
    const lines = describeAssessment(await assessment('BTC'));
    expect(lineWith(lines, 'Other entries E01 returned for BTC')).toBeTruthy();
    // Twelve others: five listed, the rest counted rather than dropped in silence.
    expect(lines.filter((line) => /^ {2}CMC \d+/.test(line))).toHaveLength(LISTED_CANDIDATES);
    expect(lineWith(lines, `and ${String(12 - LISTED_CANDIDATES)} more, none of them used.`)).toBeTruthy();
  });

  it('prints no evidence of a call it never made', async () => {
    const lines = describeAssessment(await assessment('BTC'));
    expect(lines.some((line) => line.includes('/v1/dex/token/pools'))).toBe(false);
    expect(lineWith(lines, 'C1  not_applicable')).toBeTruthy();
  });
});

describe('runCheck', () => {
  it('comes back with the report and a success for an asset it could measure', async () => {
    const { ok, lines } = await check('PAXG');
    expect(ok).toBe(true);
    expect(lines[0]).toBe('PAXG — PAX Gold, CMC 4705');
    expect(lineWith(lines, 'ACT:')).toBeTruthy();
  });

  it('reads an asset given by identifier without resolving it first', async () => {
    const { ok, lines } = await check(String(PAXG_ID));
    expect(ok).toBe(true);
    expect(lines.some((line) => line.includes('/v1/cryptocurrency/map'))).toBe(false);
  });

  it('prints the whole assessment as JSON when asked, and nothing else', async () => {
    const { ok, lines } = await check('PAXG', { json: true });
    expect(ok).toBe(true);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as AssetAssessment;
    expect(parsed.score.verdict).toBe('ACT');
    expect(parsed.checks).toHaveLength(7);
    expect(parsed.sources).toHaveLength(7);
  });

  it('fails the run when no check could be evaluated, and still says why each one could not (D11)', async () => {
    const { ok, lines } = await runCheck(replayArgs('PAXG', { mode: { kind: 'replay', dir: scratch() } }));
    expect(ok).toBe(false);
    expect(lineWith(lines, 'DO_NOT_ACT')).toContain('no check could be evaluated');
    expect(lineWith(lines, 'C1  unavailable')).toBeTruthy();
    expect(lineWith(lines, 'no fixture recorded for this request')).toBeTruthy();
  });

  it('reports a mode it could not even build a client for, rather than throwing out of the command', async () => {
    const missing = join(scratch(), 'no-such-directory');
    const { ok, lines } = await runCheck(replayArgs('PAXG', { mode: { kind: 'replay', dir: missing } }));
    expect(ok).toBe(false);
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('fixture directory not found');
    expect(lines[0]).toContain(missing);
    // No client was built, so there is no meter to report: the run never reached the API.
    expect(lines).toHaveLength(1);
  });

  it('reports a live run with no key the same way, naming the variable to set', async () => {
    const { ok, lines } = await runCheck(replayArgs('PAXG', { mode: { kind: 'live' } }), {});
    expect(ok).toBe(false);
    expect(lines[0]).toContain('CMC_API_KEY');
  });

  it('never prints the API key, in any mode', async () => {
    const live = await online({ kind: 'live' });
    expect(live.ok).toBe(true);
    expect(live.lines.join('\n')).not.toContain(KEY);
    const replayed = await check('PAXG');
    expect(replayed.lines.join('\n')).not.toContain(KEY);
  });

  it('reads the network rather than the fixtures when no mode flag was given', async () => {
    const live = await online({ kind: 'live' });
    expect(live.requests).toBe(7);
    // A live answer carries no fixture, so the evidence names the call itself.
    expect(lineWith(live.lines, '/v1/dex/token/pools')).toContain('live call');
  });

  it('writes one fixture per answer in record mode, so the run can be replayed and cited', async () => {
    const dir = scratch();
    const recorded = await online({ kind: 'record', dir });
    expect(recorded.ok).toBe(true);
    const written = readdirSync(dir);
    expect(written).toHaveLength(7);
    expect(written.filter((name) => name.startsWith('E11-'))).toHaveLength(1);
  });

  it('masks the key in every fixture record mode writes', async () => {
    const dir = scratch();
    await online({ kind: 'record', dir });
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text).not.toContain(KEY);
      expect(text).toContain('***');
    }
  });

  it('takes the index file from the command line, and reports C5 as unreached when it holds none', async () => {
    const args = replayArgs('PAXG', { indexFile: join(scratch(), 'absent.json') });
    const { ok, lines } = await runCheck(args, {}, {}, {});
    expect(ok).toBe(true);
    expect(lineWith(lines, 'C5  unavailable')).toBeTruthy();
  });
});
