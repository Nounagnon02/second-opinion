import { describe, expect, it } from 'vitest';
import { runCexDivergenceCheck } from '../src/checks/c2-cex-divergence.js';
import { datedPrices, runFreshnessCheck } from '../src/checks/c3-freshness.js';
import { runSchemaCheck, schemaInput } from '../src/checks/c7-schema.js';
import { loadChecksConfig, type ScoreConfig } from '../src/checks/config.js';
import {
  CHECK_IDS,
  evaluated,
  evidence,
  notApplicable,
  unavailable,
  type CheckId,
  type CheckResult,
  type Finding,
  type Severity,
} from '../src/checks/model.js';
import { CmcError } from '../src/cmc/errors.js';
import { priceObservations } from '../src/normalize/index.js';
import { sourceRef } from '../src/normalize/model.js';
import {
  checksThatDidNotRun,
  coverageOf,
  formatScore,
  scoreChecks,
  verdictOf,
  VERDICT_LABEL,
  VERDICTS,
  worstVerdict,
} from '../src/score/index.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C3, C7, score: SCORE } = loadChecksConfig();

const source = sourceRef(recordedSource('E02', 'E02-quotes-latest-btc-paxg'));

/** A check that ran and raised the given severities; `info` means it ran and raised nothing. */
function ran(id: CheckId, ...severities: Severity[]): CheckResult {
  const findings: Finding[] = severities
    .filter((severity) => severity !== 'info')
    .map((severity) => ({
      code: 'example',
      severity,
      message: `${severity} raised by ${id}`,
      measurement: null,
      evidence: [evidence(source)],
    }));
  return evaluated(id, { findings, measurements: [], sources: [source] });
}

/** A full run: every check that is not named is reported as one this asset cannot have, never left out (D9). */
function run(evaluatedChecks: Partial<Record<CheckId, CheckResult>>): CheckResult[] {
  return CHECK_IDS.map((id) => evaluatedChecks[id] ?? notApplicable(id, `${id} has no source for this asset.`));
}

/** The shipped weights with one setting replaced, to see what a different calibration would give. */
function tuned(edit: Partial<ScoreConfig>): ScoreConfig {
  return { ...SCORE, ...edit };
}

describe('how the score weighs the checks', () => {
  it('scores a run where every check ran and raised nothing at 100, with full coverage', () => {
    const result = scoreChecks(
      CHECK_IDS.map((id) => ran(id)),
      SCORE,
    );
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('ACT');
    expect(result.severity).toBe('info');
    expect(result.coverage).toEqual({ evaluated: 7, total: 7, label: '7 of 7 checks evaluated' });
    expect(result.worstChecks).toEqual([]);
  });

  it('renormalises over the checks that ran, so a check this asset cannot have costs it nothing (D9)', () => {
    // Only C3 and C7 ran, both clean: the five that did not run take no weight with them.
    const result = scoreChecks(run({ C3: ran('C3'), C7: ran('C7') }), SCORE);
    expect(result.score).toBe(100);
    expect(result.coverage.label).toBe('2 of 7 checks evaluated');
    const shares = new Map(result.checks.map((check) => [check.id, check.share]));
    // C3 weighs 15 and C7 weighs 5: 75 % and 25 % of a score built from those two alone.
    expect(shares.get('C3')).toBe(75);
    expect(shares.get('C7')).toBe(25);
    for (const id of ['C1', 'C2', 'C4', 'C5', 'C6'] as const) expect(shares.get(id)).toBe(0);
  });

  it('costs a warning the configured points, in proportion to the weight of the check that raised it', () => {
    // C3 weighs 15 of the 20 that ran, C7 the other 5: (15 x 100 + 5 x 50) / 20 = 87.5.
    const result = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'warning') }), SCORE);
    expect(result.score).toBe(87.5);
    expect(result.checks.find((check) => check.id === 'C7')?.points).toBe(SCORE.severityPoints.warning);
    expect(result.checks.find((check) => check.id === 'C3')?.points).toBe(100);
  });

  it('reads a check on its worst finding alone: a second warning on it costs no more', () => {
    const one = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'warning') }), SCORE);
    const three = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'warning', 'warning', 'info') }), SCORE);
    expect(three.score).toBe(one.score);
    expect(three.checks.find((check) => check.id === 'C7')?.severity).toBe('warning');
  });

  it('names every check carrying the worst severity, in the order of the engine', () => {
    const result = scoreChecks(run({ C1: ran('C1', 'warning'), C3: ran('C3', 'warning'), C7: ran('C7') }), SCORE);
    expect(result.severity).toBe('warning');
    expect(result.worstChecks).toEqual(['C1', 'C3']);
    expect(result.summary).toContain('worst observation a warning from C1 and C3');
  });

  it('keeps every check in the result, with the reason the ones that did not run gave', () => {
    const result = scoreChecks(run({ C3: ran('C3') }), SCORE);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    const missing = checksThatDidNotRun(result);
    expect(missing).toHaveLength(6);
    for (const check of missing) {
      expect(check.points, check.id).toBeNull();
      expect(check.severity, check.id).toBeNull();
      expect(check.reason, check.id).toBeTruthy();
      // The weight is still shown: what a check would have counted for is part of reading the coverage.
      expect(check.weight, check.id).toBeGreaterThan(0);
    }
  });

  it('gives every check the weight the configuration gives it, and the title the engine gave it', () => {
    const results = CHECK_IDS.map((id) => ran(id));
    const titles = new Map(results.map((result) => [result.id, result.title]));
    const scored = scoreChecks(results, SCORE);
    for (const check of scored.checks) {
      expect(check.weight, check.id).toBe(SCORE.weights[check.id]);
      expect(check.title, check.id).toBe(titles.get(check.id));
      expect(check.share, check.id).toBeGreaterThan(0);
    }
  });
});

describe('the verdict', () => {
  it('uses the three answers and the two boundaries of the specification (F5)', () => {
    expect([...VERDICTS]).toEqual(['ACT', 'CAUTION', 'DO_NOT_ACT']);
    expect(Object.keys(VERDICT_LABEL).sort()).toEqual([...VERDICTS].sort());
    expect(SCORE.actAtOrAbove).toBe(75);
    expect(SCORE.cautionAtOrAbove).toBe(40);
  });

  it('puts each boundary on the score that reaches it, not the one above', () => {
    expect(verdictOf(75, 'info', SCORE)).toBe('ACT');
    expect(verdictOf(74.9, 'info', SCORE)).toBe('CAUTION');
    expect(verdictOf(40, 'info', SCORE)).toBe('CAUTION');
    expect(verdictOf(39.9, 'info', SCORE)).toBe('DO_NOT_ACT');
    expect(verdictOf(0, 'info', SCORE)).toBe('DO_NOT_ACT');
    expect(verdictOf(100, 'info', SCORE)).toBe('ACT');
  });

  it('judges the number it prints: the score is rounded once, then read', () => {
    // C1 weighs 20 and C3 15: (20 x 100 + 15 x 50) / 35 = 78.571..., shown and judged as 78.6.
    const result = scoreChecks(run({ C1: ran('C1'), C3: ran('C3', 'warning') }), SCORE);
    expect(result.score).toBe(78.6);
    expect(result.summary).toContain('78.6 out of 100');
    expect(formatScore(78.6)).toBe('78.6');
    expect(formatScore(100)).toBe('100');
  });

  it('holds a run carrying a critical finding at CAUTION, whatever the weighted mean says (D11)', () => {
    // C3 clean weighs 15 against the 5 of C7: the mean alone is (15 x 100 + 5 x 0) / 20 = 75, the ACT boundary.
    const result = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'critical') }), SCORE);
    expect(result.score).toBe(75);
    expect(verdictOf(75, 'info', SCORE)).toBe('ACT');
    expect(result.verdict).toBe('CAUTION');
    expect(SCORE.capWithCritical).toBe('CAUTION');
  });

  it('never raises a verdict: a critical finding on a low score stays DO_NOT_ACT', () => {
    const result = scoreChecks(run({ C3: ran('C3', 'critical'), C7: ran('C7', 'critical') }), SCORE);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('DO_NOT_ACT');
    expect(worstVerdict('DO_NOT_ACT', 'CAUTION')).toBe('DO_NOT_ACT');
    expect(worstVerdict('ACT', 'CAUTION')).toBe('CAUTION');
  });

  it('leaves the score alone to decide when the cap is switched off', () => {
    const uncapped = tuned({ capWithCritical: null });
    const result = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'critical') }), uncapped);
    expect(result.score).toBe(75);
    expect(result.verdict).toBe('ACT');
  });

  it('does not hold back a run whose worst observation is a warning', () => {
    const result = scoreChecks(run({ C3: ran('C3'), C7: ran('C7', 'warning') }), SCORE);
    expect(result.severity).toBe('warning');
    expect(result.verdict).toBe('ACT');
  });
});

describe('a run where nothing could be measured (D11)', () => {
  const result = scoreChecks(run({}), SCORE);

  it('has no score rather than a perfect one', () => {
    expect(result.score).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.coverage).toEqual({ evaluated: 0, total: 7, label: '0 of 7 checks evaluated' });
  });

  it('answers DO_NOT_ACT and says that nothing was measured, rather than naming a fault', () => {
    expect(result.verdict).toBe('DO_NOT_ACT');
    expect(result.summary).toContain('no check could be evaluated for this asset');
    expect(result.summary).toContain('0 of 7 checks evaluated');
    expect(result.summary).toContain('nothing measured');
    expect(result.summary).not.toMatch(/wrong|bad|fail|incorrect/i);
  });

  it('gives every check a share of nothing, and keeps its reason', () => {
    expect(checksThatDidNotRun(result)).toHaveLength(7);
    for (const check of result.checks) expect(check.share, check.id).toBe(0);
  });
});

describe('what the score refuses to guess', () => {
  it('refuses a run missing a check rather than renormalising around its absence (D9)', () => {
    const partial = run({ C3: ran('C3') }).filter((check) => check.id !== 'C5');
    expect(() => scoreChecks(partial, SCORE)).toThrow(CmcError);
    expect(() => scoreChecks(partial, SCORE)).toThrow(/no result for C5/);
    expect(() => scoreChecks(partial, SCORE)).toThrow(/never left out \(D9\)/);
  });

  it('refuses the same check twice, which would weigh one measurement two times', () => {
    expect(() => scoreChecks([...run({}), ran('C3')], SCORE)).toThrow(/C3 twice/);
  });
});

describe('the coverage sentence D9 asks every output to carry', () => {
  it('reads as a count of what ran, out of the whole engine', () => {
    expect(coverageOf(3, 7).label).toBe('3 of 7 checks evaluated');
    expect(coverageOf(0, 7).label).toBe('0 of 7 checks evaluated');
  });
});

describe('on the recorded answers', () => {
  /** The PAXG checks a run can make from the fixtures in the repository, with the rest reported as unrunnable. */
  function recordedRun(prices: ReturnType<typeof priceObservations>): CheckResult[] {
    return run({
      C2: runCexDivergenceCheck(),
      C3: runFreshnessCheck(datedPrices(prices.items), C3),
      C7: runSchemaCheck([schemaInput(prices)], C7),
    });
  }

  it('scores the recorded E02 answer, read through the checks rather than a hand-written result', () => {
    const prices = priceObservations(recordedSource('E02', 'E02-quotes-latest-btc-paxg'));
    const result = scoreChecks(recordedRun(prices), SCORE);
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('ACT');
    // C2 is unavailable with this key (D2), so it weighs nothing even though it has the same weight as C1.
    expect(result.coverage.label).toBe('2 of 7 checks evaluated');
    const c2 = result.checks.find((check) => check.id === 'C2');
    expect(c2?.status).toBe('unavailable');
    expect(c2?.points).toBeNull();
    expect(c2?.reason).toContain('not available with the current API plan');
  });

  it('holds the same answer at CAUTION once its price can no longer be read (D11)', () => {
    const broken = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      // The price C7 calls critical, removed from the first asset of a real answer; nothing else is touched.
      const first = (data as { quote: { price: number | null }[] }[])[0];
      if (first?.quote[0]) first.quote[0].price = null;
    });
    const result = scoreChecks(recordedRun(priceObservations(broken)), SCORE);
    expect(result.checks.find((check) => check.id === 'C7')?.severity).toBe('critical');
    expect(result.verdict).toBe('CAUTION');
    expect(result.summary).toContain('worst observation a critical from C7');
  });

  it('answers DO_NOT_ACT for an asset none of the recorded checks can read', () => {
    const result = scoreChecks(
      run({ C2: runCexDivergenceCheck(), C3: runFreshnessCheck([], C3), C7: runSchemaCheck([], C7) }),
      SCORE,
    );
    expect(result.coverage.evaluated).toBe(0);
    expect(result.score).toBeNull();
    expect(result.verdict).toBe('DO_NOT_ACT');
    expect(result.checks.find((check) => check.id === 'C3')?.status).toBe('not_applicable');
  });

  it('keeps a check whose call failed out of the score, with the failure as its reason', () => {
    const failed = unavailable('C1', 'timeout: E10 did not answer within 8000 ms.');
    const result = scoreChecks(run({ C1: failed, C3: ran('C3') }), SCORE);
    expect(result.score).toBe(100);
    expect(result.coverage.evaluated).toBe(1);
    expect(result.checks.find((check) => check.id === 'C1')?.reason).toContain('timeout');
  });
});
