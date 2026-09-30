/**
 * `docs/CALIBRATION.md` as it is rendered (T4.1): the report is the readable view of the run beside it, so what it
 * says is checked against the run it was rendered from, line by line.
 *
 * The run is the live one of 2026-09-25, replayed from `fixtures/calibration`.
 */
import { describe, expect, it } from 'vitest';
import {
  calibrationReport,
  formatElapsed,
  LISTED_MEMBERS,
  LISTED_REASONS,
  serializeReport,
  serializeRun,
  summaryLine,
} from '../src/calibration/report.js';
import { summarize, type CalibrationRun } from '../src/calibration/run.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { replayedRun } from './helpers/calibration-fixtures.js';

/** The line of a report that contains `needle`; fails loudly when none does. */
function lineWith(lines: readonly string[], needle: string): string {
  const found = lines.find((line) => line.includes(needle));
  expect(found, `no line contains "${needle}"`).toBeDefined();
  return found ?? '';
}

/** The rows of the markdown table that starts at the heading `after`. */
function tableUnder(lines: readonly string[], after: string): string[][] {
  const start = lines.findIndex((line) => line.startsWith(after));
  expect(start, `no heading "${after}"`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  // The header and its separator are not rows of data.
  return rows.slice(2);
}

describe('calibrationReport', () => {
  it('states the share at ACT and whether it reaches the target the specification requires', async () => {
    const run = await replayedRun();
    const lines = calibrationReport(run);

    const verdict = lineWith(lines, 'assets reach `ACT`');
    expect(verdict).toContain(`${String(run.summary.assets)} assets reach`);
    expect(verdict).toContain(run.summary.meetsTarget ? 'the target is met' : 'the target is **not** met');
  });

  it('gives one table row per asset of the panel, in rank order', async () => {
    const run = await replayedRun();
    const rows = tableUnder(calibrationReport(run), '## Every asset');

    expect(rows).toHaveLength(run.outcomes.length);
    expect(rows.map((row) => row[0])).toEqual(run.outcomes.map((outcome) => String(outcome.member.rank)));
  });

  it('prints, for each asset, what every one of the seven checks did', async () => {
    const run = await replayedRun();
    const rows = tableUnder(calibrationReport(run), '## Every asset');

    const [first] = rows;
    const [outcome] = run.outcomes;
    expect(first).toBeDefined();
    // Rank, asset, market cap, score, verdict, coverage, then one cell per check.
    expect(first).toHaveLength(6 + CHECK_IDS.length);
    expect(first?.[4]).toBe(outcome?.verdict);
    expect(first?.[5]).toBe(`${String(outcome?.evaluated ?? 0)}/7`);
  });

  it('gives one table row per check, counting every asset once', async () => {
    const run = await replayedRun();
    const rows = tableUnder(calibrationReport(run), '## What each check did');

    expect(rows.map((row) => row[0])).toEqual([...CHECK_IDS]);
    for (const row of rows) {
      const [, , evaluated, , , , notApplicable, unavailable] = row.map(Number);
      expect((evaluated ?? 0) + (notApplicable ?? 0) + (unavailable ?? 0)).toBe(run.outcomes.length);
    }
  });

  it('shows at most a few wordings per check and says where the rest are', async () => {
    const run = await replayedRun();
    const lines = calibrationReport(run);

    for (const stats of run.summary.checks) {
      // The whole opening of a reason line, not the check ID alone: the bullet naming the checks that ran on no
      // asset of the panel opens with that same ID and a comma when it comes first in the list
      // ("- **C2, C5 ran on no asset of this panel**"), and a prefix match would count it as a wording.
      const wording = new RegExp(`^- \\*\\*${stats.id}, (?:not applicable|unavailable) on \\d+ asset\\(s\\)\\.\\*\\* `);
      const shown = lines.filter((line) => wording.test(line));
      expect({ id: stats.id, shown: shown.length }).toEqual({
        id: stats.id,
        shown: Math.min(stats.reasons.length, LISTED_REASONS),
      });
      if (stats.reasons.length > LISTED_REASONS) {
        expect(lineWith(lines, `- **${stats.id}:**`)).toContain('docs/calibration.json');
      }
    }
  });

  it('names the assets behind each observation, up to the listed few', async () => {
    const run = await replayedRun();
    const lines = calibrationReport(run);

    for (const finding of run.summary.findings) {
      const line = lineWith(lines, `**${finding.checkId} \`${finding.code}\`**`);
      expect(line).toContain(`on ${String(finding.assets)} asset(s)`);
      for (const member of finding.members.slice(0, LISTED_MEMBERS)) expect(line).toContain(member);
      if (finding.members.length > LISTED_MEMBERS) {
        expect(line).toContain(`and ${String(finding.members.length - LISTED_MEMBERS)} more`);
      }
    }
  });

  it('says so plainly when no check raised anything, rather than printing an empty list', async () => {
    const run = await replayedRun();
    const quiet: CalibrationRun = {
      ...run,
      outcomes: [],
      summary: summarize([], run.summary.credits),
    };

    expect(calibrationReport(quiet)).toContain('No check raised an observation on any asset of this panel.');
    expect(calibrationReport(quiet)).toContain('Every call of every asset came back with an answer.');
  });

  it('prints the thresholds that produced the verdicts, which is the state T4.2 changes', async () => {
    const run = await replayedRun();
    const rows = tableUnder(calibrationReport(run), '## Thresholds in effect');

    const weights = rows.filter((row) => row[1]?.startsWith('weight '));
    expect(weights).toHaveLength(CHECK_IDS.length);
    expect(rows.some((row) => row[1] === 'ACT at or above' && row[2] === String(run.thresholds.score.actAtOrAbove))).toBe(
      true,
    );
  });

  it('reports the cost from the meter of the run, per endpoint', async () => {
    const run = await replayedRun();
    const charged: CalibrationRun = {
      ...run,
      summary: { ...run.summary, credits: { charged: 253, unconfirmed: 1, requests: 260, byEndpoint: { E02: 50 } } },
    };
    const lines = calibrationReport(charged);

    expect(lineWith(lines, '253 credit(s)')).toContain('260 request(s)');
    expect(lineWith(lines, '253 credit(s)')).toContain('1 credit(s) of attempts that came back without one');
    expect(tableUnder(lines, '## Cost and time')).toEqual([['E02', '50']]);
  });

  it('says the account-wide counter was not read when the run did not read it', async () => {
    const run = await replayedRun();

    expect(calibrationReport(run)).toContain(
      'The account-wide counter (E20) was not read for this run, so only the client meter above is reported.',
    );
  });

  it('closes with what the panel settles, built from the counts, and proposes no value', async () => {
    const run = await replayedRun();
    const lines = calibrationReport(run);
    const handover = lines.slice(lines.indexOf('## What this panel settles, and what it leaves open'));

    expect(handover.length).toBeGreaterThan(2);
    expect(handover.some((line) => /\*\*The target is (?:not )?met\.\*\*/.test(line))).toBe(true);
    for (const stats of run.summary.checks) {
      if (stats.bySeverity.warning + stats.bySeverity.critical === 0) continue;
      expect(handover.some((line) => line.startsWith(`- **${stats.id} lowered`))).toBe(true);
    }
  });

  it('keeps a check it barely ran apart from one it settled and from one it never ran', async () => {
    const run = await replayedRun();
    const lines = calibrationReport(run);
    const handover = lines.slice(lines.indexOf('## What this panel settles, and what it leaves open'));

    // C2 is unavailable with this key, so the panel calibrates nothing about it; C5 ran on two wrappers, too few
    // to settle a limit on. Neither may be reported as settled by this panel (D12).
    expect(handover.some((line) => line.includes('C2 ran on no asset of this panel'))).toBe(true);
    expect(handover.some((line) => /C5 ran on \d+ asset\(s\)\*\*, too few of this panel/.test(line))).toBe(true);
  });
});

describe('summaryLine', () => {
  it('is one sentence: how many assets, what share reached ACT, and against which target', async () => {
    const run = await replayedRun();

    const line = summaryLine(run);
    expect(line).toContain(`${String(run.summary.assets)} asset(s) assessed`);
    expect(line).toContain(`${String(run.summary.verdicts.ACT)} ACT`);
    expect(line).toContain(run.summary.meetsTarget ? 'at or above' : 'below');
  });
});

describe('serializeReport and serializeRun', () => {
  it('end with a newline, as every generated file of the project does', async () => {
    const run = await replayedRun();

    expect(serializeReport(run).endsWith('\n')).toBe(true);
    expect(serializeRun(run).endsWith('\n')).toBe(true);
  });

  it('writes a run that reads back as the same run', async () => {
    const run = await replayedRun();

    expect(JSON.parse(serializeRun(run))).toEqual(JSON.parse(JSON.stringify(run)));
  });
});

describe('formatElapsed', () => {
  it('reads in milliseconds under a second and in seconds above it', () => {
    expect(formatElapsed(0)).toBe('0 ms');
    expect(formatElapsed(999)).toBe('999 ms');
    expect(formatElapsed(1_000)).toBe('1 s');
    expect(formatElapsed(7_834)).toBe('7.8 s');
  });
});
