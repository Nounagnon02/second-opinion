/**
 * C7 - the fields the verdict reads that could not be read. The normalisers already write down every field they
 * could not use (`FieldIssue`), marking `required` the ones a check reads; C7 turns those into findings and leaves
 * the rest to the audit (D8).
 *
 * That split matters for the calibration: the shapes that are the same for every asset - an `error_code` sent as a
 * string, epochs and decimals sent as strings, platform IDs that differ between endpoints - describe the API, not
 * the asset. Scoring them would lower every asset by the same amount and say nothing (D8). `schemaIssues` hands
 * them to T6.1 unchanged.
 *
 * Findings are grouped by field and problem, so that an answer holding a hundred pairs reports one line per field
 * rather than a hundred, with the number of times it was observed and one concrete path to find it in the fixture.
 */
import type { Normalized, SourceRef } from '../normalize/model.js';
import type { RwaQuote } from '../normalize/rwa.js';
import { isRecord, type FieldIssue, type FieldProblem } from '../normalize/values.js';
import type { SchemaConfig } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement, type Severity } from './model.js';

/** What C7 reads: one answer, and everything the normaliser could not use in it. */
export interface SchemaInput {
  source: SourceRef;
  issues: readonly FieldIssue[];
}

function hasIssues(item: unknown): item is { issues: FieldIssue[] } {
  return isRecord(item) && Array.isArray(item.issues);
}

/** The issues of a normalised answer: those of the container, then those of each item that carries its own. */
export function schemaInput<T>(normalized: Normalized<T>): SchemaInput {
  const issues: FieldIssue[] = [...normalized.issues];
  for (const item of normalized.items) {
    if (hasIssues(item)) issues.push(...item.issues);
  }
  return { source: normalized.source, issues };
}

/**
 * The same, for an E14 answer read as RWA quotes: its priced tokens sit under each asset, so their issues are not
 * item issues. Reading the answer through `priceObservations` instead gives the wrappers as items and needs only
 * `schemaInput`.
 */
export function rwaQuoteInput(normalized: Normalized<RwaQuote>): SchemaInput {
  const input = schemaInput(normalized);
  const issues = [...input.issues];
  for (const quote of normalized.items) {
    for (const wrapper of quote.wrappers) issues.push(...wrapper.issues);
  }
  return { source: input.source, issues };
}

/** The same field of every item of an array, for example `data[12].quote[0].price` -> `data.quote.price`. */
export function fieldPattern(field: string): string {
  return field.replace(/\[[^\]]*\]/g, '');
}

/** One field that could not be read, and how many values of one answer it happened on. */
export interface IssueGroup {
  source: SourceRef;
  /** The field path with array indices removed. */
  field: string;
  /** One concrete path where it was observed, to find it in the recorded answer. */
  example: string;
  problem: FieldProblem;
  /** The JSON types received under this field, each once. */
  seen: string[];
  count: number;
  /** True when a check reads this field: only those are scored (D8). */
  required: boolean;
}

const PROBLEM_TEXT: Record<FieldProblem, string> = {
  missing: 'the field was absent',
  null: 'the value was null',
  not_a_number: 'the value could not be read as a number',
  not_a_timestamp: 'the value could not be read as a timestamp',
  not_a_string: 'the value could not be read as a string',
  not_a_boolean: 'the value could not be read as a boolean',
  not_an_object: 'the value was not an object',
  not_an_array: 'the value was not an array',
};

/** Whether the type received adds anything to the problem: for an absent or null field it repeats it. */
function typeWorthShowing(problem: FieldProblem): boolean {
  return problem !== 'missing' && problem !== 'null';
}

function group(inputs: readonly SchemaInput[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const input of inputs) {
    for (const issue of input.issues) {
      const field = fieldPattern(issue.field);
      const key = `${input.source.endpoint}|${input.source.observedAt}|${field}|${issue.problem}`;
      const found = groups.get(key);
      if (found === undefined) {
        groups.set(key, {
          source: input.source,
          field,
          example: issue.field,
          problem: issue.problem,
          seen: [issue.seen],
          count: 1,
          required: issue.required,
        });
        continue;
      }
      found.count += 1;
      if (!found.seen.includes(issue.seen)) found.seen.push(issue.seen);
    }
  }
  return [...groups.values()];
}

/**
 * Every field that could not be read, split the way D8 splits them: `scored` is what C7 reports for this asset,
 * `reported` is what the audit describes about the API itself. Both are grouped by field and problem.
 */
export function schemaIssues(inputs: readonly SchemaInput[]): { scored: IssueGroup[]; reported: IssueGroup[] } {
  const groups = group(inputs);
  return {
    scored: groups.filter((found) => found.required),
    reported: groups.filter((found) => !found.required),
  };
}

/**
 * The configured severity of a field that could not be read.
 *
 * The same field name does not cost the same on every endpoint. A price absent from the endpoint carrying the
 * asset's own aggregated price leaves the run with no price at all; the same name absent from a venue endpoint
 * leaves it with one price where it wanted two, which is a thinner reading rather than an unusable one. The
 * endpoint is therefore part of the key, and the lookup runs from the most specific to the least: the endpoint
 * with the full field path, the endpoint with the last segment, the full field path, its last segment, then the
 * default. A key written without an endpoint still applies on every endpoint, so a configuration naming none
 * behaves exactly as before (T4.2, D8).
 */
export function severityOfField(field: string, config: SchemaConfig, endpoint?: string): Severity {
  const last = field.slice(field.lastIndexOf('.') + 1);
  const scoped = endpoint === undefined ? [] : [`${endpoint} ${field}`, `${endpoint} ${last}`];
  for (const key of [...scoped, field, last]) {
    const severity = config.severityByField[key];
    if (severity !== undefined) return severity;
  }
  return config.defaultSeverity;
}

function occurrences(count: number): string {
  return count === 1 ? 'once' : `${count} times`;
}

function describe(found: IssueGroup): string {
  const types = typeWorthShowing(found.problem) ? ` (received: ${found.seen.join(', ')})` : '';
  return (
    `${found.source.endpoint} ${found.field}: ${PROBLEM_TEXT[found.problem]}${types}, ` +
    `observed ${occurrences(found.count)} in this answer, for example at ${found.example}.`
  );
}

function toFinding(found: IssueGroup, config: SchemaConfig): Finding {
  const measurement: Measurement = {
    label: `${found.source.endpoint} ${found.field}`,
    value: found.count,
    unit: 'count',
    threshold: null,
    evidence: evidence(found.source, found.example),
  };
  return {
    code: 'unreadable_field',
    severity: severityOfField(found.field, config, found.source.endpoint),
    message: describe(found),
    measurement,
    evidence: [evidence(found.source, found.example)],
  };
}

/**
 * Runs C7 on the answers of a run. With no answer at all the check is `not_applicable`: nothing was read whose
 * shape could be looked at (D9).
 */
export function runSchemaCheck(inputs: readonly SchemaInput[], config: SchemaConfig): CheckResult {
  if (inputs.length === 0) {
    return notApplicable('C7', 'No answer was read for this asset.');
  }
  const { scored } = schemaIssues(inputs);
  const findings = scored.map((found) => toFinding(found, config));
  return evaluated('C7', {
    findings,
    measurements: findings.map((finding) => finding.measurement).filter((value) => value !== null),
    sources: inputs.map((input) => input.source),
  });
}
