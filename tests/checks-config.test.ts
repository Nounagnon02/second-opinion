import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_FILE,
  FRESHNESS_FAMILIES,
  loadChecksConfig,
  parseChecksConfig,
  type ChecksConfig,
} from '../src/checks/config.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { CmcError } from '../src/cmc/errors.js';
import { projectRoot } from './helpers/endpoints-doc.js';

/** The shipped thresholds, read from disk as the checks read them. */
const shipped = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;

/** The shipped file seen as something a test may damage, one setting at a time. */
type MutableConfig = {
  C1: Record<string, unknown>;
  C3: Record<string, unknown> & { families: Record<'aggregate' | 'dex', Record<string, unknown>> };
  C4: Record<string, unknown>;
  C5: Record<string, unknown>;
  C6: Record<string, unknown>;
  C7: Record<string, unknown> & { severityByField: Record<string, unknown> };
  score: Record<string, unknown> & {
    weights: Record<string, unknown>;
    severityPoints: Record<string, unknown>;
  };
};

/** A copy of the shipped file with one part replaced, to see what the loader refuses. */
function broken(edit: (config: MutableConfig) => void): unknown {
  const copy = structuredClone(shipped) as unknown as MutableConfig;
  edit(copy);
  return copy;
}

describe('config/checks.json', () => {
  it('sits where the checks look for it, next to the sources it was calibrated on', () => {
    expect(CONFIG_FILE).toBe(join(projectRoot, 'config', 'checks.json'));
  });

  it('loads into the thresholds C1, C3, C4, C5, C6 and C7 read', () => {
    const config: ChecksConfig = loadChecksConfig();
    expect(Object.keys(config.C3.families).sort()).toEqual([...FRESHNESS_FAMILIES].sort());
    expect(config.C7.defaultSeverity).toBe('warning');
    expect(config.C7.severityByField.price).toBe('critical');
    expect(config.C7.severityByField.data).toBe('critical');
    expect(config.C1.warnAbovePercent).toBeGreaterThan(0);
    expect(config.C1.criticalAbovePercent).toBeGreaterThanOrEqual(config.C1.warnAbovePercent);
    expect(config.C4.criticalLiquidityBelowUsd).toBeLessThanOrEqual(config.C4.warnLiquidityBelowUsd);
    expect(config.C4.criticalTurnoverRatio).toBeGreaterThanOrEqual(config.C4.warnTurnoverRatio);
    expect(config.C4.criticalOrderSharePercent).toBeGreaterThanOrEqual(config.C4.warnOrderSharePercent);
    expect(config.C5.criticalPremiumPercent).toBeGreaterThanOrEqual(config.C5.warnPremiumPercent);
    expect(config.C5.criticalSpreadPercent).toBeGreaterThanOrEqual(config.C5.warnSpreadPercent);
    // No source read so far states the unit of a wrapper, so the table is empty and the one factor is a unit
    // definition this repository writes down, with the document that defines it.
    expect(config.C5.units).toEqual({});
    expect(config.C5.conversionFactors).toHaveLength(1);
    expect(config.C5.conversionFactors[0]?.name).toBe('gram to troy ounce');
    expect(config.C5.conversionFactors[0]?.factor).toBe(31.1034768);
    expect(config.C5.conversionFactors[0]?.source).toContain('D6');
    expect(config.C6.criticalAbovePercent).toBeGreaterThanOrEqual(config.C6.warnAbovePercent);
    expect(config.C6.snapshotToleranceSeconds).toBeGreaterThan(0);
  });

  it('keeps C6 tighter than C1: two publications of one aggregate, not two venues (D7)', () => {
    const config = loadChecksConfig();
    expect(config.C6.warnAbovePercent).toBeLessThan(config.C1.warnAbovePercent);
    expect(config.C6.criticalAbovePercent).toBeLessThanOrEqual(config.C1.criticalAbovePercent);
  });

  it('leaves the recorded endpoint pairs inside the C6 limits', () => {
    // E02 and E06 published the same PAXG price to the last digit, 0 s apart; the E14 wrapper sat 0.0046 % above it.
    const { C6 } = loadChecksConfig();
    expect(C6.warnAbovePercent).toBeGreaterThan(0.0046);
    expect(C6.snapshotToleranceSeconds).toBeGreaterThanOrEqual(0);
  });

  it('leaves every wrapper of the recorded RWA answer inside the C5 limits', () => {
    // E14-rwa-quotes-gold: the widest deviation of the seven GOLD wrappers is VNXAU at 0.3396 % once converted,
    // and they span 0.5012 % of the average. A limit under those would report an asset nothing is wrong with.
    const { C5 } = loadChecksConfig();
    expect(C5.warnPremiumPercent).toBeGreaterThan(0.3396);
    expect(C5.warnSpreadPercent).toBeGreaterThan(0.5012);
  });

  it('keeps the C5 unit band between a deviation and another unit, as the recorded sample separates them', () => {
    // The five wrappers read directly sit within 0.17 % of the average; the two priced in grams sit 96.8 % away.
    const { C5 } = loadChecksConfig();
    expect(C5.unitBandPercent).toBeGreaterThan(0.17);
    expect(C5.unitBandPercent).toBeLessThan(96.77);
  });

  it('keeps the C5 volume floor above nothing and at or below the quietest wrapper that still trades', () => {
    // XAU ("Gold (Derivatives)") reports 0 USD over 24 h and VNXAU 4090.97 USD: a floor between the two leaves
    // the first out of the spread and keeps the second in it.
    const { C5 } = loadChecksConfig();
    expect(C5.minVolume24hUsd).toBeGreaterThan(0);
    expect(C5.minVolume24hUsd).toBeLessThanOrEqual(4090.96704663);
  });

  it('leaves the gap a liquid token showed between venues below the C1 warning limit', () => {
    // The recorded PAXG sample spans 0.46 % between the widest and the narrowest venue price (observation 10 and
    // the three pairs of E08-dex-spot-pairs-paxg-uniswap). A limit under that would report ordinary venue spread.
    expect(loadChecksConfig().C1.warnAbovePercent).toBeGreaterThan(0.46);
  });

  it('leaves every pool of the liquid token recorded above the C4 floor, and the phantom pair under it', () => {
    // The thinnest of the ten pools of E11-dex-token-pools-paxg holds 54244.73 USD; the BULL/WETH pair of
    // E08-dex-spot-pairs-paxg-uniswap holds 171.00653 USD (observation 11). A floor between the two reports the
    // second without reporting the first.
    const { C4 } = loadChecksConfig();
    expect(C4.warnLiquidityBelowUsd).toBeLessThan(54_244.73);
    expect(C4.criticalLiquidityBelowUsd).toBeGreaterThan(171.00653);
  });

  it('leaves the turnover a liquid token showed below the C4 warning limit, and the phantom pair above it', () => {
    // Same two samples: PAXG turns over 0.067 of its depth in 24 h at token level and up to 0.84 in one pool;
    // BULL/WETH reports 233881 times its depth.
    const { C4 } = loadChecksConfig();
    expect(C4.warnTurnoverRatio).toBeGreaterThan(0.84);
    expect(C4.criticalTurnoverRatio).toBeLessThan(233_881);
  });

  it('keeps a limit that a warning can be raised before, in both families', () => {
    const { C3 } = loadChecksConfig();
    for (const family of FRESHNESS_FAMILIES) {
      const limits = C3.families[family];
      expect(limits.warnAfterSeconds).toBeGreaterThan(0);
      expect(limits.criticalAfterSeconds).toBeGreaterThanOrEqual(limits.warnAfterSeconds);
    }
    expect(C3.futureToleranceSeconds).toBeGreaterThan(0);
  });

  it('gives DEX prices more room than aggregated quotes: a quiet token is not a wrong one (D4)', () => {
    const { C3 } = loadChecksConfig();
    expect(C3.families.dex.warnAfterSeconds).toBeGreaterThan(C3.families.aggregate.warnAfterSeconds);
  });

  it('says where each set of numbers comes from, so a finding can show it', () => {
    const config = loadChecksConfig();
    expect(config.C1.notes).toMatch(/T4\.2/);
    expect(config.C3.notes).toMatch(/T1\.2/);
    expect(config.C4.notes).toMatch(/D5/);
    expect(config.C5.notes).toMatch(/D6/);
    expect(config.C6.notes).toMatch(/D7/);
    expect(config.C7.notes).toMatch(/D8/);
  });

  it('cites, for C4, C5 and C6, recorded answers that are in the repository', () => {
    const config = loadChecksConfig();
    for (const notes of [config.C4.notes ?? '', config.C5.notes ?? '', config.C6.notes ?? '']) {
      const cited = [...notes.matchAll(/`(E\d{2}-[a-z0-9-]+)`/g)].map((match) => match[1] ?? '');
      expect(cited.length).toBeGreaterThan(0);
      for (const label of cited) {
        expect(existsSync(join(projectRoot, 'fixtures', 'discovery', `${label}.json`)), label).toBe(true);
      }
    }
  });
});

describe('parseChecksConfig', () => {
  it('refuses a file that is not an object', () => {
    expect(() => parseChecksConfig([], 'example.json')).toThrow(CmcError);
    expect(() => parseChecksConfig([], 'example.json')).toThrow(/must be a JSON object/);
  });

  it('refuses a section for a check that has no thresholds yet, rather than ignoring it', () => {
    // C2 is `unavailable` with this key (D2): it reads no threshold, so a section for it is a mistake.
    expect(() => parseChecksConfig({ ...shipped, C2: {} })).toThrow(/no check called "C2"/);
  });

  it('refuses a C6 limit that is not a percentage above zero or a number of seconds', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C6.warnAbovePercent = 0;
    }))).toThrow(/C6\.warnAbovePercent must be a percentage above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C6.snapshotToleranceSeconds = -1;
    }))).toThrow(/C6\.snapshotToleranceSeconds must be a number of seconds >= 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C6.tolerance = 60;
    }))).toThrow(/"C6" has no setting called "tolerance"/);
  });

  it('refuses C6 limits in the wrong order: a warning must be able to come before a critical', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C6.warnAbovePercent = 99;
    }))).toThrow(/C6\.warnAbovePercent must not be above criticalAbovePercent/);
  });

  it('refuses a C5 limit that is not a percentage or an amount of USD above zero', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.warnPremiumPercent = 0;
    }))).toThrow(/C5\.warnPremiumPercent must be a percentage above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.criticalSpreadPercent = '8';
    }))).toThrow(/C5\.criticalSpreadPercent must be a percentage above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.minVolume24hUsd = -1;
    }))).toThrow(/C5\.minVolume24hUsd must be an amount of USD above 0/);
  });

  it('refuses C5 limits in the wrong order: a warning must be able to come before a critical', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.warnPremiumPercent = 99;
    }))).toThrow(/C5\.warnPremiumPercent must not be above criticalPremiumPercent/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.warnSpreadPercent = 99;
    }))).toThrow(/C5\.warnSpreadPercent must not be above criticalSpreadPercent/);
  });

  it('refuses a unit band that does not reach the widest deviation C5 may report', () => {
    // Inside the band a price is read as it stands; a band at or under the critical limit would turn a real
    // deviation into "another unit" and the wrapper would never be reported.
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.unitBandPercent = config.C5.criticalPremiumPercent;
    }))).toThrow(/C5\.unitBandPercent must be above criticalPremiumPercent/);
  });

  it('refuses a conversion factor close enough to one that a price it converts would also compare directly', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = [{ name: 'a near twin', factor: 1.1, source: 'a test' }];
    }))).toThrow(/sits inside the band of 25 % around the average/);
  });

  it('refuses a unit table keyed by anything but the CMC identifier of a wrapper', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.units = { PAXG: { factor: 1, source: 'a test' } };
    }))).toThrow(/C5\.units has the key "PAXG", which is not the CMC identifier of a wrapper/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.units = { '4705': { factor: 1 } };
    }))).toThrow(/C5\.units\.4705\.source must be a non-empty string/);
  });

  it('refuses a conversion factor that does not say what it is or where it comes from', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = [{ factor: 31.1034768, source: 'a test' }];
    }))).toThrow(/C5\.conversionFactors\[0\]\.name must be a non-empty string/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = [{ name: 'gram to troy ounce', factor: 31.1034768 }];
    }))).toThrow(/C5\.conversionFactors\[0\]\.source must be a non-empty string/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = [{ name: 'gram to troy ounce', factor: 0, source: 'a test' }];
    }))).toThrow(/C5\.conversionFactors\[0\]\.factor must be a multiplier above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = {};
    }))).toThrow(/C5\.conversionFactors must be an array/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.units = [];
    }))).toThrow(/C5\.units must be an object/);
  });

  it('refuses a misspelled C5 setting, rather than measuring against a default nobody asked for', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.minVolumeUsd = 1000;
      delete config.C5.minVolume24hUsd;
    }))).toThrow(/no setting called "minVolumeUsd"/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C5.conversionFactors = [{ name: 'a test', factor: 31.1034768, source: 'a test', unit: 'gram' }];
    }))).toThrow(/C5\.conversionFactors\[0\] has no setting called "unit"/);
  });

  it('refuses a C4 limit that is not an amount of USD or a ratio above zero', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.warnLiquidityBelowUsd = 0;
    }))).toThrow(/C4\.warnLiquidityBelowUsd must be an amount of USD above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.criticalTurnoverRatio = '250';
    }))).toThrow(/C4\.criticalTurnoverRatio must be a ratio above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.warnOrderSharePercent = -1;
    }))).toThrow(/C4\.warnOrderSharePercent must be a percentage above 0/);
  });

  it('refuses a C4 floor in the wrong order: a thinner venue is a worse one, so critical sits below warn', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.criticalLiquidityBelowUsd = 999_999;
    }))).toThrow(/C4\.criticalLiquidityBelowUsd must not be above warnLiquidityBelowUsd/);
  });

  it('refuses C4 turnover and order limits in the wrong order', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.warnTurnoverRatio = 999_999;
    }))).toThrow(/C4\.warnTurnoverRatio must not be above criticalTurnoverRatio/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.warnOrderSharePercent = 99;
    }))).toThrow(/C4\.warnOrderSharePercent must not be above criticalOrderSharePercent/);
  });

  it('refuses a misspelled C4 setting, rather than measuring against a default nobody asked for', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C4.warnTurnover = 50;
      delete config.C4.warnTurnoverRatio;
    }))).toThrow(/no setting called "warnTurnover"/);
  });

  it('refuses a C1 limit that is not a percentage above zero', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C1.warnAbovePercent = 0;
    }))).toThrow(/C1\.warnAbovePercent must be a percentage above 0/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C1.criticalAbovePercent = '5';
    }))).toThrow(/C1\.criticalAbovePercent must be a percentage above 0/);
  });

  it('refuses C1 limits in the wrong order: a warning must be able to come before a critical', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C1.warnAbovePercent = 99;
    }))).toThrow(/C1\.warnAbovePercent must not be above criticalAbovePercent/);
  });

  it('refuses a misspelled setting, rather than falling back to a default nobody asked for', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C3.futureToleranceSecond = 60;
      delete config.C3.futureToleranceSeconds;
    }))).toThrow(/no setting called "futureToleranceSecond"/);
    expect(() => parseChecksConfig(broken((config) => {
      (config.C3.families as Record<string, unknown>).cex = { warnAfterSeconds: 1, criticalAfterSeconds: 2 };
    }))).toThrow(/no family called "cex"/);
  });

  it('refuses a threshold that is not a number of seconds', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C3.futureToleranceSeconds = '60';
    }))).toThrow(/C3\.futureToleranceSeconds must be a number of seconds/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C3.families.dex.warnAfterSeconds = -1;
    }))).toThrow(/C3\.families\.dex\.warnAfterSeconds must be a number of seconds/);
  });

  it('refuses limits in the wrong order: a warning must be able to come before a critical', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C3.families.dex.warnAfterSeconds = 999_999;
    }))).toThrow(/must not be above criticalAfterSeconds/);
  });

  it('refuses a severity that is not one of the three the outputs know', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.C7.defaultSeverity = 'fatal';
    }))).toThrow(/C7\.defaultSeverity must be one of info, warning, critical/);
    expect(() => parseChecksConfig(broken((config) => {
      config.C7.severityByField.price = 'high';
    }))).toThrow(/C7\.severityByField\.price must be one of/);
  });

  it('refuses a missing section rather than checking nothing', () => {
    expect(() => parseChecksConfig(broken((config) => {
      delete (config as Partial<MutableConfig>).C7;
    }))).toThrow(/"C7" must be an object/);
  });
});

describe('the score section', () => {
  it('weighs every check of the engine, including the ones no key reaches today', () => {
    const { score } = loadChecksConfig();
    expect(Object.keys(score.weights).sort()).toEqual([...CHECK_IDS].sort());
    for (const id of CHECK_IDS) expect(score.weights[id], id).toBeGreaterThan(0);
    // C2 is unavailable with this key (D2) and renormalised away on every run, but its weight is written down so
    // that a key reaching per-exchange prices scores it without a change to the code.
    expect(score.weights.C2).toBeGreaterThan(0);
  });

  it('holds the boundaries the specification states: ACT at 75, CAUTION at 40 (F5)', () => {
    const { score } = loadChecksConfig();
    expect(score.actAtOrAbove).toBe(75);
    expect(score.cautionAtOrAbove).toBe(40);
    expect(score.cautionAtOrAbove).toBeLessThan(score.actAtOrAbove);
  });

  it('scores a clean check at 100 and never rises with severity', () => {
    const { score } = loadChecksConfig();
    expect(score.severityPoints.info).toBe(100);
    expect(score.severityPoints.warning).toBeLessThanOrEqual(score.severityPoints.info);
    expect(score.severityPoints.critical).toBeLessThanOrEqual(score.severityPoints.warning);
  });

  it('holds a critical finding back from ACT, since the verdict cannot rest on that source (D11)', () => {
    expect(loadChecksConfig().score.capWithCritical).toBe('CAUTION');
  });

  it('says where its numbers come from and which task settles them', () => {
    const { score } = loadChecksConfig();
    expect(score.notes).toMatch(/placeholder/);
    expect(score.notes).toMatch(/T4\.2/);
    expect(score.notes).toMatch(/D11/);
  });

  it('refuses a weight for something that is not a check, or a check left without one', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.weights.C8 = 10;
    }))).toThrow(/score\.weights has no check called "C8"/);
    expect(() => parseChecksConfig(broken((config) => {
      delete config.score.weights.C5;
    }))).toThrow(/score\.weights\.C5 must be a weight above 0/);
  });

  it('refuses a weight of zero, which would drop a check from the score without saying so', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.weights.C2 = 0;
    }))).toThrow(/score\.weights\.C2 must be a weight above 0/);
  });

  it('refuses a ladder that rises with severity, or a clean check worth less than 100', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.severityPoints.critical = 80;
    }))).toThrow(/score\.severityPoints must not rise with severity/);
    expect(() => parseChecksConfig(broken((config) => {
      config.score.severityPoints.info = 90;
    }))).toThrow(/score\.severityPoints\.info must be 100/);
  });

  it('refuses a severity the outputs do not know, and a score outside 0 to 100', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.severityPoints.fatal = 0;
    }))).toThrow(/score\.severityPoints has no severity called "fatal"/);
    expect(() => parseChecksConfig(broken((config) => {
      config.score.severityPoints.warning = 120;
    }))).toThrow(/score\.severityPoints\.warning must be a number of points between 0 and 100/);
  });

  it('refuses boundaries that would retire a verdict', () => {
    // Equal boundaries leave no room for CAUTION; a CAUTION boundary at 0 leaves no score low enough for DO_NOT_ACT.
    expect(() => parseChecksConfig(broken((config) => {
      config.score.cautionAtOrAbove = config.score.actAtOrAbove;
    }))).toThrow(/score\.cautionAtOrAbove must be below actAtOrAbove/);
    expect(() => parseChecksConfig(broken((config) => {
      config.score.cautionAtOrAbove = 0;
    }))).toThrow(/score\.cautionAtOrAbove must be above 0/);
  });

  it('refuses a cap that is not one of the three verdicts, and accepts none written down as null', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.capWithCritical = 'HOLD';
    }))).toThrow(/score\.capWithCritical must be null or one of ACT, CAUTION, DO_NOT_ACT/);
    expect(() => parseChecksConfig(broken((config) => {
      delete config.score.capWithCritical;
    }))).toThrow(/score\.capWithCritical must be null or one of/);
    expect(parseChecksConfig(broken((config) => {
      config.score.capWithCritical = null;
    })).score.capWithCritical).toBeNull();
  });

  it('refuses a setting the score does not read, and a section left out altogether', () => {
    expect(() => parseChecksConfig(broken((config) => {
      config.score.actAbove = 75;
    }))).toThrow(/"score" has no setting called "actAbove"/);
    expect(() => parseChecksConfig(broken((config) => {
      delete (config as Partial<MutableConfig>).score;
    }))).toThrow(/"score" must be an object/);
  });
});

describe('loadChecksConfig', () => {
  it('names the file it could not read, and never guesses a threshold', () => {
    const missing = join(projectRoot, 'config', 'no-such-file.json');
    expect(() => loadChecksConfig(missing)).toThrow(CmcError);
    expect(() => loadChecksConfig(missing)).toThrow(/the check thresholds could not be read/);
  });

  it('refuses a file that is not valid JSON', () => {
    // A real file of the repository that is not JSON: it is read, then refused at parsing.
    const notJson = join(projectRoot, 'CAHIER_DES_CHARGES.md');
    expect(() => loadChecksConfig(notJson)).toThrow(CmcError);
    expect(() => loadChecksConfig(notJson)).toThrow(/are not valid JSON/);
  });
});
