/**
 * The two files the audit leaves in `docs/` (T6.1, T6.2).
 *
 * The report says of itself that it is generated and never edited by hand, and the whole of acceptance
 * criterion 6 rests on that: a reader who cannot reproduce the file has only this project's word for what it
 * says. So the committed files are compared with what a fresh run produces, which is the same standard T6.2
 * applies to the entries — a statement about oneself is checked, not promised.
 *
 * The run stamps its own wall clock, so the two timestamps of `docs/api_audit.json` are the one thing allowed to
 * differ; everything else, markdown included, has to come out byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeAuditReport, serializeAuditRun } from '../src/audit/report.js';
import type { AuditRun } from '../src/audit/run.js';
import { runAuditCommand, REPORT_FILE, RUN_FILE } from '../src/cli/audit.js';
import { DEFAULT_FIXTURE_DIR, PROJECT_ROOT } from '../src/cmc/config.js';

/** One full run over the recorded corpus, engine pass included: what `npm run audit -- --write` writes. */
async function fullRun(): Promise<AuditRun> {
  const { run } = await runAuditCommand({
    write: false,
    json: false,
    sample: true,
    size: null,
    fixtures: DEFAULT_FIXTURE_DIR,
  });
  if (run === null) throw new Error('the audit produced no run');
  return run;
}

/** The run with its wall clock taken out: the only part of the file a second run is allowed to change. */
function withoutClock(json: string): unknown {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return { ...parsed, startedAt: 'stamped', finishedAt: 'stamped' };
}

describe('the committed audit deliverables', () => {
  it('holds docs/API_AUDIT.md exactly as a fresh run writes it', async () => {
    const run = await fullRun();
    expect(serializeAuditReport(run)).toBe(readFileSync(REPORT_FILE, 'utf8'));
  }, 120_000);

  it('holds docs/api_audit.json exactly as a fresh run writes it, but for the wall clock', async () => {
    const run = await fullRun();
    expect(withoutClock(serializeAuditRun(run))).toEqual(withoutClock(readFileSync(RUN_FILE, 'utf8')));
  }, 120_000);

  it('writes them where the README and the specification say they are', () => {
    expect(REPORT_FILE).toBe(join(PROJECT_ROOT, 'docs', 'API_AUDIT.md'));
    expect(RUN_FILE).toBe(join(PROJECT_ROOT, 'docs', 'api_audit.json'));
  });
});

describe('what the published report may say', () => {
  it('prints no entry whose own evidence does not bear it out', async () => {
    const run = await fullRun();
    expect(run.review.entries).toBe(run.findings.length);
    expect(run.review.unproven).toEqual([]);
    expect(run.review.claims).toBeGreaterThan(run.findings.length);
  }, 120_000);

  it('uses no word this project undertakes not to use about the API', async () => {
    const run = await fullRun();
    expect(run.review.tone).toEqual([]);
  }, 120_000);

  it('says how many statements it withheld, and for which of the two reasons', async () => {
    const run = await fullRun();
    const report = readFileSync(REPORT_FILE, 'utf8');
    expect(report).toContain('## The second read');
    expect(report).toContain(`| Statements withheld for citing no answer (F9) | ${String(run.withheld)} |`);
    expect(report).toContain(
      `| Statements withheld because the cited answer did not show them (T6.2) | ${String(run.unproven)} |`,
    );
    expect(report).toContain(`| Statements checked against a recorded answer | ${String(run.review.claims)} |`);
  }, 120_000);

  it('keeps the promise its own preamble makes about where those counts are', () => {
    const report = readFileSync(REPORT_FILE, 'utf8');
    expect(report).toContain('Both counts of dropped statements are at\nthe end.');
    // "At the end" is checked as written: the section is the last heading of the file.
    const headings = [...report.matchAll(/^## (.+)$/gm)].map((one) => one[1]);
    expect(headings.at(-1)).toBe('The second read');
  });

  // Acceptance criterion 6 allows a report that found nothing, but not one that says nothing: whichever it is,
  // every entry printed has to open on a file that is in the repository.
  it('gives every entry of the committed report a file that exists', () => {
    const run = JSON.parse(readFileSync(RUN_FILE, 'utf8')) as AuditRun;
    expect(run.findings.length).toBeGreaterThan(0);
    for (const finding of run.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      for (const evidence of finding.evidence) {
        expect(() => readFileSync(join(PROJECT_ROOT, evidence.file), 'utf8')).not.toThrow();
      }
    }
  });
});
