/**
 * The engine run over a sample of assets, aggregated (specification F9: "aggregates the results of C3, C6 and C7").
 *
 * Those three are the checks that describe the API rather than one asset's venues. C3 reads how old the timestamps
 * are, C6 whether two endpoints agree about one asset at one moment, and C7 which fields the verdict needed and
 * could not read — so running them over a panel and counting what comes out is a measurement of the data. C1, C4
 * and C5 are about the venues and the wrappers of one asset and stay in `check`; C2 has no source with this key
 * (D2).
 *
 * Every asset goes through the same `assessAsset` a user gets (D1), against recorded answers only (D14), so the
 * sample costs nothing to run and every finding it reports carries the fixture it was read from.
 *
 * Beside the three checks, this pass keeps what D8 explicitly hands to the audit: the fields the normalisers could
 * not read and that C7 does **not** score, because they are the same for every asset. Those describe the shape of
 * the API and belong here rather than in a per-asset verdict.
 */
import { describeMember, readPanel, type PanelMember } from '../calibration/panel.js';
import { assessAsset, type AssetAssessment } from '../checks/assess.js';
import { fieldPattern } from '../checks/c7-schema.js';
import { loadChecksConfig, type ChecksConfig } from '../checks/config.js';
import type { CheckId, CheckResult, Finding, Severity } from '../checks/model.js';
import type { CmcClient } from '../cmc/client.js';
import type { EndpointId } from '../cmc/endpoints.js';
import type { SourceRef } from '../normalize/model.js';
import type { WrapperIndex } from '../rwa/wrapper-index.js';
import type { Verdict } from '../score/verdict.js';

/** The checks the audit aggregates: the ones whose findings are about the data, not about one asset's venues. */
export const AUDITED_CHECKS = ['C3', 'C6', 'C7'] as const;

/** Below this many evaluated checks, an `ACT` rests on a thin reading, which the report names rather than passes
 * over (D9, and the note D13 leaves to T6). */
export const THIN_COVERAGE = 5;

/** One asset of the sample, as far as the audit reads it. */
export interface SampleAsset {
  member: PanelMember;
  score: number | null;
  verdict: Verdict;
  /** Checks that ran, out of seven. */
  evaluated: number;
  /** The three audited checks, with their findings and the answers behind them. */
  checks: CheckResult[];
  /** Every answer this asset was assessed on. */
  sources: SourceRef[];
  failures: { endpoint: EndpointId; kind: string; message: string }[];
}

/** Where a statement of this report can be opened: a recorded answer, and the field inside it. */
export interface Site {
  file: string;
  field: string | null;
  endpoint: EndpointId;
}

/** One kind of finding, and the assets that raised it. */
export interface SampleFinding {
  checkId: CheckId;
  code: string;
  severity: Severity;
  assets: number;
  /** The assets that raised it, in panel order. */
  members: string[];
  /**
   * The asset `message` and `evidence` were read on.
   *
   * The report quotes one asset's wording of a finding several assets raised, so it has to be able to say which
   * (T6.2). Without it a reader cannot tell whether the answer cited beside the quotation is the one that
   * produced it, and that is the whole of what the quotation is worth.
   */
  member: string;
  /** That asset's wording of it, as the check phrased it. */
  message: string;
  /** The recorded answer behind that wording; `null` when the finding cites none. */
  evidence: Site | null;
}

/** One field the normalisers could not read and that C7 does not score, because it is the same everywhere (D8). */
export interface ShapeIssue {
  endpoint: EndpointId;
  field: string;
  problem: string;
  /** The JSON types received under it, each once. */
  seen: string[];
  /** Assets of the sample whose answers carried it. */
  assets: number;
  /** Values it was observed on, all assets together. */
  values: number;
  evidence: Site | null;
}

/** How one check behaved over the sample. */
export interface SampleCheckStats {
  id: CheckId;
  evaluated: number;
  notApplicable: number;
  unavailable: number;
  bySeverity: Record<Severity, number>;
  /** The distinct reasons it gave when it did not run, most frequent first. */
  reasons: { reason: string; assets: number }[];
}

/** An asset whose verdict rests on few of the seven checks (D9). */
export interface ThinCoverage {
  member: string;
  verdict: Verdict;
  score: number | null;
  evaluated: number;
  /** Why the other checks did not run, in the words they gave. */
  reasons: string[];
  /** One recorded answer this verdict was read from. */
  example: string | null;
}

/** What the engine run over the sample measured. */
export interface SampleRun {
  /** Where the recorded answers were replayed from, relative to the project root. */
  dir: string;
  /** `status.timestamp` of the E03 answer the panel was read from, never the local clock (D4). */
  panelObservedAt: string;
  assets: number;
  outcomes: SampleAsset[];
  checks: SampleCheckStats[];
  findings: SampleFinding[];
  shapeIssues: ShapeIssue[];
  thinAt: number;
  thin: ThinCoverage[];
  /** The calls that brought nothing back, most frequent first. */
  failures: { endpoint: EndpointId; kind: string; message: string; assets: number }[];
}

export interface SampleOptions {
  /** Assets to read from E03; the whole recorded panel by default. */
  size?: number;
  config?: ChecksConfig;
  /** The token to real-world-asset index C5 is read against (D6); `null` for a run that has none. */
  wrapperIndex?: WrapperIndex | null;
  /** Below this many evaluated checks a verdict is reported as thin. */
  thinAt?: number;
  /** Called after each asset, so a command can show progress. */
  onAsset?: (asset: SampleAsset, done: number, total: number) => void;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function isAudited(check: CheckResult): boolean {
  return (AUDITED_CHECKS as readonly string[]).includes(check.id);
}

/** The first answer a finding cites, as the report cites it: the fixture file and the field inside it. */
function firstEvidence(finding: Finding): Site | null {
  const [first] = finding.evidence;
  if (first === undefined || first.source.fixture === null) return null;
  return { file: first.source.fixture.file, field: first.field, endpoint: first.source.endpoint };
}

/** How an assessment names the asset it was about. */
function describeAsset(assessment: AssetAssessment): string {
  const { asset, subject } = assessment;
  return asset?.symbol ?? (subject.kind === 'symbol' ? subject.symbol : `CMC ${String(subject.cmcId)}`);
}

/** How each audited check behaved over the sample. */
function checkStats(outcomes: readonly SampleAsset[]): SampleCheckStats[] {
  return AUDITED_CHECKS.map((id) => {
    const stats: SampleCheckStats = {
      id,
      evaluated: 0,
      notApplicable: 0,
      unavailable: 0,
      bySeverity: { info: 0, warning: 0, critical: 0 },
      reasons: [],
    };
    const reasons = new Map<string, { reason: string; assets: number }>();
    for (const outcome of outcomes) {
      const check = outcome.checks.find((one) => one.id === id);
      if (check === undefined) continue;
      if (check.status === 'evaluated') {
        stats.evaluated += 1;
        stats.bySeverity[check.severity ?? 'info'] += 1;
        continue;
      }
      if (check.status === 'not_applicable') stats.notApplicable += 1;
      else stats.unavailable += 1;
      const reason = check.reason ?? 'No reason was given.';
      const seen = reasons.get(reason);
      if (seen) seen.assets += 1;
      else reasons.set(reason, { reason, assets: 1 });
    }
    stats.reasons = [...reasons.values()].sort((a, b) => b.assets - a.assets);
    return stats;
  });
}

/** Every finding the audited checks raised over the sample, worst first, then most frequent. */
function findingStats(outcomes: readonly SampleAsset[]): SampleFinding[] {
  const found = new Map<string, SampleFinding>();
  for (const outcome of outcomes) {
    const member = describeMember(outcome.member);
    for (const check of outcome.checks) {
      for (const finding of check.findings) {
        const key = `${check.id}|${finding.code}|${finding.severity}`;
        const stats = found.get(key);
        if (stats) {
          // One asset counts once, however many times its checks raised the same code: C7 raises one finding per
          // unreadable field, and an asset with three of them is still one asset.
          if (!stats.members.includes(member)) {
            stats.assets += 1;
            stats.members.push(member);
          }
          // The wording, the answer behind it and the asset it was read on move together or not at all: a
          // quotation from one asset beside another asset's answer proves nothing about either (T6.2).
          const evidence = stats.evidence ?? firstEvidence(finding);
          if (stats.evidence === null && evidence !== null) {
            stats.evidence = evidence;
            stats.message = finding.message;
            stats.member = member;
          }
          continue;
        }
        found.set(key, {
          checkId: check.id,
          code: finding.code,
          severity: finding.severity,
          assets: 1,
          members: [member],
          member,
          message: finding.message,
          evidence: firstEvidence(finding),
        });
      }
    }
  }
  return [...found.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.assets - a.assets ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
}

/** The distinct calls that brought nothing back, most frequent first. */
function failureStats(outcomes: readonly SampleAsset[]): SampleRun['failures'] {
  const found = new Map<string, SampleRun['failures'][number]>();
  for (const outcome of outcomes) {
    for (const failure of outcome.failures) {
      const key = `${failure.endpoint}|${failure.kind}|${failure.message}`;
      const seen = found.get(key);
      if (seen) seen.assets += 1;
      else found.set(key, { ...failure, assets: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.assets - a.assets);
}

/**
 * The shapes D8 hands to the audit, grouped across the sample.
 *
 * They are read from the assessments rather than recomputed, so that what the audit describes is exactly what the
 * engine met. Grouping is by endpoint, field pattern and problem, as C7 groups them, because a field sent as a
 * string on every one of two thousand pairs is one shape of the API, not two thousand observations.
 */
function shapeIssues(assessments: readonly AssetAssessment[]): ShapeIssue[] {
  const found = new Map<string, ShapeIssue & { seenAssets: Set<string> }>();
  for (const assessment of assessments) {
    const asset = describeAsset(assessment);
    for (const group of assessment.unreadable) {
      const field = fieldPattern(group.field);
      const key = `${group.source.endpoint}|${field}|${group.problem}`;
      const stats = found.get(key);
      if (stats) {
        stats.values += group.count;
        stats.seenAssets.add(asset);
        for (const type of group.seen) if (!stats.seen.includes(type)) stats.seen.push(type);
        continue;
      }
      found.set(key, {
        endpoint: group.source.endpoint,
        field,
        problem: group.problem,
        seen: [...group.seen],
        assets: 0,
        values: group.count,
        evidence:
          group.source.fixture === null
            ? null
            : { file: group.source.fixture.file, field: group.example, endpoint: group.source.endpoint },
        seenAssets: new Set([asset]),
      });
    }
  }
  return [...found.values()]
    .map(({ seenAssets, ...issue }) => ({ ...issue, assets: seenAssets.size }))
    .sort((a, b) => b.assets - a.assets || b.values - a.values || (a.field < b.field ? -1 : 1));
}

/** The reasons the checks of one asset gave for not running, each once. */
function reasonsOf(assessment: AssetAssessment): string[] {
  return [...new Set(assessment.checks.flatMap((check) => (check.reason === null ? [] : [check.reason])))];
}

/**
 * Reads the recorded panel and runs the engine over every asset on it.
 *
 * `client` answers from fixtures alone; nothing here reaches the network (D14). Assets are assessed one after
 * another, as the calibration does, so that an answer read for one asset is never attributed to the next.
 */
export async function runSample(client: CmcClient, dir: string, options: SampleOptions = {}): Promise<SampleRun> {
  const config = options.config ?? loadChecksConfig();
  const thinAt = options.thinAt ?? THIN_COVERAGE;
  const panel = await readPanel(client, options.size);

  const assessments: AssetAssessment[] = [];
  const outcomes: SampleAsset[] = [];
  for (const member of panel.members) {
    const assessment = await assessAsset(
      client,
      { kind: 'cmcId', cmcId: member.cmcId },
      { config, ...(options.wrapperIndex === undefined ? {} : { wrapperIndex: options.wrapperIndex }) },
    );
    assessments.push(assessment);
    const outcome: SampleAsset = {
      member,
      score: assessment.score.score,
      verdict: assessment.score.verdict,
      evaluated: assessment.score.coverage.evaluated,
      checks: assessment.checks.filter(isAudited),
      sources: assessment.sources,
      failures: assessment.failures,
    };
    outcomes.push(outcome);
    options.onAsset?.(outcome, outcomes.length, panel.members.length);
  }

  const thin = outcomes.flatMap((outcome, at) => {
    const assessment = assessments[at];
    if (outcome.evaluated >= thinAt || assessment === undefined) return [];
    return [
      {
        member: describeMember(outcome.member),
        verdict: outcome.verdict,
        score: outcome.score,
        evaluated: outcome.evaluated,
        reasons: reasonsOf(assessment),
        example: outcome.sources[0]?.fixture?.file ?? null,
      },
    ];
  });

  return {
    dir,
    panelObservedAt: panel.source.observedAt,
    assets: outcomes.length,
    outcomes,
    checks: checkStats(outcomes),
    findings: findingStats(outcomes),
    shapeIssues: shapeIssues(assessments),
    thinAt,
    thin,
    failures: failureStats(outcomes),
  };
}
