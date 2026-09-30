/**
 * What a page shows (T7.1): the verdict, the seven checks with the reason each gave, and the answers behind
 * them.
 *
 * Every case runs on the answers the live `check` runs of 2026-09-25 recorded into `fixtures/check` — PAXG, a
 * tokenised wrapper that goes through the whole plan of D1, and BTC, a coin whose checks mostly cannot run — so
 * that what is asserted here is what a browser would have been shown for a real asset.
 *
 * No threshold is written down here: the limits come from `config/checks.json`.
 */
import { describe, expect, it } from 'vitest';
import { assessAsset, parseSubject } from '../src/checks/assess.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS, type CheckId } from '../src/checks/model.js';
import { formatValue } from '../src/checks/units.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { assetAnswer, type AssetAnswer } from '../src/mcp/tools.js';
import { VERDICT_LABEL, VERDICTS } from '../src/score/verdict.js';
import { assetView, checkTone, SEVERITY_TONE, STATUS_LABEL, TONES, VERDICT_TONE, viewTitle } from '../src/web/view.js';
import { CHECK_FIXTURES, paxosIndex } from './helpers/check-fixtures.js';

const config = loadChecksConfig();

async function answerFor(named: string): Promise<AssetAnswer> {
  const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
  const assessment = await assessAsset(client, parseSubject(named), { config, wrapperIndex: paxosIndex() });
  return assetAnswer(assessment, CHECK_IDS);
}

const paxg = await answerFor('PAXG');
const btc = await answerFor('BTC');

describe('the tones a page colours', () => {
  it('gives every verdict and every severity one of the four', () => {
    for (const verdict of VERDICTS) expect(TONES).toContain(VERDICT_TONE[verdict]);
    for (const severity of ['info', 'warning', 'critical'] as const) expect(TONES).toContain(SEVERITY_TONE[severity]);
  });

  it('colours a check that did not run neither good nor bad', () => {
    expect(checkTone({ status: 'not_applicable', severity: null })).toBe('idle');
    expect(checkTone({ status: 'unavailable', severity: null })).toBe('idle');
    // A stale reading is a caution wherever it appears, badge or dot.
    expect(checkTone({ status: 'evaluated', severity: 'warning' })).toBe('caution');
    expect(checkTone({ status: 'evaluated', severity: 'critical' })).toBe('stop');
  });
});

describe('the title of a page', () => {
  it('names the asset the way the answers did', () => {
    expect(viewTitle(paxg)).toBe('PAXG — PAX Gold — CMC 4705');
  });

  it('falls back to what the visitor typed when no endpoint settled on an asset', () => {
    expect(viewTitle({ ...paxg, resolved: null })).toBe(paxg.asked);
    expect(viewTitle({ ...paxg, resolved: { cmcId: null, symbol: null, name: null } })).toBe(paxg.asked);
  });
});

describe('assetView, on the recorded PAXG run', () => {
  const view = assetView(paxg, config);

  it('carries the verdict, spelt out, with the tone that goes with it', () => {
    expect(view.verdict).toBe(paxg.verdict);
    expect(view.verdictLabel).toBe(VERDICT_LABEL[paxg.verdict]);
    expect(view.tone).toBe(VERDICT_TONE[paxg.verdict]);
  });

  it('writes the score the way every other output writes it', () => {
    expect(paxg.score).not.toBeNull();
    expect(view.scoreLabel).toBe(`${String(paxg.score ?? 0)} / 100`);
    expect(view.coverage).toBe(paxg.coverage.label);
    expect(view.summary).toBe(paxg.summary);
  });

  it('shows all seven checks, in the order the engine runs them', () => {
    expect(view.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
  });

  it('joins each check to what it measures and the limits it read', () => {
    const c5 = view.checks.find((check) => check.id === 'C5');
    expect(c5?.what).toContain('wrapper');
    expect(c5?.why).not.toBe('');
    expect(c5?.endpoints).toContain('E14');
    // Every limit is written with its unit, never as a bare number.
    expect(c5?.thresholds.some((line) => line.includes('C5.warnPremiumPercent') && line.includes('%'))).toBe(true);
  });

  it('writes every measured value in the unit it was measured in', () => {
    const measurements = view.checks.flatMap((check) => check.measurements);
    expect(measurements.length).toBeGreaterThan(0);
    for (const measurement of measurements) {
      expect(measurement.value).not.toMatch(/^-?\d+(\.\d+)?$/);
    }
    const c3 = view.checks.find((check) => check.id === 'C3');
    const first = c3?.measurements[0];
    expect(first).toBeDefined();
    expect(first?.value).toBe(
      formatValue(
        paxg.checks.find((check) => check.id === 'C3')?.measurements?.[0]?.value ?? null,
        paxg.checks.find((check) => check.id === 'C3')?.measurements?.[0]?.unit ?? 'count',
      ),
    );
  });

  it('separates the checks that raised something from the ones that did not run', () => {
    const raised: CheckId[] = view.raised.map((check) => check.id);
    for (const check of view.raised) expect(check.findings.length).toBeGreaterThan(0);
    for (const check of view.notRun) {
      expect(check.scored).toBe(false);
      expect(check.reason).not.toBeNull();
      expect(raised).not.toContain(check.id);
    }
    // Coverage and the list of checks that did not run are two readings of the same fact.
    expect(view.checks.length - view.notRun.length).toBe(paxg.coverage.evaluated);
  });

  it('names every answer the verdict was read from, and says how many were replayed', () => {
    expect(view.evidence.length).toBe(paxg.evidence.length);
    expect(view.evidence.every((source) => source.fixture !== null)).toBe(true);
    expect(view.recordedCount).toBe(view.evidence.length);
    for (const source of view.evidence) {
      expect(source.origin).toBe('recorded');
      expect(source.label).toBe(`${source.endpoint} ${source.path}`);
      expect(source.observedAt).not.toBe('');
    }
  });

  it('carries what the run cost and how long it took', () => {
    expect(view.credits).toEqual(paxg.credits);
    expect(view.elapsedMs).toBe(paxg.elapsedMs);
  });
});

describe('assetView, on the recorded BTC run', () => {
  const view = assetView(btc, config);

  it('shows the checks a coin cannot have, with the reason each gave (D9)', () => {
    expect(view.notRun.length).toBeGreaterThan(0);
    for (const check of view.notRun) {
      expect(check.tone).toBe('idle');
      expect(check.statusLabel).toBe(STATUS_LABEL[check.status]);
      expect(check.reason).toBeTruthy();
    }
    const c1 = view.checks.find((check) => check.id === 'C1');
    expect(c1?.status).toBe('not_applicable');
    expect(c1?.statusLabel).toBe('not applicable to this asset');
  });

  it('still shows all seven, so a reader never sees a shortened engine', () => {
    expect(view.checks).toHaveLength(CHECK_IDS.length);
  });
});

describe('assetView, on a run that measured nothing', () => {
  it('says there is no score rather than printing a zero (D11)', () => {
    const view = assetView(
      { ...paxg, score: null, verdict: 'DO_NOT_ACT', severity: null },
      config,
    );
    expect(view.scoreLabel).toContain('no score');
    expect(view.scoreLabel).not.toMatch(/\b0\b/);
    expect(view.tone).toBe('stop');
  });
});
