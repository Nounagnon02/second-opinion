import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRetryable } from '../src/cmc/errors.js';
import { parseStatus } from '../src/cmc/status.js';
import { projectRoot, readFixture } from './helpers/endpoints-doc.js';

const labels = readdirSync(join(projectRoot, 'fixtures', 'discovery'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));

describe('parseStatus', () => {
  it('reads the numeric shape (E01)', () => {
    expect(parseStatus(readFixture('E01-map-btc-paxg').response.body)).toEqual({
      timestamp: '2026-09-24T16:03:47.699Z',
      errorCode: 0,
      errorMessage: null,
      elapsed: 1,
      creditCount: 0,
      notice: null,
    });
  });

  it('reads the string shape (E02), where an empty error_message means none', () => {
    expect(parseStatus(readFixture('E02-quotes-latest-btc-paxg').response.body)).toEqual({
      timestamp: '2026-09-24T16:04:03.419Z',
      errorCode: 0,
      errorMessage: null,
      elapsed: 4,
      creditCount: 1,
      notice: null,
    });
  });

  it('reads a refusal in both shapes (E21 numeric, E15 string)', () => {
    for (const label of ['E21-exchange-market-pairs-binance-paxg', 'E15-rwa-market-pairs-gold']) {
      expect(parseStatus(readFixture(label).response.body), label).toMatchObject({
        errorCode: 1006,
        errorMessage: "Your API Key subscription plan doesn't support this endpoint.",
        creditCount: 0,
      });
    }
  });

  it('reads the status block of every recorded fixture', () => {
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const { body } = readFixture(label).response;
      const status = parseStatus(body);
      expect(status, label).toBeDefined();
      expect(status?.errorCode, label).toBe(Number(body.status?.error_code));
      expect(status?.creditCount, label).toBe(body.status?.credit_count);
    }
  });

  it('returns undefined without a usable block', () => {
    expect(parseStatus('<html>502</html>')).toBeUndefined();
    expect(parseStatus({ data: [] })).toBeUndefined();
    expect(parseStatus({ status: [] })).toBeUndefined();
    expect(parseStatus({ status: { error_code: 0 } })).toBeUndefined();
    expect(parseStatus({ status: { timestamp: 't', error_code: 'zero' } })).toBeUndefined();
    expect(parseStatus({ status: { timestamp: 't', error_code: 1.5 } })).toBeUndefined();
  });

  it('marks a missing or invalid credit_count as unknown', () => {
    expect(parseStatus({ status: { timestamp: 't', error_code: 0 } })?.creditCount).toBeNull();
    expect(parseStatus({ status: { timestamp: 't', error_code: 0, credit_count: '1' } })?.creditCount).toBeNull();
    expect(parseStatus({ status: { timestamp: 't', error_code: 0, credit_count: -1 } })?.creditCount).toBeNull();
  });
});

describe('isRetryable', () => {
  it.each([
    [500, 500, true],
    [502, undefined, true],
    [429, 1008, true],
    [429, 1011, true],
    [429, undefined, true],
    [429, 1009, false],
    [429, 1010, false],
    [400, 400, false],
    [401, 1001, false],
    [402, 1003, false],
    [403, 1006, false],
  ])('HTTP %i, error_code %s: %s', (httpStatus, errorCode, expected) => {
    expect(isRetryable(httpStatus, errorCode)).toBe(expected);
  });
});
