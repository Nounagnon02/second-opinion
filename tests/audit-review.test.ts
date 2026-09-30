/**
 * The second read of the report (T6.2): every entry is re-opened against the answers it cites, and every word it
 * uses is weighed against the rule of tone.
 *
 * `isPublishable` (T6.1) asks only that an entry name a file. A filename is cheap: a generator that miscounts,
 * cites the wrong answer, or describes one it never opened passes that gate untouched, and the reader who opens
 * the file is the one who finds out. The tests here pin the stronger question this module asks — **does the cited
 * answer carry what the entry states?** — and they ask it the way the module does, from the words the entry
 * prints rather than from the numbers the generator held.
 *
 * Each case below is a statement that is true of one corpus and false of another, with nothing else changed. That
 * is the only way to show the gate reads the answer rather than trusting the sentence beside it.
 */
import { describe, expect, it } from 'vitest';
import type { Corpus, CorpusEntry } from '../src/audit/corpus.js';
import type { AuditFinding, AuditEvidence, FindingDraft } from '../src/audit/findings.js';
import {
  ACCUSATORY,
  CAUSAL,
  claimsOf,
  isProven,
  resolvePath,
  reviewDraft,
  reviewFindings,
  toneIssues,
  type ReviewContext,
} from '../src/audit/review.js';
import type { EndpointId } from '../src/cmc/endpoints.js';

const RECORDED_AT = '2026-09-24T16:00:00.000Z';

interface Answer {
  file: string;
  path?: string;
  endpoint?: EndpointId | null;
  http?: number;
  code?: string;
  codeType?: 'string' | 'number';
  message?: string | null;
  credits?: number | null;
  latencyMs?: number;
  body?: unknown;
}

function answer(parts: Answer): CorpusEntry {
  const path = parts.path ?? '/v1/x';
  return {
    file: parts.file,
    part: 'discovery',
    label: parts.file,
    recordedAt: RECORDED_AT,
    endpoint: parts.endpoint ?? null,
    path,
    shape: path,
    request: path,
    http: parts.http ?? 200,
    latencyMs: parts.latencyMs ?? 100,
    status: {
      errorCode: parts.code ?? '0',
      errorCodeType: parts.codeType ?? 'string',
      errorMessage: parts.message ?? null,
      creditCount: parts.credits === undefined ? 1 : parts.credits,
      timestamp: RECORDED_AT,
      hasNotice: false,
    },
    body: parts.body ?? {},
  };
}

function corpusOf(answers: readonly Answer[]): Corpus {
  return {
    parts: [
      { name: 'discovery', dir: 'fixtures/discovery', description: 'a capture', paced: false, answers: answers.length },
    ],
    entries: answers.map(answer),
    skipped: [],
  };
}

function context(parts: Partial<ReviewContext> = {}): ReviewContext {
  return { corpus: corpusOf([]), comparisons: [], sample: null, ...parts };
}

/** An entry whose wording is neutral, so that only its evidence is under test. */
function draft(evidence: AuditEvidence[], parts: Partial<FindingDraft> = {}): FindingDraft {
  return {
    kind: 'observed',
    endpoints: [],
    title: 'An endpoint answered',
    statement: 'A number was measured against what this project reserves for it.',
    measurement: null,
    evidence,
    ...parts,
  };
}

const FILE = 'fixtures/discovery/a.json';

describe('resolvePath', () => {
  const body = { data: [{ platform: { id: 1 } }], quote: { USD: { price: null } }, '1839': { name: 'BNB' } };

  it('follows a path into nested objects and arrays', () => {
    expect(resolvePath(body, 'data[0].platform.id')).toEqual({ found: true, value: 1 });
    expect(resolvePath(body, 'quote.USD.price')).toEqual({ found: true, value: null });
  });

  it('reads a bracket as a key when the value is an object, which is how CMC returns a map by id', () => {
    expect(resolvePath(body, 'data[1839]')).toEqual({ found: false, value: undefined });
    expect(resolvePath({ data: { '1839': { name: 'BNB' } } }, 'data[1839].name')).toEqual({
      found: true,
      value: 'BNB',
    });
  });

  it('finds nothing where nothing is', () => {
    expect(resolvePath(body, 'data[4].platform').found).toBe(false);
    expect(resolvePath(body, 'status.error_code').found).toBe(false);
    expect(resolvePath(body, 'quote.USD.price.nested').found).toBe(false);
  });

  it('tells a value that is there and null from one that is absent', () => {
    expect(resolvePath(body, 'quote.USD.price')).toEqual({ found: true, value: null });
    expect(resolvePath(body, 'quote.EUR.price')).toEqual({ found: false, value: undefined });
  });
});

describe('claimsOf', () => {
  const shows = (text: string, field: string | null = null): AuditEvidence => ({ file: FILE, field, shows: text });

  it('reads an endpoint and a path out of a refusal line', () => {
    expect(claimsOf(shows('E04 /v2/a: HTTP 403, error_code 1006'))).toEqual([
      { kind: 'path', endpoint: 'E04', path: '/v2/a' },
      { kind: 'http', status: 403 },
      { kind: 'error-code', code: '1006' },
    ]);
  });

  it('reads the message the API itself sent', () => {
    const read = claimsOf(shows('HTTP 400, error_code 4001, "Invalid parameter."'));
    expect(read).toContainEqual({ kind: 'message', text: 'Invalid parameter.' });
  });

  it('reads a duration in the words the entry printed it in', () => {
    expect(claimsOf(shows('E03: 5.9 s'))).toContainEqual({ kind: 'latency', text: '5.9 s' });
    expect(claimsOf(shows('E05: 20 s, pacing included'))).toContainEqual({ kind: 'latency', text: '20 s' });
  });

  it('reads a cost, present or absent', () => {
    expect(claimsOf(shows('E02: 1 reported, 1 reserved'))).toContainEqual({ kind: 'credits', reported: 1 });
    expect(claimsOf(shows('absent on 3 answer(s)', 'status.credit_count'))).toContainEqual({
      kind: 'credits',
      reported: null,
    });
  });

  it('reads a field that is present, absent or null', () => {
    expect(claimsOf(shows('`data.platform` present'))).toContainEqual({
      kind: 'field',
      field: 'data.platform',
      state: 'present',
    });
    expect(claimsOf(shows('same question, `data.platform` absent'))).toContainEqual({
      kind: 'field',
      field: 'data.platform',
      state: 'absent',
    });
    expect(claimsOf(shows('`data.logo` null on 4 answer(s)'))).toContainEqual({
      kind: 'field',
      field: 'data.logo',
      state: 'null',
    });
  });

  it('reads the shape the status block arrived in', () => {
    expect(claimsOf(shows('E02 as number on 5 answer(s)'))).toContainEqual({ kind: 'status-shape', type: 'number' });
    expect(claimsOf(shows('the string shape, on E01'))).toContainEqual({ kind: 'status-shape', type: 'string' });
  });

  it('reads an asset and a verdict of the engine pass', () => {
    expect(claimsOf(shows('C7 `unreadable_field` as read on BTC'))).toContainEqual({ kind: 'asset', member: 'BTC' });
    expect(claimsOf(shows('BTC: ACT on 3 of 7 checks'))).toContainEqual({
      kind: 'verdict',
      member: 'BTC',
      verdict: 'ACT',
      evaluated: 3,
    });
  });

  it('reads nothing out of a line of prose, which is what makes such a line an issue', () => {
    expect(claimsOf(shows('this endpoint looks fine to me'))).toEqual([]);
  });
});

describe('reviewDraft reads the answer rather than the sentence', () => {
  const line = (shows: string, field: string | null = null): AuditEvidence[] => [{ file: FILE, field, shows }];
  const reasons = (finding: FindingDraft, ctx: ReviewContext): string[] =>
    reviewDraft(finding, ctx).issues.map((issue) => issue.reason);

  it('accepts a statement the cited answer carries', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: null, path: '/v2/a', http: 403, code: '1006' }]) });
    const finding = draft(line('E04 /v2/a: HTTP 403, error_code 1006'));
    expect(reviewDraft(finding, ctx).claims).toBe(3);
    expect(reasons(finding, ctx)).toEqual([]);
    expect(isProven(finding, ctx)).toBe(true);
  });

  it('refuses the same statement when the answer carries another code', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: null, path: '/v2/a', http: 200, code: '0' }]) });
    const finding = draft(line('E04 /v2/a: HTTP 403, error_code 1006'));
    expect(reasons(finding, ctx)).toEqual([
      'states HTTP 403, and the answer carries HTTP 200',
      'states error_code 1006, and the answer carries 0',
    ]);
    expect(isProven(finding, ctx)).toBe(false);
  });

  it('refuses a statement about an answer this run did not read', () => {
    const finding = draft(line('E04 /v2/a: HTTP 403, error_code 1006'));
    expect(reasons(finding, context())).toEqual(['is not an answer of the corpus this run read']);
    expect(isProven(finding, context())).toBe(false);
  });

  it('refuses an evidence line that states nothing a reader could check', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: null, path: '/v2/a' }]) });
    const finding = draft(line('this endpoint looks fine to me'));
    expect(reasons(finding, ctx)).toEqual(['states nothing checkable: "this endpoint looks fine to me"']);
    expect(isProven(finding, ctx)).toBe(false);
  });

  it('refuses a statement that names the wrong endpoint', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E05', path: '/v2/cryptocurrency/info' }]) });
    const finding = draft(line('E02: 1 reported, 1 reserved'));
    expect(reasons(finding, ctx)).toEqual(['states E02, and the answer is E05']);
  });

  it('checks a cost against what the answer reported', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E02', credits: 1 }]) });
    expect(reasons(draft(line('E02: 1 reported, 1 reserved')), ctx)).toEqual([]);
    expect(reasons(draft(line('E02: 4 reported, 1 reserved')), ctx)).toEqual([
      'states 4 credit(s) reported, and the answer reports 1',
    ]);
  });

  it('checks a duration against the interval the answer was timed at', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E03', latencyMs: 5876 }]) });
    expect(reasons(draft(line('E03: 5.9 s')), ctx)).toEqual([]);
    expect(reasons(draft(line('E03: 9.5 s')), ctx)).toEqual(['states 9.5 s, and the answer was timed at 5.9 s']);
  });

  it('checks a field against what the body carries', () => {
    const body = { data: { platform: { id: 1 }, logo: null } };
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E05', body }]) });
    expect(reasons(draft(line('`data.platform.id` present')), ctx)).toEqual([]);
    expect(reasons(draft(line('`data.logo` null on 1 answer(s)')), ctx)).toEqual([]);
    expect(reasons(draft(line('`data.circulating_supply` present')), ctx)).toEqual([
      'states `data.circulating_supply` present, and the answer does not carry it',
    ]);
    expect(reasons(draft(line('same question, `data.platform` absent')), ctx)).toEqual([
      'states `data.platform` absent, and the answer carries it',
    ]);
  });

  it('refuses a field said to be null that the answer carries a value for', () => {
    const body = { data: { platform: { id: 1 } } };
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E05', body }]) });
    expect(reasons(draft(line('`data.platform.id` null on 1 answer(s)')), ctx)).toEqual([
      'states `data.platform.id` null, and the answer carries it as number',
    ]);
  });

  it('follows the field a statement points at, and says so when nothing is there', () => {
    const body = { data: { platform: { id: 1 } } };
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E05', body }]) });
    expect(reasons(draft(line('`data.platform.id` present', 'data.platform.id')), ctx)).toEqual([]);
    expect(reasons(draft(line('`data.platform.id` present', 'data.platform.slug')), ctx)).toEqual([
      'points at `data.platform.slug`, and nothing is there',
    ]);
  });

  it('quotes the message the API sent, and refuses a quotation it did not', () => {
    const ctx = context({
      corpus: corpusOf([{ file: FILE, endpoint: 'E19', http: 400, code: '4001', message: 'Invalid parameter.' }]),
    });
    expect(reasons(draft(line('HTTP 400, error_code 4001, "Invalid parameter."')), ctx)).toEqual([]);
    expect(reasons(draft(line('HTTP 400, error_code 4001, "Service unavailable."')), ctx)).toEqual([
      'quotes "Service unavailable.", and the answer carries "Invalid parameter."',
    ]);
  });

  it('checks a name count against the comparison it was read from', () => {
    const ctx = context({
      corpus: corpusOf([{ file: FILE, endpoint: 'E05' }]),
      comparisons: [
        {
          endpoint: 'E05',
          compared: true,
          reference: null,
          listed: 8,
          missing: [],
          unexpected: [],
          received: 42,
          answers: 3,
          example: FILE,
        },
      ],
    });
    expect(reasons(draft(line('E05: 8 name(s) recorded, 42 received')), ctx)).toEqual([]);
    expect(reasons(draft(line('E05: 8 name(s) recorded, 99 received')), ctx)).toEqual([
      'states 99 name(s) received for E05, and the corpus carried 42',
    ]);
  });

  it('refuses a statement about an engine pass that was not made', () => {
    const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E02' }]) });
    expect(reasons(draft(line('BTC: ACT on 3 of 7 checks')), ctx)).toEqual([
      'states a verdict of the sample, and no engine pass was made',
    ]);
  });

  it('skips an evidence line that names no file, which the first gate already counts', () => {
    const finding = draft([{ file: '   ', field: null, shows: 'E02: 1 reported, 1 reserved' }]);
    expect(reviewDraft(finding, context()).issues).toEqual([]);
    expect(reviewDraft(finding, context()).claims).toBe(0);
  });
});

describe('toneIssues', () => {
  const ctx = context({ corpus: corpusOf([{ file: FILE, endpoint: 'E02' }]) });
  const evidence = [{ file: FILE, field: null, shows: 'E02: 1 reported, 1 reserved' }];

  it('passes an entry that states what was measured', () => {
    expect(toneIssues(draft(evidence))).toEqual([]);
  });

  it('names a word that judges rather than measures', () => {
    const finding = draft(evidence, { statement: 'The documented cost is wrong for this endpoint.' });
    expect(toneIssues(finding)).toEqual([{ kind: 'tone', file: null, reason: 'says "wrong" of the API' }]);
  });

  it('names a turn of phrase that states a cause a corpus cannot establish', () => {
    const finding = draft(evidence, { statement: 'The answers did not arrive, caused by the load on the endpoint.' });
    expect(toneIssues(finding)).toEqual([{ kind: 'tone', file: null, reason: 'states a cause: "caused by"' }]);
  });

  it('leaves the words the API itself used alone, in quotation marks and in backticks', () => {
    const quoted = draft(evidence, {
      title: 'E12 answered "Invalid parameter." to every call',
      statement: 'The answers carry `error_code` 400 with the message "the request is wrong", quoted as received.',
    });
    expect(toneIssues(quoted)).toEqual([]);
  });

  it('refuses a kind this report does not use', () => {
    const finding = { ...draft(evidence), kind: 'defect' } as unknown as FindingDraft;
    expect(toneIssues(finding)).toEqual([
      { kind: 'tone', file: null, reason: 'is of kind `defect`, which this report does not use' },
    ]);
  });

  it('does not decide publication: a word is this project’s fault, not the API’s', () => {
    const finding = draft(evidence, { statement: 'The documented cost is wrong for this endpoint.' });
    expect(toneIssues(finding)).toHaveLength(1);
    expect(isProven(finding, ctx)).toBe(true);
  });

  it('keeps both lists short enough not to catch ordinary English', () => {
    expect(ACCUSATORY.length).toBeLessThan(25);
    expect(CAUSAL.length).toBeLessThan(10);
    for (const word of [...ACCUSATORY, ...CAUSAL]) expect(word).toBe(word.toLowerCase());
  });
});

describe('reviewFindings', () => {
  const ctx = context({
    corpus: corpusOf([
      { file: FILE, endpoint: 'E02', credits: 1 },
      { file: 'fixtures/discovery/b.json', endpoint: 'E03', latencyMs: 5876 },
    ]),
  });
  const numbered = (id: string, parts: Partial<FindingDraft>): AuditFinding => ({ id, ...draft([], parts) });

  it('counts every entry and every claim it checked', () => {
    const review = reviewFindings(
      [
        numbered('A1', { evidence: [{ file: FILE, field: null, shows: 'E02: 1 reported, 1 reserved' }] }),
        numbered('A2', { evidence: [{ file: 'fixtures/discovery/b.json', field: null, shows: 'E03: 5.9 s' }] }),
      ],
      ctx,
    );
    expect(review.entries).toBe(2);
    expect(review.claims).toBe(4);
    expect(review.unproven).toEqual([]);
    expect(review.tone).toEqual([]);
  });

  it('keeps the two kinds of issue apart, so a word is never reported as a missing proof', () => {
    const review = reviewFindings(
      [
        numbered('A1', {
          evidence: [{ file: FILE, field: null, shows: 'E02: 9 reported, 1 reserved' }],
        }),
        numbered('A2', {
          statement: 'This endpoint is broken.',
          evidence: [{ file: 'fixtures/discovery/b.json', field: null, shows: 'E03: 5.9 s' }],
        }),
      ],
      ctx,
    );
    expect(review.unproven.map((one) => one.id)).toEqual(['A1']);
    expect(review.unproven[0]?.issues.map((one) => one.kind)).toEqual(['evidence']);
    expect(review.tone.map((one) => one.id)).toEqual(['A2']);
    expect(review.tone[0]?.issues.map((one) => one.kind)).toEqual(['tone']);
  });

  it('reports nothing about a report with nothing in it', () => {
    expect(reviewFindings([], ctx)).toEqual({ entries: 0, claims: 0, unproven: [], tone: [] });
  });
});
