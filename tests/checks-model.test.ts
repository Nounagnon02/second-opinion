import { describe, expect, it } from 'vitest';
import { CmcError } from '../src/cmc/errors.js';
import {
  CHECK_IDS,
  CHECK_TITLES,
  distinctSources,
  evaluated,
  evidence,
  notApplicable,
  unavailable,
  unavailableFromError,
  worstSeverity,
  type Finding,
  type Measurement,
} from '../src/checks/model.js';
import { sourceRef } from '../src/normalize/model.js';
import { recordedSource } from './helpers/normalize.js';

const source = sourceRef(recordedSource('E02', 'E02-quotes-latest-btc-paxg'));
const other = sourceRef(recordedSource('E06', 'E06-simple-price-btc-paxg'));

function measurement(label: string): Measurement {
  return { label, value: 1, unit: 'count', threshold: null, evidence: evidence(source) };
}

function finding(severity: Finding['severity']): Finding {
  return { code: 'example', severity, message: `${severity} example`, measurement: null, evidence: [evidence(source)] };
}

describe('the shape every check returns', () => {
  it('names the seven checks of the specification', () => {
    expect([...CHECK_IDS]).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(Object.keys(CHECK_TITLES).sort()).toEqual([...CHECK_IDS]);
    expect(Object.values(CHECK_TITLES).every((title) => title.length > 0)).toBe(true);
  });

  it('ranks severities so that the worst one leads', () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(['info', 'warning', 'info'])).toBe('warning');
    expect(worstSeverity(['warning', 'critical', 'info'])).toBe('critical');
  });

  it('reports the worst finding first and takes the check severity from it', () => {
    const result = evaluated('C3', {
      findings: [finding('info'), finding('critical'), finding('warning')],
      measurements: [measurement('one')],
      sources: [source],
    });
    expect(result.findings.map((found) => found.severity)).toEqual(['critical', 'warning', 'info']);
    expect(result).toMatchObject({ id: 'C3', title: CHECK_TITLES.C3, status: 'evaluated', severity: 'critical', reason: null });
  });

  it('calls a check that ran and found nothing info, not silence', () => {
    const result = evaluated('C7', { findings: [], measurements: [], sources: [source] });
    expect(result).toMatchObject({ status: 'evaluated', severity: 'info', findings: [] });
  });

  it('lists every answer read once, whatever the number of findings', () => {
    expect(distinctSources([source, source, other, source])).toEqual([source, other]);
    expect(evaluated('C3', { findings: [], measurements: [], sources: [source, source] }).sources).toHaveLength(1);
  });

  it('keeps a check that could not run, with the reason, and never a severity (D9)', () => {
    const missing = notApplicable('C1', 'This asset has no token contract.');
    expect(missing).toMatchObject({
      status: 'not_applicable',
      severity: null,
      reason: 'This asset has no token contract.',
      findings: [],
      measurements: [],
    });
    expect(unavailable('C2', 'Per-exchange prices are not available with the current API plan.')).toMatchObject({
      status: 'unavailable',
      severity: null,
    });
  });

  it('turns a client failure into the reason of an unavailable check, without leaking a key', () => {
    const error = new CmcError('timeout', 'E10 did not answer within 8000 ms.', { endpoint: 'E10' });
    const result = unavailableFromError('C1', error);
    expect(result).toMatchObject({ id: 'C1', status: 'unavailable', reason: 'timeout: E10 did not answer within 8000 ms.' });
  });
});
