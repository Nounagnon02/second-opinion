/**
 * The audit page (T7.1): the published report of F9 as a browser shows it.
 *
 * Every case reads `docs/api_audit.json`, the report `npm run audit -- --write` produced and the second read of
 * T6.2 went through. The point of the page is that it reshapes that file and computes nothing of its own, so
 * that is what these tests hold it to: each figure it shows is compared with the one in the file.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINDING_KINDS } from '../src/audit/findings.js';
import { describeMeasurement } from '../src/audit/report.js';
import type { AuditRun } from '../src/audit/run.js';
import { CmcError } from '../src/cmc/errors.js';
import { auditStats, auditView, KIND_LABEL, KIND_NOTE, loadAuditView } from '../src/web/audit-view.js';
import { DEFAULT_AUDIT_FILE } from '../src/web/settings.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const view = loadAuditView(DEFAULT_AUDIT_FILE);
const run = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;

describe('the published report is there to be shown', () => {
  it('reads it from the file docs/api_audit.json', () => {
    expect(DEFAULT_AUDIT_FILE).toBe(join(projectRoot, 'docs', 'api_audit.json'));
    expect(view).not.toBeNull();
  });
});

describe('auditView', () => {
  it('shows every published entry, in the order the report prints them', () => {
    expect(view?.findings.map((finding) => finding.id)).toEqual(run.findings.map((finding) => finding.id));
  });

  it('carries each entry whole: what was stated, the measurement, and the answers it cites', () => {
    const [first] = view?.findings ?? [];
    const [source] = run.findings;
    expect(first).toBeDefined();
    expect(source).toBeDefined();
    if (first === undefined || source === undefined) return;
    expect(first.title).toBe(source.title);
    expect(first.statement).toBe(source.statement);
    expect(first.kindLabel).toBe(KIND_LABEL[source.kind]);
    expect(first.measurement).toBe(source.measurement === null ? null : describeMeasurement(source.measurement));
    expect(first.evidence.map((evidence) => evidence.file)).toEqual(source.evidence.map((evidence) => evidence.file));
  });

  it('never shows an entry with no recorded answer behind it (F9)', () => {
    for (const finding of view?.findings ?? []) expect(finding.evidence.length).toBeGreaterThan(0);
  });

  it('counts the three kinds the way the report does', () => {
    for (const kind of FINDING_KINDS) {
      expect(view?.counts[kind]).toBe(run.findings.filter((finding) => finding.kind === kind).length);
    }
    const total = FINDING_KINDS.reduce((sum, kind) => sum + (view?.counts[kind] ?? 0), 0);
    expect(total).toBe(run.findings.length);
  });

  it('says how much was left out rather than hiding it', () => {
    expect(view?.withheld).toBe(run.withheld);
    expect(view?.unproven).toBe(run.unproven);
    expect(view?.reviewNote).toContain(run.review.claims.toLocaleString('en-US'));
  });

  it('measures nothing of its own: every figure is one the report already carries', () => {
    const stats = auditStats(run);
    const byLabel = new Map(stats.map((stat) => [stat.label, stat.value]));
    expect(byLabel.get('Recorded answers read')).toBe(run.totals.answers.toLocaleString('en-US'));
    expect(byLabel.get('Endpoints covered')).toBe(run.totals.endpoints.toLocaleString('en-US'));
    // The audit sends no request, which is the point of D14 and the first thing this page should say.
    expect(byLabel.get('Credits this report spent')).toBe('0');
    expect(run.totals.creditsSpent).toBe(0);
    expect(byLabel.get('Claims checked against their evidence')).toBe(run.review.claims.toLocaleString('en-US'));
  });

  it('explains the three kinds without naming a cause', () => {
    for (const kind of FINDING_KINDS) {
      expect(KIND_NOTE[kind]).not.toBe('');
      expect(KIND_NOTE[kind].toLowerCase()).not.toMatch(/\bwrong\b|\bbroken\b|\bfault\b/);
    }
  });
});

describe('auditView reads the same file loadAuditView does', () => {
  it('builds the same page from the parsed report', () => {
    expect(auditView(run)).toEqual(view);
  });
});

describe('a deployment without a report', () => {
  it('says there is none rather than failing', () => {
    expect(loadAuditView(join(tmpdir(), 'there-is-no-audit-report-here.json'))).toBeNull();
  });

  it('refuses a file that is not a report, naming it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'so-audit-')), 'api_audit.json');
    writeFileSync(file, '{"hello":"world"}\n');
    expect(() => loadAuditView(file)).toThrow(CmcError);
    expect(() => loadAuditView(file)).toThrow(/npm run audit/);
  });

  it('refuses a file that is not JSON at all', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'so-audit-')), 'api_audit.json');
    writeFileSync(file, 'not json\n');
    expect(() => loadAuditView(file)).toThrow(/not readable JSON/);
  });
});
