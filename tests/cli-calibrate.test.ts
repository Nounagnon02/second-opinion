/**
 * The `calibrate` command (T4.1): acceptance criterion 4 of the specification, "the calibration is reached and
 * documented in `docs/CALIBRATION.md`".
 *
 * It is a gate as much as a report, so both sides are tested: what it writes, and the status it exits with when the
 * panel sits below the share of `ACT` the specification requires. Every run here is a replay of the answers the
 * live run of 2026-09-25 recorded, so nothing touches the network.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeReport, serializeRun } from '../src/calibration/report.js';
import { DEFAULT_PANEL_SIZE, MAX_PANEL_SIZE } from '../src/calibration/panel.js';
import {
  CALIBRATION_FIXTURE_DIR,
  DEFAULT_REQUESTS_PER_MINUTE,
  parseCalibrateArgs,
  progressLine,
  runCalibrate,
  type CalibrateArgs,
} from '../src/cli/calibrate.js';
import { DEFAULT_FIXTURE_DIR, DEFAULT_RECORD_DIR } from '../src/cmc/config.js';
import { NETWORK_DISABLED } from './setup/no-network.js';

const scratches: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-calibrate-'));
  scratches.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The arguments of a replay run over the recorded calibration answers. */
function replayArgs(parts: Partial<CalibrateArgs> = {}): CalibrateArgs {
  return {
    size: DEFAULT_PANEL_SIZE,
    mode: { kind: 'replay', dir: CALIBRATION_FIXTURE_DIR },
    write: false,
    json: false,
    perMinute: DEFAULT_REQUESTS_PER_MINUTE,
    indexFile: null,
    ...parts,
  };
}

describe('parseCalibrateArgs', () => {
  it('reads the panel the specification names by default, live, printing the report', () => {
    expect(parseCalibrateArgs([])).toEqual({
      size: DEFAULT_PANEL_SIZE,
      mode: { kind: 'live' },
      write: false,
      json: false,
      perMinute: DEFAULT_REQUESTS_PER_MINUTE,
      indexFile: null,
    });
  });

  it('records into its own fixture directory rather than the shared one', () => {
    expect(parseCalibrateArgs(['--record']).mode).toEqual({ kind: 'record', dir: CALIBRATION_FIXTURE_DIR });
    expect(CALIBRATION_FIXTURE_DIR).not.toBe(DEFAULT_RECORD_DIR);
  });

  it('leaves a directory the caller named alone', () => {
    const dir = scratch();

    expect(parseCalibrateArgs([`--record=${dir}`]).mode).toEqual({ kind: 'record', dir });
    expect(parseCalibrateArgs(['--replay']).mode).toEqual({ kind: 'replay', dir: DEFAULT_FIXTURE_DIR });
  });

  it('reads the size, the pacing, the output flags and the index path', () => {
    const args = parseCalibrateArgs(['--size=25', '--per-minute=12', '--write', '--json', '--index=cache/idx.json']);

    expect(args).toMatchObject({ size: 25, perMinute: 12, write: true, json: true });
    expect(args.indexFile).toBe(resolve(process.cwd(), 'cache/idx.json'));
  });

  it('refuses a size or a pacing that is not a whole number in range', () => {
    for (const arg of ['--size=0', '--size=2.5', `--size=${String(MAX_PANEL_SIZE + 1)}`, '--size=many']) {
      expect(() => parseCalibrateArgs([arg])).toThrow(/whole number/);
    }
    for (const arg of ['--per-minute=0', '--per-minute=-3', '--per-minute=90000']) {
      expect(() => parseCalibrateArgs([arg])).toThrow(/whole number/);
    }
  });

  it('refuses an empty index path, an unknown option and a stray argument', () => {
    expect(() => parseCalibrateArgs(['--index='])).toThrow(/path is empty/);
    expect(() => parseCalibrateArgs(['--verbose'])).toThrow(/Unknown option/);
    expect(() => parseCalibrateArgs(['BTC'])).toThrow(/Unexpected argument/);
  });

  it('refuses two modes in one run', () => {
    expect(() => parseCalibrateArgs(['--record', '--replay'])).toThrow(/One mode per run/);
  });
});

describe('progressLine', () => {
  it('names the asset, its verdict, its score, its coverage and what it cost', () => {
    const line = progressLine(
      {
        member: { rank: 3, cmcId: 825, symbol: 'USDT', name: 'Tether USDt', marketCapUsd: null },
        score: 88.5,
        verdict: 'ACT',
        severity: 'warning',
        evaluated: 5,
        checks: [],
        hasContract: true,
        wrapsRwaId: null,
        failures: [],
        credits: 5,
        creditsUnconfirmed: 0,
        requests: 5,
        elapsedMs: 2024,
        sources: [],
      },
      3,
      50,
    );

    expect(line).toBe('[3/50] USDT: ACT, 88.5/100, 5 of 7 checks, 5 credit(s), 2024 ms');
  });
});

describe('runCalibrate', () => {
  it('assesses the recorded panel offline and prints the report', async () => {
    const { ok, lines, run } = await runCalibrate(replayArgs(), {});

    expect(ok).toBe(true);
    expect(lines[0]).toBe('# Calibration — the first assets by market capitalisation');
    expect(run?.outcomes.length).toBe(run?.panel.members.length);
  });

  it('reports progress once per asset while it runs', async () => {
    const seen: string[] = [];

    const { run } = await runCalibrate(replayArgs(), {}, {}, { onProgress: (line) => seen.push(line) });

    expect(seen).toHaveLength(run?.outcomes.length ?? 0);
    expect(seen[0]).toMatch(/^\[1\/\d+]/);
  });

  it('says whether the panel met the target, apart from whether the run could be made', async () => {
    const { ok, meetsTarget, run } = await runCalibrate(replayArgs(), {});

    expect(ok).toBe(true);
    expect(meetsTarget).toBe(run?.summary.meetsTarget);
  });

  it('writes the two generated files, and nothing else, when asked to', async () => {
    const dir = scratch();
    const files = { report: join(dir, 'CALIBRATION.md'), run: join(dir, 'calibration.json') };

    const { ok, lines, run } = await runCalibrate(replayArgs({ write: true }), {}, {}, { files });

    expect(ok).toBe(true);
    expect(lines[0]).toBe(`Written: ${files.report}`);
    expect(run).not.toBeNull();
    expect(readFileSync(files.report, 'utf8')).toBe(serializeReport(run as NonNullable<typeof run>));
    expect(readFileSync(files.run, 'utf8')).toBe(serializeRun(run as NonNullable<typeof run>));
  });

  it('prints the whole run as JSON when asked to', async () => {
    const { lines, run } = await runCalibrate(replayArgs({ json: true }), {});

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual(JSON.parse(JSON.stringify(run)));
  });

  it('reports a fixture directory that is not there instead of throwing', async () => {
    const missing = join(scratch(), 'nowhere');

    const { ok, meetsTarget, lines } = await runCalibrate(replayArgs({ mode: { kind: 'replay', dir: missing } }), {});

    expect({ ok, meetsTarget }).toEqual({ ok: false, meetsTarget: false });
    expect(lines[0]).toContain('fixture directory not found');
  });

  it('reports a panel it could not read, with the credits the attempt cost', async () => {
    const { ok, lines } = await runCalibrate(replayArgs({ size: 7 }), {});

    expect(ok).toBe(false);
    expect(lines[0]).toContain('no fixture recorded for this request');
    expect(lines[lines.length - 1]).toMatch(/^Credits this run:/);
  });

  it('refuses a live run without a key, before any request is sent', async () => {
    const { ok, lines } = await runCalibrate(replayArgs({ mode: { kind: 'live' } }), { CMC_API_KEY: '' });

    expect(ok).toBe(false);
    expect(lines[0]).toContain('CMC_API_KEY is not set');
  });

  it('paces a live run, and sends nothing over the network in a replay', async () => {
    // A live run reaches for the network, which the test setup refuses: proof the pacing wraps the real transport.
    const live = await runCalibrate(replayArgs({ mode: { kind: 'live' }, size: 1 }), {
      CMC_API_KEY: 'a-test-key-long-enough',
      CMC_MAX_RETRIES: '0',
      CMC_CACHE_DIR: scratch(),
    });

    expect(live.ok).toBe(false);
    expect(live.lines[0]).toContain(NETWORK_DISABLED);

    const replay = await runCalibrate(replayArgs(), {});
    expect(replay.run?.pacedPerMinute).toBeNull();
  });
});
