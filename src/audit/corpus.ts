/**
 * The recorded exchanges the audit measures (specification F9): every raw request and answer this project has
 * captured, read from disk and grouped by endpoint.
 *
 * The audit sends no request of its own (D14): a statement about the API that a reader cannot open the answer
 * behind is not publishable, so everything measured here comes from a file that is in the repository. That also
 * means the report costs no credit to reproduce.
 *
 * Three groupings matter and they are not the same:
 * - **by endpoint**, for what does not depend on the call: the shape of the `status` block, the cost an answer
 *   reports, whether it came back at all;
 * - **by request shape** — the API path and the *names* of the query parameters, never their values — for what
 *   does. E06 answers carry `quotes[].last_updated` when `include_last_updated=true` is sent and not otherwise, so
 *   a field seen in one answer and absent from another only says something about the API when both answers were
 *   asked the same question;
 * - **by capture**, for the clock. A run that paces itself against the per-minute request limit waits for a free
 *   slot inside the measured interval, so its recorded latencies are upper bounds on the time the API took. Only a
 *   capture made one call at a time measures the API alone, and the report has to be able to tell them apart.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS, endpointForPath, type EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import { evidencePath, type RecordedExchange } from '../cmc/fixtures.js';
import { isRecord, jsonTypeOf, toFiniteNumber, toText } from '../normalize/values.js';

/** One capture of recorded answers: a directory, and the name the report calls it by. */
export interface CorpusPart {
  name: string;
  dir: string;
  /** What produced it, in one line, for the report to say what it is reading. */
  description: string;
  /**
   * Whether the run that recorded it paced its requests against the per-minute limit. A paced recording measures
   * the wait for a free slot as well as the answer, so its latencies are upper bounds (D14).
   */
  paced: boolean;
}

/** The `status` block of an answer, as the audit reads it: the shape, not only the value (observation 1). */
export interface StatusBlock {
  /** `status.error_code` written back as text, whatever type it arrived as. */
  errorCode: string | null;
  /** The JSON type it arrived as: `number`, `string`, `null` or `absent`. */
  errorCodeType: string;
  /** `status.error_message`, as sent; `null` when absent or empty. */
  errorMessage: string | null;
  /** `status.credit_count`; `null` when the answer carries none. */
  creditCount: number | null;
  /** `status.timestamp`, the server clock of the answer (D4); `null` when absent. */
  timestamp: string | null;
  /** Whether the answer carries the `notice` field the number-shaped block adds (observation 1). */
  hasNotice: boolean;
}

/** One recorded exchange, as the audit reads it. */
export interface CorpusEntry {
  /** Path to cite, relative to the project root. */
  file: string;
  /** The capture it was read from. */
  part: string;
  label: string;
  recordedAt: string;
  /** `null` for a path outside the verified inventory, which is counted and never measured here. */
  endpoint: EndpointId | null;
  path: string;
  /** The API path and the names of the query parameters, sorted: what makes two calls the same question. */
  shape: string;
  /** The API path and the whole query, sorted: what makes two calls the same request (`requestKey`). */
  request: string;
  http: number;
  latencyMs: number;
  status: StatusBlock | null;
  body: unknown;
}

/** A file under a capture directory that is not a recorded exchange, kept so the report can say so. */
export interface CorpusSkip {
  file: string;
  reason: string;
}

/** Everything one run of the audit read. */
export interface Corpus {
  parts: (CorpusPart & { answers: number })[];
  entries: CorpusEntry[];
  skipped: CorpusSkip[];
}

/** The request shape of a call: the path and the parameter names, never their values. */
export function requestShape(path: string, query: Readonly<Record<string, string>>): string {
  const names = Object.keys(query).sort();
  return names.length === 0 ? path : `${path}?${names.join('&')}`;
}

/**
 * The request a call made: the path and the whole query, sorted.
 *
 * This is what tells one question from another, and therefore what tells a retried call from a second call. The
 * label of a recording cannot: the recorder names files after the run, so a walk that asks the same question
 * twice writes two labels for one request.
 */
export function requestOf(path: string, query: Readonly<Record<string, string>>): string {
  const params = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return params.length === 0 ? path : `${path}?${new URLSearchParams(params).toString()}`;
}

/** Reads the `status` block of a response body, or `null` when the body carries none. */
export function readStatus(body: unknown): StatusBlock | null {
  if (!isRecord(body) || !isRecord(body.status)) return null;
  const { status } = body;
  const code = status.error_code;
  // `error_code` has arrived as both a number and a string (observation 1), so it is written back as text
  // whatever it was. Anything that is not a scalar is not a code: `errorCodeType` still records what it was.
  const scalar = typeof code === 'string' || typeof code === 'number' || typeof code === 'boolean';
  return {
    errorCode: scalar ? String(code) : null,
    errorCodeType: jsonTypeOf(code),
    errorMessage: toText(status.error_message),
    creditCount: toFiniteNumber(status.credit_count),
    timestamp: toText(status.timestamp),
    hasNotice: 'notice' in status,
  };
}

/** Whether an answer is one the API accepted: HTTP 200 and the CMC error code 0, whichever type it arrived as. */
export function succeeded(entry: CorpusEntry): boolean {
  return entry.http === 200 && (entry.status === null || entry.status.errorCode === '0');
}

/** Every `.json` file under a directory and its subdirectories, sorted by path. */
function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listJsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
    })
    .sort();
}

/** Reads one file as a recorded exchange, or says why it is not one. A malformed file is never fatal here. */
export function readEntry(file: string, part = ''): CorpusEntry | CorpusSkip {
  const skip = (reason: string): CorpusSkip => ({ file: evidencePath(file), reason });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return skip(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed) || !isRecord(parsed.request) || !isRecord(parsed.response)) {
    return skip('no request or response object');
  }
  const { request, response } = parsed as unknown as RecordedExchange;
  if (typeof request.path !== 'string' || typeof response.status !== 'number') {
    return skip('no request path or response status');
  }
  const query = isRecord(request.query) ? request.query : {};
  return {
    file: evidencePath(file),
    part,
    label: typeof parsed.label === 'string' ? parsed.label : evidencePath(file),
    recordedAt: typeof parsed.recordedAt === 'string' ? parsed.recordedAt : '',
    endpoint: endpointForPath(request.path) ?? null,
    path: request.path,
    shape: requestShape(request.path, query),
    request: requestOf(request.path, query),
    http: response.status,
    latencyMs: typeof response.latencyMs === 'number' ? response.latencyMs : 0,
    status: readStatus(response.body),
    body: response.body,
  };
}

function isSkip(value: CorpusEntry | CorpusSkip): value is CorpusSkip {
  return 'reason' in value;
}

/**
 * Reads every recorded exchange of every capture.
 *
 * Every file is kept, superseded recordings included: replay keeps one answer per request because it has to answer
 * a call, and the audit counts answers rather than answering with them. Two captures naming the same directory
 * would therefore count it twice; the caller passes distinct ones.
 */
export function readCorpus(parts: readonly CorpusPart[]): Corpus {
  const entries: CorpusEntry[] = [];
  const skipped: CorpusSkip[] = [];
  const read: (CorpusPart & { answers: number })[] = [];
  for (const part of parts) {
    let isDirectory = false;
    try {
      isDirectory = statSync(part.dir).isDirectory();
    } catch {
      // Reported just below, with the path the caller gave.
    }
    if (!isDirectory) {
      throw new CmcError('config', `Audit: capture directory not found: ${evidencePath(part.dir)}.`);
    }
    let answers = 0;
    for (const file of listJsonFiles(part.dir)) {
      const entry = readEntry(file, part.name);
      if (isSkip(entry)) skipped.push(entry);
      else {
        entries.push(entry);
        answers += 1;
      }
    }
    read.push({ ...part, dir: evidencePath(part.dir), answers });
  }
  return { parts: read, entries, skipped };
}

/** How often one value was observed, with a file to open it in. */
export interface Observed<T> {
  value: T;
  answers: number;
  /** One recorded answer carrying it. */
  example: string;
}

/**
 * A duration in the unit it was measured in, as every part of the audit writes it.
 *
 * One function rather than one per file: the review of T6.2 re-reads the durations the entries print and compares
 * them with the recorded answers, so a second rounding rule would make it report a difference of its own making.
 */
export function describeMs(value: number): string {
  return value < 1000 ? `${String(Math.round(value))} ms` : `${String(Math.round(value / 100) / 10)} s`;
}

/** Latency over a set of recorded answers, in milliseconds, with the slowest one named. */
export interface LatencyStats {
  answers: number;
  minMs: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
  slowest: { file: string; ms: number };
}

/** One answer the API did not accept. */
export interface ErrorAnswer {
  http: number;
  code: string | null;
  message: string | null;
  answers: number;
  /** Distinct requests behind those answers: the client retries, so answers alone overstate how often it happened. */
  requests: number;
  creditsReported: number;
  example: string;
  firstRecordedAt: string;
  lastRecordedAt: string;
}

/** What the corpus says about one endpoint. */
export interface EndpointCorpus {
  endpoint: EndpointId;
  path: string;
  answers: number;
  accepted: number;
  /** The distinct questions that were asked of it, most recorded first. */
  shapes: Observed<string>[];
  firstRecordedAt: string;
  lastRecordedAt: string;
  /** HTTP statuses observed, most frequent first. */
  http: Observed<number>[];
  /** `status.error_code` values of the accepted answers, with the JSON type each arrived as. */
  errorCodes: Observed<{ code: string | null; type: string }>[];
  /** Whether the `notice` field of the number-shaped `status` block was present, absent or both. */
  notice: Observed<boolean>[];
  /** `status.credit_count` of the accepted answers only: a refusal reports its own cost, which is not the call's. */
  credits: Observed<number | null>[];
  /** The per-call cost `src/cmc/endpoints.ts` reserves before sending, to read against the line above. */
  declaredCredits: number;
  /** The answers the API did not accept, most frequent first. */
  errors: ErrorAnswer[];
  /** Over every recorded answer, pacing included: an upper bound on what the API took. */
  latency: LatencyStats;
  /**
   * Over the answers of captures recorded one call at a time. These are the ones that measure the API rather
   * than the wait for a free request slot; `null` when every answer of this endpoint came from a paced run.
   */
  unpacedLatency: LatencyStats | null;
}

/** Counts distinct values, most frequent first, keeping one file per value as evidence. */
function tally<T>(entries: readonly CorpusEntry[], of: (entry: CorpusEntry) => T): Observed<T>[] {
  const found = new Map<string, Observed<T>>();
  for (const entry of entries) {
    const value = of(entry);
    const key = JSON.stringify(value) ?? 'undefined';
    const seen = found.get(key);
    if (seen) seen.answers += 1;
    else found.set(key, { value, answers: 1, example: entry.file });
  }
  return [...found.values()].sort((a, b) => b.answers - a.answers);
}

/** The value at a percentile of a sorted list, nearest rank; 0 for an empty list. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

/** Latency over a set of recorded answers. */
export function latencyOf(entries: readonly CorpusEntry[]): LatencyStats {
  const sorted = entries.map((entry) => entry.latencyMs).sort((a, b) => a - b);
  const slowest = entries.reduce<CorpusEntry | null>(
    (worst, entry) => (worst === null || entry.latencyMs > worst.latencyMs ? entry : worst),
    null,
  );
  return {
    answers: entries.length,
    minMs: sorted[0] ?? 0,
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    maxMs: sorted[sorted.length - 1] ?? 0,
    slowest: { file: slowest?.file ?? '', ms: slowest?.latencyMs ?? 0 },
  };
}

/** The answers the API did not accept, grouped by HTTP status and CMC error code. */
function errorsOf(entries: readonly CorpusEntry[]): ErrorAnswer[] {
  const found = new Map<string, ErrorAnswer & { shapes: Set<string> }>();
  for (const entry of entries) {
    const code = entry.status?.errorCode ?? null;
    const message = entry.status?.errorMessage ?? null;
    const key = `${String(entry.http)}|${code ?? ''}|${message ?? ''}`;
    const seen = found.get(key);
    if (seen) {
      seen.answers += 1;
      seen.creditsReported += entry.status?.creditCount ?? 0;
      seen.shapes.add(entry.request);
      if (entry.recordedAt < seen.firstRecordedAt) seen.firstRecordedAt = entry.recordedAt;
      if (entry.recordedAt > seen.lastRecordedAt) seen.lastRecordedAt = entry.recordedAt;
      continue;
    }
    found.set(key, {
      http: entry.http,
      code,
      message,
      answers: 1,
      requests: 0,
      creditsReported: entry.status?.creditCount ?? 0,
      example: entry.file,
      firstRecordedAt: entry.recordedAt,
      lastRecordedAt: entry.recordedAt,
      shapes: new Set([entry.request]),
    });
  }
  return [...found.values()]
    .map(({ shapes, ...error }) => ({ ...error, requests: shapes.size }))
    .sort((a, b) => b.answers - a.answers);
}

/** The entries of one endpoint, oldest recording first. */
export function entriesOf(corpus: Corpus, endpoint: EndpointId): CorpusEntry[] {
  return corpus.entries
    .filter((entry) => entry.endpoint === endpoint)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** What the corpus says about each endpoint it holds an answer for, in the order of the inventory. */
export function endpointCorpora(corpus: Corpus): EndpointCorpus[] {
  const paced = new Set(corpus.parts.filter((part) => part.paced).map((part) => part.name));
  return (Object.keys(ENDPOINTS) as EndpointId[]).flatMap((endpoint) => {
    const entries = entriesOf(corpus, endpoint);
    if (entries.length === 0) return [];
    const accepted = entries.filter(succeeded);
    const refused = entries.filter((entry) => !succeeded(entry));
    const unpaced = entries.filter((entry) => !paced.has(entry.part));
    return [
      {
        endpoint,
        path: ENDPOINTS[endpoint].path,
        answers: entries.length,
        accepted: accepted.length,
        shapes: tally(entries, (entry) => entry.shape),
        firstRecordedAt: entries[0]?.recordedAt ?? '',
        lastRecordedAt: entries[entries.length - 1]?.recordedAt ?? '',
        http: tally(entries, (entry) => entry.http),
        errorCodes: tally(accepted, (entry) => ({
          code: entry.status?.errorCode ?? null,
          type: entry.status?.errorCodeType ?? 'absent',
        })),
        notice: tally(accepted, (entry) => entry.status?.hasNotice ?? false),
        credits: tally(accepted, (entry) => entry.status?.creditCount ?? null),
        declaredCredits: ENDPOINTS[endpoint].credits,
        errors: errorsOf(refused),
        latency: latencyOf(entries),
        unpacedLatency: unpaced.length === 0 ? null : latencyOf(unpaced),
      },
    ];
  });
}

/** What every answer of the corpus reported it cost, summed; the answers that reported nothing are counted apart. */
export function corpusCredits(corpus: Corpus): { reported: number; answers: number; withoutCount: number } {
  let reported = 0;
  let withoutCount = 0;
  for (const entry of corpus.entries) {
    const count = entry.status?.creditCount ?? null;
    if (count === null) withoutCount += 1;
    else reported += count;
  }
  return { reported, answers: corpus.entries.length, withoutCount };
}
