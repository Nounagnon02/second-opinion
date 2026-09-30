/**
 * `docs/API_AUDIT.md` and `docs/api_audit.json`, written from one audit run (specification F9, acceptance
 * criterion 6).
 *
 * Both files are generated, never edited by hand, for the reason the calibration report gives: a measurement
 * written down by hand is a claim. The markdown is the readable view of the JSON beside it, and
 * `tests/audit-doc.test.ts` holds both committed files against what a fresh run writes — byte for byte for the
 * markdown, and for the JSON but for the two timestamps of the run — so that "never edited by hand" is itself
 * something a reader can check rather than take on trust.
 *
 * The report is written for the team that owns the API. It opens on what it read and what it cost, puts the
 * entries next, and closes on what it did **not** measure — because a reader deciding what to do with a number
 * needs the edge of the sample it came from as much as the number itself.
 */
import { CHECK_TITLES } from '../checks/model.js';
import { wrap } from '../cli/args.js';
import { describeMs, type EndpointCorpus } from './corpus.js';
import { FINDING_KINDS, type AuditFinding, type AuditMeasurement } from './findings.js';
import type { AuditRun } from './run.js';
import type { SampleRun } from './sample.js';

/** How many reasons one check shows before the rest are only counted. */
export const LISTED_AUDIT_REASONS = 3;

/** A duration in the unit it was measured in: milliseconds under a second, one decimal above it. */
export function formatMs(value: number): string {
  return describeMs(value);
}

/** A share, one decimal, no trailing zero. */
function share(part: number, whole: number): string {
  return whole === 0 ? '—' : `${String(Math.round((part / whole) * 1000) / 10)} %`;
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(headers), row(headers.map(() => '---')), ...rows.map(row)];
}

/** A measured value with what it was read against. */
export function describeMeasurement(measurement: AuditMeasurement): string {
  const { unit, value, against, label } = measurement;
  if (unit === 'milliseconds') {
    const head = `${label}: ${formatMs(value)}`;
    return against === null ? head : `${head} of a ${formatMs(against)} budget`;
  }
  if (unit === 'credits') {
    const head = `${label}: ${String(value)} credit(s)`;
    return against === null ? head : `${head}, against ${String(against)} reserved`;
  }
  // `count` and `answers` read as a plain ratio: the label already carries the noun they count.
  const head = `${label}: ${String(value)}`;
  return against === null ? head : `${head} of ${String(against)}`;
}

/** The distinct credit costs one endpoint reported, as the table prints them. */
function creditCell(endpoint: EndpointCorpus): string {
  if (endpoint.credits.length === 0) return '—';
  return endpoint.credits
    .map(
      (observed) =>
        `${String(observed.value ?? 'absent')}${endpoint.credits.length > 1 ? ` ×${String(observed.answers)}` : ''}`,
    )
    .join(', ');
}

/** One line per capture: what it is, how many answers it holds, and whether its clock includes pacing. */
function captureTable(run: AuditRun): string[] {
  return table(
    ['Capture', 'Directory', 'Answers', 'Timing', 'What it is'],
    run.corpus.parts.map((part) => [
      part.name,
      `\`${part.dir}\``,
      String(part.answers),
      part.paced ? 'paced' : 'one call at a time',
      part.description,
    ]),
  );
}

/** One line per endpoint: what was asked of it, what it answered, what it reported, how long it took. */
function endpointTable(run: AuditRun): string[] {
  return table(
    [
      'Endpoint',
      'Path',
      'Answers',
      'Accepted',
      'Questions',
      'Credits reported',
      'Reserved',
      'Median, one at a time',
      'Slowest, one at a time',
      'Slowest, pacing included',
    ],
    run.endpoints.map((endpoint) => [
      endpoint.endpoint,
      `\`${endpoint.path}\``,
      String(endpoint.answers),
      `${String(endpoint.accepted)} (${share(endpoint.accepted, endpoint.answers)})`,
      String(endpoint.shapes.length),
      creditCell(endpoint),
      String(endpoint.declaredCredits),
      endpoint.unpacedLatency === null ? '—' : formatMs(endpoint.unpacedLatency.medianMs),
      endpoint.unpacedLatency === null ? '—' : formatMs(endpoint.unpacedLatency.maxMs),
      formatMs(endpoint.latency.maxMs),
    ]),
  );
}

/** One line per endpoint of the inventory: what it records, what arrived, and what the comparison concluded. */
function comparisonTable(run: AuditRun): string[] {
  const result = (one: AuditRun['comparisons'][number]): string => {
    if (!one.compared) return 'not compared';
    if (one.missing.length === 0 && one.unexpected.length === 0) return 'every recorded name arrived';
    return [
      one.missing.length === 0 ? '' : `${String(one.missing.length)} not received: ${one.missing.join(', ')}`,
      one.unexpected.length === 0 ? '' : `recorded as absent but present: ${one.unexpected.join(', ')}`,
    ]
      .filter((part) => part !== '')
      .join('; ');
  };
  return table(
    ['Endpoint', 'Names recorded', 'Names received', 'Answers', 'Result'],
    run.comparisons.map((one) => [
      one.endpoint,
      one.compared ? String(one.listed) : `by reference to ${one.reference ?? 'another endpoint'}`,
      String(one.received),
      String(one.answers),
      result(one),
    ]),
  );
}

/** One entry of the report: what it is, what it measured, and the answers behind it. */
function findingLines(finding: AuditFinding): string[] {
  const about = finding.endpoints.length === 0 ? '' : ` — ${[...new Set(finding.endpoints)].join(', ')}`;
  const lines = [`### ${finding.id} · ${finding.kind} · ${finding.title}${about}`, '', ...wrap(finding.statement, ''), ''];
  if (finding.measurement !== null) lines.push(`**Measured:** ${describeMeasurement(finding.measurement)}`, '');
  lines.push('**Evidence:**');
  for (const evidence of finding.evidence) {
    const at = evidence.field === null ? '' : ` at \`${evidence.field}\``;
    lines.push(`- \`${evidence.file}\`${at} — ${evidence.shows}`);
  }
  lines.push('');
  return lines;
}

/** What the engine found over the sample: one line per audited check. */
function sampleTable(sample: SampleRun): string[] {
  return table(
    ['Check', 'What it reads', 'Evaluated', 'info', 'warning', 'critical', 'Not applicable', 'Unavailable'],
    sample.checks.map((stats) => [
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

/** The reasons the audited checks gave when they did not run, most frequent first. */
function reasonLines(sample: SampleRun): string[] {
  const lines: string[] = [];
  for (const stats of sample.checks) {
    for (const reason of stats.reasons.slice(0, LISTED_AUDIT_REASONS)) {
      lines.push(...wrap(`- **${stats.id}, on ${String(reason.assets)} asset(s).** ${reason.reason}`, ''));
    }
    const rest = stats.reasons.slice(LISTED_AUDIT_REASONS);
    if (rest.length > 0) {
      lines.push(
        `- **${stats.id}:** ${String(rest.length)} further wording(s), covering ` +
          `${String(rest.reduce((sum, reason) => sum + reason.assets, 0))} asset(s), are in ` +
          '`docs/api_audit.json` under `sample.checks`.',
      );
    }
  }
  return lines.length === 0 ? ['Every audited check ran on every asset of the sample.'] : lines;
}

/** The calls of the sample that brought nothing back. */
function failureLines(sample: SampleRun): string[] {
  if (sample.failures.length === 0) return ['Every call of every asset of the sample came back with an answer.'];
  return sample.failures.flatMap((failure) =>
    wrap(`- **${failure.endpoint}**, ${failure.kind}, on ${String(failure.assets)} asset(s): ${failure.message}`, ''),
  );
}

/**
 * What this run did not measure.
 *
 * Every line is derived from the run above it. A reader deciding what to do with a number in this report has to
 * know the edge of the sample it came from, and stating that edge is the difference between a measurement and a
 * claim about the API as a whole.
 */
function limitLines(run: AuditRun): string[] {
  const lines: string[] = [];
  const paced = run.corpus.parts.filter((part) => part.paced);

  lines.push(
    ...wrap(
      `- **This is one corpus, not the API.** ${String(run.totals.answers)} recorded answers over ` +
        `${String(run.totals.endpoints)} endpoints, captured by the runs this project made for its own purposes, ` +
        `in ${String(run.corpus.parts.length)} captures listed above. Every number here is about those answers. ` +
        'Nothing here measures an endpoint on a day it was not called, or with a parameter it was not called with.',
      '',
    ),
  );
  if (paced.length > 0) {
    lines.push(
      ...wrap(
        `- **Timings from ${paced.map((part) => part.name).join(', ')} include pacing.** That capture was recorded ` +
          'by a run that waits for a free request slot, and the wait falls inside the measured interval. Its ' +
          'latencies are upper bounds on what the API took, never a measure of the API alone.',
        '',
      ),
    );
  }
  const uncompared = run.comparisons.filter((one) => !one.compared);
  if (uncompared.length > 0) {
    lines.push(
      ...wrap(
        `- **${uncompared.map((one) => one.endpoint).join(', ')} were not compared with the inventory.** Their ` +
          'rows state their fields by reference to another endpoint ("the same fields as E14, without `tokens`"), ' +
          'and resolving that mechanically would mean deciding what becomes of the names nested inside the ' +
          'excluded field — which is inventing a baseline rather than reading one (D14).',
        '',
      ),
    );
  }
  if (run.sample === null) {
    lines.push('- **No engine pass was made**, so nothing here aggregates C3, C6 or C7 over assets.');
  } else {
    lines.push(
      ...wrap(
        `- **The engine pass covers ${String(run.sample.assets)} assets**, the calibration panel replayed from ` +
          `\`${run.sample.dir}\`. The assets of the other captures are read for their shape, their cost and their ` +
          'clock, and are not assessed here. C1, C4 and C5 are about the venues and the wrappers of one asset and ' +
          'are left to `npm run check`; C2 has no source with this key (D2).',
        '',
      ),
    );
  }
  lines.push(
    ...wrap(
      '- **No cause is stated anywhere above.** An answer that did not arrive is counted as an answer that did ' +
        'not arrive; why it did not is not something a corpus of recorded answers can establish, and no entry ' +
        'guesses at it.',
      '',
    ),
  );
  if (run.withheld > 0) {
    lines.push(
      ...wrap(
        `- **${String(run.withheld)} statement(s) were withheld.** They came out of the measurements above and ` +
          'cited no recorded answer, so the rule of F9 — no captured evidence, no publication — dropped them ' +
          'before this report was written.',
        '',
      ),
    );
  }
  if (run.unproven > 0) {
    lines.push(
      ...wrap(
        `- **${String(run.unproven)} further statement(s) were withheld.** They cited a recorded answer that did ` +
          'not show what they stated, which the second read of every entry (T6.2) found by opening it. A ' +
          'statement whose own evidence does not bear it out is not published, whatever produced it.',
        '',
      ),
    );
  }
  return lines;
}

/**
 * The closing section: what the second read of the entries came to (T6.2).
 *
 * The preamble promises that both counts of dropped statements are at the end, and this is where that promise is
 * kept. The counts are of this project's own generators, never of the API: a statement withheld here is one this
 * project wrote and could not support, which is a fault of the writing and not of what was measured.
 */
function reviewLines(run: AuditRun): string[] {
  const { review } = run;
  const lines = [
    ...wrap(
      `Every entry above was read back from the words it prints and checked against the answer beside it. That ` +
        `second read turned the ${String(review.claims)} statements the evidence lines make — an HTTP code, a ` +
        `field present, absent or null, a cost, a duration, an asset of the sample — into questions put to the ` +
        `recorded answer they cite. An entry is printed only when every one of its own statements held.`,
      '',
    ),
    '',
    ...table(
      ['What', 'Count'],
      [
        ['Entries printed', String(run.findings.length)],
        ['Statements checked against a recorded answer', String(review.claims)],
        ['Statements withheld for citing no answer (F9)', String(run.withheld)],
        ['Statements withheld because the cited answer did not show them (T6.2)', String(run.unproven)],
        ['Printed entries whose re-read did not hold', String(review.unproven.length)],
        ['Printed entries whose wording breaks the rule of tone', String(review.tone.length)],
      ],
    ),
    '',
  ];

  if (review.unproven.length > 0) {
    lines.push(
      ...wrap('These printed entries did not survive the re-read, which is a fault in this report:', ''),
      '',
      ...review.unproven.flatMap((entry) => [
        `- **${entry.id}** — ${entry.title}`,
        ...entry.issues.map((issue) => `  - ${issue.file === null ? '' : `\`${issue.file}\` `}${issue.reason}`),
      ]),
      '',
    );
  }

  if (review.tone.length > 0) {
    lines.push(
      ...wrap('These entries use a word this report undertakes not to use about the API:', ''),
      '',
      ...review.tone.flatMap((entry) => [
        `- **${entry.id}** — ${entry.title}`,
        ...entry.issues.map((issue) => `  - ${issue.reason}`),
      ]),
      '',
    );
  }

  if (run.withheld === 0 && run.unproven === 0 && review.unproven.length === 0 && review.tone.length === 0) {
    lines.push(
      ...wrap(
        'Nothing was withheld on this run: every statement a generator produced cited an answer, and every ' +
          'cited answer carried what the statement made of it. That is a property of this corpus and this ' +
          'code on this run, not a guarantee about either — the gates are what hold, and they are in ' +
          '`src/audit/review.ts`.',
        '',
      ),
      '',
    );
  }
  return lines;
}

/** The whole report, one array entry per line. */
export function auditReport(run: AuditRun): string[] {
  const { totals } = run;
  const lines = [
    '# API audit — what the recorded answers show',
    '',
    'This report is a measurement of the CoinMarketCap Pro API as this project recorded it, written for the team',
    'that owns the API. It is not a list of defects: every entry below is either a number with what it was measured',
    'against (`observed`), something a consumer has to plan for (`signal`), or a constructive proposal',
    '(`suggestion`). No entry states a cause, because a corpus of recorded answers cannot establish one.',
    '',
    '**Every entry cites a recorded answer that is in this repository, and that answer was opened.** Both are',
    'enforced by the code rather than promised: a statement citing no file is dropped before the report is written',
    '(specification F9), and so is one whose cited answer does not carry what it states — each entry is read back',
    'from its own words and checked against the file beside it (T6.2). Both counts of dropped statements are at',
    'the end.',
    '',
    'This file and `docs/api_audit.json` beside it are generated by `npm run audit`; neither is edited by hand.',
    '',
    '## How this was produced',
    '',
    '```',
    'npm run audit             # prints the report',
    'npm run audit -- --write  # writes docs/API_AUDIT.md and docs/api_audit.json',
    '```',
    '',
    ...wrap(
      `The command sends no request. It reads the answers this project already recorded, so it costs ` +
        `**${String(totals.creditsSpent)} credits** to run and reproduces on a clone with no API key at all. Those ` +
        `answers reported **${String(totals.creditsReported)} credits** between them when they were first ` +
        (totals.withoutCreditCount === 0
          ? 'captured, which is what the captures cost the account.'
          : `captured; ${String(totals.withoutCreditCount)} of them carried no \`credit_count\`.`),
      '',
    ),
    '',
    '## What was read',
    '',
    ...wrap(
      `${String(totals.answers)} recorded answers over ${String(totals.endpoints)} endpoints of the verified ` +
        `inventory, of which ${String(totals.accepted)} (${share(totals.accepted, totals.answers)}) were accepted ` +
        'by the API.',
      '',
    ),
    '',
    ...captureTable(run),
    '',
  ];

  if (run.corpus.unknownPaths.length > 0) {
    lines.push(
      ...wrap(
        'The corpus also holds answers for paths outside the verified inventory — the refusals of T1.2 and T1.3, ' +
          'recorded so that a refusal can be quoted rather than described. They are counted here and are not ' +
          'measured with the rest:',
        '',
      ),
      '',
      ...table(
        ['Path', 'Answers'],
        run.corpus.unknownPaths.map((path) => [`\`${path.path}\``, String(path.answers)]),
      ),
      '',
    );
  }
  if (run.corpus.skipped.length > 0) {
    lines.push(
      `${String(run.corpus.skipped.length)} file(s) under those directories are not recorded exchanges and were ` +
        'left out:',
      '',
      ...run.corpus.skipped.map((skip) => `- \`${skip.file}\`: ${skip.reason}`),
      '',
    );
  }

  lines.push(
    '## Entries',
    '',
    ...wrap(
      run.findings.length === 0
        ? 'This corpus produced no entry that a recorded answer could support. What was measured is in the tables ' +
          'below.'
        : `${String(run.findings.length)} entries, each with the answers it was read from. Each was then read a ` +
          `second time the other way round (T6.2): the ${String(run.review.claims)} statements their evidence ` +
          'lines make — an HTTP code, a field present or absent, a duration, an asset of the sample — were taken ' +
          'from the words printed here and checked against the recorded answer beside them. An entry whose own ' +
          'evidence did not bear it out is counted at the end rather than printed.',
      '',
    ),
    '',
  );
  for (const finding of run.findings) lines.push(...findingLines(finding));

  lines.push(
    '## Endpoint by endpoint',
    '',
    ...wrap(
      '"Questions" counts the distinct sets of query parameter names the endpoint was called with, which is what ' +
        'makes two answers comparable. "Credits reported" is `status.credit_count` as the accepted answers sent ' +
        'it, and "Reserved" is what this project holds back before sending, itself read from the answers of ' +
        `${run.inventoryRecordedAt}. The two "one at a time" columns cover the captures recorded without pacing, ` +
        'where nothing but the API is inside the measured interval; the last column covers every answer, pacing ' +
        'included, and is an upper bound.',
      '',
    ),
    '',
    ...endpointTable(run),
    '',
    '## The inventory against the answers',
    '',
    `\`docs/ENDPOINTS.md\` recorded the fields of every verified endpoint on ${run.inventoryRecordedAt}, from live`,
    'calls. The comparison below runs in the direction that says something: a name that was recorded and that no',
    'answer of this corpus carries. The other direction is not reported — that table records the fields of interest',
    'and never claimed to be exhaustive, so listing what it omits would describe our note-taking rather than the',
    'API.',
    '',
    ...comparisonTable(run),
    '',
  );

  if (run.sample !== null) {
    const { sample } = run;
    lines.push(
      '## C3, C6 and C7 over a sample of assets',
      '',
      ...wrap(
        `The engine was run over ${String(sample.assets)} assets — the calibration panel, replayed from ` +
          `\`${sample.dir}\`, read from an E03 answer whose server clock reads ${sample.panelObservedAt}. Those ` +
          'three checks are the ones that describe the data rather than one asset’s venues: how old the ' +
          'timestamps are, whether two endpoints agree about one asset at one moment, and which fields a verdict ' +
          'needed and could not read.',
        '',
      ),
      '',
      ...sampleTable(sample),
      '',
      '### Why a check did not run',
      '',
      ...reasonLines(sample),
      '',
      '### Calls of the sample that brought nothing back',
      '',
      ...failureLines(sample),
      '',
    );
  }

  lines.push('## What this run did not measure', '', ...limitLines(run), '');
  lines.push('## The second read', '', ...reviewLines(run));
  return lines;
}

/** The one sentence a command ends with: what was read, and what came out of it. */
export function auditSummaryLine(run: AuditRun): string {
  const counts = FINDING_KINDS.map(
    (kind) => `${String(run.findings.filter((finding) => finding.kind === kind).length)} ${kind}`,
  ).join(', ');
  return (
    `${String(run.totals.answers)} recorded answers over ${String(run.totals.endpoints)} endpoints: ` +
    `${String(run.findings.length)} entries (${counts}), ${String(run.withheld)} withheld for want of evidence, ` +
    `${String(run.unproven)} withheld because a cited answer did not show it, ${String(run.review.claims)} claims ` +
    `checked, ${String(run.totals.creditsSpent)} credits spent.`
  );
}

/** The report as a file holds it. */
export function serializeAuditReport(run: AuditRun): string {
  return `${auditReport(run).join('\n')}\n`;
}

/** The run as `docs/api_audit.json` holds it: two spaces, a trailing newline. */
export function serializeAuditRun(run: AuditRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}
