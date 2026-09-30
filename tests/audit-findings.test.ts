/**
 * The rule that makes this report checkable (T6.1, specification F9): **no captured evidence, no publication**.
 *
 * It is enforced in `auditFindings` rather than trusted to the generators, so it is tested there: a statement
 * naming no file never reaches the report, however true it might be, and the number of statements dropped is
 * carried out, so the report can say it rather than quietly shortening itself.
 *
 * The rest of this file pins the distinctions the entries rest on, each of which was written wrongly at least
 * once before it was caught: a refusal for the plan is not the same statement as a parameter error, a retried
 * call is not several calls, and a latency measured while a run waits for a request slot is not a latency of the
 * API.
 */
import { describe, expect, it } from 'vitest';
import type { Corpus, CorpusEntry, EndpointCorpus, LatencyStats } from '../src/audit/corpus.js';
import { auditFindings, FINDING_KINDS, isPublishable, type AuditInputs } from '../src/audit/findings.js';
import type { EndpointRow } from '../src/audit/inventory.js';
import type { SampleRun } from '../src/audit/sample.js';
import type { EndpointId } from '../src/cmc/endpoints.js';

function latency(maxMs: number, file: string): LatencyStats {
  return { answers: 1, minMs: maxMs, medianMs: maxMs, p90Ms: maxMs, maxMs, slowest: { file, ms: maxMs } };
}

/** An endpoint the corpus answered for, with everything the entries read set to something unremarkable. */
function endpoint(parts: Partial<EndpointCorpus> & { endpoint: EndpointCorpus['endpoint'] }): EndpointCorpus {
  const quick = latency(100, 'fixtures/discovery/a.json');
  return {
    path: '/v1/x',
    answers: 1,
    accepted: 1,
    shapes: [{ value: '/v1/x', answers: 1, example: 'fixtures/discovery/a.json' }],
    firstRecordedAt: '2026-09-24T16:00:00.000Z',
    lastRecordedAt: '2026-09-24T16:00:00.000Z',
    http: [{ value: 200, answers: 1, example: 'fixtures/discovery/a.json' }],
    errorCodes: [{ value: { code: '0', type: 'string' }, answers: 1, example: 'fixtures/discovery/a.json' }],
    notice: [{ value: false, answers: 1, example: 'fixtures/discovery/a.json' }],
    credits: [{ value: 1, answers: 1, example: 'fixtures/discovery/a.json' }],
    declaredCredits: 1,
    errors: [],
    latency: quick,
    unpacedLatency: quick,
    ...parts,
  };
}

function row(parts: Partial<EndpointRow> & { id: EndpointRow['id'] }): EndpointRow {
  return { method: 'GET', path: '/v1/x', plan: 'listed', checks: 'C1', status: 'verified', ...parts };
}

const RECORDED_AT = '2026-09-24T16:00:00.000Z';

/**
 * One recorded answer, with everything unremarkable unless the test says otherwise.
 *
 * Since T6.2 an entry has to survive a second gate: the answer it cites is opened and asked whether it carries
 * what the entry states. A test that invents a filename therefore proves nothing any more — the corpus below has
 * to hold the answers the fixtures cite, exactly as the real one does.
 */
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

/** A corpus holding the answers named, and nothing else. */
function corpusOf(answers: readonly Answer[]): Corpus {
  return {
    parts: [
      { name: 'discovery', dir: 'fixtures/discovery', description: 'a capture', paced: false, answers: answers.length },
    ],
    entries: answers.map(answer),
    skipped: [],
  };
}

interface RefusedAnswer {
  path: string;
  file: string;
  code: string;
  message: string;
  http: number;
}

/** A corpus holding one answer per path named: enough for the entries that look a refusal up by path. */
function corpus(answers: readonly RefusedAnswer[]): Corpus {
  return corpusOf(answers.map((one) => ({ ...one, codeType: 'number' as const, credits: 0 })));
}

/** The answer the `endpoint` helper below cites for everything it does not measure. */
const PLAIN_FILE = 'fixtures/discovery/a.json';

/** The corpus that makes `endpoint({ endpoint: id })` citable: the one answer all of its examples name. */
function plainCorpus(id: EndpointId, path = '/v1/x'): Corpus {
  return corpusOf([{ file: PLAIN_FILE, endpoint: id, path }]);
}

function inputs(parts: Partial<AuditInputs> = {}): AuditInputs {
  return {
    corpus: corpusOf([]),
    endpoints: [],
    rows: [],
    comparisons: [],
    variances: [],
    optional: [],
    alwaysNull: [],
    sample: null,
    unpaced: ['discovery'],
    paced: ['calibration'],
    budgetMs: 10_000,
    inventoryRecordedAt: '2026-09-24',
    ...parts,
  };
}

/** A sample run holding nothing but the assets whose coverage is thin. */
function sample(thin: SampleRun['thin']): SampleRun {
  return {
    dir: 'fixtures/calibration/live',
    panelObservedAt: '2026-09-26T10:44:11.282Z',
    assets: 50,
    outcomes: [],
    checks: [],
    findings: [],
    shapeIssues: [],
    thinAt: 5,
    thin,
    failures: [],
  };
}

describe('isPublishable', () => {
  const draft = {
    kind: 'observed' as const,
    endpoints: [],
    title: 'a title',
    statement: 'a statement',
    measurement: null,
  };

  it('refuses a statement that cites nothing', () => {
    expect(isPublishable({ ...draft, evidence: [] })).toBe(false);
  });

  it('refuses a statement whose only citation names no file', () => {
    expect(isPublishable({ ...draft, evidence: [{ file: '   ', field: null, shows: 'nothing' }] })).toBe(false);
  });

  it('accepts a statement citing one file', () => {
    expect(isPublishable({ ...draft, evidence: [{ file: 'fixtures/discovery/a.json', field: null, shows: 'it' }] })).toBe(
      true,
    );
  });
});

describe('auditFindings', () => {
  it('produces nothing at all from an empty corpus', () => {
    expect(auditFindings(inputs())).toEqual({ findings: [], withheld: 0, unproven: 0 });
  });

  it('numbers the entries it publishes in the order it prints them', () => {
    const { findings } = auditFindings(
      inputs({ corpus: plainCorpus('E02'), endpoints: [endpoint({ endpoint: 'E02' })] }),
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.id)).toEqual(findings.map((_, at) => `A${String(at + 1)}`));
    for (const finding of findings) expect(FINDING_KINDS).toContain(finding.kind);
  });

  it('gives every published entry at least one file to open', () => {
    const { findings } = auditFindings(
      inputs({
        corpus: corpusOf([
          { file: PLAIN_FILE, endpoint: 'E02' },
          { file: 'fixtures/discovery/E01.json', endpoint: 'E01', code: '0', codeType: 'number', credits: 0 },
        ]),
        endpoints: [
          endpoint({ endpoint: 'E02' }),
          endpoint({
            endpoint: 'E01',
            shapes: [{ value: '/v1/x', answers: 1, example: 'fixtures/discovery/E01.json' }],
            http: [{ value: 200, answers: 1, example: 'fixtures/discovery/E01.json' }],
            latency: latency(100, 'fixtures/discovery/E01.json'),
            unpacedLatency: latency(100, 'fixtures/discovery/E01.json'),
            declaredCredits: 0,
            credits: [{ value: 0, answers: 1, example: 'fixtures/discovery/E01.json' }],
            errorCodes: [{ value: { code: '0', type: 'number' }, answers: 1, example: 'fixtures/discovery/E01.json' }],
            notice: [{ value: true, answers: 1, example: 'fixtures/discovery/E01.json' }],
          }),
        ],
      }),
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      for (const evidence of finding.evidence) expect(evidence.file.trim()).not.toBe('');
    }
  });

  it('withholds a statement whose measurement is real and whose evidence is not, and counts it', () => {
    // An asset at ACT on thin coverage that was assessed from no recorded answer: the count is true, and there is
    // nothing to open. The entry is dropped rather than published without a citation.
    const { findings, withheld } = auditFindings(
      inputs({
        sample: sample([
          { member: 'BTC', verdict: 'ACT', score: 100, evaluated: 3, reasons: ['no contract'], example: null },
        ]),
      }),
    );
    expect(findings).toEqual([]);
    expect(withheld).toBe(1);
  });

  // The second gate of T6.2. The first one only asks for a filename; this asks the file. Both counts come out
  // separately, because citing nothing and citing something that says otherwise are two different faults.
  it('withholds a statement whose cited answer does not carry it, and counts it apart', () => {
    const asInput = {
      corpus: corpusOf([
        { file: PLAIN_FILE, endpoint: 'E10' as const, path: '/v1/dex/token/price' },
        {
          file: 'fixtures/calibration/E10.json',
          endpoint: 'E10' as const,
          path: '/v1/dex/token/price',
          http: 500,
          code: '500',
          codeType: 'number' as const,
          message: 'The system is busy, please try again later!',
          credits: 0,
        },
      ]),
      endpoints: [
        endpoint({
          endpoint: 'E10',
          path: '/v1/dex/token/price',
          answers: 77,
          accepted: 36,
          errors: [
            {
              http: 500,
              code: '500',
              message: 'The system is busy, please try again later!',
              answers: 41,
              requests: 14,
              creditsReported: 0,
              example: 'fixtures/calibration/E10.json',
              firstRecordedAt: RECORDED_AT,
              lastRecordedAt: RECORDED_AT,
            },
          ],
        }),
      ],
    };

    const agreeing = auditFindings(inputs(asInput));
    expect(agreeing.findings.map((finding) => finding.title)).toContain('E10 answered HTTP 500 on part of the recorded calls');
    expect(agreeing.unproven).toBe(0);

    // The same statement, over a corpus whose answer carries HTTP 200 instead: the count is unchanged and the
    // file is still there to open, so only reading it can tell the two apart.
    const contradicted = auditFindings(
      inputs({
        ...asInput,
        corpus: corpusOf([
          { file: PLAIN_FILE, endpoint: 'E10', path: '/v1/dex/token/price' },
          { file: 'fixtures/calibration/E10.json', endpoint: 'E10', path: '/v1/dex/token/price', http: 200 },
        ]),
      }),
    );
    expect(contradicted.findings.map((finding) => finding.title)).not.toContain(
      'E10 answered HTTP 500 on part of the recorded calls',
    );
    expect(contradicted.unproven).toBe(1);
    expect(contradicted.withheld).toBe(0);
  });

  it('publishes the same statement once an answer can be cited for it', () => {
    const { findings, withheld, unproven } = auditFindings(
      inputs({
        corpus: corpusOf([{ file: 'fixtures/calibration/live/E02-btc.json', endpoint: 'E02' }]),
        sample: sample([
          {
            member: 'BTC',
            verdict: 'ACT',
            score: 100,
            evaluated: 3,
            reasons: ['no contract'],
            example: 'fixtures/calibration/live/E02-btc.json',
          },
        ]),
      }),
    );
    expect(withheld).toBe(0);
    expect(unproven).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain('ACT');
  });
});

describe('the refusal entries', () => {
  const refusals = corpus([
    { path: '/v2/a', file: 'fixtures/discovery/E04.json', code: '1006', message: 'plan', http: 403 },
    { path: '/v1/b', file: 'fixtures/discovery/E12.json', code: '400', message: 'Parameter error', http: 400 },
  ]);
  const rows = [
    row({ id: 'E04', path: '/v2/a', status: 'refused' }),
    row({ id: 'E12', path: '/v1/b', status: 'refused' }),
  ];

  it('does not report a parameter error as a plan refusal', () => {
    const { findings } = auditFindings(inputs({ corpus: refusals, rows }));
    const plan = findings.find((finding) => finding.title.includes('page lists this plan'));
    expect(plan?.measurement?.value).toBe(1);
    expect(plan?.evidence.map((one) => one.file)).toEqual(['fixtures/discovery/E04.json']);
  });

  it('reports the parameter error as its own entry, with its own code', () => {
    const { findings } = auditFindings(inputs({ corpus: refusals, rows }));
    const parameter = findings.find((finding) => finding.title.startsWith('E12'));
    expect(parameter?.kind).toBe('observed');
    expect(parameter?.statement).toContain('the code is 400, not 1006');
  });

  it('says nothing about a refused endpoint the corpus holds no answer for', () => {
    const { findings } = auditFindings(inputs({ rows: [row({ id: 'E04', path: '/v2/a', status: 'refused' })] }));
    expect(findings).toEqual([]);
  });
});

describe('the entry about answers the API did not accept', () => {
  const failingCorpus = corpusOf([
    { file: PLAIN_FILE, endpoint: 'E10', path: '/v1/dex/token/price' },
    {
      file: 'fixtures/calibration/E10.json',
      endpoint: 'E10',
      path: '/v1/dex/token/price',
      http: 500,
      code: '500',
      codeType: 'number',
      message: 'The system is busy, please try again later!',
      credits: 0,
    },
  ]);
  const failing = endpoint({
    path: '/v1/dex/token/price',
    endpoint: 'E10',
    answers: 77,
    accepted: 36,
    errors: [
      {
        http: 500,
        code: '500',
        message: 'The system is busy, please try again later!',
        answers: 41,
        requests: 14,
        creditsReported: 0,
        example: 'fixtures/calibration/E10.json',
        firstRecordedAt: '2026-09-26T10:44:13.710Z',
        lastRecordedAt: '2026-09-26T10:51:32.376Z',
      },
    ],
  });

  it('counts the answers and the distinct requests apart', () => {
    const { findings } = auditFindings(inputs({ corpus: failingCorpus, endpoints: [failing] }));
    const entry = findings.find((finding) => finding.title.includes('HTTP 500'));
    expect(entry?.statement).toContain('41 of the 77');
    expect(entry?.statement).toContain('over 14 distinct request(s)');
    expect(entry?.statement).toContain('The client retries');
  });

  it('does not claim a retry when one call brought back one answer', () => {
    const once = endpoint({
      endpoint: 'E19',
      path: '/v5/real-world-assets/quotes/latest',
      answers: 34,
      accepted: 33,
      errors: [
        {
          http: 400,
          code: '4001',
          message: 'Invalid parameter.',
          answers: 1,
          requests: 1,
          creditsReported: 0,
          example: 'fixtures/discovery/E19.json',
          firstRecordedAt: '2026-09-25T15:06:30.266Z',
          lastRecordedAt: '2026-09-25T15:06:30.266Z',
        },
      ],
    });
    const onceCorpus = corpusOf([
      { file: PLAIN_FILE, endpoint: 'E19', path: '/v5/real-world-assets/quotes/latest' },
      {
        file: 'fixtures/discovery/E19.json',
        endpoint: 'E19',
        path: '/v5/real-world-assets/quotes/latest',
        http: 400,
        code: '4001',
        codeType: 'number',
        message: 'Invalid parameter.',
        credits: 0,
      },
    ]);
    const { findings } = auditFindings(inputs({ corpus: onceCorpus, endpoints: [once] }));
    const entry = findings.find((finding) => finding.title.includes('HTTP 400'));
    expect(entry?.statement).not.toContain('The client retries');
  });

  it('states no cause for an answer that did not arrive', () => {
    const { findings } = auditFindings(inputs({ corpus: failingCorpus, endpoints: [failing] }));
    const entry = findings.find((finding) => finding.title.includes('HTTP 500'));
    for (const word of ['unreliable', 'broken', 'outage', 'fault', 'bug']) {
      expect(entry?.statement.toLowerCase()).not.toContain(word);
    }
  });
});

describe('the latency entries', () => {
  it('makes its claim from the captures recorded one call at a time', () => {
    const slow = endpoint({
      endpoint: 'E03',
      latency: latency(5876, 'fixtures/discovery/E03.json'),
      unpacedLatency: latency(5876, 'fixtures/discovery/E03.json'),
    });
    const { findings } = auditFindings(
      inputs({
        corpus: corpusOf([{ file: 'fixtures/discovery/E03.json', endpoint: 'E03', latencyMs: 5876 }]),
        endpoints: [slow],
      }),
    );
    const entry = findings.find((finding) => finding.title.includes('one at a time'));
    expect(entry?.measurement?.value).toBe(5876);
    expect(entry?.evidence[0]?.file).toBe('fixtures/discovery/E03.json');
  });

  it('reports a figure from a paced run as an upper bound rather than a measurement', () => {
    const pacedOnly = endpoint({
      endpoint: 'E05',
      latency: latency(19_969, 'fixtures/calibration/E05.json'),
      unpacedLatency: null,
    });
    const { findings } = auditFindings(
      inputs({
        corpus: corpusOf([{ file: 'fixtures/calibration/E05.json', endpoint: 'E05', latencyMs: 19_969 }]),
        endpoints: [pacedOnly],
      }),
    );
    const entry = findings.find((finding) => finding.title.includes('Upper bounds'));
    expect(entry?.kind).toBe('observed');
    expect(entry?.statement).toContain('upper bounds');
    expect(entry?.statement).toContain('nothing here says the API was slow');
  });

  it('says nothing about an endpoint that answered well inside the budget', () => {
    const { findings } = auditFindings(inputs({ endpoints: [endpoint({ endpoint: 'E07' })] }));
    expect(findings.filter((finding) => finding.title.toLowerCase().includes('budget'))).toEqual([]);
  });
});
