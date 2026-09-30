/**
 * C5 - a tokenised wrapper of a real-world asset against the other wrappers of the same asset.
 *
 * The specification asks for the premium or discount against the reference asset (F4). No reachable endpoint carries
 * a price of the underlying asset: `tradfi_markets` lists venues without prices and is empty for GOLD, and E15 is
 * refused with this key. So the reference here is E14 `average_tokenized_price`, CMC's own average over the
 * wrappers, and the outputs call it exactly that - never an underlying market price (D6). Beside it, the spread
 * between the wrappers of one asset says how much the wrappers disagree, which needs no external reference at all.
 *
 * The answers state no unit: in the recorded GOLD asset, five wrappers are priced near 4,255 USD and two near
 * 137 USD, and nothing says whether that is an ounce, a gram or a fraction. A wrapper price therefore goes through
 * the ladder of D6 - a unit stated in `config/checks.json`, else a price already in the band around the average,
 * else one configured conversion factor that brings it into that band ("unit inferred"), else a warning that the
 * price level is not explained by a known unit. The last case is reported, never dropped: the API gives no way to
 * tell a different unit from a real deviation, and a silent guess either way would be the project inventing data.
 *
 * Findings are raised on the wrapper the run is about; its siblings are measured, cited, and carried by the spread.
 * An asset that is not a tokenised wrapper reaches none of this and the check is `not_applicable` (D9).
 */
import type { SourceRef } from '../normalize/model.js';
import type { RwaQuote, RwaWrapper } from '../normalize/rwa.js';
import { relativeGapPercent } from './c1-dex-divergence.js';
import type { RwaConfig } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement } from './model.js';
import { formatPercent, formatUsd, isAboutAsset, priceLabel, type AssetSelector } from './prices.js';

/**
 * How the unit of a wrapper price was settled, in the order D6 tries them.
 * - `stated`: `config/checks.json` names the unit of this wrapper, and cites where that comes from;
 * - `direct`: the price already sits in the band around the average, so it is compared as it stands;
 * - `inferred`: exactly one configured factor brings the price into that band;
 * - `ambiguous`: several factors do, and no answer says which one this wrapper uses;
 * - `unexplained`: none does, so the price level is reported as unexplained rather than compared;
 * - `unknown`: the price or the average could not be read, so no unit question arises.
 */
export type UnitBasis = 'stated' | 'direct' | 'inferred' | 'ambiguous' | 'unexplained' | 'unknown';

/** What the unit ladder settled for one wrapper. */
export interface ResolvedUnit {
  basis: UnitBasis;
  /** The multiplier applied to the wrapper price; `null` when no unit could be settled. */
  factor: number | null;
  /** How the multiplier is named in a finding; `null` when the price was read as it stands. */
  name: string | null;
  /** Where the multiplier comes from; `null` when none was applied. */
  source: string | null;
  /** The price in the unit of the average; `null` when the unit could not be settled. */
  comparableUsd: number | null;
  /** The configured factors that would fit the band, named; only `ambiguous` has more than one. */
  candidates: string[];
}

const NO_UNIT: ResolvedUnit = {
  basis: 'unknown',
  factor: null,
  name: null,
  source: null,
  comparableUsd: null,
  candidates: [],
};

/** A multiplier as a report writes it: nine significant digits, enough for an exact unit definition, no padding. */
export function formatFactor(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable multiplier';
  return String(Number.parseFloat(value.toPrecision(9)));
}

/**
 * Settles the unit of one wrapper price against the average, following the ladder of D6.
 *
 * A stated unit wins over everything, including the band: a wrapper whose unit is known and whose price then sits
 * far from the average has a real deviation, which the premium finding reports rather than explains away.
 */
export function resolveUnit(
  priceUsd: number | null,
  cmcId: number | null,
  averageUsd: number | null,
  config: RwaConfig,
): ResolvedUnit {
  if (priceUsd === null || priceUsd <= 0 || averageUsd === null || averageUsd <= 0) return NO_UNIT;

  const stated = cmcId === null ? undefined : config.units[String(cmcId)];
  if (stated !== undefined) {
    return {
      basis: 'stated',
      factor: stated.factor,
      name: `the unit stated for ${String(cmcId)}`,
      source: stated.source,
      comparableUsd: priceUsd * stated.factor,
      candidates: [],
    };
  }

  const inBand = (value: number): boolean =>
    Math.abs(relativeGapPercent(averageUsd, value)) <= config.unitBandPercent;
  if (inBand(priceUsd)) {
    return { basis: 'direct', factor: 1, name: null, source: null, comparableUsd: priceUsd, candidates: [] };
  }

  const fitting = config.conversionFactors.filter((entry) => inBand(priceUsd * entry.factor));
  const candidates = fitting.map((entry) => entry.name);
  const [only] = fitting;
  if (fitting.length === 1 && only !== undefined) {
    return {
      basis: 'inferred',
      factor: only.factor,
      name: only.name,
      source: only.source,
      comparableUsd: priceUsd * only.factor,
      candidates,
    };
  }
  return {
    basis: fitting.length > 1 ? 'ambiguous' : 'unexplained',
    factor: null,
    name: null,
    source: null,
    comparableUsd: null,
    candidates,
  };
}

/** One wrapper C5 reads, with the unit its price was settled in and whether it counts in the spread. */
export interface ComparedWrapper {
  /** What the price is, in the words of the outputs, for example `E14 wrapper price of PAXG`. */
  label: string;
  source: SourceRef;
  cmcId: number | null;
  symbol: string | null;
  issuerName: string | null;
  /** The price as the answer carried it; `null` when it could not be read, which C7 scores (D8). */
  priceUsd: number | null;
  volume24hUsd: number | null;
  unit: ResolvedUnit;
  /** How far the comparable price sits from the average, in percent; `null` when either could not be settled. */
  deviationPercent: number | null;
  /** True when this wrapper counts in the spread: a settled unit, and at least the configured 24 h volume. */
  inSpread: boolean;
}

/** Whether a wrapper trades enough to carry a spread. A volume that could not be read is not treated as enough. */
function tradesEnough(volume24hUsd: number | null, config: RwaConfig): boolean {
  return volume24hUsd !== null && volume24hUsd >= config.minVolume24hUsd;
}

/** The wrappers of one RWA answer, each brought to the form the comparison needs. */
export function comparedWrappers(quote: RwaQuote, config: RwaConfig): ComparedWrapper[] {
  const average = quote.averageTokenizedPriceUsd;
  return quote.wrappers.map((wrapper: RwaWrapper): ComparedWrapper => {
    const unit = resolveUnit(wrapper.priceUsd, wrapper.asset.cmcId, average, config);
    const comparable = unit.comparableUsd;
    return {
      label: priceLabel(wrapper),
      source: wrapper.source,
      cmcId: wrapper.asset.cmcId,
      symbol: wrapper.asset.symbol,
      issuerName: wrapper.issuerName,
      priceUsd: wrapper.priceUsd,
      volume24hUsd: wrapper.volume24hUsd,
      unit,
      deviationPercent:
        comparable !== null && average !== null && average > 0 ? relativeGapPercent(average, comparable) : null,
      inSpread: comparable !== null && tradesEnough(wrapper.volume24hUsd, config),
    };
  });
}

/** Names a wrapper the way a sentence does: its symbol, else its CMC identifier, else that it has neither. */
function wrapperName(wrapper: ComparedWrapper): string {
  return wrapper.symbol ?? (wrapper.cmcId === null ? 'an unnamed wrapper' : `CMC ${String(wrapper.cmcId)}`);
}

/** How wide the wrappers that count spread, in percent of the average; `null` when fewer than two count. */
export function spreadPercent(wrappers: readonly ComparedWrapper[], averageUsd: number | null): number | null {
  const prices = wrappers.flatMap((wrapper) =>
    wrapper.inSpread && wrapper.unit.comparableUsd !== null ? [wrapper.unit.comparableUsd] : [],
  );
  if (prices.length < 2 || averageUsd === null || averageUsd <= 0) return null;
  return ((Math.max(...prices) - Math.min(...prices)) / averageUsd) * 100;
}

function averageMeasurement(quote: RwaQuote): Measurement {
  const name = quote.asset.symbol ?? quote.asset.name ?? 'this real-world asset';
  return {
    label: `E14 average tokenized price of ${name}`,
    value: quote.averageTokenizedPriceUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(quote.source),
  };
}

function priceMeasurement(wrapper: ComparedWrapper): Measurement {
  return {
    label: wrapper.label,
    value: wrapper.priceUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(wrapper.source),
  };
}

function comparableMeasurement(wrapper: ComparedWrapper): Measurement {
  return {
    label: `${wrapper.label}, in the unit of the average`,
    value: wrapper.unit.comparableUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(wrapper.source),
  };
}

function deviationMeasurement(wrapper: ComparedWrapper, config: RwaConfig, reported: boolean): Measurement {
  return {
    label: `${wrapper.label} against the average tokenized price`,
    value: wrapper.deviationPercent,
    unit: 'percent',
    threshold: reported ? config.warnPremiumPercent : null,
    evidence: evidence(wrapper.source),
  };
}

function spreadMeasurement(quote: RwaQuote, spread: number | null, config: RwaConfig): Measurement {
  return {
    label: 'E14 spread between the wrappers that trade, in percent of the average',
    value: spread,
    unit: 'percent',
    threshold: config.warnSpreadPercent,
    evidence: evidence(quote.source),
  };
}

function finding(
  source: SourceRef,
  measurement: Measurement | null,
  part: Pick<Finding, 'code' | 'severity' | 'message'>,
): Finding {
  return { ...part, measurement, evidence: [evidence(source)] };
}

/** What the unit ladder settled, when it is worth saying: an inferred, ambiguous or unexplained price level. */
function unitFinding(wrapper: ComparedWrapper, config: RwaConfig): Finding | null {
  const name = wrapperName(wrapper);
  const price = wrapper.priceUsd ?? 0;
  const measurement = comparableMeasurement(wrapper);
  switch (wrapper.unit.basis) {
    case 'inferred':
      return finding(wrapper.source, measurement, {
        code: 'unit_inferred',
        severity: 'info',
        message:
          `${name} is priced ${formatUsd(price)}, outside the ${formatPercent(config.unitBandPercent)} band around ` +
          `the average tokenized price; multiplied by ${formatFactor(wrapper.unit.factor ?? 1)} ` +
          `(${wrapper.unit.name ?? 'a configured factor'}) it falls inside it, so it is compared after conversion ` +
          'and its unit is inferred, not stated by the answer.',
      });
    case 'ambiguous':
      return finding(wrapper.source, measurement, {
        code: 'unit_ambiguous',
        severity: 'warning',
        message:
          `${name} is priced ${formatUsd(price)}, and ${String(wrapper.unit.candidates.length)} configured factors ` +
          `(${wrapper.unit.candidates.join(', ')}) each bring it into the band around the average tokenized price; ` +
          'the answer states no unit, so this wrapper is left out of the spread rather than converted by a guess.',
      });
    case 'unexplained':
      return finding(wrapper.source, measurement, {
        code: 'unit_unexplained',
        severity: 'warning',
        message:
          `${name} is priced ${formatUsd(price)}, which no known unit explains: it sits outside the ` +
          `${formatPercent(config.unitBandPercent)} band around the average tokenized price and no configured ` +
          'factor brings it inside. The answer states no unit, so this may be another unit or a real deviation; it ' +
          'is reported rather than compared.',
      });
    default:
      return null;
  }
}

/** A wrapper whose price the answer did not carry: the field itself is C7's to score (D8). */
function priceUnknownFinding(wrapper: ComparedWrapper): Finding {
  return finding(wrapper.source, priceMeasurement(wrapper), {
    code: 'wrapper_price_unknown',
    severity: 'info',
    message:
      `${wrapperName(wrapper)} carries no usable price, so it could not be compared with the average tokenized ` +
      'price; C7 reports the field itself.',
  });
}

/** How far the wrapper the run is about sits from the average of its asset: the premium or discount of D6. */
function deviationFinding(
  wrapper: ComparedWrapper,
  averageUsd: number,
  measurement: Measurement,
  config: RwaConfig,
): Finding | null {
  const deviation = wrapper.deviationPercent;
  if (deviation === null || Math.abs(deviation) <= config.warnPremiumPercent) return null;
  const critical = Math.abs(deviation) > config.criticalPremiumPercent;
  const limit = critical ? config.criticalPremiumPercent : config.warnPremiumPercent;
  const converted =
    wrapper.unit.factor !== null && wrapper.unit.factor !== 1
      ? ` (${formatUsd(wrapper.priceUsd ?? 0)} multiplied by ${formatFactor(wrapper.unit.factor)})`
      : '';
  return finding(wrapper.source, measurement, {
    code: 'wrapper_deviation',
    severity: critical ? 'critical' : 'warning',
    message:
      `${wrapperName(wrapper)} is ${formatUsd(wrapper.unit.comparableUsd ?? 0)}${converted}, ` +
      `${formatPercent(Math.abs(deviation))} ${deviation >= 0 ? 'above' : 'below'} the average tokenized price of ` +
      `${formatUsd(averageUsd)}; limit: ${formatPercent(limit)}.`,
  });
}

/** How far apart the wrappers of one asset are priced, once brought to the same unit. */
function spreadFinding(
  quote: RwaQuote,
  wrappers: readonly ComparedWrapper[],
  spread: number,
  measurement: Measurement,
  config: RwaConfig,
): Finding | null {
  if (spread <= config.warnSpreadPercent) return null;
  const critical = spread > config.criticalSpreadPercent;
  const limit = critical ? config.criticalSpreadPercent : config.warnSpreadPercent;
  const counted = wrappers.filter((wrapper) => wrapper.inSpread);
  const prices = counted.map((wrapper) => wrapper.unit.comparableUsd ?? 0);
  return finding(quote.source, measurement, {
    code: 'wrapper_spread',
    severity: critical ? 'critical' : 'warning',
    message:
      `The ${String(counted.length)} wrappers that trade span ${formatUsd(Math.min(...prices))} to ` +
      `${formatUsd(Math.max(...prices))}, ${formatPercent(spread)} of the average tokenized price; ` +
      `limit: ${formatPercent(limit)}.`,
  });
}

/** The wrappers left out of the spread for trading too little: named in one finding, never dropped (D6). */
function lowVolumeFinding(quote: RwaQuote, wrappers: readonly ComparedWrapper[], config: RwaConfig): Finding | null {
  const quiet = wrappers.filter(
    (wrapper) => wrapper.unit.comparableUsd !== null && !tradesEnough(wrapper.volume24hUsd, config),
  );
  if (quiet.length === 0) return null;
  const listed = quiet
    .map((wrapper) => `${wrapperName(wrapper)} (${formatUsd(wrapper.volume24hUsd ?? 0)})`)
    .join(', ');
  return finding(quote.source, null, {
    code: 'low_volume_left_out',
    severity: 'info',
    message:
      `${listed}: 24 h volume below ${formatUsd(config.minVolume24hUsd)}, so ` +
      `${quiet.length === 1 ? 'this wrapper is' : 'these wrappers are'} measured and reported but left out of the ` +
      'spread, where a price nobody trades at would widen the range without saying anything about the others.',
  });
}

/** Why no spread could be measured, when fewer than two wrappers counted. */
function spreadUnmeasurableFinding(
  quote: RwaQuote,
  wrappers: readonly ComparedWrapper[],
  measurement: Measurement,
): Finding {
  const counted = wrappers.filter((wrapper) => wrapper.inSpread).length;
  return finding(quote.source, measurement, {
    code: 'spread_unmeasurable',
    severity: 'info',
    message:
      `${counted === 0 ? 'No wrapper' : 'Only one wrapper'} of this asset both carries a price in a settled unit ` +
      `and trades enough to count, out of ${String(wrappers.length)} read, so no spread between wrappers was ` +
      'measured.',
  });
}

/**
 * Runs C5 on one real-world asset read from E14.
 *
 * `subject` names the wrapper the run is about, as the caller knows it (a CMC identifier or a symbol); the premium
 * or discount is reported for that wrapper, and its siblings are measured and carried by the spread. Pass `null`
 * when the run is about the asset itself rather than one of its wrappers: the spread then stands alone.
 *
 * The check is `not_applicable` when no RWA answer was read, when the answer listed no wrapper, or when the subject
 * is not one of the wrappers of this asset - the last case being an asset that is not a tokenised wrapper (D9). The
 * caller may replace the reason when it knows more about why.
 */
export function runRwaCheck(quote: RwaQuote | null, subject: AssetSelector | null, config: RwaConfig): CheckResult {
  if (quote === null) {
    return notApplicable('C5', 'No real-world-asset answer was read for this asset, so there is nothing to compare.');
  }
  const wrappers = comparedWrappers(quote, config);
  if (wrappers.length === 0) {
    return notApplicable(
      'C5',
      'The real-world-asset answer listed no tokenised wrapper, so there is nothing to compare.',
      [quote.source],
    );
  }

  const target = subject === null ? null : quote.wrappers.findIndex((wrapper) => isAboutAsset(wrapper, subject));
  if (target !== null && target < 0) {
    const known = wrappers.map(wrapperName).join(', ');
    return notApplicable(
      'C5',
      `This asset is not one of the tokenised wrappers the real-world-asset answer listed (${known}), so it has ` +
        'no average tokenized price to be compared with.',
      [quote.source],
    );
  }
  const reported = target === null ? null : wrappers[target] ?? null;

  const average = quote.averageTokenizedPriceUsd;
  const theAverage = averageMeasurement(quote);
  const measurements: Measurement[] = [theAverage];
  const findings: Finding[] = [];

  if (average === null) {
    findings.push(
      finding(quote.source, theAverage, {
        code: 'average_unknown',
        severity: 'info',
        message:
          'The real-world-asset answer carries no usable average tokenized price, so no wrapper could be compared ' +
          'with it and no spread was measured against it; C7 reports the field itself.',
      }),
    );
  } else if (average <= 0) {
    findings.push(
      finding(quote.source, theAverage, {
        code: 'average_not_positive',
        severity: 'warning',
        message:
          `The average tokenized price of this asset is ${formatUsd(average)}, so no relative deviation can be ` +
          'measured against it; the wrapper prices are reported as they were read.',
      }),
    );
  }

  for (const wrapper of wrappers) {
    const isReported = wrapper === reported;
    measurements.push(priceMeasurement(wrapper), comparableMeasurement(wrapper));
    const deviation = deviationMeasurement(wrapper, config, isReported);
    measurements.push(deviation);

    if (wrapper.priceUsd === null) {
      findings.push(priceUnknownFinding(wrapper));
      continue;
    }
    const unit = unitFinding(wrapper, config);
    if (unit) findings.push(unit);
    if (isReported && average !== null && average > 0) {
      const premium = deviationFinding(wrapper, average, deviation, config);
      if (premium) findings.push(premium);
    }
  }

  const spread = spreadPercent(wrappers, average);
  const theSpread = spreadMeasurement(quote, spread, config);
  measurements.push(theSpread);
  if (spread === null) {
    findings.push(spreadUnmeasurableFinding(quote, wrappers, theSpread));
  } else {
    const wide = spreadFinding(quote, wrappers, spread, theSpread, config);
    if (wide) findings.push(wide);
  }
  const quiet = lowVolumeFinding(quote, wrappers, config);
  if (quiet) findings.push(quiet);

  return evaluated('C5', {
    findings,
    measurements,
    sources: [quote.source, ...wrappers.map((wrapper) => wrapper.source)],
  });
}
