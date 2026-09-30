/**
 * One whole audit run (specification F9): the recorded corpus, what it says endpoint by endpoint, the comparison
 * with the inventory, the engine pass over a sample of assets, and the entries all of that produced.
 *
 * `docs/api_audit.json` is this object, and `docs/API_AUDIT.md` is its readable view. Neither is written by hand:
 * an audit whose numbers are typed in is a claim, and the point of this one is that every number can be recomputed
 * and every sentence opened in a file of the repository.
 *
 * The corpus is a named list of captures rather than "everything under `fixtures/`" (D14). Two partial recordings
 * of the calibration walk are in the repository — a run of 2026-09-25 left loose at the root of
 * `fixtures/calibration/`, and `live-2026-09-26/`, stopped at 25 assets of 50 — and counting them would report the
 * same request several times over and attribute to one walk the answers of another. The list below names the
 * captures that are complete, for the same reason `tests/helpers/calibration-fixtures.ts` replays one dated
 * directory rather than the whole tree.
 */
import { join } from 'node:path';
import { VERDICT_BUDGET_MS } from '../calibration/run.js';
import { DEFAULT_FIXTURE_DIR } from '../cmc/config.js';
import type { EndpointId } from '../cmc/endpoints.js';
import {
  corpusCredits,
  endpointCorpora,
  readCorpus,
  type Corpus,
  type CorpusPart,
  type EndpointCorpus,
} from './corpus.js';
import {
  compareInventory,
  fieldsByEndpoint,
  nullFields,
  optionalFields,
  typeVariances,
  type InventoryComparison,
  type NullField,
  type OptionalField,
  type TypeVariance,
} from './fields.js';
import { auditFindings, type AuditFinding } from './findings.js';
import { reviewFindings, type Review, type ReviewContext } from './review.js';
import { readEndpointRows, readFieldInventory, type EndpointRow } from './inventory.js';
import type { SampleRun } from './sample.js';

/** The day the inventory of `docs/ENDPOINTS.md` was recorded from live calls (T1.2). */
export const INVENTORY_RECORDED_AT = '2026-09-24';

/** The capture recorded one call at a time, whose latencies measure the API rather than the pacing. */
export const UNPACED_CAPTURE = 'discovery';

/** The complete captures, in the order the report reads them. */
export function defaultCorpus(fixtures = DEFAULT_FIXTURE_DIR): CorpusPart[] {
  return [
    {
      name: UNPACED_CAPTURE,
      dir: join(fixtures, 'discovery'),
      description: 'T1.2 and T1.3: every candidate endpoint called once, one call at a time, on 2026-09-24',
      paced: false,
    },
    {
      name: 'rwa-index',
      dir: join(fixtures, 'rwa-index'),
      description: 'T3.4: the walk of the whole issuer catalogue through E18 and E19, on 2026-09-25',
      paced: false,
    },
    {
      name: 'check',
      dir: join(fixtures, 'check'),
      description: 'T3.7: the first live runs of the `check` command, on 2026-09-25',
      paced: false,
    },
    {
      name: 'demo',
      dir: join(fixtures, 'demo'),
      description: 'T5.3: the answers the two demonstration scenarios are replayed from, on 2026-09-26',
      paced: false,
    },
    {
      name: 'calibration',
      dir: join(fixtures, 'calibration', 'live-20260926T1044Z'),
      description: 'T4.1: the fifty assets of the calibration panel, paced at 40 requests per minute, on 2026-09-26',
      paced: true,
    },
  ];
}

/** Where the sample the engine is run over is replayed from: the one complete calibration walk. */
export function defaultSampleDir(fixtures = DEFAULT_FIXTURE_DIR): string {
  return join(fixtures, 'calibration', 'live-20260926T1044Z');
}

/** How much of the corpus there is, and what it reported it cost. */
export interface AuditTotals {
  /** Recorded answers read. */
  answers: number;
  /** Answers the API accepted. */
  accepted: number;
  /** Distinct endpoints of the verified inventory the corpus holds an answer for. */
  endpoints: number;
  /** Credits the answers of this corpus reported, all captures together. */
  creditsReported: number;
  /** Answers carrying no `status.credit_count`. */
  withoutCreditCount: number;
  /** Credits this run spent: none, because it sends no request (D14). */
  creditsSpent: number;
}

/** One whole audit run. */
export interface AuditRun {
  /** Wall clock of the run; the data it reads is dated by the recordings, never by this. */
  startedAt: string;
  finishedAt: string;
  corpus: { parts: Corpus['parts']; skipped: Corpus['skipped']; unknownPaths: { path: string; answers: number }[] };
  totals: AuditTotals;
  endpoints: EndpointCorpus[];
  rows: EndpointRow[];
  comparisons: InventoryComparison[];
  variances: { endpoint: EndpointId; fields: TypeVariance[] }[];
  optional: { endpoint: EndpointId; fields: OptionalField[] }[];
  alwaysNull: { endpoint: EndpointId; fields: NullField[] }[];
  /** The engine pass; `null` when the run was asked not to make one. */
  sample: SampleRun | null;
  findings: AuditFinding[];
  /** Entries a generator produced that cite no recorded answer, so the report did not print them (F9). */
  withheld: number;
  /**
   * Entries that cited an answer which did not show what they stated, so the report did not print them either
   * (T6.2). The two counts are kept apart because they are two different faults.
   */
  unproven: number;
  /** The second read of what was printed: every claim of every published entry, checked against its answer. */
  review: Review;
  budgetMs: number;
  inventoryRecordedAt: string;
}

export interface AuditOptions {
  /** The captures to read; the complete ones by default. */
  parts?: CorpusPart[];
  /** Where `docs/ENDPOINTS.md` is, for the two tables the comparison reads. */
  inventoryFile?: string;
  /** The engine pass over a sample of assets; `null` for a run that makes none. */
  sample?: SampleRun | null;
  /** Wall clock, epoch milliseconds. */
  now?: () => number;
}

/** Paths the corpus holds answers for that are not in the verified inventory, most recorded first. */
function unknownPaths(corpus: Corpus): { path: string; answers: number }[] {
  const found = new Map<string, number>();
  for (const entry of corpus.entries) {
    if (entry.endpoint !== null) continue;
    found.set(entry.path, (found.get(entry.path) ?? 0) + 1);
  }
  return [...found].map(([path, answers]) => ({ path, answers })).sort((a, b) => b.answers - a.answers);
}

/**
 * Reads the corpus, measures it, and produces the entries of the report.
 *
 * Nothing here reaches the network: the sample, when there is one, is produced by the caller from a replay client,
 * and everything else is read from files (D14).
 */
export function runAudit(options: AuditOptions = {}): AuditRun {
  const now = options.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const parts = options.parts ?? defaultCorpus();
  const corpus = readCorpus(parts);
  const endpoints = endpointCorpora(corpus);
  const sets = fieldsByEndpoint(corpus);

  const rows = options.inventoryFile === undefined ? readEndpointRows() : readEndpointRows(options.inventoryFile);
  const inventory =
    options.inventoryFile === undefined ? readFieldInventory() : readFieldInventory(options.inventoryFile);

  const variances = sets.map((set) => ({ endpoint: set.endpoint, fields: typeVariances(set.fields) }));
  const optional = sets.map((set) => ({ endpoint: set.endpoint, fields: optionalFields(set.entries) }));
  const alwaysNull = sets.map((set) => ({
    endpoint: set.endpoint,
    // A field whose only observed type is `null` never carried a value in this corpus.
    fields: nullFields(set.fields.filter((field) => field.types.length === 1)),
  }));
  const comparisons = compareInventory(sets, inventory);
  const sample = options.sample ?? null;

  const credits = corpusCredits(corpus);
  const { findings, withheld, unproven } = auditFindings({
    corpus,
    endpoints,
    rows,
    comparisons,
    variances,
    optional,
    alwaysNull,
    sample,
    unpaced: parts.filter((part) => !part.paced).map((part) => part.name),
    paced: parts.filter((part) => part.paced).map((part) => part.name),
    budgetMs: VERDICT_BUDGET_MS,
    inventoryRecordedAt: INVENTORY_RECORDED_AT,
  });

  // The same read the gate above applied, kept this time: what the report withheld is a count, but what it
  // printed is something a reader can ask about, so the claims that were checked are carried out with it.
  const context: ReviewContext = { corpus, comparisons, sample };

  return {
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    corpus: { parts: corpus.parts, skipped: corpus.skipped, unknownPaths: unknownPaths(corpus) },
    totals: {
      answers: credits.answers,
      accepted: endpoints.reduce((sum, endpoint) => sum + endpoint.accepted, 0),
      endpoints: endpoints.length,
      creditsReported: credits.reported,
      withoutCreditCount: credits.withoutCount,
      creditsSpent: 0,
    },
    endpoints,
    rows,
    comparisons,
    variances,
    optional,
    alwaysNull,
    sample,
    findings,
    withheld,
    unproven,
    review: reviewFindings(findings, context),
    budgetMs: VERDICT_BUDGET_MS,
    inventoryRecordedAt: INVENTORY_RECORDED_AT,
  };
}
