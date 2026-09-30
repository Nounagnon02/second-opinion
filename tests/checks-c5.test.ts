import { describe, expect, it } from 'vitest';
import {
  comparedWrappers,
  formatFactor,
  resolveUnit,
  runRwaCheck,
  spreadPercent,
  type ComparedWrapper,
} from '../src/checks/c5-rwa.js';
import { loadChecksConfig, type RwaConfig } from '../src/checks/config.js';
import type { CheckResult, Finding, Measurement } from '../src/checks/model.js';
import { normalizeRwaQuotes, type RwaQuote } from '../src/normalize/rwa.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C5 } = loadChecksConfig();

/**
 * The one real-world asset recorded so far: GOLD on 2026-09-24 at 16:02:03 UTC, seven wrappers around an
 * `average_tokenized_price` of 4255.05199754471 USD (`E14-rwa-quotes-gold`).
 */
const AVERAGE = 4255.05199754471;

/** The prices the answer carried, so a test can say which wrapper it means without re-reading the file. */
const RECORDED = {
  PAXG: { cmcId: 4705, priceUsd: 4253.420091887455, volume24hUsd: 224_569_605.417406 },
  XAUM: { cmcId: 34212, priceUsd: 4248.174086278088, volume24hUsd: 477_254.93663428 },
  CGO: { cmcId: 20245, priceUsd: 136.6823118203415, volume24hUsd: 882_024.57063139 },
  XAU: { cmcId: 39344, priceUsd: 4259.592957257188, volume24hUsd: 0 },
} as const;

/** The gram-to-troy-ounce factor the shipped file lists; a unit definition, not a value read from the API. */
const TROY_OUNCE = 31.1034768;

const GOLD_FIXTURE = 'fixtures/discovery/E14-rwa-quotes-gold.json';

function gold(): RwaQuote {
  const [asset] = normalizeRwaQuotes(recordedSource('E14', 'E14-rwa-quotes-gold')).items;
  if (asset === undefined) throw new Error('E14-rwa-quotes-gold carries no asset.');
  return asset;
}

/** The same recorded answer with one part of its GOLD entry replaced, to see what C5 does with it. */
function goldWith(edit: (asset: Record<string, unknown>, tokens: Record<string, unknown>[]) => void): RwaQuote {
  const source = damaged('E14', 'E14-rwa-quotes-gold', (data) => {
    const [asset] = (data as { rwa_assets: Record<string, unknown>[] }).rwa_assets;
    if (asset === undefined) throw new Error('E14-rwa-quotes-gold carries no asset.');
    edit(asset, asset.tokens as Record<string, unknown>[]);
  });
  const [asset] = normalizeRwaQuotes(source).items;
  if (asset === undefined) throw new Error('the damaged answer carries no asset.');
  return asset;
}

/** The USD quote block of the recorded answer, where `average_tokenized_price` lives. */
function usdQuote(asset: Record<string, unknown>): Record<string, unknown> {
  const [quote] = asset.quotes as Record<string, unknown>[];
  if (quote === undefined) throw new Error('E14-rwa-quotes-gold carries no USD quote.');
  return quote;
}

function wrapperOf(wrappers: readonly ComparedWrapper[], symbol: string): ComparedWrapper {
  const found = wrappers.find((wrapper) => wrapper.symbol === symbol);
  if (found === undefined) throw new Error(`no wrapper called ${symbol}`);
  return found;
}

function codes(result: CheckResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function findingOf(result: CheckResult, code: string): Finding {
  const found = result.findings.find((finding) => finding.code === code);
  if (found === undefined) throw new Error(`no finding ${code} among ${codes(result).join(', ') || 'none'}`);
  return found;
}

function measurementOf(result: CheckResult, label: string): Measurement | undefined {
  return result.measurements.find((measurement) => measurement.label === label);
}

/** A configuration derived from the shipped one, to isolate a single limit. */
function withLimits(overrides: Partial<RwaConfig>): RwaConfig {
  return { ...C5, ...overrides };
}

/** The shipped factor next to a twin close enough that both fit the band: nothing says which one a token uses. */
const TWO_FACTORS = withLimits({
  conversionFactors: [
    { name: 'gram to troy ounce', factor: TROY_OUNCE, source: 'a test' },
    { name: 'a near twin', factor: TROY_OUNCE * 1.02, source: 'a test' },
  ],
});

describe('resolveUnit: the ladder of D6', () => {
  it('reads a price already in the band as it stands, and converts nothing', () => {
    const unit = resolveUnit(RECORDED.PAXG.priceUsd, RECORDED.PAXG.cmcId, AVERAGE, C5);
    expect(unit).toMatchObject({ basis: 'direct', factor: 1, name: null, source: null, candidates: [] });
    expect(unit.comparableUsd).toBe(RECORDED.PAXG.priceUsd);
  });

  it('infers the one configured factor that brings a price into the band, and says which one', () => {
    const unit = resolveUnit(RECORDED.CGO.priceUsd, RECORDED.CGO.cmcId, AVERAGE, C5);
    expect(unit.basis).toBe('inferred');
    expect(unit.factor).toBe(TROY_OUNCE);
    expect(unit.name).toBe('gram to troy ounce');
    expect(unit.source).toMatch(/D6/);
    expect(unit.candidates).toEqual(['gram to troy ounce']);
    expect(unit.comparableUsd).toBeCloseTo(4251.2951, 3);
  });

  it('prefers a stated unit over the band, so a known unit never hides a real deviation', () => {
    // PAXG sits in the band already; a file that states a unit for it is still obeyed, and the price moves.
    const stated = withLimits({ units: { [String(RECORDED.PAXG.cmcId)]: { factor: 2, source: 'a test' } } });
    const unit = resolveUnit(RECORDED.PAXG.priceUsd, RECORDED.PAXG.cmcId, AVERAGE, stated);
    expect(unit.basis).toBe('stated');
    expect(unit.factor).toBe(2);
    expect(unit.source).toBe('a test');
    expect(unit.comparableUsd).toBe(RECORDED.PAXG.priceUsd * 2);
  });

  it('leaves a price several factors would fit out of the comparison rather than guessing between them', () => {
    const unit = resolveUnit(RECORDED.CGO.priceUsd, RECORDED.CGO.cmcId, AVERAGE, TWO_FACTORS);
    expect(unit.basis).toBe('ambiguous');
    expect(unit.comparableUsd).toBeNull();
    expect(unit.candidates).toEqual(['gram to troy ounce', 'a near twin']);
  });

  it('reports a price level no known unit explains instead of comparing it', () => {
    const unit = resolveUnit(AVERAGE / 7, 123_456, AVERAGE, C5);
    expect(unit).toMatchObject({ basis: 'unexplained', factor: null, comparableUsd: null, candidates: [] });
  });

  it('asks no unit question when the price or the average could not be read', () => {
    const cases: [number | null, number | null][] = [
      [null, AVERAGE],
      [RECORDED.PAXG.priceUsd, null],
      [0, AVERAGE],
      [RECORDED.PAXG.priceUsd, 0],
      [-1, AVERAGE],
    ];
    for (const [price, average] of cases) {
      expect(resolveUnit(price, RECORDED.PAXG.cmcId, average, C5).basis).toBe('unknown');
    }
  });
});

describe('formatFactor', () => {
  it('keeps a unit definition exact and pads nothing', () => {
    expect(formatFactor(TROY_OUNCE)).toBe('31.1034768');
    expect(formatFactor(1)).toBe('1');
    expect(formatFactor(Number.NaN)).toBe('an unreadable multiplier');
  });
});

describe('the wrappers of the recorded GOLD answer', () => {
  it('measures each wrapper against the average tokenized price, as the answer recorded them', () => {
    const wrappers = comparedWrappers(gold(), C5);
    expect(wrappers.map((wrapper) => wrapper.symbol)).toEqual([
      'PAXG',
      'XAUt',
      'XAUM',
      'CGO',
      'VNXAU',
      'XAUT0',
      'XAU',
    ]);
    // The five priced near the average are read directly; the two near 137 USD go through the one factor.
    const basis = (name: string) =>
      wrappers.filter((wrapper) => wrapper.unit.basis === name).map((wrapper) => wrapper.symbol);
    expect(basis('direct')).toEqual(['PAXG', 'XAUt', 'XAUM', 'XAUT0', 'XAU']);
    expect(basis('inferred')).toEqual(['CGO', 'VNXAU']);

    const deviation = (symbol: string) => wrapperOf(wrappers, symbol).deviationPercent ?? Number.NaN;
    expect(deviation('PAXG')).toBeCloseTo(-0.0384, 4);
    expect(deviation('XAUt')).toBeCloseTo(0.0752, 4);
    expect(deviation('XAUM')).toBeCloseTo(-0.1616, 4);
    expect(deviation('CGO')).toBeCloseTo(-0.0883, 4);
    expect(deviation('VNXAU')).toBeCloseTo(0.3396, 4);
    expect(deviation('XAUT0')).toBeCloseTo(0.0899, 4);
    expect(deviation('XAU')).toBeCloseTo(0.1067, 4);
  });

  it('names each price the way an output does, and keeps the answer it came from', () => {
    const paxg = wrapperOf(comparedWrappers(gold(), C5), 'PAXG');
    expect(paxg.label).toBe('E14 wrapper price of PAXG');
    expect(paxg.issuerName).toBe('Paxos');
    expect(paxg.source.fixture?.file).toBe(GOLD_FIXTURE);
  });

  it('leaves the wrapper that reports no volume out of the spread, and keeps it measured', () => {
    const wrappers = comparedWrappers(gold(), C5);
    // XAU ("Gold (Derivatives)") reports volume_24h 0; every other wrapper trades above the configured minimum.
    expect(wrappers.filter((wrapper) => !wrapper.inSpread).map((wrapper) => wrapper.symbol)).toEqual(['XAU']);
    const xau = wrapperOf(wrappers, 'XAU');
    expect(xau.volume24hUsd).toBe(RECORDED.XAU.volume24hUsd);
    expect(xau.deviationPercent).not.toBeNull();
  });

  it('counts a volume it could not read as not enough, rather than as enough', () => {
    const quote = goldWith((_asset, tokens) => {
      const [paxg] = tokens;
      if (paxg) paxg.volume_24h = null;
    });
    expect(wrapperOf(comparedWrappers(quote, C5), 'PAXG').inSpread).toBe(false);
  });

  it('spans the wrappers that trade, in percent of the average', () => {
    // Widest: VNXAU converted, 4269.5005 USD; narrowest: XAUM, 4248.1741 USD. XAU is out for trading nothing.
    expect(spreadPercent(comparedWrappers(gold(), C5), AVERAGE)).toBeCloseTo(0.5012, 4);
  });

  it('measures no spread when fewer than two wrappers count, or when there is no average to divide by', () => {
    const wrappers = comparedWrappers(gold(), C5);
    expect(spreadPercent(wrappers, null)).toBeNull();
    expect(spreadPercent(wrappers, 0)).toBeNull();
    expect(spreadPercent(wrappers.slice(0, 1), AVERAGE)).toBeNull();
    expect(spreadPercent([], AVERAGE)).toBeNull();
  });
});

describe('runRwaCheck on the recorded GOLD answer', () => {
  it('reports the requested wrapper against the average, and carries its siblings', () => {
    const result = runRwaCheck(gold(), { symbol: 'PAXG' }, C5);
    expect(result).toMatchObject({ id: 'C5', status: 'evaluated', reason: null });
    expect(result.title).toBe('RWA wrapper against the average tokenized price');
    // PAXG sits 0.038 % from the average, well inside the configured warning limit: nothing to report about it.
    expect(codes(result)).not.toContain('wrapper_deviation');
    expect(codes(result)).not.toContain('wrapper_spread');
    expect(result.severity).toBe('info');
  });

  it('says which factor it applied to the two wrappers priced in another unit', () => {
    const result = runRwaCheck(gold(), { symbol: 'PAXG' }, C5);
    const inferred = result.findings.filter((finding) => finding.code === 'unit_inferred');
    expect(inferred).toHaveLength(2);
    for (const finding of inferred) {
      expect(finding.severity).toBe('info');
      expect(finding.message).toContain('31.1034768');
      expect(finding.message).toContain('gram to troy ounce');
      expect(finding.message).toContain('inferred, not stated by the answer');
      expect(finding.evidence[0]?.source.fixture?.file).toBe(GOLD_FIXTURE);
    }
  });

  it('names the wrapper it left out of the spread and what it trades, rather than dropping it', () => {
    const finding = findingOf(runRwaCheck(gold(), { symbol: 'PAXG' }, C5), 'low_volume_left_out');
    expect(finding.severity).toBe('info');
    expect(finding.message).toContain('XAU');
    expect(finding.message).toContain('0 USD');
    expect(finding.message).toContain('this wrapper is');
  });

  it('holds the limit only on the wrapper the run is about, so an output never reads a sibling as the subject', () => {
    const result = runRwaCheck(gold(), { symbol: 'PAXG' }, C5);
    const against = (symbol: string) =>
      measurementOf(result, `E14 wrapper price of ${symbol} against the average tokenized price`);
    expect(against('PAXG')?.threshold).toBe(C5.warnPremiumPercent);
    expect(against('XAUt')?.threshold).toBeNull();
    expect(against('XAU')?.threshold).toBeNull();
  });

  it('measures the average, every wrapper price, its converted value and the spread', () => {
    const result = runRwaCheck(gold(), { symbol: 'PAXG' }, C5);
    expect(measurementOf(result, 'E14 average tokenized price of GOLD')).toMatchObject({
      value: AVERAGE,
      unit: 'usd',
      threshold: null,
    });
    expect(measurementOf(result, 'E14 wrapper price of CGO')?.value).toBe(RECORDED.CGO.priceUsd);
    expect(measurementOf(result, 'E14 wrapper price of CGO, in the unit of the average')?.value).toBeCloseTo(
      4251.2951,
      3,
    );
    const spread = measurementOf(result, 'E14 spread between the wrappers that trade, in percent of the average');
    expect(spread?.value).toBeCloseTo(0.5012, 4);
    expect(spread?.threshold).toBe(C5.warnSpreadPercent);
  });

  it('answers on a CMC identifier as well as on a symbol', () => {
    const bySymbol = runRwaCheck(gold(), { symbol: 'XAUM' }, C5);
    const byId = runRwaCheck(gold(), { cmcId: RECORDED.XAUM.cmcId }, C5);
    expect(codes(byId)).toEqual(codes(bySymbol));
    expect(measurementOf(byId, 'E14 wrapper price of XAUM against the average tokenized price')?.threshold).toBe(
      C5.warnPremiumPercent,
    );
  });

  it('measures the spread alone when the run is about the asset rather than one of its wrappers', () => {
    const result = runRwaCheck(gold(), null, C5);
    expect(result.status).toBe('evaluated');
    expect(codes(result)).not.toContain('wrapper_deviation');
    for (const measurement of result.measurements) {
      if (measurement.label.endsWith('against the average tokenized price')) {
        expect(measurement.threshold).toBeNull();
      }
    }
  });

  it('cites the answer once, and lists it as the source of the check', () => {
    const result = runRwaCheck(gold(), { symbol: 'PAXG' }, C5);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ endpoint: 'E14', observedAt: '2026-09-24T16:04:07.977Z' });
  });
});

describe('runRwaCheck when a wrapper is away from the average', () => {
  /** The recorded answer with the PAXG wrapper moved a given distance from the average, in percent. */
  function paxgOff(percent: number): RwaQuote {
    return goldWith((_asset, tokens) => {
      const [paxg] = tokens;
      if (paxg) paxg.price = AVERAGE * (1 + percent / 100);
    });
  }

  it('says nothing while the wrapper stays inside the warning limit', () => {
    expect(codes(runRwaCheck(paxgOff(C5.warnPremiumPercent), { symbol: 'PAXG' }, C5))).not.toContain(
      'wrapper_deviation',
    );
  });

  it('warns past the warning limit and says which way the wrapper sits', () => {
    const above = runRwaCheck(paxgOff(C5.warnPremiumPercent + 0.5), { symbol: 'PAXG' }, C5);
    const premium = findingOf(above, 'wrapper_deviation');
    expect(premium.severity).toBe('warning');
    expect(premium.message).toContain('above the average tokenized price');
    expect(premium.measurement?.threshold).toBe(C5.warnPremiumPercent);

    const below = runRwaCheck(paxgOff(-(C5.warnPremiumPercent + 0.5)), { symbol: 'PAXG' }, C5);
    const discount = findingOf(below, 'wrapper_deviation');
    expect(discount.severity).toBe('warning');
    expect(discount.message).toContain('below the average tokenized price');
  });

  it('turns critical past the critical limit, and names that limit', () => {
    const finding = findingOf(
      runRwaCheck(paxgOff(C5.criticalPremiumPercent + 0.5), { symbol: 'PAXG' }, C5),
      'wrapper_deviation',
    );
    expect(finding.severity).toBe('critical');
    expect(finding.message).toContain(`limit: ${String(C5.criticalPremiumPercent)} %`);
  });

  it('shows the conversion behind a converted wrapper, so a reader can redo the arithmetic', () => {
    // CGO priced 10 % high in grams: its converted value is 10 % above the average.
    const quote = goldWith((_asset, tokens) => {
      const cgo = tokens.find((token) => token.symbol === 'CGO');
      if (cgo) cgo.price = (AVERAGE * 1.1) / TROY_OUNCE;
    });
    const finding = findingOf(runRwaCheck(quote, { symbol: 'CGO' }, C5), 'wrapper_deviation');
    expect(finding.message).toContain('multiplied by 31.1034768');
    expect(finding.message).toContain('10 % above the average tokenized price');
  });

  it('reports a wrapper no known unit explains rather than comparing it', () => {
    const quote = goldWith((_asset, tokens) => {
      const [paxg] = tokens;
      if (paxg) paxg.price = AVERAGE / 7;
    });
    const result = runRwaCheck(quote, { symbol: 'PAXG' }, C5);
    const finding = findingOf(result, 'unit_unexplained');
    expect(finding.severity).toBe('warning');
    expect(finding.message).toContain('no known unit explains');
    // It is reported, never compared: no premium is claimed on a price whose unit is unknown.
    expect(codes(result)).not.toContain('wrapper_deviation');
    expect(wrapperOf(comparedWrappers(quote, C5), 'PAXG').inSpread).toBe(false);
  });

  it('reports a wrapper several factors would fit, and leaves it out of the spread', () => {
    const finding = findingOf(runRwaCheck(gold(), { symbol: 'CGO' }, TWO_FACTORS), 'unit_ambiguous');
    expect(finding.severity).toBe('warning');
    expect(finding.message).toContain('gram to troy ounce, a near twin');
    expect(finding.message).toContain('rather than converted by a guess');
    expect(wrapperOf(comparedWrappers(gold(), TWO_FACTORS), 'CGO').inSpread).toBe(false);
  });
});

describe('runRwaCheck when the answer is incomplete', () => {
  it('reports a wrapper price the answer did not carry, and hands the field itself to C7', () => {
    const quote = goldWith((_asset, tokens) => {
      const [paxg] = tokens;
      if (paxg) paxg.price = null;
    });
    const finding = findingOf(runRwaCheck(quote, { symbol: 'PAXG' }, C5), 'wrapper_price_unknown');
    expect(finding.severity).toBe('info');
    expect(finding.message).toContain('C7 reports the field itself');
    expect(finding.measurement?.value).toBeNull();
  });

  it('reports an average it could not read, and compares nothing against it', () => {
    const quote = goldWith((asset) => {
      usdQuote(asset).average_tokenized_price = null;
      asset.average_tokenized_price = null;
    });
    const result = runRwaCheck(quote, { symbol: 'PAXG' }, C5);
    expect(findingOf(result, 'average_unknown').severity).toBe('info');
    expect(codes(result)).toContain('spread_unmeasurable');
    expect(codes(result)).not.toContain('wrapper_deviation');
  });

  it('reports an average that is not positive, rather than dividing by it', () => {
    const quote = goldWith((asset) => {
      usdQuote(asset).average_tokenized_price = 0;
      asset.average_tokenized_price = 0;
    });
    const result = runRwaCheck(quote, { symbol: 'PAXG' }, C5);
    expect(findingOf(result, 'average_not_positive').severity).toBe('warning');
    expect(codes(result)).toContain('spread_unmeasurable');
    expect(result.measurements.every((measurement) => Number.isFinite(measurement.value ?? 0))).toBe(true);
  });

  it('says why no spread was measured when only one wrapper counts', () => {
    const quote = goldWith((_asset, tokens) => {
      for (const token of tokens.slice(1)) token.volume_24h = 0;
    });
    const finding = findingOf(runRwaCheck(quote, { symbol: 'PAXG' }, C5), 'spread_unmeasurable');
    expect(finding.severity).toBe('info');
    expect(finding.message).toContain('Only one wrapper');
    expect(finding.message).toContain('out of 7 read');
  });

  it('warns on a spread wider than the configured limit, and turns critical past the second one', () => {
    // The recorded sample spreads 0.5012 %: above both limits of the first configuration below.
    const wide = withLimits({ warnSpreadPercent: 0.4, criticalSpreadPercent: 0.5 });
    const finding = findingOf(runRwaCheck(gold(), { symbol: 'PAXG' }, wide), 'wrapper_spread');
    expect(finding.severity).toBe('critical');
    expect(finding.message).toContain('The 6 wrappers that trade span');
    expect(finding.message).toContain('4248.1741 USD');
    expect(finding.message).toContain('4269.5005 USD');

    const narrow = withLimits({ warnSpreadPercent: 0.4, criticalSpreadPercent: 3 });
    expect(findingOf(runRwaCheck(gold(), { symbol: 'PAXG' }, narrow), 'wrapper_spread').severity).toBe('warning');
  });
});

describe('runRwaCheck when C5 cannot run (D9)', () => {
  it('is not applicable without a real-world-asset answer, and cites nothing', () => {
    const result = runRwaCheck(null, { symbol: 'PAXG' }, C5);
    expect(result).toMatchObject({ id: 'C5', status: 'not_applicable', severity: null, findings: [] });
    expect(result.reason).toMatch(/no real-world-asset answer was read/i);
    expect(result.sources).toEqual([]);
  });

  it('is not applicable for an asset whose answer lists no wrapper, and still cites that answer', () => {
    // E16 reads with the same normaliser and carries no `tokens` array (D6).
    const [asset] = normalizeRwaQuotes(recordedSource('E16', 'E16-rwa-assets-list')).items;
    if (asset === undefined) throw new Error('E16-rwa-assets-list carries no asset.');
    const result = runRwaCheck(asset, null, C5);
    expect(result.status).toBe('not_applicable');
    expect(result.reason).toMatch(/listed no tokenised wrapper/);
    expect(result.sources[0]?.endpoint).toBe('E16');
  });

  it('is not applicable for an asset that is not one of the wrappers, and names the ones it knows', () => {
    const result = runRwaCheck(gold(), { symbol: 'BTC' }, C5);
    expect(result.status).toBe('not_applicable');
    expect(result.reason).toContain('PAXG');
    expect(result.reason).toContain('VNXAU');
    expect(result.findings).toEqual([]);
  });
});
