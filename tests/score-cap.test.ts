/**
 * The verdict cap of D11, exercised on a whole run rather than on hand-made check results: a `critical` finding
 * holds the verdict at `CAUTION`, however high the weighted mean of the checks that ran lands.
 *
 * T4.2 is the reason this case is written down on its own. Calibrating C7 against the panel of the top 50 made the
 * severities endpoint-aware (D12): a price that could not be read on a DEX venue is a `warning`, because C1 and C4
 * already report that same loss in their own words, while a price that could not be read on the aggregated
 * endpoint stays `critical` — it is the price a trade would rest on, and nothing else measures its absence. That
 * distinction is what brought AVAX and TAO back to `ACT` on the panel, and it is also the one change that could
 * switch the cap off without any test going red: widen the DEX exception to E02 and a run with no aggregated price
 * at all reaches `ACT` on the strength of the checks that did run, which is the outcome this tool exists to
 * prevent.
 *
 * Both sides are exercised end to end, on the PAXG run recorded live in T3.7, replayed with fields removed from one
 * recorded answer and nothing else touched. No CMC body is written by hand: where a whole venue reading is lost, the
 * answer is reduced to the fields a real one carried — TAO's E10 answer on the panel, which came back holding `pid`,
 * `pdex` and `a` and nothing else (`fixtures/calibration/live-20260926T1044Z/E10-ccb0832a-20260926T104826027Z.json`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessAsset, parseSubject, type AssetAssessment } from '../src/checks/assess.js';
import { loadChecksConfig } from '../src/checks/config.js';
import type { CheckId, CheckResult } from '../src/checks/model.js';
import type { EndpointId } from '../src/cmc/endpoints.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { scoreChecks, verdictOf } from '../src/score/index.js';
import { copyCheckFixturesEditing, PAXG_ID, paxosIndex } from './helpers/check-fixtures.js';

const { score: SCORE } = loadChecksConfig();

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-cap-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The USD quote of a recorded E02 answer: where the aggregated price a trade would rest on is read. */
function usdQuote(body: Record<string, unknown>): Record<string, unknown> {
  const [asset] = body.data as Record<string, unknown>[];
  if (asset === undefined) throw new Error('the recorded E02 answer carries no asset.');
  const quotes = asset.quote as Record<string, unknown>[];
  const usd = quotes.find((quote) => quote.symbol === 'USD');
  if (usd === undefined) throw new Error('the recorded E02 answer carries no USD quote.');
  return usd;
}

/** The recorded PAXG run, replayed with the price removed from every answer of `endpoint`. */
async function assessWithoutPriceOn(endpoint: EndpointId, field: string): Promise<AssetAssessment> {
  const dir = scratch();
  const edited = copyCheckFixturesEditing(dir, endpoint, (body) => {
    if (endpoint === 'E02') delete usdQuote(body)[field];
    else delete (body.data as Record<string, unknown>)[field];
  });
  expect(edited, `recorded ${endpoint} answers edited`).toBeGreaterThan(0);
  const client = createClientForMode({ kind: 'replay', dir }, {});
  return assessAsset(client, parseSubject(String(PAXG_ID)), { wrapperIndex: paxosIndex() });
}

/** What TAO's recorded E10 answer carried on the panel: the venue and its address, and no reading at all. */
const TAO_E10_FIELDS = ['pid', 'pdex', 'a'];

/**
 * The recorded PAXG run, replayed with its E10 answer reduced to that shape — the whole venue reading lost at once,
 * rather than the price alone.
 */
async function assessWithVenueReadingLost(): Promise<AssetAssessment> {
  const dir = scratch();
  const edited = copyCheckFixturesEditing(dir, 'E10', (body) => {
    const data = body.data as Record<string, unknown>;
    for (const field of Object.keys(data)) {
      if (!TAO_E10_FIELDS.includes(field)) delete data[field];
    }
  });
  expect(edited, 'recorded E10 answers edited').toBeGreaterThan(0);
  const client = createClientForMode({ kind: 'replay', dir }, {});
  return assessAsset(client, parseSubject(String(PAXG_ID)), { wrapperIndex: paxosIndex() });
}

function checkOf(assessment: AssetAssessment, id: CheckId): CheckResult {
  const result = assessment.checks.find((check) => check.id === id);
  if (result === undefined) throw new Error(`${id} is missing from the run.`);
  return result;
}

describe('a run whose aggregated price could not be read', () => {
  it('reports the loss as critical, names the answer it read, and is held at CAUTION above the ACT boundary', async () => {
    const assessment = await assessWithoutPriceOn('E02', 'price');
    const c7 = checkOf(assessment, 'C7');
    const { score, verdict } = assessment.score;

    expect(c7.severity).toBe('critical');
    expect(c7.findings.map((finding) => finding.code)).toContain('unreadable_field');
    expect(c7.findings.some((finding) => finding.message.includes('E02'))).toBe(true);
    // The checks that could still run leave the mean above the ACT boundary; the cap is what holds the verdict.
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(SCORE.actAtOrAbove);
    expect(verdictOf(score, 'info', SCORE)).toBe('ACT');
    expect(verdict).toBe('CAUTION');
  });

  it('would reach ACT with no price behind it if the cap were switched off, which is why it is kept (D11)', async () => {
    const assessment = await assessWithoutPriceOn('E02', 'price');

    const uncapped = scoreChecks(assessment.checks, { ...SCORE, capWithCritical: null });

    expect(uncapped.score).toBe(assessment.score.score);
    expect(uncapped.verdict).toBe('ACT');
  });
});

describe('a run whose DEX price could not be read (D12)', () => {
  it('reports the loss as a warning, because C1 already says what it cost, and is not capped', async () => {
    const assessment = await assessWithoutPriceOn('E10', 'p');
    const c7 = checkOf(assessment, 'C7');

    expect(c7.severity).toBe('warning');
    expect(c7.findings.some((finding) => finding.message.includes('E10'))).toBe(true);
    // The same loss, in the words of the check that needed the value: it is not hidden by the lighter severity.
    expect(checkOf(assessment, 'C1').findings.map((finding) => finding.code)).toContain('gap_unknown');
    // The depth behind the price was still readable, and C4 still measured it: only what rested on `p` is gone.
    expect(checkOf(assessment, 'C4').status).toBe('evaluated');
    expect(checkOf(assessment, 'C4').severity).toBe('info');
    expect(assessment.score.verdict).toBe('ACT');
  });

  it('leaves each check that needed the venue saying so in its own words when the whole reading is lost', async () => {
    const assessment = await assessWithVenueReadingLost();
    const c7 = checkOf(assessment, 'C7');

    // The shape TAO came back with on the panel: no price, no timestamp, no liquidity, no volume. Three checks lose
    // a measurement and each reports it; C7 raises one warning per field and no critical, so nothing is capped.
    expect(checkOf(assessment, 'C1').findings.map((finding) => finding.code)).toContain('gap_unknown');
    expect(checkOf(assessment, 'C3').findings.map((finding) => finding.code)).toContain('age_unknown');
    expect(checkOf(assessment, 'C4').findings.map((finding) => finding.code)).toContain('liquidity_unknown');
    expect(c7.severity).toBe('warning');
    expect(c7.findings.length).toBeGreaterThan(1);
    expect(c7.findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(assessment.score.verdict).toBe('ACT');
  });

  it('keeps the aggregated endpoints out of that exception, so only a venue price is lightened', () => {
    const { severityByField } = loadChecksConfig().C7;

    for (const endpoint of ['E08', 'E09', 'E10', 'E11']) {
      expect(severityByField[`${endpoint} price`], `${endpoint} price`).toBe('warning');
      expect(severityByField[`${endpoint} p`], `${endpoint} p`).toBe('warning');
    }
    for (const endpoint of ['E02', 'E03', 'E06', 'E07', 'E14']) {
      expect(severityByField[`${endpoint} price`], `${endpoint} price`).toBeUndefined();
    }
    expect(severityByField.price).toBe('critical');
    expect(severityByField.p).toBe('critical');
  });
});
