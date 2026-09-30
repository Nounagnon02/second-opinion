/**
 * The `audit` command (T6.1): acceptance criterion 6 of the specification, "`docs/API_AUDIT.md` holds at least
 * one real finding, proved by a fixture, worded with tact; if no real inconsistency is found, the report says so
 * honestly and presents the measurements it made".
 *
 * The property that makes the command usable at all is tested first: it reads the answers already recorded and
 * sends nothing, so it needs no key, spends no credit, and gives the same numbers on a clone. Then the rule the
 * criterion rests on — every entry opens on a file that is in the repository — is checked by opening them.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditReport, auditSummaryLine, serializeAuditRun } from '../src/audit/report.js';
import type { AuditRun } from '../src/audit/run.js';
import { parseAuditArgs, runAuditCommand, type AuditArgs } from '../src/cli/audit.js';
import { DEFAULT_FIXTURE_DIR, PROJECT_ROOT } from '../src/cmc/config.js';
import { NETWORK_DISABLED } from './setup/no-network.js';

const scratches: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-audit-cli-'));
  scratches.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The arguments of a run over the recorded corpus, with the slow engine pass off unless a case asks for it. */
function args(parts: Partial<AuditArgs> = {}): AuditArgs {
  return { write: false, json: false, sample: false, size: null, fixtures: DEFAULT_FIXTURE_DIR, ...parts };
}

/** The run of a command that was expected to produce one. */
function runOf(result: { run: AuditRun | null }): AuditRun {
  const { run } = result;
  if (run === null) throw new Error('the command produced no run');
  return run;
}

describe('parseAuditArgs', () => {
  it('reads the corpus and prints the report by default', () => {
    expect(parseAuditArgs([])).toEqual({
      write: false,
      json: false,
      sample: true,
      size: null,
      fixtures: DEFAULT_FIXTURE_DIR,
    });
  });

  it('reads every flag the command documents', () => {
    expect(parseAuditArgs(['--write', '--json', '--no-sample', '--size=3', '--fixtures=elsewhere'], '/tmp')).toEqual({
      write: true,
      json: true,
      sample: false,
      size: 3,
      fixtures: resolve('/tmp', 'elsewhere'),
    });
  });

  it('refuses a size that is not a whole number above 0', () => {
    expect(() => parseAuditArgs(['--size=0'])).toThrow(/whole number above 0/);
    expect(() => parseAuditArgs(['--size=two'])).toThrow(/whole number above 0/);
  });

  it('refuses an empty fixture directory, an unknown option and a stray argument', () => {
    expect(() => parseAuditArgs(['--fixtures='])).toThrow(/directory is empty/);
    expect(() => parseAuditArgs(['--everything'])).toThrow(/Unknown option/);
    expect(() => parseAuditArgs(['PAXG'])).toThrow(/Unexpected argument/);
  });
});

describe('runAuditCommand over the recorded corpus', () => {
  it('runs without a key and without touching the network', async () => {
    await expect(fetch('https://pro-api.coinmarketcap.com/v1/key/info')).rejects.toThrow(NETWORK_DISABLED);
    const result = await runAuditCommand(args());
    expect(result.ok).toBe(true);
    expect(runOf(result).totals.creditsSpent).toBe(0);
  });

  it('reads every complete capture and no partial one', async () => {
    const run = runOf(await runAuditCommand(args()));
    expect(run.corpus.parts.map((part) => part.name)).toEqual([
      'discovery',
      'rwa-index',
      'check',
      'demo',
      'calibration',
    ]);
    // The two abandoned calibration walks sit in the repository and are deliberately not read (D14).
    for (const part of run.corpus.parts) expect(part.dir).not.toBe('fixtures/calibration');
  });

  it('finds every file under those captures to be a recorded exchange', async () => {
    const run = runOf(await runAuditCommand(args()));
    expect(run.corpus.skipped).toEqual([]);
    expect(run.totals.answers).toBeGreaterThan(300);
  });

  it('produces at least one entry, and every entry opens on a file of this repository', async () => {
    const run = runOf(await runAuditCommand(args()));
    expect(run.findings.length).toBeGreaterThan(0);
    for (const finding of run.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      for (const evidence of finding.evidence) {
        expect(evidence.file).toMatch(/^fixtures\//);
        expect(() => readFileSync(join(PROJECT_ROOT, evidence.file), 'utf8')).not.toThrow();
      }
    }
  });

  it('says how many statements it withheld rather than shortening itself quietly', async () => {
    const run = runOf(await runAuditCommand(args()));
    expect(run.withheld).toBeGreaterThanOrEqual(0);
    expect(auditSummaryLine(run)).toContain('withheld for want of evidence');
  });

  it('prints the report when neither --json nor --write is given', async () => {
    const result = await runAuditCommand(args());
    expect(result.lines[0]).toBe('# API audit — what the recorded answers show');
    expect(result.lines).toEqual(auditReport(runOf(result)));
  });

  it('prints the whole run as JSON with --json', async () => {
    const result = await runAuditCommand(args({ json: true }));
    expect(result.lines).toHaveLength(1);
    expect(JSON.parse(result.lines[0] ?? '')).toEqual(JSON.parse(serializeAuditRun(runOf(result))));
  });

  it('writes the two files with --write and names them', async () => {
    const dir = scratch();
    const files = { report: join(dir, 'API_AUDIT.md'), run: join(dir, 'api_audit.json') };
    const result = await runAuditCommand(args({ write: true }), { files });
    const run = runOf(result);
    expect(result.lines[0]).toBe(`Written: ${files.report}`);
    expect(result.lines[1]).toBe(`Written: ${files.run}`);
    expect(readFileSync(files.report, 'utf8')).toBe(`${auditReport(run).join('\n')}\n`);
    expect(JSON.parse(readFileSync(files.run, 'utf8'))).toEqual(JSON.parse(serializeAuditRun(run)));
  });

  it('reports a corpus that is not there rather than throwing', async () => {
    const result = await runAuditCommand(args({ fixtures: join(scratch(), 'nowhere') }));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('capture directory not found');
  });
});

describe('the engine pass over the sample', () => {
  it('assesses the recorded panel offline and aggregates C3, C6 and C7', async () => {
    const { sample } = runOf(await runAuditCommand(args({ sample: true })));
    expect(sample?.assets).toBe(50);
    expect(sample?.checks.map((stats) => stats.id)).toEqual(['C3', 'C6', 'C7']);
    // Those three read what every asset has, so they run on every asset of the panel.
    for (const stats of sample?.checks ?? []) expect(stats.evaluated).toBe(sample?.assets);
  }, 120_000);

  it('counts one asset once, however many findings its checks raised on it', async () => {
    const { sample } = runOf(await runAuditCommand(args({ sample: true })));
    expect(sample?.findings.length).toBeGreaterThan(0);
    for (const finding of sample?.findings ?? []) {
      expect(new Set(finding.members).size).toBe(finding.members.length);
      expect(finding.assets).toBe(finding.members.length);
      expect(finding.assets).toBeLessThanOrEqual(sample?.assets ?? 0);
    }
  }, 120_000);

  it('assesses only the assets asked for with --size', async () => {
    const { sample } = runOf(await runAuditCommand(args({ sample: true, size: 50 })));
    expect(sample?.assets).toBe(50);
  }, 120_000);
});
