/**
 * The thresholds of the checks and the weights of the score, read from `config/checks.json`. The specification
 * puts them in a configuration file, not in the code (F4, F5), so that T4.2 can calibrate them without touching a
 * check.
 *
 * The file is validated strictly: an unknown key, a missing section, a severity that is not one of the three names
 * or a warning limit above its critical limit stops the run with a `config` error. A threshold read wrong would
 * change every verdict silently, which is worse than not starting.
 *
 * Each section may carry a `notes` string saying where its numbers come from; it is kept, so that the audit and the
 * web page can show the provenance of a limit next to the finding it produced.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { isRecord } from '../normalize/values.js';
import { isVerdict, type Verdict } from '../score/verdict.js';
import { CHECK_IDS, SEVERITY_RANK, type CheckId, type Severity } from './model.js';

export const CONFIG_FILE = join(PROJECT_ROOT, 'config', 'checks.json');

/** The two threshold families of C3: aggregated quotes and DEX prices, which do not age at the same pace (D4). */
export const FRESHNESS_FAMILIES = ['aggregate', 'dex'] as const;

export type FreshnessFamily = (typeof FRESHNESS_FAMILIES)[number];

export interface FreshnessLimits {
  warnAfterSeconds: number;
  criticalAfterSeconds: number;
}

export interface FreshnessConfig {
  notes: string | null;
  /** How far a timestamp may sit after the answer that carried it before it is reported. */
  futureToleranceSeconds: number;
  families: Record<FreshnessFamily, FreshnessLimits>;
}

export interface SchemaConfig {
  notes: string | null;
  /** Severity of a required field that could not be read and is not named in `severityByField`. */
  defaultSeverity: Severity;
  /**
   * Severity per field. A key may name the endpoint it applies to (`E10 data.p`, `E10 p`) or apply to every
   * endpoint (`data.quote.price`, `price`). The lookup takes the most specific key that matches: endpoint with
   * the full field path, endpoint with the last segment, the full field path, its last segment, then
   * `defaultSeverity`.
   */
  severityByField: Record<string, Severity>;
}

/** The limits of a price gap, in percent of the reference price. C1 reads them; C5 and C6 have their own below. */
export interface DivergenceConfig {
  notes: string | null;
  /** A gap wider than this, in either direction, is reported as a warning. */
  warnAbovePercent: number;
  /** A gap wider than this is reported as critical. */
  criticalAbovePercent: number;
}

/**
 * The limits of C6: how far two endpoints may sit apart on the same asset, and how far apart their timestamps may
 * sit and still describe the same snapshot. Beyond that tolerance the gap is shown but not judged, because a price
 * that moved between two moments is not a price two endpoints disagree on (D7).
 */
export interface ConsistencyConfig {
  notes: string | null;
  /** A gap wider than this, in either direction, is reported as a warning. */
  warnAbovePercent: number;
  /** A gap wider than this is reported as critical. */
  criticalAbovePercent: number;
  /** How far apart two timestamps of the same asset may sit and still be read as the same snapshot. */
  snapshotToleranceSeconds: number;
}

/**
 * The limits of C4: how thin a venue may be, how far its 24 h volume may run past the depth it holds, and how much
 * of the deepest pool one order may take. All three are read on the latest snapshot only (D5).
 */
export interface LiquidityConfig {
  notes: string | null;
  /** A venue holding fewer USD than this is reported as a warning. Lower is worse, so it sits above the critical limit. */
  warnLiquidityBelowUsd: number;
  /** A venue holding fewer USD than this is reported as critical. */
  criticalLiquidityBelowUsd: number;
  /** A 24 h volume above this many times the liquidity behind it is reported as a warning. */
  warnTurnoverRatio: number;
  /** A 24 h volume above this many times the liquidity behind it is reported as critical. */
  criticalTurnoverRatio: number;
  /** An order taking more than this share of the deepest pool, in percent, is reported as a warning. */
  warnOrderSharePercent: number;
  /** An order taking more than this share of the deepest pool, in percent, is reported as critical. */
  criticalOrderSharePercent: number;
}

/**
 * One factor that brings a wrapper price into the unit of the average tokenized price. The RWA answers state no
 * unit at all (D6), so a factor is a unit definition the project writes down, never a value read from the API, and
 * every one of them says where it comes from.
 */
export interface UnitFactor {
  /** How the factor is named in a finding, for example `gram to troy ounce`. */
  name: string;
  /** The wrapper price is multiplied by this to reach the unit of the average. */
  factor: number;
  /** Where the factor comes from: a URL, a fixture, or a document of this repository. */
  source: string;
}

/** The unit of one wrapper, stated rather than inferred: the first step of the ladder of D6. */
export interface UnitEntry {
  /** The wrapper price is multiplied by this to reach the unit of the average. */
  factor: number;
  /** Where the statement comes from: a URL, a fixture, or a document of this repository. */
  source: string;
}

/**
 * The limits of C5: how far one wrapper may sit from the average tokenized price of its asset, how wide the
 * wrappers of one asset may spread, how far from the average a price is still read in the same unit, and how little
 * a wrapper may trade before it is left out of the spread (D6).
 */
export interface RwaConfig {
  notes: string | null;
  /** A wrapper further from the average than this, in either direction, is reported as a warning. */
  warnPremiumPercent: number;
  /** A wrapper further from the average than this is reported as critical. */
  criticalPremiumPercent: number;
  /** A spread between the wrappers wider than this, in percent of the average, is reported as a warning. */
  warnSpreadPercent: number;
  /** A spread wider than this is reported as critical. */
  criticalSpreadPercent: number;
  /**
   * How far from the average a wrapper price may sit, in percent, and still be read in the unit of the average.
   * Not a quality limit: it separates a different unit from a deviation, and the smallest factor below is 31 times,
   * so this band is far from every unit the file lists.
   */
  unitBandPercent: number;
  /** A wrapper trading less than this over 24 h is listed but left out of the spread. */
  minVolume24hUsd: number;
  /** Stated units, by CMC identifier of the wrapper; empty until a source states one (D6, step 1). */
  units: Record<string, UnitEntry>;
  /** Factors tried, in this order, when a price sits outside the band (D6, step 3). */
  conversionFactors: UnitFactor[];
}

/**
 * How the seven checks weigh into one score out of 100, and where the verdict changes (specification F5, D11).
 *
 * The weights are renormalised over the checks that ran, so a check that could not run lowers nothing; the outputs
 * say how many ran instead (D9). Every check carries a weight, including the ones no key reaches today, so that a
 * check coming back is a change to this file rather than to the code.
 */
export interface ScoreConfig {
  notes: string | null;
  /** Weight of each check before renormalisation; one per check, and none of them zero. */
  weights: Record<CheckId, number>;
  /** Points out of 100 a check scores, read from its worst finding. */
  severityPoints: Record<Severity, number>;
  /** A score at or above this is `ACT`. */
  actAtOrAbove: number;
  /** A score at or above this and below `actAtOrAbove` is `CAUTION`; below it, `DO_NOT_ACT`. */
  cautionAtOrAbove: number;
  /**
   * The best verdict a run carrying a critical finding may reach, whatever its score. `null` leaves the score
   * alone to decide, which lets the checks that found nothing carry a run whose price could not be read at all.
   */
  capWithCritical: Verdict | null;
}

export interface ChecksConfig {
  C1: DivergenceConfig;
  C3: FreshnessConfig;
  C4: LiquidityConfig;
  C5: RwaConfig;
  C6: ConsistencyConfig;
  C7: SchemaConfig;
  score: ScoreConfig;
}

/** The checks whose thresholds are configured so far; a section for any other check is refused, not ignored. */
const CONFIGURED_CHECKS = ['C1', 'C3', 'C4', 'C5', 'C6', 'C7'] as const;

/** The one section of the file that is not a check: how the checks weigh into the score (F5). */
const SCORE_SECTION = 'score';

function fail(origin: string, detail: string): never {
  throw new CmcError('config', `${origin}: ${detail}`);
}

function section(value: Record<string, unknown>, name: string, allowed: readonly string[], origin: string): Record<string, unknown> {
  const found = value[name];
  if (!isRecord(found)) fail(origin, `"${name}" must be an object.`);
  for (const key of Object.keys(found)) {
    if (!allowed.includes(key)) fail(origin, `"${name}" has no setting called "${key}".`);
  }
  return found;
}

function notes(value: Record<string, unknown>, origin: string, where: string): string | null {
  const found = value.notes;
  if (found === undefined) return null;
  if (typeof found !== 'string') fail(origin, `${where}.notes must be a string.`);
  return found;
}

function seconds(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found < 0) {
    fail(origin, `${where}.${name} must be a number of seconds >= 0.`);
  }
  return found;
}

function percent(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found <= 0) {
    fail(origin, `${where}.${name} must be a percentage above 0.`);
  }
  return found;
}

function usd(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found <= 0) {
    fail(origin, `${where}.${name} must be an amount of USD above 0.`);
  }
  return found;
}

function ratio(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found <= 0) {
    fail(origin, `${where}.${name} must be a ratio above 0.`);
  }
  return found;
}

function severity(value: unknown, origin: string, where: string): Severity {
  if (typeof value !== 'string' || !(value in SEVERITY_RANK)) {
    fail(origin, `${where} must be one of ${Object.keys(SEVERITY_RANK).join(', ')}.`);
  }
  return value as Severity;
}

function freshnessLimits(families: Record<string, unknown>, family: FreshnessFamily, origin: string): FreshnessLimits {
  const where = `C3.families.${family}`;
  const found = families[family];
  if (!isRecord(found)) fail(origin, `${where} must be an object.`);
  for (const key of Object.keys(found)) {
    if (key !== 'warnAfterSeconds' && key !== 'criticalAfterSeconds') fail(origin, `${where} has no setting called "${key}".`);
  }
  const limits = {
    warnAfterSeconds: seconds(found, 'warnAfterSeconds', origin, where),
    criticalAfterSeconds: seconds(found, 'criticalAfterSeconds', origin, where),
  };
  if (limits.warnAfterSeconds > limits.criticalAfterSeconds) {
    fail(origin, `${where}.warnAfterSeconds must not be above criticalAfterSeconds.`);
  }
  return limits;
}

function divergenceConfig(root: Record<string, unknown>, name: 'C1', origin: string): DivergenceConfig {
  const found = section(root, name, ['notes', 'warnAbovePercent', 'criticalAbovePercent'], origin);
  const limits = {
    notes: notes(found, origin, name),
    warnAbovePercent: percent(found, 'warnAbovePercent', origin, name),
    criticalAbovePercent: percent(found, 'criticalAbovePercent', origin, name),
  };
  if (limits.warnAbovePercent > limits.criticalAbovePercent) {
    fail(origin, `${name}.warnAbovePercent must not be above criticalAbovePercent.`);
  }
  return limits;
}

function consistencyConfig(root: Record<string, unknown>, origin: string): ConsistencyConfig {
  const found = section(
    root,
    'C6',
    ['notes', 'warnAbovePercent', 'criticalAbovePercent', 'snapshotToleranceSeconds'],
    origin,
  );
  const limits = {
    notes: notes(found, origin, 'C6'),
    warnAbovePercent: percent(found, 'warnAbovePercent', origin, 'C6'),
    criticalAbovePercent: percent(found, 'criticalAbovePercent', origin, 'C6'),
    snapshotToleranceSeconds: seconds(found, 'snapshotToleranceSeconds', origin, 'C6'),
  };
  if (limits.warnAbovePercent > limits.criticalAbovePercent) {
    fail(origin, 'C6.warnAbovePercent must not be above criticalAbovePercent.');
  }
  return limits;
}

function liquidityConfig(root: Record<string, unknown>, origin: string): LiquidityConfig {
  const found = section(
    root,
    'C4',
    [
      'notes',
      'warnLiquidityBelowUsd',
      'criticalLiquidityBelowUsd',
      'warnTurnoverRatio',
      'criticalTurnoverRatio',
      'warnOrderSharePercent',
      'criticalOrderSharePercent',
    ],
    origin,
  );
  const limits = {
    notes: notes(found, origin, 'C4'),
    warnLiquidityBelowUsd: usd(found, 'warnLiquidityBelowUsd', origin, 'C4'),
    criticalLiquidityBelowUsd: usd(found, 'criticalLiquidityBelowUsd', origin, 'C4'),
    warnTurnoverRatio: ratio(found, 'warnTurnoverRatio', origin, 'C4'),
    criticalTurnoverRatio: ratio(found, 'criticalTurnoverRatio', origin, 'C4'),
    warnOrderSharePercent: percent(found, 'warnOrderSharePercent', origin, 'C4'),
    criticalOrderSharePercent: percent(found, 'criticalOrderSharePercent', origin, 'C4'),
  };
  // A thinner venue is a worse one, so this pair reads the other way round from every other limit of the file.
  if (limits.criticalLiquidityBelowUsd > limits.warnLiquidityBelowUsd) {
    fail(origin, 'C4.criticalLiquidityBelowUsd must not be above warnLiquidityBelowUsd.');
  }
  if (limits.warnTurnoverRatio > limits.criticalTurnoverRatio) {
    fail(origin, 'C4.warnTurnoverRatio must not be above criticalTurnoverRatio.');
  }
  if (limits.warnOrderSharePercent > limits.criticalOrderSharePercent) {
    fail(origin, 'C4.warnOrderSharePercent must not be above criticalOrderSharePercent.');
  }
  return limits;
}

function text(value: Record<string, unknown>, name: string, origin: string, where: string): string {
  const found = value[name];
  if (typeof found !== 'string' || found.trim() === '') {
    fail(origin, `${where}.${name} must be a non-empty string.`);
  }
  return found;
}

function factor(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found <= 0) {
    fail(origin, `${where}.${name} must be a multiplier above 0.`);
  }
  return found;
}

/** One entry of the unit table of C5: a multiplier and where it comes from, both required (D6, step 1). */
function unitEntry(value: unknown, origin: string, where: string): UnitEntry {
  if (!isRecord(value)) fail(origin, `${where} must be an object with a factor and a source.`);
  for (const key of Object.keys(value)) {
    if (key !== 'factor' && key !== 'source') fail(origin, `${where} has no setting called "${key}".`);
  }
  return { factor: factor(value, 'factor', origin, where), source: text(value, 'source', origin, where) };
}

/**
 * The unit table, keyed by the CMC identifier of the wrapper. A key that is not one is refused rather than ignored:
 * a unit stated for an asset nobody can look up would never be applied, and the run would silently infer instead.
 */
function unitTable(found: Record<string, unknown>, origin: string): Record<string, UnitEntry> {
  const raw = found.units;
  if (!isRecord(raw)) fail(origin, 'C5.units must be an object, empty when no source states a unit.');
  const units: Record<string, UnitEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(key)) {
      fail(origin, `C5.units has the key "${key}", which is not the CMC identifier of a wrapper.`);
    }
    units[key] = unitEntry(value, origin, `C5.units.${key}`);
  }
  return units;
}

/** The factors C5 tries when a price sits outside the band; each one names itself and cites its source (D6). */
function conversionFactors(found: Record<string, unknown>, origin: string): UnitFactor[] {
  const raw = found.conversionFactors;
  if (!Array.isArray(raw)) fail(origin, 'C5.conversionFactors must be an array.');
  return raw.map((value, index) => {
    const where = `C5.conversionFactors[${index}]`;
    if (!isRecord(value)) fail(origin, `${where} must be an object with a name, a factor and a source.`);
    for (const key of Object.keys(value)) {
      if (key !== 'name' && key !== 'factor' && key !== 'source') {
        fail(origin, `${where} has no setting called "${key}".`);
      }
    }
    return {
      name: text(value, 'name', origin, where),
      factor: factor(value, 'factor', origin, where),
      source: text(value, 'source', origin, where),
    };
  });
}

function rwaConfig(root: Record<string, unknown>, origin: string): RwaConfig {
  const found = section(
    root,
    'C5',
    [
      'notes',
      'warnPremiumPercent',
      'criticalPremiumPercent',
      'warnSpreadPercent',
      'criticalSpreadPercent',
      'unitBandPercent',
      'minVolume24hUsd',
      'units',
      'conversionFactors',
    ],
    origin,
  );
  const limits = {
    notes: notes(found, origin, 'C5'),
    warnPremiumPercent: percent(found, 'warnPremiumPercent', origin, 'C5'),
    criticalPremiumPercent: percent(found, 'criticalPremiumPercent', origin, 'C5'),
    warnSpreadPercent: percent(found, 'warnSpreadPercent', origin, 'C5'),
    criticalSpreadPercent: percent(found, 'criticalSpreadPercent', origin, 'C5'),
    unitBandPercent: percent(found, 'unitBandPercent', origin, 'C5'),
    minVolume24hUsd: usd(found, 'minVolume24hUsd', origin, 'C5'),
    units: unitTable(found, origin),
    conversionFactors: conversionFactors(found, origin),
  };
  if (limits.warnPremiumPercent > limits.criticalPremiumPercent) {
    fail(origin, 'C5.warnPremiumPercent must not be above criticalPremiumPercent.');
  }
  if (limits.warnSpreadPercent > limits.criticalSpreadPercent) {
    fail(origin, 'C5.warnSpreadPercent must not be above criticalSpreadPercent.');
  }
  // A band that does not reach the widest deviation a wrapper may show would read that deviation as another unit.
  if (limits.unitBandPercent <= limits.criticalPremiumPercent) {
    fail(origin, 'C5.unitBandPercent must be above criticalPremiumPercent, or a deviation would be read as a unit.');
  }
  // Two factors close to each other would both fit the band, and no answer says which one a token uses.
  for (const entry of limits.conversionFactors) {
    const ratioToOne = entry.factor > 1 ? entry.factor : 1 / entry.factor;
    if ((ratioToOne - 1) * 100 <= limits.unitBandPercent) {
      fail(
        origin,
        `C5.conversionFactors "${entry.name}" is ${String(entry.factor)}, which sits inside the band of ` +
          `${String(limits.unitBandPercent)} % around the average: a price it converts would also compare directly.`,
      );
    }
  }
  return limits;
}

function freshnessConfig(root: Record<string, unknown>, origin: string): FreshnessConfig {
  const found = section(root, 'C3', ['notes', 'futureToleranceSeconds', 'families'], origin);
  const families = found.families;
  if (!isRecord(families)) fail(origin, 'C3.families must be an object.');
  for (const key of Object.keys(families)) {
    if (!(FRESHNESS_FAMILIES as readonly string[]).includes(key)) fail(origin, `C3.families has no family called "${key}".`);
  }
  return {
    notes: notes(found, origin, 'C3'),
    futureToleranceSeconds: seconds(found, 'futureToleranceSeconds', origin, 'C3'),
    families: {
      aggregate: freshnessLimits(families, 'aggregate', origin),
      dex: freshnessLimits(families, 'dex', origin),
    },
  };
}

function schemaConfig(root: Record<string, unknown>, origin: string): SchemaConfig {
  const found = section(root, 'C7', ['notes', 'defaultSeverity', 'severityByField'], origin);
  const byField = found.severityByField;
  if (!isRecord(byField)) fail(origin, 'C7.severityByField must be an object.');
  const severityByField: Record<string, Severity> = {};
  for (const [field, value] of Object.entries(byField)) {
    severityByField[field] = severity(value, origin, `C7.severityByField.${field}`);
  }
  return {
    notes: notes(found, origin, 'C7'),
    defaultSeverity: severity(found.defaultSeverity, origin, 'C7.defaultSeverity'),
    severityByField,
  };
}

function points(value: Record<string, unknown>, name: string, origin: string, where: string): number {
  const found = value[name];
  if (typeof found !== 'number' || !Number.isFinite(found) || found < 0 || found > 100) {
    fail(origin, `${where}.${name} must be a number of points between 0 and 100.`);
  }
  return found;
}

/**
 * The weight of every check, in the order of `CHECK_IDS`. A weight is required for each one and may not be zero: a
 * check left out of this table, or weighed zero, would drop out of the score without any output saying so, and
 * whether a check counts is a decision for `docs/DECISIONS.md`, not a setting quietly missing from a file.
 */
function weightTable(found: Record<string, unknown>, origin: string): Record<CheckId, number> {
  const raw = found.weights;
  if (!isRecord(raw)) fail(origin, 'score.weights must be an object with one weight per check.');
  for (const key of Object.keys(raw)) {
    if (!(CHECK_IDS as readonly string[]).includes(key)) fail(origin, `score.weights has no check called "${key}".`);
  }
  const weights = {} as Record<CheckId, number>;
  for (const id of CHECK_IDS) {
    const value = raw[id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      fail(origin, `score.weights.${id} must be a weight above 0.`);
    }
    weights[id] = value;
  }
  return weights;
}

/**
 * The ladder a check scores on, one score per severity. It may not fall as a finding gets milder, and a check that
 * raised nothing scores exactly 100, so that the score of the specification reads as a share of a clean run.
 */
function severityPointTable(found: Record<string, unknown>, origin: string): Record<Severity, number> {
  const raw = found.severityPoints;
  if (!isRecord(raw)) fail(origin, 'score.severityPoints must be an object with one score per severity.');
  const names = Object.keys(SEVERITY_RANK) as Severity[];
  for (const key of Object.keys(raw)) {
    if (!names.includes(key as Severity)) fail(origin, `score.severityPoints has no severity called "${key}".`);
  }
  const table = {} as Record<Severity, number>;
  for (const name of names) table[name] = points(raw, name, origin, 'score.severityPoints');
  if (table.info !== 100) {
    fail(origin, 'score.severityPoints.info must be 100: the score is a share of what a check raising nothing scores.');
  }
  if (table.warning > table.info || table.critical > table.warning) {
    fail(origin, 'score.severityPoints must not rise with severity: info >= warning >= critical.');
  }
  return table;
}

/**
 * The best verdict a critical finding still allows. It must be written down, as `null` or as one of the three
 * verdicts: left out, it would read as "no cap", and whether a critical finding holds a verdict back is a decision
 * of `docs/DECISIONS.md` (D11), not a line missing from a file.
 */
function verdictCap(found: Record<string, unknown>, origin: string): Verdict | null {
  const raw = found.capWithCritical;
  if (raw === null) return null;
  if (!isVerdict(raw)) {
    fail(origin, 'score.capWithCritical must be null or one of ACT, CAUTION, DO_NOT_ACT.');
  }
  return raw;
}

function scoreConfig(root: Record<string, unknown>, origin: string): ScoreConfig {
  const found = section(
    root,
    SCORE_SECTION,
    ['notes', 'weights', 'severityPoints', 'actAtOrAbove', 'cautionAtOrAbove', 'capWithCritical'],
    origin,
  );
  const limits = {
    notes: notes(found, origin, SCORE_SECTION),
    weights: weightTable(found, origin),
    severityPoints: severityPointTable(found, origin),
    actAtOrAbove: points(found, 'actAtOrAbove', origin, SCORE_SECTION),
    cautionAtOrAbove: points(found, 'cautionAtOrAbove', origin, SCORE_SECTION),
    capWithCritical: verdictCap(found, origin),
  };
  // Strictly ordered and both above zero, so that each of the three verdicts stays reachable. A boundary at 0, or
  // two boundaries on the same score, would silently retire a verdict, which is the way T4.2 must not calibrate.
  if (limits.cautionAtOrAbove <= 0) {
    fail(origin, 'score.cautionAtOrAbove must be above 0, or no score could ever be DO_NOT_ACT.');
  }
  if (limits.cautionAtOrAbove >= limits.actAtOrAbove) {
    fail(origin, 'score.cautionAtOrAbove must be below actAtOrAbove, or no score could ever be CAUTION.');
  }
  return limits;
}

/** Reads a parsed configuration; `origin` names the file in every error message. */
export function parseChecksConfig(value: unknown, origin = CONFIG_FILE): ChecksConfig {
  if (!isRecord(value)) fail(origin, 'the configuration must be a JSON object.');
  for (const key of Object.keys(value)) {
    if (key === SCORE_SECTION) continue;
    if (!(CONFIGURED_CHECKS as readonly string[]).includes(key)) {
      fail(origin, `no check called "${key}" has thresholds yet.`);
    }
  }
  return {
    C1: divergenceConfig(value, 'C1', origin),
    C3: freshnessConfig(value, origin),
    C4: liquidityConfig(value, origin),
    C5: rwaConfig(value, origin),
    C6: consistencyConfig(value, origin),
    C7: schemaConfig(value, origin),
    score: scoreConfig(value, origin),
  };
}

/** Reads `config/checks.json`, or another file in its shape. */
export function loadChecksConfig(file: string = CONFIG_FILE): ChecksConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    throw new CmcError('config', `${file}: the check thresholds could not be read (${String(cause)}).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new CmcError('config', `${file}: the check thresholds are not valid JSON (${String(cause)}).`);
  }
  return parseChecksConfig(parsed, file);
}
