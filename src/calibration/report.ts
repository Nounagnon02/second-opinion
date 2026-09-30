/**
 * `docs/CALIBRATION.md` and `docs/calibration.json`, written from one calibration run (specification F5, T4.1).
 *
 * Both files are generated, never edited by hand: the acceptance criterion the specification states — at least 90 %
 * of the first fifty assets at `ACT` — is a measurement, and a measurement written down by hand is a claim. The
 * markdown is the readable view of the JSON beside it, and `tests/calibration-doc.test.ts` keeps the two in line.
 *
 * The closing section says what the run leaves for T4.2. Every line of it is derived from the counts above it: this
 * task measures the panel and changes no threshold, so the report proposes nothing it has not measured.
 */
import { formatDuration } from '../checks/c3-freshness.js';
import { CHECK_TITLES, type CheckId, type CheckStatus } from '../checks/model.js';
import { formatUsd } from '../checks/prices.js';
import { formatScore } from '../score/score.js';
import { VERDICTS } from '../score/verdict.js';
import { describeMember } from './panel.js';
import type { AssetOutcome, CalibrationRun, CheckStats } from './run.js';

/** How many assets are named in a finding line before the rest are only counted. */
export const LISTED_MEMBERS = 8;

/**
 * How many distinct reasons one check shows before the rest are only counted. A reason often names the asset it is
 * about — "CMC 1027 is not in the index" — so a panel of fifty can produce fifty wordings of one situation.
 */
export const LISTED_REASONS = 4;

/** A share as this report writes it: one decimal, no trailing zero. */
function share(value: number): string {
  return `${String(Math.round(value * 10) / 10)} %`;
}

/** A wall-clock duration: milliseconds under a second, one decimal of a second above it. */
export function formatElapsed(milliseconds: number): string {
  const ms = Math.round(milliseconds);
  return ms < 1_000 ? `${String(ms)} ms` : `${String(Math.round(ms / 100) / 10)} s`;
}

/** A market capitalisation as the table prints it, in billions where the number runs long. */
function formatCap(value: number | null): string {
  if (value === null) return 'not readable';
  if (Math.abs(value) >= 1e9) return `${String(Math.round(value / 1e8) / 10)} bn USD`;
  return formatUsd(value);
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(headers), row(headers.map(() => '---')), ...rows.map(row)];
}

/** The status of one check on one asset, in one cell: its severity when it ran, its status otherwise. */
function cell(outcome: AssetOutcome, id: CheckId): string {
  const check = outcome.checks.find((one) => one.id === id);
  if (check === undefined) return '—';
  if (check.status === 'evaluated') return check.severity ?? 'info';
  return check.status === 'not_applicable' ? 'n/a' : 'unavail.';
}

/** How a status reads in a sentence. */
function statusWord(status: CheckStatus): string {
  return status === 'not_applicable' ? 'not applicable' : status;
}

/** One line per asset: rank, what it scored, and what each of the seven checks did. */
function panelTable(run: CalibrationRun): string[] {
  const ids = run.summary.checks.map((stats) => stats.id);
  return table(
    ['#', 'Asset', 'Market cap', 'Score', 'Verdict', 'Evaluated', ...ids],
    run.outcomes.map((outcome) => [
      String(outcome.member.rank),
      `${describeMember(outcome.member)}${outcome.member.name === null ? '' : ` (${outcome.member.name})`}`,
      formatCap(outcome.member.marketCapUsd),
      outcome.score === null ? 'none' : formatScore(outcome.score),
      outcome.verdict,
      `${String(outcome.evaluated)}/7`,
      ...ids.map((id) => cell(outcome, id)),
    ]),
  );
}

/** One line per check: on how many assets it ran, what it found there, and how often it could not run. */
function checkTable(run: CalibrationRun): string[] {
  return table(
    ['Check', 'What it reads', 'Evaluated', 'info', 'warning', 'critical', 'Not applicable', 'Unavailable'],
    run.summary.checks.map((stats) => [
      stats.id,
      CHECK_TITLES[stats.id],
      String(stats.evaluated),
      String(stats.bySeverity.info),
      String(stats.bySeverity.warning),
      String(stats.bySeverity.critical),
      String(stats.notApplicable),
      String(stats.unavailable),
    ]),
  );
}

/** The reasons the checks that did not run gave, most frequent first, with how many assets gave each. */
function reasonLines(stats: CheckStats): string[] {
  const shown = stats.reasons.slice(0, LISTED_REASONS);
  const rest = stats.reasons.slice(LISTED_REASONS);
  const lines = shown.map(
    (reason) => `- **${stats.id}, ${statusWord(reason.status)} on ${String(reason.assets)} asset(s).** ${reason.reason}`,
  );
  if (rest.length === 0) return lines;
  const assets = rest.reduce((sum, reason) => sum + reason.assets, 0);
  lines.push(
    `- **${stats.id}:** ${String(rest.length)} further wording(s), covering ${String(assets)} asset(s), are in ` +
      '`docs/calibration.json` under `summary.checks`.',
  );
  return lines;
}

/** Every finding raised on the panel, with the assets that raised it. */
function findingLines(run: CalibrationRun): string[] {
  if (run.summary.findings.length === 0) {
    return ['No check raised an observation on any asset of this panel.'];
  }
  return run.summary.findings.map((finding) => {
    const named = finding.members.slice(0, LISTED_MEMBERS).join(', ');
    const rest = finding.members.length - LISTED_MEMBERS;
    const where = rest > 0 ? `${named} and ${String(rest)} more` : named;
    return `- **${finding.checkId} \`${finding.code}\`**, ${finding.severity}, on ${String(finding.assets)} asset(s): ${where}.`;
  });
}

/** The calls that brought nothing back, which is what makes a check unavailable rather than not applicable (D9). */
function failureLines(run: CalibrationRun): string[] {
  if (run.summary.failures.length === 0) {
    return ['Every call of every asset came back with an answer.'];
  }
  return run.summary.failures.map(
    (failure) => `- **${failure.endpoint}**, ${failure.kind}, on ${String(failure.assets)} asset(s): ${failure.message}`,
  );
}

/** What the account-wide counter of E20 says the run cost, when it was read before and after (D6). */
function keyLines(run: CalibrationRun): string[] {
  const { keyBefore, keyAfter } = run;
  if (keyBefore === null || keyAfter === null) {
    return ['The account-wide counter (E20) was not read for this run, so only the client meter above is reported.'];
  }
  const used = keyAfter.creditsUsedMonth - keyBefore.creditsUsedMonth;
  return [
    `E20 read before and after the run: ${String(keyBefore.creditsUsedMonth)} credits used this month before, ` +
      `${String(keyAfter.creditsUsedMonth)} after, so the account was charged **${String(used)} credit(s)** for it. ` +
      `${String(keyAfter.creditsLeftMonth)} credit(s) remain of the monthly ${String(keyAfter.creditLimitMonthly)}, ` +
      `which reset on ${keyAfter.creditLimitMonthlyResetAt}.`,
    `The plan allows ${String(keyAfter.rateLimitMinute)} requests per minute; this run was paced at ` +
      `${run.pacedPerMinute === null ? 'no limit, having sent no request over the network' : `${String(run.pacedPerMinute)} per minute`}.`,
  ];
}

/**
 * What this panel settles and what it leaves open, derived from the counts above and from nothing else.
 *
 * Each line states a number this run produced and what that number does or does not decide. A panel of assets
 * reputed reliable can show a limit to be too tight — it lowered an asset that should not have been lowered — and
 * it can show where a limit sits relative to everything it measured. It cannot show a limit to be too loose, and
 * it decides nothing at all about a check it never ran. The lines below keep those three cases apart, so that the
 * reasoning written into `config/checks.json` by T4.2 stays separable from the reasoning still owed (D12).
 */
function handoverLines(run: CalibrationRun): string[] {
  const { summary } = run;
  const lines: string[] = [];
  const target = share(summary.targetShare);

  lines.push(
    summary.meetsTarget
      ? `- **The target is met.** ${share(summary.actShare)} of the panel reaches \`ACT\`, at or above the ${target} ` +
        'the specification requires, with the thresholds listed above. Why each of those numbers sits where it does ' +
        'is written in the `notes` of `config/checks.json`, beside the number itself.'
      : `- **The target is not met.** ${share(summary.actShare)} of the panel reaches \`ACT\`, below the ${target} ` +
        'the specification requires. The counts below say which checks moved the score.',
  );

  const raising = summary.checks.filter((stats) => stats.bySeverity.warning + stats.bySeverity.critical > 0);
  for (const stats of raising) {
    lines.push(
      `- **${stats.id} lowered ${String(stats.bySeverity.warning + stats.bySeverity.critical)} asset(s)** ` +
        `(${String(stats.bySeverity.warning)} warning, ${String(stats.bySeverity.critical)} critical) out of the ` +
        `${String(stats.evaluated)} it ran on. This panel is what its limits were settled against.`,
    );
  }
  if (raising.length === 0) {
    lines.push(
      '- **No check lowered any asset of this panel**, so every score above comes from the checks that ran finding ' +
        'nothing. The thresholds are therefore not shown to be too tight by this panel; whether they are too loose ' +
        'is not something a panel of assets reputed reliable can answer.',
    );
  }

  const never = summary.checks.filter((stats) => stats.evaluated === 0);
  if (never.length > 0) {
    lines.push(
      `- **${never.map((stats) => stats.id).join(', ')} ran on no asset of this panel**, so nothing here calibrates ` +
        'them. Their thresholds stay as they are until a panel that exercises them is recorded.',
    );
  }
  const thin = summary.checks.filter((stats) => stats.evaluated > 0 && stats.evaluated < summary.assets / 10);
  if (thin.length > 0) {
    lines.push(
      `- **${thin.map((stats) => `${stats.id} ran on ${String(stats.evaluated)} asset(s)`).join(', ')}**, too few of ` +
        'this panel to settle a limit on. Those limits wait for a panel that exercises them.',
    );
  }

  const partial = summary.coverage.min < summary.coverage.max;
  lines.push(
    partial
      ? `- **Coverage runs from ${String(summary.coverage.min)} to ${String(summary.coverage.max)} checks per asset**, ` +
        'and it caps no verdict. D9 left that open and this panel closes it: the assets at the low end are either ' +
        'coins with no token contract, for which the checks that ran are all the checks that can run, or assets ' +
        'whose DEX calls the API could not answer. Capping either group would put the panel below the target for a ' +
        'reason that is not about the data being wrong (D12).'
      : `- **Every asset was assessed on the same ${String(summary.coverage.max)} checks**, so this panel says ` +
        'nothing about whether low coverage should cap the verdict (D9).',
  );

  if (summary.score.unscored > 0) {
    lines.push(
      `- **${String(summary.score.unscored)} asset(s) got no score at all**, which is \`DO_NOT_ACT\` by D11. The ` +
        'reasons their checks gave are listed above.',
    );
  }
  if (run.pacedPerMinute !== null && summary.elapsed.pastBudget > 0) {
    lines.push(
      `- **${String(summary.elapsed.pastBudget)} asset(s) took longer than the ` +
        `${formatElapsed(10_000)} budget of D1.** The run was paced against the per-minute request limit, so these ` +
        'times include waiting for a free slot and are not the times a single `check` would take.',
    );
  }
  return lines;
}

/** The whole report, one array entry per line. */
export function calibrationReport(run: CalibrationRun): string[] {
  const { summary, panel } = run;
  const scored = summary.assets - summary.score.unscored;

  return [
    '# Calibration — the first assets by market capitalisation',
    '',
    'Specification F5 requires that at least 90 % of the first fifty cryptocurrencies by market capitalisation —',
    'assets reputed reliable — reach the `ACT` verdict. A panel of such assets sitting below that share means the',
    'engine is crying wolf, and it has to be corrected before any demonstration.',
    '',
    'This file and `docs/calibration.json` beside it are generated by `npm run calibrate`; neither is edited by hand.',
    'T4.1 measured this panel live and changed no threshold; T4.2 settled the thresholds against it and re-scored the',
    'same recorded answers. What the panel settles and what it still leaves open is listed at the end.',
    '',
    '## How this was produced',
    '',
    '```',
    'npm run calibrate -- --record   # the live run: reads the panel from E03, assesses every asset, writes fixtures',
    'npm run calibrate -- --replay   # the same run offline, from the recorded answers',
    '```',
    '',
    `The panel was read from E03 on ${run.panelObservedAt} (\`status.timestamp\` of that answer, never the local`,
    `clock — D4) and every asset was then assessed through the same call plan a \`check\` uses (D1), by CMC ID, which`,
    'skips the E01 resolution. Every answer behind every line below is recorded under `fixtures/calibration/`, with',
    'the API key masked.',
    '',
    '## The panel',
    '',
    `${String(panel.requested)} asset(s) were asked of E03 and ${String(panel.members.length)} came back with a CMC ID` +
      `${panel.withoutId.length === 0 ? '' : `; ${String(panel.withoutId.length)} item(s) carried none and were not assessed (ranks ${panel.withoutId.join(', ')})`}.`,
    run.index === null
      ? 'No token to real-world-asset index was available for this run, so C5 reports itself unavailable on every asset (D6).'
      : `C5 was read against the token to real-world-asset index built on ${run.index.builtAt}, which holds ` +
        `${String(run.index.entries)} wrapper(s) (D6).`,
    '',
    '## Result',
    '',
    `**${share(summary.actShare)} of the ${String(summary.assets)} assets reach \`ACT\`**, against the ` +
      `${share(summary.targetShare)} the specification requires: ` +
      `${summary.meetsTarget ? 'the target is met' : 'the target is **not** met'}.`,
    '',
    ...table(
      ['Verdict', 'Assets', 'Share'],
      VERDICTS.map((verdict) => [
        `\`${verdict}\``,
        String(summary.verdicts[verdict]),
        summary.assets === 0 ? '—' : share((summary.verdicts[verdict] / summary.assets) * 100),
      ]),
    ),
    '',
    scored === 0
      ? 'No asset of the panel got a score.'
      : `Scores of the ${String(scored)} asset(s) that got one: lowest ${formatScore(summary.score.min ?? 0)}, ` +
        `median ${formatScore(summary.score.median ?? 0)}, mean ${formatScore(summary.score.mean ?? 0)}, ` +
        `highest ${formatScore(summary.score.max ?? 0)}.` +
        (summary.score.unscored === 0
          ? ''
          : ` ${String(summary.score.unscored)} asset(s) got no score at all, which is \`DO_NOT_ACT\` by D11.`),
    '',
    `Checks evaluated per asset: ${String(summary.coverage.min)} to ${String(summary.coverage.max)} of 7, median ` +
      `${String(summary.coverage.median)} — ` +
      summary.coverage.byCount
        .map((count) => `${String(count.assets)} asset(s) at ${String(count.evaluated)}`)
        .join(', ') +
      '.',
    '',
    '## Every asset',
    '',
    'A cell holds the severity the check raised when it ran, `n/a` when the asset cannot have it, and `unavail.`',
    'when the data could not be reached (D9).',
    '',
    ...panelTable(run),
    '',
    '## What each check did',
    '',
    ...checkTable(run),
    '',
    '### Why checks did not run',
    '',
    ...summary.checks.flatMap(reasonLines),
    '',
    '### Observations raised',
    '',
    ...findingLines(run),
    '',
    '### Calls that brought nothing back',
    '',
    ...failureLines(run),
    '',
    '## Thresholds in effect',
    '',
    'These are the numbers that produced the verdicts above, read from `config/checks.json` at run time. T4.2 settled',
    'them against this panel; the reasoning behind each one, and what the panel did not settle, is in the `notes`',
    'field of that file, beside the number itself.',
    '',
    ...table(
      ['Where', 'Setting', 'Value'],
      [
        ...Object.entries(run.thresholds.score.weights).map(([id, weight]) => [
          'score',
          `weight ${id}`,
          String(weight),
        ]),
        ...Object.entries(run.thresholds.score.severityPoints).map(([severity, points]) => [
          'score',
          `points for ${severity}`,
          String(points),
        ]),
        ['score', 'ACT at or above', String(run.thresholds.score.actAtOrAbove)],
        ['score', 'CAUTION at or above', String(run.thresholds.score.cautionAtOrAbove)],
        ['score', 'verdict cap with a critical finding', run.thresholds.score.capWithCritical ?? 'none'],
        ['C1', 'warn above', share(run.thresholds.C1.warnAbovePercent)],
        ['C1', 'critical above', share(run.thresholds.C1.criticalAbovePercent)],
        ['C3', 'aggregate, warn after', formatDuration(run.thresholds.C3.families.aggregate.warnAfterSeconds)],
        ['C3', 'aggregate, critical after', formatDuration(run.thresholds.C3.families.aggregate.criticalAfterSeconds)],
        ['C3', 'DEX, warn after', formatDuration(run.thresholds.C3.families.dex.warnAfterSeconds)],
        ['C3', 'DEX, critical after', formatDuration(run.thresholds.C3.families.dex.criticalAfterSeconds)],
        ['C4', 'warn below liquidity', formatUsd(run.thresholds.C4.warnLiquidityBelowUsd)],
        ['C4', 'critical below liquidity', formatUsd(run.thresholds.C4.criticalLiquidityBelowUsd)],
        ['C4', 'warn above turnover', `${String(run.thresholds.C4.warnTurnoverRatio)}×`],
        ['C4', 'critical above turnover', `${String(run.thresholds.C4.criticalTurnoverRatio)}×`],
        ['C6', 'warn above', share(run.thresholds.C6.warnAbovePercent)],
        ['C6', 'critical above', share(run.thresholds.C6.criticalAbovePercent)],
        ['C6', 'same-snapshot tolerance', formatDuration(run.thresholds.C6.snapshotToleranceSeconds)],
      ],
    ),
    '',
    '## Cost and time',
    '',
    `${String(summary.credits.requests)} request(s) for the whole run, ${String(summary.credits.charged)} credit(s)` +
      ` reported by the answers` +
      (summary.credits.unconfirmed === 0
        ? '.'
        : `, and ${String(summary.credits.unconfirmed)} credit(s) of attempts that came back without one, which the ` +
          'answers never confirmed either way.'),
    '',
    ...table(
      ['Endpoint', 'Credits'],
      Object.entries(summary.credits.byEndpoint)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([endpoint, credits]) => [endpoint, String(credits)]),
    ),
    '',
    ...keyLines(run),
    '',
    run.pacedPerMinute === null
      ? 'This run sent no request over the network, so it has no timings of its own: what a live run of this panel ' +
        'took is reported by the run that made it.'
      : `Per asset: median ${formatElapsed(summary.elapsed.medianMs)}, slowest ` +
        `${formatElapsed(summary.elapsed.slowestMs)}; ${String(summary.elapsed.pastBudget)} asset(s) past the ` +
        `${formatElapsed(10_000)} budget of D1. These times include waiting for a free slot under the per-minute ` +
        'request limit of the key, so they are not the times a single `check` takes.',
    '',
    '## What this panel settles, and what it leaves open',
    '',
    ...handoverLines(run),
    '',
  ];
}

/** The one sentence a command ends with: what share of the panel reached `ACT`, against the target. */
export function summaryLine(run: CalibrationRun): string {
  const { summary } = run;
  const counts = VERDICTS.map((verdict) => `${String(summary.verdicts[verdict])} ${verdict}`).join(', ');
  return (
    `${String(summary.assets)} asset(s) assessed: ${share(summary.actShare)} at ACT, ` +
    `${summary.meetsTarget ? 'at or above' : 'below'} the ${share(summary.targetShare)} the specification ` +
    `requires (${counts}).`
  );
}

/** The report as a file holds it. */
export function serializeReport(run: CalibrationRun): string {
  return `${calibrationReport(run).join('\n')}\n`;
}

/** The run as `docs/calibration.json` holds it: two spaces, a trailing newline. */
export function serializeRun(run: CalibrationRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}
