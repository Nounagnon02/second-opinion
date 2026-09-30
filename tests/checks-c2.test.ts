import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  C2_REFUSAL_FIXTURES,
  C2_UNAVAILABLE_REASON,
  runCexDivergenceCheck,
} from '../src/checks/c2-cex-divergence.js';
import { CHECK_IDS, CHECK_TITLES } from '../src/checks/model.js';
import { projectRoot, readFixture, readInventory, succeeded } from './helpers/endpoints-doc.js';

describe('runCexDivergenceCheck', () => {
  it('stays in the list of checks and reports why it could not run (D2, D9)', () => {
    const result = runCexDivergenceCheck();
    expect(CHECK_IDS).toContain('C2');
    expect(result).toMatchObject({
      id: 'C2',
      title: CHECK_TITLES.C2,
      status: 'unavailable',
      severity: null,
      findings: [],
      measurements: [],
    });
    expect(result.reason).toBe(C2_UNAVAILABLE_REASON);
  });

  it('names the plan, not the API, and reads as an observation rather than a complaint', () => {
    expect(C2_UNAVAILABLE_REASON).toMatch(/not available with the current API plan/);
    expect(C2_UNAVAILABLE_REASON).toMatch(/HTTP 403 with error code 1006/);
    expect(C2_UNAVAILABLE_REASON).toMatch(/docs\/DECISIONS\.md, D2/);
  });

  it('reads no answer of its own, so a run spends no call and no credit on it', () => {
    expect(runCexDivergenceCheck().sources).toEqual([]);
  });
});

describe('the refusals C2 rests on', () => {
  it('names one recorded refusal per candidate source', () => {
    expect([...C2_REFUSAL_FIXTURES]).toEqual([
      'E04-market-pairs-btc',
      'E15-rwa-market-pairs-gold',
      'E21-exchange-market-pairs-binance-paxg',
    ]);
    for (const label of C2_REFUSAL_FIXTURES) {
      expect(C2_UNAVAILABLE_REASON).toContain(`fixtures/discovery/${label}.json`);
    }
  });

  it('shows, in each cited answer, the refusal the reason describes', () => {
    for (const label of C2_REFUSAL_FIXTURES) {
      const fixture = readFixture(label);
      expect(succeeded(fixture), label).toBe(false);
      expect(fixture.response.status, label).toBe(403);
      expect(Number(fixture.response.body.status?.error_code), label).toBe(1006);
    }
  });

  it('keeps those endpoints marked refused in the inventory', () => {
    const refused = new Set(readInventory().filter((row) => row.status === 'refused').map((row) => row.id));
    for (const id of ['E04', 'E15', 'E21']) expect(refused, id).toContain(id);
  });

  it('is the decision docs/DECISIONS.md records, so the two never drift apart', () => {
    const decisions = readFileSync(join(projectRoot, 'docs', 'DECISIONS.md'), 'utf8');
    expect(decisions).toMatch(/\| C2 \| unavailable \| none \|/);
    expect(decisions).toMatch(/## D2 — C2 is `unavailable` with this key/);
  });
});
