/**
 * The second read of the report (T6.2): every entry is re-opened against the answers it cites, and every word it
 * uses is weighed against the rule of tone.
 *
 * `isPublishable` in `findings.ts` asks only that an entry name a file. That is the weaker half of F9: a statement
 * can name a file that does not show what it says, and the reader who opens it is the one who finds out. This
 * module asks the stronger question — **does the cited answer carry what the entry states?** — and it asks it of
 * the words the entry prints, not of the numbers the generator held. Each evidence line is read back into the
 * claims it makes ("HTTP 403", "`data.platform.id` present", "E14: 9.5 s") and each claim is checked against the
 * recorded exchange. A generator that miscounts, cites the wrong file, or describes an answer it did not read
 * therefore cannot reach the report, however sincerely it was written.
 *
 * An entry whose evidence does not hold is withheld and counted, exactly as one citing no file is. That is what
 * "remove any statement that is not proven" means when it is written in code rather than promised.
 *
 * The review is deliberately strict in one further way: an evidence line that makes **no** checkable claim is an
 * issue. A line of prose beside a filename proves nothing, and a report of this kind is only worth what a reader
 * can verify without trusting it.
 *
 * Tone is reviewed in the same pass, against the rule the specification states in its first section and
 * `CLAUDE.md` repeats as rule 6: an observation, never an accusation, and never a cause. What the API itself said
 * is quoted rather than judged, so text inside quotation marks and backticks is exempt — `"Invalid parameter."` is
 * the API's own wording, and reporting it is not a word this project chose.
 */
import { ENDPOINTS, type EndpointId } from '../cmc/endpoints.js';
import { isRecord, jsonTypeOf } from '../normalize/values.js';
import { describeMs, type Corpus, type CorpusEntry } from './corpus.js';
import { walkFields, type InventoryComparison } from './fields.js';
import type { AuditEvidence, AuditFinding, FindingDraft, FindingKind } from './findings.js';
import type { SampleRun } from './sample.js';

/** What an evidence line states about the answer it cites, read back from the words it prints. */
export type EvidenceClaim =
  /** The answer was sent to this path, which is how an endpoint outside the verified inventory is named. */
  | { kind: 'path'; endpoint: string; path: string }
  /** The answer is one of that endpoint's. */
  | { kind: 'endpoint'; endpoint: EndpointId }
  | { kind: 'http'; status: number }
  /** `status.error_code` as text, or `absent` when the answer carries none. */
  | { kind: 'error-code'; code: string }
  | { kind: 'message'; text: string }
  /** The JSON type `status.error_code` arrived as. */
  | { kind: 'status-shape'; type: string }
  | { kind: 'field'; field: string; state: 'present' | 'absent' | 'null' }
  | { kind: 'field-type'; field: string; type: string }
  /** `status.credit_count`; `null` for an answer that carries none. */
  | { kind: 'credits'; reported: number | null }
  /** The latency the entry printed, in the words it printed it in. */
  | { kind: 'latency'; text: string }
  /** Distinct field names the corpus received for that endpoint. */
  | { kind: 'names'; endpoint: EndpointId; received: number }
  /** The answer is one the sample read for that asset. */
  | { kind: 'asset'; member: string }
  | { kind: 'verdict'; member: string; verdict: string; evaluated: number };

/** One thing the review found wrong with an entry. */
export interface ReviewIssue {
  /** `evidence` when a cited answer does not show what was stated, `tone` when a word breaks the rule of tone. */
  kind: 'evidence' | 'tone';
  /** The cited answer the issue is about; `null` for an issue about the entry as a whole. */
  file: string | null;
  /** What does not hold, in one line. */
  reason: string;
}

/** What the review made of one entry. */
export interface FindingReview {
  /** `A1`, `A2`, ... for an entry already numbered. */
  id: string;
  title: string;
  /** Claims read out of its evidence lines and checked. */
  claims: number;
  issues: ReviewIssue[];
}

/** Everything the review reads besides the entries themselves. */
export interface ReviewContext {
  corpus: Corpus;
  comparisons: readonly InventoryComparison[];
  sample: SampleRun | null;
}

/** What one whole review came to. */
export interface Review {
  /** Entries read. */
  entries: number;
  /** Claims read out of their evidence and checked against a recorded answer. */
  claims: number;
  /** Entries whose evidence did not hold; they are withheld rather than published. */
  unproven: FindingReview[];
  /** Entries whose wording breaks the rule of tone. Those are a fault of this project, not of the API. */
  tone: FindingReview[];
}

/**
 * Words this report does not use about the API.
 *
 * Every one of them states a judgement a corpus of recorded answers cannot support: that something is at fault
 * rather than that something was measured. The list is short on purpose — a long one catches ordinary English
 * ("the call failed to return", "the field is missing from the answer") and would push the generators into
 * circumlocution rather than into neutrality.
 */
export const ACCUSATORY = [
  'wrong',
  'broken',
  'buggy',
  'defective',
  'flawed',
  'faulty',
  'at fault',
  'unreliable',
  'misleading',
  'sloppy',
  'careless',
  'negligent',
  'to blame',
  'violates',
  'fails to',
  'should have',
  'ought to have',
  'obviously',
] as const;

/**
 * Turns of phrase that state a cause.
 *
 * "53 % of the answers carried HTTP 500" is a measurement; "the endpoint was overloaded, which is why" is a cause,
 * and nothing in a corpus of recorded answers establishes one. The report says as much of itself, so the words
 * that would break that promise are named here.
 */
export const CAUSAL = ['because the api', 'caused by', 'due to the', 'the cause is', 'which is why the api'] as const;

/** The three kinds an entry may be; anything else is an entry this report does not know how to weigh. */
const KINDS: readonly string[] = ['observed', 'signal', 'suggestion'] satisfies readonly FindingKind[];

/** One step of a concrete path: a field name, then the positions taken inside it. */
interface PathStep {
  key: string;
  positions: string[];
}

/** `data[4705].platform.id` read as steps, or `null` when it is not a path this report writes. */
function parsePath(path: string): PathStep[] | null {
  const steps: PathStep[] = [];
  for (const part of path.split('.')) {
    const match = /^([^[\]]+)((?:\[[^[\]]+\])*)$/.exec(part);
    if (match === null) return null;
    const positions = [...(match[2] ?? '').matchAll(/\[([^[\]]+)\]/g)].map((one) => one[1] ?? '');
    steps.push({ key: match[1] ?? '', positions });
  }
  return steps;
}

/** What a concrete path points at inside one answer, and whether it points at anything at all. */
export function resolvePath(body: unknown, path: string): { found: boolean; value: unknown } {
  const steps = parsePath(path);
  const missing = { found: false, value: undefined };
  if (steps === null) return missing;

  let current: unknown = body;
  for (const step of steps) {
    if (!isRecord(current) || !(step.key in current)) return missing;
    current = current[step.key];
    for (const position of step.positions) {
      if (Array.isArray(current)) {
        const index = Number(position);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) return missing;
        current = current[index];
        continue;
      }
      if (isRecord(current) && position in current) {
        current = current[position];
        continue;
      }
      return missing;
    }
  }
  return { found: true, value: current };
}

/** Whether an endpoint identifier is one of the verified inventory. */
function isEndpointId(value: string): value is EndpointId {
  return Object.prototype.hasOwnProperty.call(ENDPOINTS, value);
}

/**
 * The fields of a body, walked once.
 *
 * An entry may state ten things about the same answer, and the largest answers of this corpus carry several
 * thousand entries: walking one of those once per claim is the difference between a review that runs with the
 * audit and one nobody waits for.
 */
const WALKED = new WeakMap<object, ReturnType<typeof walkFields>>();

function fieldsOf(body: unknown): ReturnType<typeof walkFields> {
  if (typeof body !== 'object' || body === null) return walkFields(body);
  const seen = WALKED.get(body);
  if (seen !== undefined) return seen;
  const walked = walkFields(body);
  WALKED.set(body, walked);
  return walked;
}

/**
 * The claims one evidence line makes.
 *
 * The line is read as a reader reads it — from its words — rather than from whatever the generator knew when it
 * wrote it. That is the whole point of the pass: a sentence and a number that no longer agree are only caught by
 * something that reads the sentence.
 */
export function claimsOf(evidence: AuditEvidence): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  const { shows, field } = evidence;

  const path = /^(E\d+) (\/\S+):/.exec(shows);
  if (path !== null) claims.push({ kind: 'path', endpoint: path[1] ?? '', path: path[2] ?? '' });

  const named = /^(E\d+)[ :]/.exec(shows);
  const id = named?.[1] ?? '';
  if (path === null && isEndpointId(id)) claims.push({ kind: 'endpoint', endpoint: id });

  const http = /\bHTTP (\d{3})\b/.exec(shows);
  if (http !== null) claims.push({ kind: 'http', status: Number(http[1]) });

  const code = /\berror_code (\S+?)(?:,|$)/.exec(shows);
  if (code !== null) claims.push({ kind: 'error-code', code: code[1] ?? '' });

  const message = /"([^"]*)"/.exec(shows);
  if (message !== null) claims.push({ kind: 'message', text: message[1] ?? '' });

  // "string on E02, E03 and 7 more" and "the string shape, on E01" both describe the shape of the status block.
  const shape = /^(?:the )?(string|number)(?: shape,)? on /.exec(shows);
  if (shape !== null) claims.push({ kind: 'status-shape', type: shape[1] ?? '' });

  const asType = /^E\d+ as (\w+) on \d+ answer\(s\)$/.exec(shows);
  if (asType !== null) claims.push({ kind: 'status-shape', type: asType[1] ?? '' });

  const present = /`([^`]+)` present$/.exec(shows);
  if (present !== null) claims.push({ kind: 'field', field: present[1] ?? '', state: 'present' });

  const absent = /`([^`]+)` absent$/.exec(shows);
  if (absent !== null) claims.push({ kind: 'field', field: absent[1] ?? '', state: 'absent' });

  const nulled = /`([^`]+)` null on \d+ answer\(s\)$/.exec(shows);
  if (nulled !== null) claims.push({ kind: 'field', field: nulled[1] ?? '', state: 'null' });

  const fieldType = /^`([^`]+)` as (\w+) on \d+ answer\(s\)$/.exec(shows);
  if (fieldType !== null) claims.push({ kind: 'field-type', field: fieldType[1] ?? '', type: fieldType[2] ?? '' });

  // A shape the normalisers could not read: "E11 `data.t0.liq`: sometimes a string, received string/number".
  const shapeIssue = /^E\d+ `([^`]+)`: .+, received /.exec(shows);
  if (shapeIssue !== null) claims.push({ kind: 'field', field: shapeIssue[1] ?? '', state: 'present' });

  const carrying = /^E\d+ answer carrying (.+)$/.exec(shows);
  if (carrying !== null) {
    for (const name of (carrying[1] ?? '').split(', ')) {
      if (!name.endsWith(' more')) claims.push({ kind: 'field', field: name, state: 'present' });
    }
  }

  const credits = /^E\d+: (\d+) reported, \d+ reserved$/.exec(shows);
  if (credits !== null) claims.push({ kind: 'credits', reported: Number(credits[1]) });

  // The other shape a cost is written in, on the entry that reports a cost this project did not reserve.
  const creditValue = /^(\d+|absent) on \d+ answer\(s\)$/.exec(shows);
  if (creditValue !== null && field === 'status.credit_count') {
    const value = creditValue[1] ?? '';
    claims.push({ kind: 'credits', reported: value === 'absent' ? null : Number(value) });
  }

  const latency = /^E\d+: (\d+(?:\.\d+)? (?:ms|s))(?:, pacing included)?$/.exec(shows);
  if (latency !== null) claims.push({ kind: 'latency', text: latency[1] ?? '' });

  const names = /^(E\d+): \d+ name\(s\) recorded, (\d+) received$/.exec(shows);
  const namesOf = names?.[1] ?? '';
  if (isEndpointId(namesOf)) claims.push({ kind: 'names', endpoint: namesOf, received: Number(names?.[2]) });

  const read = /^C\d `[a-z_]+` as read on (.+)$/.exec(shows);
  if (read !== null) claims.push({ kind: 'asset', member: read[1] ?? '' });

  const verdict = /^(.+): (ACT|CAUTION|DO_NOT_ACT) on (\d+) of 7 checks$/.exec(shows);
  if (verdict !== null) {
    claims.push({
      kind: 'verdict',
      member: verdict[1] ?? '',
      verdict: verdict[2] ?? '',
      evaluated: Number(verdict[3]),
    });
  }

  return claims;
}

/** Every answer the sample read for one asset, as files; `null` when the sample holds no such asset. */
function sourcesOf(sample: SampleRun, member: string): string[] | null {
  const outcome = sample.outcomes.find((one) => (one.member.symbol ?? `CMC ${String(one.member.cmcId)}`) === member);
  if (outcome === undefined) return null;
  return outcome.sources.flatMap((source) => (source.fixture === null ? [] : [source.fixture.file]));
}

/** Whether one claim holds against the answer it was read from: the reason it does not, or `null`. */
function checkClaim(
  claim: EvidenceClaim,
  entry: CorpusEntry,
  evidence: AuditEvidence,
  context: ReviewContext,
): string | null {
  switch (claim.kind) {
    case 'path':
      return entry.path === claim.path
        ? null
        : `states ${claim.endpoint} ${claim.path}, and the answer was sent to ${entry.path}`;
    case 'endpoint':
      return entry.endpoint === claim.endpoint
        ? null
        : `states ${claim.endpoint}, and the answer is ${entry.endpoint ?? `outside the inventory (${entry.path})`}`;
    case 'http':
      return entry.http === claim.status
        ? null
        : `states HTTP ${String(claim.status)}, and the answer carries HTTP ${String(entry.http)}`;
    case 'error-code': {
      const received = entry.status?.errorCode ?? 'absent';
      return received === claim.code ? null : `states error_code ${claim.code}, and the answer carries ${received}`;
    }
    case 'message': {
      const received = entry.status?.errorMessage ?? null;
      if (claim.text === 'no message') {
        return received === null ? null : `states no message, and the answer carries "${received}"`;
      }
      return received !== null && received.includes(claim.text)
        ? null
        : `quotes "${claim.text}", and the answer carries ${received === null ? 'no message' : `"${received}"`}`;
    }
    case 'status-shape': {
      const received = entry.status?.errorCodeType ?? 'absent';
      return received === claim.type
        ? null
        : `states error_code arrived as a ${claim.type}, and in this answer it is a ${received}`;
    }
    case 'field': {
      const walked = fieldsOf(entry.body).get(claim.field);
      if (claim.state === 'absent') {
        return walked === undefined ? null : `states \`${claim.field}\` absent, and the answer carries it`;
      }
      if (walked === undefined) return `states \`${claim.field}\` ${claim.state}, and the answer does not carry it`;
      if (claim.state === 'null' && !(walked.types.length === 1 && walked.types[0] === 'null')) {
        return `states \`${claim.field}\` null, and the answer carries it as ${walked.types.join('/')}`;
      }
      if (evidence.field === null) return null;
      const found = resolvePath(entry.body, evidence.field);
      if (!found.found) return `points at \`${evidence.field}\`, and nothing is there`;
      if (claim.state === 'null' && found.value !== null) {
        return `points at \`${evidence.field}\` as null, and it carries a ${jsonTypeOf(found.value)}`;
      }
      return null;
    }
    case 'field-type': {
      const walked = fieldsOf(entry.body).get(claim.field);
      if (walked === undefined) return `states \`${claim.field}\` as a ${claim.type}, and the answer does not carry it`;
      return walked.types.includes(claim.type)
        ? null
        : `states \`${claim.field}\` as a ${claim.type}, and the answer carries it as ${walked.types.join('/')}`;
    }
    case 'credits': {
      const received = entry.status?.creditCount ?? null;
      return received === claim.reported
        ? null
        : `states ${claim.reported === null ? 'no' : String(claim.reported)} credit(s) reported, and the answer ` +
            `reports ${received === null ? 'none' : String(received)}`;
    }
    case 'latency': {
      const received = describeMs(entry.latencyMs);
      return received === claim.text ? null : `states ${claim.text}, and the answer was timed at ${received}`;
    }
    case 'names': {
      const comparison = context.comparisons.find((one) => one.endpoint === claim.endpoint);
      if (comparison === undefined) return `states what ${claim.endpoint} received, and no comparison was run for it`;
      return comparison.received === claim.received
        ? null
        : `states ${String(claim.received)} name(s) received for ${claim.endpoint}, and the corpus carried ` +
            `${String(comparison.received)}`;
    }
    case 'asset': {
      if (context.sample === null) return 'names an asset of the sample, and no engine pass was made';
      const sources = sourcesOf(context.sample, claim.member);
      if (sources === null) return `names ${claim.member}, which is not an asset of the sample`;
      return sources.includes(evidence.file)
        ? null
        : `names ${claim.member}, and this answer is not one the sample read for it`;
    }
    case 'verdict': {
      if (context.sample === null) return 'states a verdict of the sample, and no engine pass was made';
      const outcome = context.sample.thin.find((one) => one.member === claim.member);
      if (outcome === undefined) return `names ${claim.member}, which the sample did not report on thin coverage`;
      if (outcome.verdict !== claim.verdict || outcome.evaluated !== claim.evaluated) {
        return (
          `states ${claim.member} at ${claim.verdict} on ${String(claim.evaluated)} of the checks, and the sample ` +
          `read ${outcome.verdict} on ${String(outcome.evaluated)}`
        );
      }
      return outcome.example === evidence.file
        ? null
        : `names ${claim.member}, and this answer is not the one the sample read that verdict from`;
    }
  }
}

/** The wording of an entry, with what the API itself said taken out: a quotation is not a word we chose. */
function ourWords(finding: FindingDraft): string {
  return `${finding.title} ${finding.statement}`
    .replace(/"[^"]*"/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[“][^”]*[”]/g, ' ')
    .toLowerCase();
}

/** What the rule of tone finds wrong with an entry's wording. */
export function toneIssues(finding: FindingDraft): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const words = ourWords(finding);

  if (!KINDS.includes(finding.kind)) {
    issues.push({ kind: 'tone', file: null, reason: `is of kind \`${finding.kind}\`, which this report does not use` });
  }
  for (const word of ACCUSATORY) {
    if (words.includes(word)) issues.push({ kind: 'tone', file: null, reason: `says "${word}" of the API` });
  }
  for (const phrase of CAUSAL) {
    if (words.includes(phrase)) issues.push({ kind: 'tone', file: null, reason: `states a cause: "${phrase}"` });
  }
  return issues;
}

/**
 * Reads one entry back against the answers it cites.
 *
 * A file named but not in the corpus is an issue, as is a line that states nothing checkable: both leave a reader
 * with a sentence and no way to confirm it, which is the one thing this report is built not to do.
 */
export function reviewDraft(finding: FindingDraft, context: ReviewContext): { claims: number; issues: ReviewIssue[] } {
  const entries = new Map(context.corpus.entries.map((entry) => [entry.file, entry]));
  const issues: ReviewIssue[] = [...toneIssues(finding)];
  let claims = 0;

  for (const evidence of finding.evidence) {
    if (evidence.file.trim() === '') continue;
    const entry = entries.get(evidence.file);
    if (entry === undefined) {
      issues.push({ kind: 'evidence', file: evidence.file, reason: 'is not an answer of the corpus this run read' });
      continue;
    }
    const read = claimsOf(evidence);
    if (read.length === 0) {
      issues.push({ kind: 'evidence', file: evidence.file, reason: `states nothing checkable: "${evidence.shows}"` });
      continue;
    }
    claims += read.length;
    for (const claim of read) {
      const wrong = checkClaim(claim, entry, evidence, context);
      if (wrong !== null) issues.push({ kind: 'evidence', file: evidence.file, reason: wrong });
    }
  }

  return { claims, issues };
}

/** Whether the answers an entry cites show what it states. This is what decides publication. */
export function isProven(finding: FindingDraft, context: ReviewContext): boolean {
  return reviewDraft(finding, context).issues.every((issue) => issue.kind !== 'evidence');
}

/** Reads every published entry back against the corpus, and weighs its words. */
export function reviewFindings(findings: readonly AuditFinding[], context: ReviewContext): Review {
  const reviews: FindingReview[] = findings.map((finding) => {
    const { claims, issues } = reviewDraft(finding, context);
    return { id: finding.id, title: finding.title, claims, issues };
  });
  const only = (kind: ReviewIssue['kind']): FindingReview[] =>
    reviews
      .map((review) => ({ ...review, issues: review.issues.filter((issue) => issue.kind === kind) }))
      .filter((review) => review.issues.length > 0);

  return {
    entries: reviews.length,
    claims: reviews.reduce((sum, review) => sum + review.claims, 0),
    unproven: only('evidence'),
    tone: only('tone'),
  };
}
