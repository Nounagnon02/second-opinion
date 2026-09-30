/**
 * What the audit publishes: one entry per thing measured, each carrying the recorded answer it was read from
 * (specification F9, "a finding without captured evidence is not published").
 *
 * That rule is enforced here rather than trusted: `auditFindings` drops any entry whose evidence list names no
 * file, whatever produced it, and the report never sees it. A generator that cannot cite a recorded answer
 * therefore cannot put a sentence in the report, which is the only way a report of this kind can be checked by a
 * reader.
 *
 * Wording follows the rule the specification states in its first section and `CLAUDE.md` repeats: this is a tool
 * built for the API, not a complaint about it. Every entry is one of three kinds and nothing else:
 * - `observed` — a number this corpus measured, and what it was measured against;
 * - `signal` — something a consumer of the API has to plan for, stated as a consequence rather than a fault;
 * - `suggestion` — a constructive proposal, always attached to an observation above it.
 *
 * No generator states a cause. "53 % of the answers to this endpoint in this window carried HTTP 500" is a
 * measurement; "this endpoint is unreliable" is a conclusion this corpus cannot support, and is not written.
 */
import type { EndpointId } from '../cmc/endpoints.js';
import { describeMs as ms, type Corpus, type EndpointCorpus } from './corpus.js';
import type { InventoryComparison, NullField, OptionalField, TypeVariance } from './fields.js';
import type { EndpointRow } from './inventory.js';
import { isProven, type ReviewContext } from './review.js';
import type { SampleRun } from './sample.js';

/** The three kinds an entry may be, and nothing else. */
export const FINDING_KINDS = ['observed', 'signal', 'suggestion'] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

/** The unit a measured value is written in, so that no bare number is printed. */
export type AuditUnit = 'count' | 'answers' | 'credits' | 'milliseconds';

/** One recorded answer a statement rests on. */
export interface AuditEvidence {
  /** The fixture file, relative to the project root. */
  file: string;
  /** Where inside it, when the statement is about one field; `null` for the answer as a whole. */
  field: string | null;
  /** What this file shows, in a few words. */
  shows: string;
}

/** One quantity an entry measured, with what it was measured against. */
export interface AuditMeasurement {
  label: string;
  value: number;
  unit: AuditUnit;
  /** What the value is read against — a declared cost, a budget, a total; `null` when it stands alone. */
  against: number | null;
}

/** One entry of the report. */
export interface AuditFinding {
  /** `A1`, `A2`, ... in the order the report prints them; assigned by `auditFindings`. */
  id: string;
  kind: FindingKind;
  /** The endpoints it is about; empty when it is about the corpus as a whole. */
  endpoints: EndpointId[];
  /** One line, in the words of the table of contents. */
  title: string;
  /** What was measured and against what, in neutral English. */
  statement: string;
  measurement: AuditMeasurement | null;
  evidence: AuditEvidence[];
}

/** An entry before it has been numbered. */
export type FindingDraft = Omit<AuditFinding, 'id'>;

/** Everything the generators read. */
export interface AuditInputs {
  corpus: Corpus;
  endpoints: EndpointCorpus[];
  rows: EndpointRow[];
  comparisons: InventoryComparison[];
  variances: { endpoint: EndpointId; fields: TypeVariance[] }[];
  optional: { endpoint: EndpointId; fields: OptionalField[] }[];
  alwaysNull: { endpoint: EndpointId; fields: NullField[] }[];
  sample: SampleRun | null;
  /** The captures recorded one call at a time, whose latencies measure the API alone. */
  unpaced: string[];
  /** The captures recorded by a run that paced its own requests. */
  paced: string[];
  /** The time one `check` is meant to fit in (D1), which the latency entry is read against. */
  budgetMs: number;
  /** The day the inventory the comparison runs against was recorded. */
  inventoryRecordedAt: string;
}

/** How many items one entry names before the rest are only counted. */
export const LISTED = 6;

/** A list, with the tail counted rather than printed. */
function listed(items: readonly string[], limit = LISTED): string {
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} and ${String(items.length - limit)} more`;
}

/** A share as this report writes it: one decimal, no trailing zero. */
function share(part: number, whole: number): string {
  return whole === 0 ? '0 %' : `${String(Math.round((part / whole) * 1000) / 10)} %`;
}

/** One shape of the `status` block, and the endpoints that only ever sent it. */
interface StatusShape {
  type: string;
  notice: boolean;
  endpoints: EndpointId[];
  example: string;
}

/**
 * The shapes of the `status` block across the corpus.
 *
 * An endpoint is attributed the shape all its accepted answers carry; one that carried more than one is reported
 * apart, because an endpoint differing from itself is a different statement from two endpoints differing.
 */
function statusShapes(endpoints: readonly EndpointCorpus[]): { shapes: StatusShape[]; mixed: EndpointCorpus[] } {
  const shapes = new Map<string, StatusShape>();
  const mixed: EndpointCorpus[] = [];
  for (const endpoint of endpoints) {
    const [code] = endpoint.errorCodes;
    const [notice] = endpoint.notice;
    if (code === undefined || notice === undefined) continue;
    if (endpoint.errorCodes.length > 1 || endpoint.notice.length > 1) {
      mixed.push(endpoint);
      continue;
    }
    const key = `${code.value.type}|${String(notice.value)}`;
    const found = shapes.get(key);
    if (found) found.endpoints.push(endpoint.endpoint);
    else {
      shapes.set(key, {
        type: code.value.type,
        notice: notice.value,
        endpoints: [endpoint.endpoint],
        example: code.example,
      });
    }
  }
  return { shapes: [...shapes.values()].sort((a, b) => b.endpoints.length - a.endpoints.length), mixed };
}

/** Two shapes of one block, and what a client has to do about it. */
function statusBlockEntries(inputs: AuditInputs): FindingDraft[] {
  const { shapes, mixed } = statusShapes(inputs.endpoints);
  const drafts: FindingDraft[] = [];

  if (shapes.length > 1) {
    drafts.push(
      {
        kind: 'observed',
        endpoints: shapes.flatMap((shape) => shape.endpoints),
        title: 'The `status` block arrives in two shapes',
        statement:
          'Across the recorded answers, `status.error_code` arrives as a ' +
          shapes
            .map(
              (shape) =>
                `${shape.type} on ${String(shape.endpoints.length)} endpoint(s) (${listed(shape.endpoints)})` +
                `${shape.notice ? ', with a `notice` field beside it' : ', with no `notice` field'}`,
            )
            .join(', and as a ') +
          '. Both shapes carry `timestamp`, `elapsed` and `credit_count`, and both were observed on accepted ' +
          'calls, so the difference is in the envelope rather than in what it reports.',
        measurement: {
          label: 'shapes of the status block',
          value: shapes.length,
          unit: 'count',
          against: inputs.endpoints.length,
        },
        evidence: shapes.map((shape) => ({
          file: shape.example,
          field: 'status.error_code',
          shows: `${shape.type} on ${listed(shape.endpoints)}`,
        })),
      },
      {
        kind: 'suggestion',
        endpoints: [],
        title: 'A client reading `status.error_code` needs to accept both a number and a string',
        statement:
          'A consumer that compares `status.error_code` with the number 0 succeeds on one group of endpoints and ' +
          'fails on the other. Reading it through a comparison that accepts both — as this project does in ' +
          '`src/cmc/status.ts` — costs one function and removes the difference at the edge of the client. ' +
          'Publishing one shape on every endpoint would remove it once for every consumer.',
        measurement: null,
        evidence: shapes.map((shape) => ({
          file: shape.example,
          field: 'status.error_code',
          shows: `the ${shape.type} shape, on ${listed(shape.endpoints)}`,
        })),
      },
    );
  }

  if (mixed.length > 0) {
    drafts.push({
      kind: 'observed',
      endpoints: mixed.map((endpoint) => endpoint.endpoint),
      title: 'Endpoints whose accepted answers carried more than one shape',
      statement:
        `${listed(mixed.map((endpoint) => endpoint.endpoint))} returned accepted answers under more than one ` +
        'shape of the `status` block within this corpus.',
      measurement: { label: 'endpoints', value: mixed.length, unit: 'count', against: inputs.endpoints.length },
      evidence: mixed.flatMap((endpoint) =>
        endpoint.errorCodes.map((code) => ({
          file: code.example,
          field: 'status.error_code',
          shows: `${endpoint.endpoint} as ${code.value.type} on ${String(code.answers)} answer(s)`,
        })),
      ),
    });
  }
  return drafts;
}

/** The CMC error code a plan refusal carries, observed on every one of them in T1.2 and T1.3. */
const PLAN_REFUSAL_CODE = '1006';

/** One refused endpoint, with the answer that refused it. */
interface Refusal {
  row: EndpointRow;
  file: string;
  http: number;
  code: string | null;
  message: string | null;
}

/** The refusals the corpus holds, one per endpoint the inventory marks refused. */
function refusals(inputs: AuditInputs): Refusal[] {
  return inputs.rows
    .filter((row) => row.status === 'refused')
    .flatMap((row) => {
      const answer = inputs.corpus.entries.find((entry) => entry.path === row.path);
      if (answer === undefined) return [];
      return [
        {
          row,
          file: answer.file,
          http: answer.http,
          code: answer.status?.errorCode ?? null,
          message: answer.status?.errorMessage ?? null,
        },
      ];
    });
}

/** The endpoints the key could not call, against what their documentation row says. */
function planEntries(inputs: AuditInputs): FindingDraft[] {
  const all = refusals(inputs);
  const byPlan = all.filter((refusal) => refusal.code === PLAN_REFUSAL_CODE);
  const others = all.filter((refusal) => refusal.code !== PLAN_REFUSAL_CODE);
  const drafts: FindingDraft[] = [];

  if (byPlan.length > 0) {
    drafts.push({
      kind: 'signal',
      endpoints: [],
      title: 'Endpoints whose page lists this plan and that the key could not call',
      statement:
        `${String(byPlan.length)} of the ${String(inputs.rows.length)} endpoints inventoried answered HTTP ` +
        `${String(byPlan[0]?.http ?? 403)} with \`error_code\` ${PLAN_REFUSAL_CODE} — "your API key subscription ` +
        'plan doesn\u2019t support this endpoint" — although their documentation pages list the plan this key is ' +
        'on. Each refusal was recorded rather than inferred, and is quoted below. For a consumer this is a ' +
        'planning matter: an endpoint a page lists cannot be assumed callable, so the coverage of a plan is worth ' +
        'one verifying call before a check is built on it. This project made those calls in T1.2 and T1.3 and ' +
        'adapted the checks that depended on them (D2).',
      measurement: {
        label: 'endpoints refused for the plan',
        value: byPlan.length,
        unit: 'count',
        against: inputs.rows.length,
      },
      evidence: byPlan.map((refusal) => ({
        file: refusal.file,
        field: 'status',
        shows: `${refusal.row.id} ${refusal.row.path}: HTTP ${String(refusal.http)}, error_code ${refusal.code ?? 'absent'}`,
      })),
    });
  }

  for (const refusal of others) {
    drafts.push({
      kind: 'observed',
      endpoints: [],
      title: `${refusal.row.id} answered a parameter error to every call this project made to it`,
      statement:
        `${refusal.row.id} (\`${refusal.row.path}\`) answered HTTP ${String(refusal.http)} with \`error_code\` ` +
        `${refusal.code ?? 'absent'}${refusal.message === null ? '' : ` and the message "${refusal.message}"`} to ` +
        'every call recorded here, including one made with its documented parameters alone. This is not a plan ' +
        `refusal: the code is ${refusal.code ?? 'absent'}, not ${PLAN_REFUSAL_CODE}. The message names no ` +
        'parameter, so a consumer has no way to tell which value was not accepted; naming it would make the ' +
        'difference between a retry and a dead end. This project does not use this endpoint (D10).',
      measurement: null,
      evidence: [
        {
          file: refusal.file,
          field: 'status',
          shows: `HTTP ${String(refusal.http)}, error_code ${refusal.code ?? 'absent'}, "${refusal.message ?? 'no message'}"`,
        },
      ],
    });
  }
  return drafts;
}

/** Answers the API did not accept on endpoints the key can otherwise call. */
function errorEntries(inputs: AuditInputs): FindingDraft[] {
  return inputs.endpoints.flatMap((endpoint) =>
    endpoint.errors.map((error): FindingDraft => {
      const window =
        error.firstRecordedAt === error.lastRecordedAt
          ? `on ${error.firstRecordedAt}`
          : `between ${error.firstRecordedAt} and ${error.lastRecordedAt}`;
      return {
        kind: 'signal',
        endpoints: [endpoint.endpoint],
        title: `${endpoint.endpoint} answered HTTP ${String(error.http)} on part of the recorded calls`,
        statement:
          `${String(error.answers)} of the ${String(endpoint.answers)} recorded answers of ${endpoint.endpoint} ` +
          `(${share(error.answers, endpoint.answers)}) carried HTTP ${String(error.http)} with \`error_code\` ` +
          `${error.code ?? 'absent'}${error.message === null ? '' : ` and the message "${error.message}"`}, over ` +
          `${String(error.requests)} distinct request(s) ${window}. ` +
          (error.answers > error.requests
            ? 'The client retries a call that brings nothing back, which is why the answers outnumber the ' +
              'requests. '
            : '') +
          (error.creditsReported === 0
            ? 'Every one of them reported `credit_count` 0, so they were not charged. '
            : `They reported ${String(error.creditsReported)} credit(s) in total. `) +
          'The consequence for a consumer is that a check resting on this endpoint needs an answer for the case ' +
          'where the call brings nothing back: this project reports the check as `unavailable` with the reason it ' +
          'gave, rather than scoring the asset as though the call had succeeded (D9).',
        measurement: {
          label: `${endpoint.endpoint} answers not accepted`,
          value: error.answers,
          unit: 'answers',
          against: endpoint.answers,
        },
        evidence: [
          {
            file: error.example,
            field: 'status',
            shows: `HTTP ${String(error.http)}, error_code ${error.code ?? 'absent'}`,
          },
        ],
      };
    }),
  );
}

/** What the answers reported they cost, against what the client reserves for them. */
function creditEntries(inputs: AuditInputs): FindingDraft[] {
  const priced = inputs.endpoints.filter((endpoint) => endpoint.credits.length > 0);
  if (priced.length === 0) return [];

  const disagreeing = priced.filter((endpoint) =>
    endpoint.credits.some((observed) => observed.value !== endpoint.declaredCredits),
  );
  if (disagreeing.length > 0) {
    return disagreeing.map((endpoint) => ({
      kind: 'observed' as const,
      endpoints: [endpoint.endpoint],
      title: `${endpoint.endpoint} reported a cost this project did not reserve for it`,
      statement:
        `${endpoint.endpoint} reported ` +
        endpoint.credits
          .map(
            (observed) =>
              `\`credit_count\` ${String(observed.value ?? 'absent')} on ${String(observed.answers)} answer(s)`,
          )
          .join(', ') +
        `, against the ${String(endpoint.declaredCredits)} credit(s) \`src/cmc/endpoints.ts\` reserves before ` +
        'sending, a figure itself read from the T1.2 recordings.',
      measurement: {
        label: `${endpoint.endpoint} credits reported`,
        value: endpoint.credits[0]?.value ?? 0,
        unit: 'credits',
        against: endpoint.declaredCredits,
      },
      evidence: endpoint.credits.map((observed) => ({
        file: observed.example,
        field: 'status.credit_count',
        shows: `${String(observed.value ?? 'absent')} on ${String(observed.answers)} answer(s)`,
      })),
    }));
  }

  const free = priced.filter((endpoint) => endpoint.declaredCredits === 0);
  return [
    {
      kind: 'observed',
      endpoints: priced.map((endpoint) => endpoint.endpoint),
      title: 'Every accepted answer reported the cost this project reserves for its endpoint',
      statement:
        `Over the ${String(priced.reduce((sum, endpoint) => sum + endpoint.accepted, 0))} accepted answers of ` +
        `${String(priced.length)} endpoints, \`status.credit_count\` matched the per-call cost reserved for each ` +
        'one, with no exception. ' +
        (free.length === 0
          ? ''
          : `${listed(free.map((endpoint) => endpoint.endpoint))} reported 0 on every answer, which is what their ` +
            'pages state and what makes an identifier lookup free to a consumer. ') +
        'A consumer can therefore budget a run from the documented per-call cost and check it against the answers ' +
        'as they arrive, which is what the credit meter of this project does.',
      measurement: {
        label: 'endpoints whose reported cost matched',
        value: priced.length,
        unit: 'count',
        against: priced.length,
      },
      evidence: priced.slice(0, LISTED).map((endpoint) => ({
        file: endpoint.credits[0]?.example ?? '',
        field: 'status.credit_count',
        shows:
          `${endpoint.endpoint}: ${String(endpoint.credits[0]?.value ?? 0)} reported, ` +
          `${String(endpoint.declaredCredits)} reserved`,
      })),
    },
  ];
}

/**
 * How long the answers took, and what that leaves for a call plan.
 *
 * The claim is made from the captures recorded one call at a time, because a paced run waits for a free request
 * slot inside the measured interval and its figures are upper bounds rather than measurements (D14). The paced
 * figures are given beside them, said to be what they are.
 */
function latencyEntries(inputs: AuditInputs): FindingDraft[] {
  const slow = inputs.endpoints
    .filter((endpoint) => (endpoint.unpacedLatency?.maxMs ?? 0) >= inputs.budgetMs / 2)
    .sort((a, b) => (b.unpacedLatency?.maxMs ?? 0) - (a.unpacedLatency?.maxMs ?? 0));
  const pacedOnly = inputs.endpoints
    .filter((endpoint) => endpoint.unpacedLatency === null || !slow.includes(endpoint))
    .filter((endpoint) => endpoint.latency.maxMs >= inputs.budgetMs / 2)
    .sort((a, b) => b.latency.maxMs - a.latency.maxMs);
  const drafts: FindingDraft[] = [];

  if (slow.length > 0) {
    drafts.push({
      kind: 'signal',
      endpoints: slow.map((endpoint) => endpoint.endpoint),
      title: 'Endpoints that took a large share of a ten-second budget when called one at a time',
      statement:
        `${String(slow.length)} endpoint(s) have an answer taking at least half of the ${ms(inputs.budgetMs)} one ` +
        '`check` is allowed (D1), measured on the captures recorded one call at a time, where nothing but the API ' +
        'is inside the interval: ' +
        slow
          .map(
            (endpoint) =>
              `${endpoint.endpoint} up to ${ms(endpoint.unpacedLatency?.maxMs ?? 0)} ` +
              `(median ${ms(endpoint.unpacedLatency?.medianMs ?? 0)} over ` +
              `${String(endpoint.unpacedLatency?.answers ?? 0)} answer(s))`,
          )
          .join(', ') +
        '. The consequence is a call plan rather than a complaint: this project sends the independent calls of ' +
        'one asset in parallel and keeps the slowest endpoints off that path (D1, D10).',
      measurement: {
        label: 'slowest answer called one at a time',
        value: slow[0]?.unpacedLatency?.maxMs ?? 0,
        unit: 'milliseconds',
        against: inputs.budgetMs,
      },
      evidence: slow.slice(0, LISTED).map((endpoint) => ({
        file: endpoint.unpacedLatency?.slowest.file ?? '',
        field: 'response.latencyMs',
        shows: `${endpoint.endpoint}: ${ms(endpoint.unpacedLatency?.slowest.ms ?? 0)}`,
      })),
    });
  }

  if (pacedOnly.length > 0) {
    drafts.push({
      kind: 'observed',
      endpoints: pacedOnly.map((endpoint) => endpoint.endpoint),
      title: 'Upper bounds observed during a run that paced its own requests',
      statement:
        `During the ${inputs.paced.join(', ')} capture(s), which wait for a free request slot inside the measured ` +
        `interval, ${String(pacedOnly.length)} further endpoint(s) recorded an answer past half of the ` +
        `${ms(inputs.budgetMs)} budget: ` +
        pacedOnly.map((endpoint) => `${endpoint.endpoint} up to ${ms(endpoint.latency.maxMs)}`).join(', ') +
        '. These are upper bounds on what the API took and are reported as such: the wait is inside the number, ' +
        'so nothing here says the API was slow.',
      measurement: {
        label: 'slowest recorded answer, pacing included',
        value: pacedOnly[0]?.latency.maxMs ?? 0,
        unit: 'milliseconds',
        against: inputs.budgetMs,
      },
      evidence: pacedOnly.slice(0, LISTED).map((endpoint) => ({
        file: endpoint.latency.slowest.file,
        field: 'response.latencyMs',
        shows: `${endpoint.endpoint}: ${ms(endpoint.latency.slowest.ms)}, pacing included`,
      })),
    });
  }
  return drafts;
}

/** What the comparison with the inventory of `docs/ENDPOINTS.md` found. */
function inventoryEntries(inputs: AuditInputs): FindingDraft[] {
  const compared = inputs.comparisons.filter((one) => one.compared);
  if (compared.length === 0) return [];
  const drifting = compared.filter((one) => one.missing.length > 0);
  const contradicted = inputs.comparisons.filter((one) => one.unexpected.length > 0);

  const drafts: FindingDraft[] = drifting.map((one) => ({
    kind: 'signal' as const,
    endpoints: [one.endpoint],
    title: `${one.endpoint} no longer carries field(s) the inventory recorded`,
    statement:
      `The inventory recorded ${String(one.listed)} field name(s) for ${one.endpoint} on ` +
      `${inputs.inventoryRecordedAt}. ${listed(one.missing)} appear(s) in none of the ${String(one.answers)} ` +
      'recorded answers of that endpoint. A consumer reading those names gets `undefined` rather than an error, ' +
      'which is the case worth planning for.',
    measurement: {
      label: `${one.endpoint} recorded names not received`,
      value: one.missing.length,
      unit: 'count',
      against: one.listed,
    },
    evidence: [{ file: one.example, field: null, shows: `${one.endpoint} answer the comparison was run against` }],
  }));

  for (const one of contradicted) {
    drafts.push({
      kind: 'observed',
      endpoints: [one.endpoint],
      title: `${one.endpoint} carries field(s) the inventory records as absent`,
      statement:
        `The inventory states that ${one.endpoint} answers carry no ${listed(one.unexpected)}; a recorded answer ` +
        `carries ${one.unexpected.length === 1 ? 'it' : 'them'}.`,
      measurement: {
        label: `${one.endpoint} names recorded as absent that arrived`,
        value: one.unexpected.length,
        unit: 'count',
        against: null,
      },
      evidence: [
        { file: one.example, field: null, shows: `${one.endpoint} answer carrying ${listed(one.unexpected)}` },
      ],
    });
  }

  if (drifting.length === 0 && contradicted.length === 0) {
    const names = compared.reduce((sum, one) => sum + one.listed, 0);
    drafts.push({
      kind: 'observed',
      endpoints: compared.map((one) => one.endpoint),
      title: 'Every field name the inventory records was carried by a recorded answer',
      statement:
        `${String(names)} field name(s) were recorded across ${String(compared.length)} endpoints on ` +
        `${inputs.inventoryRecordedAt} and compared with the ` +
        `${String(compared.reduce((sum, one) => sum + one.answers, 0))} answers of those endpoints in this ` +
        'corpus. Every name was carried by at least one answer, and no name the inventory records as absent ' +
        'arrived. Within this window and on these endpoints, the response shapes did not move.',
      measurement: { label: 'names compared', value: names, unit: 'count', against: names },
      evidence: compared.slice(0, LISTED).map((one) => ({
        file: one.example,
        field: null,
        shows: `${one.endpoint}: ${String(one.listed)} name(s) recorded, ${String(one.received)} received`,
      })),
    });
  }
  return drafts;
}

/** Fields whose JSON type is not the same on every answer of one endpoint. */
function varianceEntries(inputs: AuditInputs): FindingDraft[] {
  return inputs.variances
    .filter((one) => one.fields.length > 0)
    .map((one) => ({
      kind: 'signal' as const,
      endpoints: [one.endpoint],
      title: `${one.endpoint} sends field(s) under more than one JSON type`,
      statement:
        `${String(one.fields.length)} field(s) of ${one.endpoint} arrived under more than one JSON type across ` +
        'the recorded answers: ' +
        listed(
          one.fields.map((field) => `\`${field.field}\` as ${field.types.map((type) => type.type).join(' and ')}`),
        ) +
        '. A consumer reading such a field has to accept every type it was observed under; this project parses ' +
        'them through one set of readers and writes down what it could not use rather than raising ' +
        '(`src/normalize/values.ts`).',
      measurement: {
        label: `${one.endpoint} fields with more than one type`,
        value: one.fields.length,
        unit: 'count',
        against: null,
      },
      evidence: one.fields.slice(0, LISTED).flatMap((field) =>
        field.types.map((type) => ({
          file: type.site.file,
          field: type.site.path,
          shows: `\`${field.field}\` as ${type.type} on ${String(type.answers)} answer(s)`,
        })),
      ),
    }));
}

/** Fields present in some answers of one question and absent from others. */
function optionalEntries(inputs: AuditInputs): FindingDraft[] {
  return inputs.optional
    .filter((one) => one.fields.length > 0)
    .map((one) => ({
      kind: 'signal' as const,
      endpoints: [one.endpoint],
      title: `${one.endpoint} carries field(s) on some answers to the same question and not on others`,
      statement:
        `${String(one.fields.length)} field(s) of ${one.endpoint} were carried by some accepted answers and ` +
        'absent from others. Only answers to requests made with the same parameter names are compared, so a ' +
        'parameter that adds a field to the answer is not what is counted, and refused answers are left out ' +
        'entirely: ' +
        listed(
          one.fields.map(
            (field) => `\`${field.field}\` on ${String(field.present)} of ${String(field.answers)} answer(s)`,
          ),
        ) +
        '. For a consumer these are optional fields whatever a page calls them, and reading one means handling ' +
        'its absence.',
      measurement: {
        label: `${one.endpoint} fields that come and go`,
        value: one.fields.length,
        unit: 'count',
        against: null,
      },
      evidence: one.fields.slice(0, LISTED).flatMap((field) => [
        { file: field.with.file, field: field.with.path, shows: `\`${field.field}\` present` },
        { file: field.without, field: null, shows: `same question, \`${field.field}\` absent` },
      ]),
    }));
}

/**
 * Fields that were `null` on every answer that carried them.
 *
 * The `status` envelope is left out: `error_message` is null on an accepted answer by design, and the two shapes
 * of that block are measured in their own entry rather than counted twice here.
 */
function alwaysNullEntries(inputs: AuditInputs): FindingDraft[] {
  return inputs.alwaysNull.flatMap((one) => {
    const fields = one.fields.filter((field) => !field.field.startsWith('status'));
    if (fields.length === 0) return [];
    const answers = inputs.endpoints.find((endpoint) => endpoint.endpoint === one.endpoint)?.accepted ?? 0;
    return [
      {
        kind: 'observed' as const,
        endpoints: [one.endpoint],
        title: `${one.endpoint} sends field(s) that were null on every recorded answer`,
        statement:
          `On the ${String(answers)} accepted answer(s) of ${one.endpoint}, ` +
          listed(fields.map((field) => `\`${field.field}\``)) +
          ` carried \`null\` every time. The field is present, so a consumer cannot tell a value that is empty ` +
          'from one this capture never happened to see filled; a wider capture, or a line on the page saying ' +
          'when the field is populated, would settle which it is.',
        measurement: {
          label: `${one.endpoint} fields always null`,
          value: fields.length,
          unit: 'count',
          against: null,
        },
        evidence: fields.slice(0, LISTED).map((field) => ({
          file: field.site.file,
          field: field.site.path,
          shows: `\`${field.field}\` null on ${String(field.answers)} answer(s)`,
        })),
      },
    ];
  });
}

/** The shapes the normalisers handle and C7 deliberately does not score (D8). */
function shapeEntries(inputs: AuditInputs): FindingDraft[] {
  const { sample } = inputs;
  if (sample === null) return [];
  const citable = sample.shapeIssues.filter((issue) => issue.evidence !== null);
  if (citable.length === 0) return [];
  return [
    {
      kind: 'observed',
      endpoints: [...new Set(citable.map((issue) => issue.endpoint))],
      title: 'Fields a consumer has to convert before a check can read them',
      statement:
        `Running the engine over ${String(sample.assets)} assets met ${String(citable.length)} field shape(s) no ` +
        'check reads directly and every normaliser has to convert first: ' +
        listed(
          citable.map(
            (issue) => `${issue.endpoint} \`${issue.field}\` (${issue.problem}, received ${issue.seen.join('/')})`,
          ),
        ) +
        '. They are the same on every asset, which is why they describe the API rather than any one asset, and ' +
        'why this project reports them here instead of scoring them (D8). Each one is handled, and none of them ' +
        'stopped a verdict from being formed.',
      measurement: { label: 'field shapes converted', value: citable.length, unit: 'count', against: null },
      evidence: citable.slice(0, LISTED).map((issue) => ({
        file: issue.evidence?.file ?? '',
        field: issue.evidence?.field ?? null,
        shows: `${issue.endpoint} \`${issue.field}\`: ${issue.problem}, received ${issue.seen.join('/')}`,
      })),
    },
  ];
}

/** What C3, C6 and C7 found over the sample. */
function sampleEntries(inputs: AuditInputs): FindingDraft[] {
  const { sample } = inputs;
  if (sample === null) return [];
  const drafts: FindingDraft[] = [];

  for (const finding of sample.findings) {
    if (finding.evidence === null) continue;
    drafts.push({
      kind: finding.severity === 'info' ? 'observed' : 'signal',
      endpoints: [finding.evidence.endpoint],
      title: `${finding.checkId} raised \`${finding.code}\` on ${String(finding.assets)} of ${String(sample.assets)} assets`,
      statement:
        `Over the ${String(sample.assets)} assets of the sample, ${finding.checkId} raised \`${finding.code}\` ` +
        `(${finding.severity}) on ${String(finding.assets)} of them: ${listed(finding.members)}. The reading on ` +
        `${finding.member}, in the words of the check: "${finding.message}" The answer cited below is the one ` +
        'that reading was made on.',
      measurement: {
        label: `${finding.checkId} \`${finding.code}\``,
        value: finding.assets,
        unit: 'count',
        against: sample.assets,
      },
      evidence: [
        {
          file: finding.evidence.file,
          field: finding.evidence.field,
          shows: `${finding.checkId} \`${finding.code}\` as read on ${finding.member}`,
        },
      ],
    });
  }

  const thin = sample.thin.filter((one) => one.verdict === 'ACT');
  if (thin.length > 0) {
    drafts.push({
      kind: 'signal',
      endpoints: [],
      title: 'Assets that reach `ACT` on fewer checks than the rest',
      statement:
        `${String(thin.length)} asset(s) of the sample reached \`ACT\` with fewer than ${String(sample.thinAt)} of ` +
        'the seven checks evaluated: ' +
        listed(thin.map((one) => `${one.member} (${String(one.evaluated)} of 7)`)) +
        '. The score renormalises over the checks that ran and prints the coverage beside the verdict, so nothing ' +
        'is hidden; but two `ACT` verdicts are not the same reading, and the coverage line is what tells them ' +
        'apart. Whether thin coverage should hold a verdict back is the question D9 left open and T4.2 answered ' +
        'for the top fifty; this is where the case can be watched.',
      measurement: {
        label: 'assets at ACT on thin coverage',
        value: thin.length,
        unit: 'count',
        against: sample.assets,
      },
      evidence: thin.slice(0, LISTED).map((one) => ({
        file: one.example ?? '',
        field: null,
        shows: `${one.member}: ${one.verdict} on ${String(one.evaluated)} of 7 checks`,
      })),
    });
  }
  return drafts;
}

/** Every generator, in the order the report prints their entries. */
const GENERATORS: ((inputs: AuditInputs) => FindingDraft[])[] = [
  planEntries,
  errorEntries,
  statusBlockEntries,
  inventoryEntries,
  varianceEntries,
  optionalEntries,
  alwaysNullEntries,
  shapeEntries,
  creditEntries,
  latencyEntries,
  sampleEntries,
];

/** An entry is publishable only if it cites at least one recorded answer that names a file. */
export function isPublishable(draft: FindingDraft): boolean {
  return draft.evidence.some((one) => one.file.trim() !== '');
}

/**
 * Every entry of the report, numbered.
 *
 * Two gates, and an entry passes both or it is not printed. The first asks whether it cites a recorded answer at
 * all; the second (T6.2, `review.ts`) opens that answer and asks whether it shows what the entry states. Neither
 * shortens the report quietly: both counts come out, so the report can say how many statements it withheld and
 * for which of the two reasons.
 */
export function auditFindings(inputs: AuditInputs): {
  findings: AuditFinding[];
  withheld: number;
  unproven: number;
} {
  const drafts = GENERATORS.flatMap((generate) => generate(inputs));
  const cited = drafts.filter(isPublishable);
  const context: ReviewContext = { corpus: inputs.corpus, comparisons: inputs.comparisons, sample: inputs.sample };
  const proven = cited.filter((draft) => isProven(draft, context));
  return {
    findings: proven.map((draft, at) => ({
      ...draft,
      id: `A${String(at + 1)}`,
      evidence: draft.evidence.filter((one) => one.file.trim() !== ''),
    })),
    withheld: drafts.length - cited.length,
    unproven: cited.length - proven.length,
  };
}
