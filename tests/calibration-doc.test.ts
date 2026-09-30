/**
 * `docs/CALIBRATION.md` and `docs/calibration.json` as they are committed (T4.1 and T4.2, acceptance criterion 4).
 *
 * Two runs are committed, and they answer different questions.
 *
 * `docs/calibration.json` is the panel scored under the thresholds now in effect. T4.2 settled those thresholds
 * against the recorded answers of the live run and re-scored the same answers, so this file is reproduced exactly
 * by a replay — which is what lets a later change to a limit be re-measured without spending a credit.
 *
 * `docs/calibration-live-20260926T1044Z.json` is the live run that recorded those answers. Its verdicts are the
 * ones the thresholds of T4.1 produced and are deliberately not refreshed: it is kept for the evidence a replay
 * cannot produce — what the panel cost on the account (E20 read before and after), the pacing it ran at, and how
 * long each asset took over the network.
 *
 * So: the markdown is exactly what the run beside it renders to, and a hand edit to either fails here; the replay
 * reproduces the measurement of the current run; and the live run keeps the cost and the clock.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeReport } from '../src/calibration/report.js';
import { TARGET_ACT_SHARE, type CalibrationRun } from '../src/calibration/run.js';
import { projectRoot } from './helpers/endpoints-doc.js';
import { replayedRun } from './helpers/calibration-fixtures.js';

/** The run as `docs/calibration.json` holds it: the panel under the thresholds now in effect. */
function committedRun(): CalibrationRun {
  return JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as CalibrationRun;
}

/** Where the live run that recorded the answers is kept, for the cost and the clock a replay cannot reproduce. */
const LIVE_RUN_FILE = join(projectRoot, 'docs', 'calibration-live-20260926T1044Z.json');

function liveRun(): CalibrationRun {
  return JSON.parse(readFileSync(LIVE_RUN_FILE, 'utf8')) as CalibrationRun;
}

function committedReport(): string {
  return readFileSync(join(projectRoot, 'docs', 'CALIBRATION.md'), 'utf8');
}

/** What a replay can reproduce from the recorded answers: the measurement, not the cost or the clock. */
function measurement(run: CalibrationRun) {
  return run.outcomes.map((outcome) => ({
    rank: outcome.member.rank,
    cmcId: outcome.member.cmcId,
    symbol: outcome.member.symbol,
    score: outcome.score,
    verdict: outcome.verdict,
    severity: outcome.severity,
    evaluated: outcome.evaluated,
    hasContract: outcome.hasContract,
    wrapsRwaId: outcome.wrapsRwaId,
    checks: outcome.checks.map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity,
      codes: check.codes,
    })),
  }));
}

/** What each check did, without the wording of the reasons it gave. */
function counts(run: CalibrationRun) {
  return run.summary.checks.map(({ id, evaluated, notApplicable, unavailable, bySeverity }) => ({
    id,
    evaluated,
    notApplicable,
    unavailable,
    bySeverity,
  }));
}

describe('docs/CALIBRATION.md', () => {
  it('is exactly what docs/calibration.json renders to', () => {
    expect(committedReport()).toBe(serializeReport(committedRun()));
  });

  it('was measured on the panel the specification names, against the share it requires', () => {
    const run = committedRun();

    expect(run.panel.requested).toBe(50);
    expect(run.summary.assets).toBe(run.panel.members.length);
    expect(run.summary.targetShare).toBe(TARGET_ACT_SHARE);
  });

  it('rests on answers recorded under fixtures/calibration, with the key masked', () => {
    const run = committedRun();
    const cited = run.outcomes.flatMap((outcome) => outcome.sources.map((source) => source.fixture?.file ?? ''));

    expect(cited.length).toBeGreaterThan(0);
    for (const file of cited) expect(file).toMatch(/^fixtures\/calibration\/.+\.json$/);
    for (const file of new Set(cited)) {
      expect(readFileSync(join(projectRoot, file), 'utf8')).toContain('"X-CMC_PRO_API_KEY": "***"');
    }
  });

  it('reports what the answers cost, from the credit counts the answers themselves carried', () => {
    const run = committedRun();

    expect(run.summary.credits.charged).toBeGreaterThan(0);
    expect(run.summary.credits.requests).toBeGreaterThan(0);
  });

  it('claims no timing and no account-wide reading of its own, having sent no request', () => {
    const run = committedRun();

    expect(run.pacedPerMinute).toBeNull();
    expect(run.keyBefore).toBeNull();
    expect(run.keyAfter).toBeNull();
  });

  it('carries no API key, only the mask', () => {
    const files = [
      committedReport(),
      readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8'),
      readFileSync(LIVE_RUN_FILE, 'utf8'),
    ];

    for (const text of files) expect(text).not.toMatch(/X-CMC_PRO_API_KEY"\s*:\s*"(?!\*\*\*)/);
  });

  it('holds the same measurement the recorded answers replay to', async () => {
    const replayed = await replayedRun();

    expect(measurement(replayed)).toEqual(measurement(committedRun()));
  });

  it('holds the same counts the replayed measurement produces', async () => {
    const replayed = await replayedRun();
    const committed = committedRun();

    expect(replayed.summary.verdicts).toEqual(committed.summary.verdicts);
    expect(replayed.summary.actShare).toBe(committed.summary.actShare);
    expect(replayed.summary.meetsTarget).toBe(committed.summary.meetsTarget);
    expect(replayed.summary.score).toEqual(committed.summary.score);
    expect(replayed.summary.coverage).toEqual(committed.summary.coverage);
    expect(replayed.summary.findings).toEqual(committed.summary.findings);
    // The counts, not the wordings: a call the live run lost to a timeout has no fixture, so a replay reports it as
    // a missing fixture. Both leave the check `unavailable` — the status is reproduced, the sentence is not.
    expect(counts(replayed)).toEqual(counts(committed));
  });

  it('reaches the share the specification requires, on the thresholds now in effect', () => {
    const { summary } = committedRun();

    expect(summary.actShare).toBeGreaterThanOrEqual(TARGET_ACT_SHARE);
    expect(summary.meetsTarget).toBe(true);
  });

  it('still reports assets below ACT, so the panel does not show a blinded engine', () => {
    const run = committedRun();
    const below = run.outcomes.filter((outcome) => outcome.verdict !== 'ACT');

    // F5 asks for at least 90 % at ACT; a panel at 100 % would mean the limits had been widened until nothing
    // could be seen. These are the assets the settled limits still hold back, and why (D12).
    expect(below.length).toBeGreaterThan(0);
    for (const outcome of below) {
      expect(outcome.checks.some((check) => check.severity === 'warning' || check.severity === 'critical')).toBe(true);
    }
  });

  // The case T4.2 is required to keep: three assets of the panel that have to stay below ACT, named, with the
  // measurement that holds each one there. A limit widened until one of them reaches ACT turns this red, which is
  // what stops the share from being raised by loosening rather than by measuring — the 6 % variant of C1's critical
  // limit, measured and rejected in `config/checks.json`, is exactly the change this catches.
  it('keeps the three assets the measurements hold below ACT, each on the check that holds it', () => {
    const held = new Map(
      committedRun()
        .outcomes.filter((outcome) => outcome.verdict !== 'ACT')
        .map((outcome) => [outcome.member.symbol, outcome]),
    );

    expect([...held.keys()].sort()).toEqual(['BNB', 'GRAM', 'LEO']);
    for (const [symbol, id, severity, code] of [
      // A gap of 5.735 % between the aggregate and the only DEX venue read for it.
      ['BNB', 'C1', 'critical', 'price_gap'],
      // A gap of 8.045 %, on a venue whose price was also among the stalest of the panel.
      ['GRAM', 'C1', 'critical', 'price_gap'],
      // 3756.8 USD of depth behind the price, under the 10000 USD critical floor.
      ['LEO', 'C4', 'critical', 'thin_venue'],
    ] as const) {
      const outcome = held.get(symbol);
      expect(outcome?.score, symbol).toBeLessThan(committedRun().thresholds.score.actAtOrAbove);
      const holder = outcome?.checks.find((candidate) => candidate.id === id);
      expect(holder?.severity, `${symbol} ${id}`).toBe(severity);
      expect(holder?.codes, `${symbol} ${id}`).toContain(code);
    }
  });
});

describe('docs/calibration-live-20260926T1044Z.json', () => {
  it('keeps what only a live run can show: the account-wide cost and the pacing', () => {
    const run = liveRun();

    expect(run.pacedPerMinute).toBeGreaterThan(0);
    expect(run.summary.credits.charged).toBeGreaterThan(0);
    expect(run.keyBefore?.creditsUsedMonth).toBeGreaterThanOrEqual(0);
    expect(run.keyAfter?.creditsUsedMonth).toBeGreaterThan(run.keyBefore?.creditsUsedMonth ?? 0);
    // The client meter and the account counter measured the same run, so they have to agree.
    const account = (run.keyAfter?.creditsUsedMonth ?? 0) - (run.keyBefore?.creditsUsedMonth ?? 0);
    expect(account).toBe(run.summary.credits.charged);
  });

  it('rests on the same panel and the same recorded answers as the run beside it', () => {
    const live = liveRun();
    const current = committedRun();

    expect(live.panelObservedAt).toBe(current.panelObservedAt);
    expect(live.panel.members.map((member) => member.cmcId)).toEqual(
      current.panel.members.map((member) => member.cmcId),
    );
  });

  it('measured the timings acceptance criterion 2 is judged against', () => {
    const { summary } = liveRun();

    expect(summary.elapsed.medianMs).toBeGreaterThan(0);
    expect(summary.elapsed.slowestMs).toBeGreaterThan(0);
  });
});
