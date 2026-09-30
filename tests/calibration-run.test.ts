/**
 * The calibration run (T4.1): the panel through the whole engine, and the counting of what came out.
 *
 * Every outcome read here comes from replaying the live run of 2026-09-25 recorded in `fixtures/calibration`, so
 * the counts are checked against real verdicts rather than against verdicts written for the occasion. The counting
 * itself is then exercised on slices of those same outcomes.
 */
import { describe, expect, it } from 'vitest';
import { runCalibration, median, summarize, TARGET_ACT_SHARE, type AssetOutcome } from '../src/calibration/run.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { VERDICTS } from '../src/score/verdict.js';
import { CALIBRATION_FIXTURES, replayClient, replayedRun } from './helpers/calibration-fixtures.js';

const NO_CREDITS = { charged: 0, unconfirmed: 0, requests: 0, byEndpoint: {} };

describe('median', () => {
  it('is the middle value of an odd list and the mean of the two middle ones of an even list', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('has no value for an empty list', () => {
    expect(median([])).toBeNull();
  });
});

describe('runCalibration', () => {
  it('assesses every member of the panel, in the order E03 ranked them', async () => {
    const run = await replayedRun();

    expect(run.outcomes).toHaveLength(run.panel.members.length);
    expect(run.outcomes.map((outcome) => outcome.member.rank)).toEqual(
      run.panel.members.map((member) => member.rank),
    );
  });

  it('reads the panel from the E03 answer and dates the run by it, never by the local clock', async () => {
    const run = await replayedRun();

    expect(run.panel.source.endpoint).toBe('E03');
    expect(run.panelObservedAt).toBe(run.panel.source.observedAt);
  });

  it('gives every asset the seven checks, each one once', async () => {
    const run = await replayedRun();

    for (const outcome of run.outcomes) {
      expect(outcome.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    }
  });

  it('counts as evaluated exactly the checks that ran', async () => {
    const run = await replayedRun();

    for (const outcome of run.outcomes) {
      const ran = outcome.checks.filter((check) => check.status === 'evaluated');
      expect({ asset: outcome.member.symbol, evaluated: outcome.evaluated }).toEqual({
        asset: outcome.member.symbol,
        evaluated: ran.length,
      });
    }
  });

  it('records the answers each asset was assessed on, with the fixture behind each', async () => {
    const run = await replayedRun();
    const assessed = run.outcomes.filter((outcome) => outcome.evaluated > 0);

    expect(assessed.length).toBeGreaterThan(0);
    for (const outcome of assessed) {
      expect(outcome.sources.length).toBeGreaterThan(0);
      for (const source of outcome.sources) expect(source.fixture?.file).toMatch(/^fixtures\/calibration\//);
    }
  });

  it('reports C5 as unavailable on every asset when the run has no wrapper index', async () => {
    const run = await runCalibration(replayClient(CALIBRATION_FIXTURES), { wrapperIndex: null });

    expect(run.index).toBeNull();
    const statuses = new Set(run.outcomes.map((outcome) => outcome.checks.find((check) => check.id === 'C5')?.status));
    expect([...statuses]).toEqual(['unavailable']);
  });

  it('names the index C5 was read against when there is one', async () => {
    const run = await replayedRun();

    expect(run.index?.entries).toBeGreaterThan(0);
    expect(Date.parse(run.index?.builtAt ?? '')).not.toBeNaN();
  });

  it('reports progress once per asset, in order, up to the panel size', async () => {
    const seen: { done: number; total: number; symbol: string | null }[] = [];
    const index = (await replayedRun()).index;

    await runCalibration(replayClient(CALIBRATION_FIXTURES), {
      wrapperIndex: null,
      onAsset: (outcome, done, total) => seen.push({ done, total, symbol: outcome.member.symbol }),
    });

    expect(index).not.toBeNull();
    expect(seen.map((step) => step.done)).toEqual(seen.map((_step, at) => at + 1));
    expect(new Set(seen.map((step) => step.total))).toEqual(new Set([seen.length]));
  });

  it('keeps the thresholds that produced the verdicts, so the report states its own "before"', async () => {
    const run = await replayedRun();

    expect(run.thresholds.score.actAtOrAbove).toBe(75);
    expect(run.thresholds.score.cautionAtOrAbove).toBe(40);
    expect(Object.keys(run.thresholds.score.weights).sort()).toEqual([...CHECK_IDS]);
  });

  it('counts, for a replay, the credits the recorded answers reported and nothing only a live run knows', async () => {
    const run = await replayedRun();

    // A replay sends nothing over the network, so the account is charged nothing. The meter still reports the
    // `status.credit_count` each recorded answer carried, which is what the same plan costs live (src/cmc/mode.ts).
    expect(run.summary.credits.charged).toBeGreaterThan(0);
    expect(run.summary.credits.requests).toBeGreaterThan(0);
    // Pacing and the account-wide counter belong to the live run alone: a replay paces nothing and reads no E20.
    expect(run.pacedPerMinute).toBeNull();
    expect(run.keyBefore).toBeNull();
    expect(run.keyAfter).toBeNull();
  });
});

describe('summarize', () => {
  /** The real outcomes of the recorded panel, which every case below counts slices of. */
  async function outcomes(): Promise<AssetOutcome[]> {
    return (await replayedRun()).outcomes;
  }

  it('counts one verdict per asset and no more', async () => {
    const summary = summarize(await outcomes(), NO_CREDITS);

    const counted = VERDICTS.reduce((total, verdict) => total + summary.verdicts[verdict], 0);
    expect(counted).toBe(summary.assets);
  });

  it('reads the share at ACT against the target the specification states', async () => {
    const all = await outcomes();
    const summary = summarize(all, NO_CREDITS);

    expect(summary.targetShare).toBe(TARGET_ACT_SHARE);
    expect(summary.actShare).toBe(Math.round((summary.verdicts.ACT / all.length) * 1000) / 10);
    expect(summary.meetsTarget).toBe(summary.actShare >= TARGET_ACT_SHARE);
  });

  it('has no share and meets no target for an empty panel', () => {
    const summary = summarize([], NO_CREDITS);

    expect(summary).toMatchObject({ assets: 0, actShare: 0, meetsTarget: false });
    expect(summary.score).toMatchObject({ min: null, median: null, max: null, mean: null, unscored: 0 });
  });

  it('leaves the assets without a score out of the spread and counts them apart', async () => {
    const all = await outcomes();
    const scored = all.filter((outcome) => outcome.score !== null).map((outcome) => outcome.score ?? 0);
    const summary = summarize(all, NO_CREDITS);

    expect(summary.score.unscored).toBe(all.length - scored.length);
    if (scored.length > 0) {
      expect(summary.score.min).toBe(Math.min(...scored));
      expect(summary.score.max).toBe(Math.max(...scored));
    }
  });

  it('counts each check once per asset, across its three statuses', async () => {
    const all = await outcomes();
    const summary = summarize(all, NO_CREDITS);

    for (const stats of summary.checks) {
      expect({ id: stats.id, total: stats.evaluated + stats.notApplicable + stats.unavailable }).toEqual({
        id: stats.id,
        total: all.length,
      });
      const severities = stats.bySeverity.info + stats.bySeverity.warning + stats.bySeverity.critical;
      expect({ id: stats.id, severities }).toEqual({ id: stats.id, severities: stats.evaluated });
    }
  });

  it('gathers the reasons of the checks that did not run, most frequent first', async () => {
    const summary = summarize(await outcomes(), NO_CREDITS);

    for (const stats of summary.checks) {
      const covered = stats.reasons.reduce((total, reason) => total + reason.assets, 0);
      expect({ id: stats.id, covered }).toEqual({ id: stats.id, covered: stats.notApplicable + stats.unavailable });
      const counts = stats.reasons.map((reason) => reason.assets);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    }
  });

  it('names, for every finding it counts, exactly the assets that raised it', async () => {
    const all = await outcomes();
    const summary = summarize(all, NO_CREDITS);

    for (const finding of summary.findings) {
      const raised = all.filter((outcome) =>
        outcome.checks.some((check) => check.id === finding.checkId && check.codes.includes(finding.code)),
      );
      expect({ code: finding.code, assets: finding.assets }).toEqual({ code: finding.code, assets: raised.length });
      expect(finding.members).toHaveLength(raised.length);
    }
  });

  it('puts the worst findings first, then the most frequent', async () => {
    const summary = summarize(await outcomes(), NO_CREDITS);
    const rank = { critical: 0, warning: 1, info: 2 };

    const ranks = summary.findings.map((finding) => rank[finding.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('spreads the coverage over the counts the panel actually showed', async () => {
    const all = await outcomes();
    const summary = summarize(all, NO_CREDITS);

    expect(summary.coverage.byCount.reduce((total, count) => total + count.assets, 0)).toBe(all.length);
    expect(summary.coverage.min).toBe(Math.min(...all.map((outcome) => outcome.evaluated)));
    expect(summary.coverage.max).toBe(Math.max(...all.map((outcome) => outcome.evaluated)));
  });

  it('passes the credits it is given through untouched, since they are the client meter', async () => {
    const summary = summarize(await outcomes(), { charged: 251, unconfirmed: 2, requests: 253, byEndpoint: { E02: 50 } });

    expect(summary.credits).toEqual({ charged: 251, unconfirmed: 2, requests: 253, byEndpoint: { E02: 50 } });
  });
});
