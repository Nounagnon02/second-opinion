import { describe, expect, it } from 'vitest';
import {
  ageSeconds,
  jsonTypeOf,
  Reader,
  toFiniteNumber,
  toFlag,
  toInteger,
  toIsoTimestamp,
  toText,
  type FieldIssue,
} from '../src/normalize/values.js';

describe('toFiniteNumber', () => {
  it('reads JSON numbers and the decimal strings of E10 and E11', () => {
    expect(toFiniteNumber(4253.226063661451)).toBe(4253.226063661451);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-0.0033)).toBe(-0.0033);
    // E11 `liqUsd` of the deepest PAXG pool, sent with more digits than a double keeps.
    expect(toFiniteNumber('16257792.367634998293472449')).toBeCloseTo(16257792.367634999, 6);
    expect(toFiniteNumber(' 1.5e3 ')).toBe(1500);
  });

  it('refuses anything that is not a finite number', () => {
    for (const value of [null, undefined, '', '  ', 'abc', '1,5', '0x10', {}, [], true, NaN, Infinity]) {
      expect(toFiniteNumber(value)).toBeNull();
    }
  });
});

describe('toInteger', () => {
  it('reads the identifiers sent as numbers and as strings', () => {
    expect(toInteger(4705)).toBe(4705);
    expect(toInteger('4705')).toBe(4705);
    expect(toInteger('1027')).toBe(1027);
  });

  it('refuses a number with a fractional part', () => {
    expect(toInteger(1.5)).toBeNull();
    expect(toInteger('1.5')).toBeNull();
  });
});

describe('toIsoTimestamp', () => {
  it('normalises the ISO timestamps of the aggregated endpoints', () => {
    expect(toIsoTimestamp('2026-09-24T16:02:03.000Z')).toBe('2026-09-24T16:02:03.000Z');
    expect(toIsoTimestamp('2026-09-24T16:02:03Z')).toBe('2026-09-24T16:02:03.000Z');
  });

  it('reads the millisecond epochs E10 and E11 send as strings', () => {
    // `ts` of fixtures/discovery/E10-dex-token-price-paxg.json.
    expect(toIsoTimestamp('1790265911000')).toBe('2026-09-24T16:05:11.000Z');
    expect(toIsoTimestamp(1790265911000)).toBe('2026-09-24T16:05:11.000Z');
  });

  it('refuses an epoch outside 2000-2100 instead of guessing its unit', () => {
    // The same instant in seconds: read as milliseconds it lands in 1970, so it is refused, not rescaled.
    expect(toIsoTimestamp('1790265911')).toBeNull();
    expect(toIsoTimestamp(0)).toBeNull();
    expect(toIsoTimestamp('99999999999999')).toBeNull();
  });

  it('refuses a value that is not a timestamp', () => {
    for (const value of [null, undefined, '', 'yesterday', {}, [], true]) {
      expect(toIsoTimestamp(value)).toBeNull();
    }
  });
});

describe('toFlag and toText', () => {
  it('reads booleans and the 0 / 1 integers of is_active', () => {
    expect(toFlag(true)).toBe(true);
    expect(toFlag(1)).toBe(true);
    expect(toFlag(0)).toBe(false);
    expect(toFlag(2)).toBeNull();
    expect(toFlag('true')).toBeNull();
  });

  it('treats an empty or blank string as no value', () => {
    expect(toText('PAXG')).toBe('PAXG');
    expect(toText('')).toBeNull();
    expect(toText('   ')).toBeNull();
    expect(toText(4705)).toBeNull();
  });
});

describe('ageSeconds', () => {
  it('measures the data against the clock of its own answer, not the local one', () => {
    // fixtures/discovery/E10-dex-token-price-paxg.json: status.timestamp minus `ts`.
    expect(ageSeconds('2026-09-24T16:06:56.496Z', '2026-09-24T16:05:11.000Z')).toBeCloseTo(105.496, 3);
  });

  it('is negative when the data is dated after the answer, and null without a timestamp', () => {
    expect(ageSeconds('2026-09-24T16:00:00.000Z', '2026-09-24T16:00:30.000Z')).toBe(-30);
    expect(ageSeconds('2026-09-24T16:00:00.000Z', null)).toBeNull();
    expect(ageSeconds('not a date', '2026-09-24T16:00:00.000Z')).toBeNull();
  });
});

describe('jsonTypeOf', () => {
  it('tells an absent field from a null one', () => {
    expect(jsonTypeOf(undefined)).toBe('absent');
    expect(jsonTypeOf(null)).toBe('null');
    expect(jsonTypeOf([])).toBe('array');
    expect(jsonTypeOf({})).toBe('object');
    expect(jsonTypeOf('a')).toBe('string');
    expect(jsonTypeOf(1)).toBe('number');
  });
});

describe('Reader', () => {
  function reader(value: unknown, issues: FieldIssue[] = []): Reader {
    return new Reader(value, 'data', issues, true);
  }

  it('reads the fields it can and says nothing about them', () => {
    const issues: FieldIssue[] = [];
    const item = reader({ id: '4705', price: '1.5', at: '2026-09-24T16:02:03.000Z', live: 1, sym: 'PAXG' }, issues);

    expect(item.integer('id', true)).toBe(4705);
    expect(item.number('price', true)).toBe(1.5);
    expect(item.timestamp('at', true)).toBe('2026-09-24T16:02:03.000Z');
    expect(item.flag('live')).toBe(true);
    expect(item.text('sym', true)).toBe('PAXG');
    expect(issues).toEqual([]);
  });

  it('writes down a required field that is absent, null or unusable', () => {
    const issues: FieldIssue[] = [];
    const item = reader({ nulled: null, wrong: 'abc' }, issues);

    expect(item.number('absent', true)).toBeNull();
    expect(item.number('nulled', true)).toBeNull();
    expect(item.number('wrong', true)).toBeNull();
    expect(issues).toEqual([
      { field: 'data.absent', problem: 'missing', required: true, seen: 'absent' },
      { field: 'data.nulled', problem: 'null', required: true, seen: 'null' },
      { field: 'data.wrong', problem: 'not_a_number', required: true, seen: 'string' },
    ]);
  });

  it('stays silent on an optional field that was simply not sent, but not on one sent unusable', () => {
    const issues: FieldIssue[] = [];
    const item = reader({ wrong: {} }, issues);

    expect(item.number('absent')).toBeNull();
    expect(item.number('wrong')).toBeNull();
    expect(issues).toEqual([{ field: 'data.wrong', problem: 'not_a_number', required: false, seen: 'object' }]);
  });

  it('reads every field as absent when the value is not an object', () => {
    const issues: FieldIssue[] = [];
    const item = reader([1, 2], issues);

    expect(item.present).toBe(false);
    expect(item.keys).toEqual([]);
    expect(item.number('price', true)).toBeNull();
    expect(issues).toEqual([
      { field: 'data', problem: 'not_an_object', required: true, seen: 'array' },
      { field: 'data.price', problem: 'missing', required: true, seen: 'absent' },
    ]);
  });

  it('gives each item of a list its own issues, and keeps the list problem apart', () => {
    const issues: FieldIssue[] = [];
    const items = Reader.list([{ price: 1 }, { price: 'x' }], 'data', issues, true);

    expect(items.map((item) => item.number('price', true))).toEqual([1, null]);
    expect(issues).toEqual([]);
    expect(items[0]?.issues).toEqual([]);
    expect(items[1]?.issues).toEqual([
      { field: 'data[1].price', problem: 'not_a_number', required: true, seen: 'string' },
    ]);
  });

  it('reports a data that is not the expected array, and returns no item', () => {
    const issues: FieldIssue[] = [];
    expect(Reader.list({ price: 1 }, 'data', issues, true)).toEqual([]);
    expect(issues).toEqual([{ field: 'data', problem: 'not_an_array', required: true, seen: 'object' }]);
  });

  it('shares its issues with nested objects and short arrays', () => {
    const issues: FieldIssue[] = [];
    const item = reader({ quote: [{ price: null }] }, issues);

    expect(item.items('quote', true)[0]?.number('price', true)).toBeNull();
    expect(item.child('platform', true).text('slug', true)).toBeNull();
    expect(issues.map((issue) => issue.field)).toEqual(['data.quote[0].price', 'data.platform', 'data.platform.slug']);
  });
});
