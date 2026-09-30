/**
 * `explain(check_id)` — what one check measures, in plain English, with the limits it reads and where those limits
 * come from (specification F6).
 *
 * Two rules shape it:
 * - **the limits are read, never restated.** Every number comes out of the `ChecksConfig` the run was given, so an
 *   explanation cannot drift from the thresholds the verdict was actually formed with. A limit written down here as
 *   prose would be a second copy of `config/checks.json`, and the first one to go stale;
 * - **the provenance travels with the limit.** Each section of `config/checks.json` carries a `notes` string saying
 *   which recorded answers its numbers were settled on (T4.2); `explain` hands that string back rather than
 *   summarising it, because it is the evidence behind the threshold.
 *
 * The prose itself — what the check measures and why an agent should care before acting — is written here, since it
 * describes this project's own checks rather than anything read from the API.
 */
import { C2_UNAVAILABLE_REASON } from '../checks/c2-cex-divergence.js';
import type { ChecksConfig } from '../checks/config.js';
import { CHECK_IDS, CHECK_TITLES, type CheckId, type Unit } from '../checks/model.js';
import type { EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';

/** One configured limit a check reads, in the unit it is expressed in. */
export interface ThresholdDigest {
  /** The setting as `config/checks.json` names it, for example `C4.warnOrderSharePercent`. */
  name: string;
  value: number;
  unit: Unit;
}

/** Everything `explain` answers about one check. */
export interface CheckExplanation {
  id: CheckId;
  title: string;
  /** What the check measures, and on which reading. */
  what: string;
  /** Why the measurement matters to something about to act on the price. */
  why: string;
  /** The endpoints it reads, by inventory identifier (`docs/ENDPOINTS.md`). */
  endpoints: EndpointId[];
  /** The configured limits it reads; empty when the check has none. */
  thresholds: ThresholdDigest[];
  /** What the numbers were settled on (`notes` of `config/checks.json`); `null` when the section carries none. */
  provenance: string | null;
  /** Why the check may not run at all, when that is known in advance; `null` otherwise. */
  caveat: string | null;
}

/** What each check measures, why it matters, and the endpoints it reads. No number lives here (see the header). */
const PROSE: Record<CheckId, Pick<CheckExplanation, 'what' | 'why' | 'endpoints'>> = {
  C1: {
    what:
      'Measures the gap between the aggregated price of the asset (E02) and the price of the same token read at its ' +
      'DEX venues (E10), as a percentage of the aggregate.',
    why:
      'The aggregate is a mean over venues, so it can stay steady while the venue an order would actually reach has ' +
      'moved. A wide gap means the price shown and the price obtainable are not the same number.',
    endpoints: ['E02', 'E10'],
  },
  C2: {
    what:
      'Would measure the gap between the aggregated price and the prices of individual centralised exchange pairs. ' +
      'No such source answers with the current API plan, so the check reports that instead of measuring.',
    why:
      'Centralised venues carry most of the volume of a large asset, so a per-exchange price would be the closest ' +
      'second opinion on the aggregate. Until a plan reaches one, the aggregate is read against DEX venues only (C1).',
    endpoints: [],
  },
  C3: {
    what:
      'Measures how old every timestamp read is, against the clock of the answer that carried it rather than against ' +
      'the local clock. Aggregated sources and DEX sources are held to separate limits, because they do not refresh ' +
      'at the same pace.',
    why:
      'A stale quote is the failure that looks most like a working one: the number is well formed, the field is ' +
      'present, and it describes a market that has since moved.',
    endpoints: ['E02', 'E06', 'E10', 'E14'],
  },
  C4: {
    what:
      'Measures the depth behind a price on the latest snapshot: how much each venue holds, how many times its 24 h ' +
      'volume runs past that depth, and — when an order size is given — what share of the deepest pool read that ' +
      'order would take.',
    why:
      'A venue can report a large volume while holding too little to close a position at the price just read. ' +
      'Volume says a price was reached; depth says whether it can be reached again, and for how large an order.',
    endpoints: ['E10', 'E11'],
  },
  C5: {
    what:
      'Measures how far one tokenised wrapper sits from the average tokenized price CMC publishes over the wrappers ' +
      'of its real-world asset (E14), and how wide the wrappers of that asset spread around it.',
    why:
      'A wrapper is a claim on something off-chain. When it drifts from the other wrappers of the same asset, the ' +
      'price is no longer a price of the underlying asset, which is the one thing a buyer of it wanted.',
    endpoints: ['E14'],
  },
  C6: {
    what:
      'Measures the gap between two endpoints that publish a value for the same asset — the aggregate (E02) against ' +
      'the simple price (E06), and against the wrapper price inside the RWA answer (E14) — and only where their ' +
      'timestamps are close enough to describe the same snapshot.',
    why:
      'Two endpoints disagreeing about one asset means at least one of them is not what the caller thinks it is. ' +
      'Outside the snapshot tolerance the gap is shown but not judged: a price that moved between two moments is ' +
      'not a price two endpoints disagree on.',
    endpoints: ['E02', 'E06', 'E14'],
  },
  C7: {
    what:
      'Reports the fields the verdict needed but could not read in the answers of this run: a missing container, an ' +
      'absent quote block, a price that is not a number. Severity depends on the field and on the endpoint it went ' +
      'missing from.',
    why:
      'Losing the aggregated price leaves nothing to form a verdict about; losing a timestamp or a liquidity figure ' +
      'leaves the verdict standing on less. Naming which one it was is the difference between the two.',
    endpoints: ['E01', 'E02', 'E05', 'E06', 'E10', 'E11', 'E14'],
  },
};

/** The configured limits of one check, in the order `config/checks.json` lists them. */
export function thresholdsOf(id: CheckId, config: ChecksConfig): ThresholdDigest[] {
  const percent = (name: string, value: number): ThresholdDigest => ({ name, value, unit: 'percent' });
  const seconds = (name: string, value: number): ThresholdDigest => ({ name, value, unit: 'seconds' });
  switch (id) {
    case 'C1':
      return [
        percent('C1.warnAbovePercent', config.C1.warnAbovePercent),
        percent('C1.criticalAbovePercent', config.C1.criticalAbovePercent),
      ];
    case 'C2':
      // No section in the file: a check that cannot run has no limit to read (D2).
      return [];
    case 'C3':
      return [
        seconds('C3.futureToleranceSeconds', config.C3.futureToleranceSeconds),
        seconds('C3.families.aggregate.warnAfterSeconds', config.C3.families.aggregate.warnAfterSeconds),
        seconds('C3.families.aggregate.criticalAfterSeconds', config.C3.families.aggregate.criticalAfterSeconds),
        seconds('C3.families.dex.warnAfterSeconds', config.C3.families.dex.warnAfterSeconds),
        seconds('C3.families.dex.criticalAfterSeconds', config.C3.families.dex.criticalAfterSeconds),
      ];
    case 'C4':
      return [
        { name: 'C4.warnLiquidityBelowUsd', value: config.C4.warnLiquidityBelowUsd, unit: 'usd' },
        { name: 'C4.criticalLiquidityBelowUsd', value: config.C4.criticalLiquidityBelowUsd, unit: 'usd' },
        { name: 'C4.warnTurnoverRatio', value: config.C4.warnTurnoverRatio, unit: 'ratio' },
        { name: 'C4.criticalTurnoverRatio', value: config.C4.criticalTurnoverRatio, unit: 'ratio' },
        percent('C4.warnOrderSharePercent', config.C4.warnOrderSharePercent),
        percent('C4.criticalOrderSharePercent', config.C4.criticalOrderSharePercent),
      ];
    case 'C5':
      return [
        percent('C5.warnPremiumPercent', config.C5.warnPremiumPercent),
        percent('C5.criticalPremiumPercent', config.C5.criticalPremiumPercent),
        percent('C5.warnSpreadPercent', config.C5.warnSpreadPercent),
        percent('C5.criticalSpreadPercent', config.C5.criticalSpreadPercent),
        percent('C5.unitBandPercent', config.C5.unitBandPercent),
        { name: 'C5.minVolume24hUsd', value: config.C5.minVolume24hUsd, unit: 'usd' },
      ];
    case 'C6':
      return [
        percent('C6.warnAbovePercent', config.C6.warnAbovePercent),
        percent('C6.criticalAbovePercent', config.C6.criticalAbovePercent),
        seconds('C6.snapshotToleranceSeconds', config.C6.snapshotToleranceSeconds),
      ];
    case 'C7':
      // C7 grades fields by severity rather than against a number, so it has no numeric limit at all (D8).
      return [];
  }
}

/** Where the numbers of a check were settled, as its section of `config/checks.json` records it. */
function provenanceOf(id: CheckId, config: ChecksConfig): string | null {
  switch (id) {
    case 'C1':
      return config.C1.notes;
    case 'C2':
      return null;
    case 'C3':
      return config.C3.notes;
    case 'C4':
      return config.C4.notes;
    case 'C5':
      return config.C5.notes;
    case 'C6':
      return config.C6.notes;
    case 'C7':
      return config.C7.notes;
  }
}

/** What a caller should know before reading a result of this check, beyond the measurement itself. */
function caveatOf(id: CheckId): string | null {
  switch (id) {
    case 'C2':
      return C2_UNAVAILABLE_REASON;
    case 'C1':
    case 'C4':
      return (
        'Reads DEX venues, which an asset only has when E05 lists a token contract for it. A coin comes back ' +
        'not_applicable rather than passing silently (D9).'
      );
    case 'C5':
      return (
        'Runs for a tokenised wrapper only, and only when the cached token to real-world-asset index links this ' +
        'token to one; otherwise it comes back not_applicable or unavailable with the reason (D6). Its limits are ' +
        'still settled on a single recorded asset, GOLD, so they are placeholders rather than calibrated values.'
      );
    case 'C3':
    case 'C6':
    case 'C7':
      return null;
  }
}

/** Reads a check identifier the way a caller may type it: `C4`, `c4`, or with surrounding spaces. */
export function parseCheckId(text: string): CheckId {
  const wanted = text.trim().toUpperCase();
  const found = CHECK_IDS.find((id) => id === wanted);
  if (found === undefined) {
    throw new CmcError(
      'config',
      `"${text.trim()}" is not a check identifier. The seven are ` +
        `${CHECK_IDS.map((id) => `${id} (${CHECK_TITLES[id]})`).join(', ')}.`,
    );
  }
  return found;
}

/** Everything known about one check: its prose, the limits it reads, and where those limits were settled. */
export function explainCheck(id: CheckId, config: ChecksConfig): CheckExplanation {
  return {
    id,
    title: CHECK_TITLES[id],
    ...PROSE[id],
    thresholds: thresholdsOf(id, config),
    provenance: provenanceOf(id, config),
    caveat: caveatOf(id),
  };
}

/** How a limit reads in a sentence: the value, then the unit it is expressed in. */
export function describeThreshold(threshold: ThresholdDigest): string {
  const unit: Record<Unit, string> = {
    percent: '%',
    seconds: 's',
    usd: 'USD',
    ratio: 'times the depth held',
    count: '',
  };
  const suffix = unit[threshold.unit];
  return `${threshold.name} = ${String(threshold.value)}${suffix === '' ? '' : ` ${suffix}`}`;
}

/** The explanation as lines of plain text, which is what the MCP tool hands back beside the structured answer. */
export function describeExplanation(explanation: CheckExplanation): string[] {
  const lines = [
    `${explanation.id} — ${explanation.title}`,
    '',
    `What it measures: ${explanation.what}`,
    '',
    `Why it matters: ${explanation.why}`,
    '',
    explanation.endpoints.length === 0
      ? 'Endpoints read: none — see the caveat below.'
      : `Endpoints read: ${explanation.endpoints.join(', ')} (docs/ENDPOINTS.md).`,
    '',
    explanation.thresholds.length === 0
      ? 'Configured limits: none — this check reads no numeric threshold.'
      : `Configured limits (config/checks.json): ${explanation.thresholds.map(describeThreshold).join('; ')}.`,
  ];
  if (explanation.caveat !== null) lines.push('', `Caveat: ${explanation.caveat}`);
  if (explanation.provenance !== null) lines.push('', `Where these limits come from: ${explanation.provenance}`);
  return lines;
}
