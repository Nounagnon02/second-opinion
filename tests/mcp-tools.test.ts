/**
 * The four tools of the MCP server (T5.1), tested without a transport: what each one answers, what it says about
 * what it could not measure, and the evidence it carries.
 *
 * Every run is offline, replayed from the answers the live `check` runs of 2026-09-25 recorded into `fixtures/check`:
 * - **PAXG** goes through the whole plan of D1 and is a tokenised wrapper, so it exercises `check_rwa_token` and C5;
 * - **BTC** is a coin with no token contract and no real-world asset, so it exercises what the tools say when the
 *   check a caller asked about could not run (D9).
 *
 * No test here asserts a threshold of its own: the limits come from `config/checks.json`, so a calibration that
 * moves one does not have to be copied into this file.
 */
import { describe, expect, it } from 'vitest';
import { assessAsset, parseSubject, type AssetAssessment } from '../src/checks/assess.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { createClientForMode } from '../src/cmc/mode.js';
import {
  assetAnswer,
  checkAsset,
  checkRwaToken,
  describeAssetAnswer,
  explain,
  ORDER_LIMITS_NOTE,
  ORDER_SIDE_NOTE,
  ORDER_SIDES,
  orderShareOf,
  preflightTrade,
  TOOL_NAMES,
  type ToolContext,
} from '../src/mcp/tools.js';
import { CHECK_FIXTURES, PAXG_ID, paxosIndex } from './helpers/check-fixtures.js';

const config = loadChecksConfig();

/** A tool context reading the recorded answers, with the index the recorded PAXG run was read with (D6). */
function context(): ToolContext {
  return {
    client: createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {}),
    config,
    assess: { wrapperIndex: paxosIndex() },
  };
}

/** The assessment a tool answer is built from, read the way the tool reads it. */
async function assessment(named = 'PAXG'): Promise<AssetAssessment> {
  const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
  return assessAsset(client, parseSubject(named), { config, wrapperIndex: paxosIndex() });
}

function lineWith(lines: readonly string[], needle: string): string {
  const found = lines.find((line) => line.includes(needle));
  if (found === undefined) throw new Error(`no line contains "${needle}" in:\n${lines.join('\n')}`);
  return found;
}

describe('the tools the specification names', () => {
  it('is the four of F6, and nothing else', () => {
    expect([...TOOL_NAMES]).toEqual(['check_asset', 'check_rwa_token', 'preflight_trade', 'explain']);
  });

  it('weighs an order on one of two sides', () => {
    expect([...ORDER_SIDES]).toEqual(['buy', 'sell']);
  });
});

describe('check_asset', () => {
  it('answers with the verdict, the score and the coverage of the run', async () => {
    const { data, isError } = await checkAsset(context(), 'PAXG');
    expect(isError).toBe(false);
    const answer = data ?? expect.fail('no answer');
    expect(answer.asked).toBe('PAXG');
    expect(answer.resolved?.cmcId).toBe(PAXG_ID);
    expect(answer.resolved?.symbol).toBe('PAXG');
    expect(['ACT', 'CAUTION', 'DO_NOT_ACT']).toContain(answer.verdict);
    expect(answer.score).not.toBeNull();
    expect(answer.coverage.total).toBe(CHECK_IDS.length);
    expect(answer.coverage.evaluated).toBeGreaterThan(0);
    expect(answer.coverage.label).toBe(`${String(answer.coverage.evaluated)} of 7 checks evaluated`);
  });

  it('is the same verdict the engine formed, so an agent and a reviewer read one number', async () => {
    const { data } = await checkAsset(context(), 'PAXG');
    const direct = await assessment('PAXG');
    expect(data?.verdict).toBe(direct.score.verdict);
    expect(data?.score).toBe(direct.score.score);
    expect(data?.summary).toBe(direct.score.summary);
  });

  it('carries all seven checks, each with its status and the reason it did not run', async () => {
    const { data } = await checkAsset(context(), 'PAXG');
    const answer = data ?? expect.fail('no answer');
    expect(answer.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    for (const check of answer.checks) {
      if (check.status === 'evaluated') {
        expect(check.reason).toBeNull();
        expect(check.points).not.toBeNull();
      } else {
        // D9: a check that could not run says why, in every output, and weighs nothing.
        expect(check.reason).not.toBeNull();
        expect(check.reason).not.toBe('');
        expect(check.points).toBeNull();
        expect(check.sharePercent).toBe(0);
      }
    }
  });

  it('names C2 unavailable with the plan of the recorded key, never silently dropped (D2)', async () => {
    const { data } = await checkAsset(context(), 'PAXG');
    const c2 = data?.checks.find((check) => check.id === 'C2');
    expect(c2?.status).toBe('unavailable');
    expect(c2?.reason).toContain('1006');
  });

  it('cites the answer behind every statement, with the fixture a replay read it from', async () => {
    const { data } = await checkAsset(context(), 'PAXG');
    const answer = data ?? expect.fail('no answer');
    expect(answer.evidence.length).toBeGreaterThan(0);
    for (const source of answer.evidence) {
      expect(source.endpoint).toMatch(/^E\d\d$/);
      expect(source.observedAt).not.toBe('');
      // Replayed, so every answer names the recorded file it came from rather than a live call.
      expect(source.fixture).not.toBeNull();
    }
  });

  it('leaves the measurements out, which is what keeps a general answer readable', async () => {
    const { data } = await checkAsset(context(), 'PAXG');
    for (const check of data?.checks ?? []) expect(check.measurements).toBeNull();
  });

  it('reports a coin the way D9 asks: C1, C4 and C5 did not run, and each says why', async () => {
    const { data, isError } = await checkAsset(context(), 'BTC');
    expect(isError).toBe(false);
    const answer = data ?? expect.fail('no answer');
    expect(answer.resolved?.symbol).toBe('BTC');
    for (const id of ['C1', 'C4', 'C5'] as const) {
      const check = answer.checks.find((entry) => entry.id === id);
      expect(check?.status, `${id} ran on a coin`).not.toBe('evaluated');
      expect(check?.reason).not.toBeNull();
    }
  });

  it('answers an asset no recorded call covers with no score, which is DO_NOT_ACT (D11)', async () => {
    const { data, isError, lines } = await checkAsset(context(), 'NOSUCHTOKEN');
    expect(isError).toBe(false);
    expect(data?.verdict).toBe('DO_NOT_ACT');
    expect(data?.score).toBeNull();
    expect(lines.join('\n')).toContain('no check could be evaluated');
  });

  it('refuses an empty asset name with a reason rather than guessing', async () => {
    const { isError, lines, data } = await checkAsset(context(), '   ');
    expect(isError).toBe(true);
    expect(data).toBeNull();
    expect(lines[0]).toContain('No asset was named');
  });
});

describe('check_rwa_token', () => {
  it('details every measurement of C5, which is the check it is about', async () => {
    const { data, isError } = await checkRwaToken(context(), 'PAXG');
    expect(isError).toBe(false);
    const answer = data ?? expect.fail('no answer');
    const c5 = answer.checks.find((check) => check.id === 'C5');
    expect(c5?.status).toBe('evaluated');
    expect(c5?.measurements).not.toBeNull();
    expect(c5?.measurements?.length).toBeGreaterThan(0);
    for (const measurement of c5?.measurements ?? []) {
      expect(measurement.label).not.toBe('');
      expect(['seconds', 'percent', 'usd', 'count', 'ratio']).toContain(measurement.unit);
    }
  });

  it('details C5 alone: the other six stay summarised', async () => {
    const { data } = await checkRwaToken(context(), 'PAXG');
    const detailed = (data?.checks ?? []).filter((check) => check.measurements !== null).map((check) => check.id);
    expect(detailed).toEqual(['C5']);
  });

  it('names the real-world asset the cached index linked the token to (D6)', async () => {
    const { lines } = await checkRwaToken(context(), 'PAXG');
    expect(lineWith(lines, 'Wraps rwa_id')).toContain('cached index');
  });

  it('says plainly that C5 did not run for a coin, instead of implying an RWA reading', async () => {
    const { data, isError } = await checkRwaToken(context(), 'BTC');
    expect(isError).toBe(false);
    const answer = data ?? expect.fail('no answer');
    const c5 = answer.checks.find((check) => check.id === 'C5');
    expect(c5?.status).not.toBe('evaluated');
    expect(answer.caveats).toHaveLength(1);
    expect(answer.caveats[0]).toContain('C5');
    expect(answer.caveats[0]).toContain('did not run');
    // The reason the check gave travels into the caveat, so the caller is not left to guess at the cause.
    expect(answer.caveats[0]).toContain((c5?.reason ?? '').slice(0, 40));
  });

  it('adds no caveat when C5 did run', async () => {
    const { data } = await checkRwaToken(context(), 'PAXG');
    expect(data?.caveats).toEqual([]);
  });
});

describe('preflight_trade', () => {
  it('weighs the order against the deepest pool read and says what share it is', async () => {
    const { data, isError } = await preflightTrade(context(), 'PAXG', 'buy', 250_000);
    expect(isError).toBe(false);
    const answer = data ?? expect.fail('no answer');
    expect(answer.order.side).toBe('buy');
    expect(answer.order.sizeUsd).toBe(250_000);
    expect(answer.order.shareOfDeepestPoolPercent).not.toBeNull();
    expect(answer.order.warnAbovePercent).toBe(config.C4.warnOrderSharePercent);
    expect(answer.order.criticalAbovePercent).toBe(config.C4.criticalOrderSharePercent);
  });

  it('reports the share C4 measured, not a second division of its own', async () => {
    const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
    const direct = await assessAsset(client, parseSubject('PAXG'), {
      config,
      wrapperIndex: paxosIndex(),
      orderSizeUsd: 250_000,
    });
    const { data } = await preflightTrade(context(), 'PAXG', 'buy', 250_000);
    expect(data?.order.shareOfDeepestPoolPercent).toBe(orderShareOf(direct));
  });

  it('grows the share with the size, on the same recorded pools', async () => {
    const small = await preflightTrade(context(), 'PAXG', 'buy', 10_000);
    const large = await preflightTrade(context(), 'PAXG', 'buy', 1_000_000);
    const smallShare = small.data?.order.shareOfDeepestPoolPercent ?? expect.fail('no small share');
    const largeShare = large.data?.order.shareOfDeepestPoolPercent ?? expect.fail('no large share');
    expect(largeShare).toBeGreaterThan(smallShare);
    expect(largeShare / smallShare).toBeCloseTo(100, 6);
  });

  it('lowers the verdict once an order is large enough against the depth to raise a finding', async () => {
    const asset = await checkAsset(context(), 'PAXG');
    // The deepest recorded PAXG pool holds about 16.3 M USD, so an order of 100 M is far past every limit of C4.
    const huge = await preflightTrade(context(), 'PAXG', 'buy', 100_000_000);
    const share = huge.data?.order.shareOfDeepestPoolPercent ?? expect.fail('no share');
    expect(share).toBeGreaterThan(config.C4.criticalOrderSharePercent);
    const c4 = huge.data?.checks.find((check) => check.id === 'C4');
    expect(c4?.findings.map((finding) => finding.code)).toContain('order_above_liquidity_share');
    expect(huge.data?.score ?? 0).toBeLessThan(asset.data?.score ?? 0);
  });

  it('weighs a buy and a sell of the same size identically, and says so rather than implying otherwise', async () => {
    const buy = await preflightTrade(context(), 'PAXG', 'buy', 250_000);
    const sell = await preflightTrade(context(), 'PAXG', 'sell', 250_000);
    expect(sell.data?.order.side).toBe('sell');
    expect(sell.data?.order.shareOfDeepestPoolPercent).toBe(buy.data?.order.shareOfDeepestPoolPercent);
    expect(sell.data?.verdict).toBe(buy.data?.verdict);
    expect(buy.data?.caveats).toContain(ORDER_SIDE_NOTE);
  });

  it('says the two order limits are still placeholders, on every answer', async () => {
    const { data, lines } = await preflightTrade(context(), 'PAXG', 'buy', 250_000);
    expect(data?.caveats).toContain(ORDER_LIMITS_NOTE);
    expect(lines.join('\n')).toContain('placeholders');
  });

  it('details C4 alone, which is the check the order is weighed by', async () => {
    const { data } = await preflightTrade(context(), 'PAXG', 'buy', 250_000);
    const detailed = (data?.checks ?? []).filter((check) => check.measurements !== null).map((check) => check.id);
    expect(detailed).toEqual(['C4']);
  });

  it('refuses a size that is not an amount of USD above 0', async () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { isError, lines, data } = await preflightTrade(context(), 'PAXG', 'buy', size);
      expect(isError, `size ${String(size)} was accepted`).toBe(true);
      expect(data).toBeNull();
      expect(lines[0]).toContain('not an amount of USD above 0');
    }
  });

  it('says the order could not be weighed when no pool stated a depth, rather than passing it', async () => {
    // BTC is a coin: E05 lists no contract, so no pool is read and there is no depth to weigh an order against.
    const { data, lines, isError } = await preflightTrade(context(), 'BTC', 'sell', 50_000);
    expect(isError).toBe(false);
    expect(data?.order.shareOfDeepestPoolPercent).toBeNull();
    expect(lineWith(lines, 'Order weighed')).toContain('could not be weighed');
  });
});

describe('explain', () => {
  it('explains each of the seven checks, reading its limits from the configuration', () => {
    for (const id of CHECK_IDS) {
      const { data, isError } = explain(id, config);
      expect(isError, `${id} could not be explained`).toBe(false);
      const explanation = data ?? expect.fail(`no explanation for ${id}`);
      expect(explanation.id).toBe(id);
      expect(explanation.title).not.toBe('');
      expect(explanation.what.length).toBeGreaterThan(40);
      expect(explanation.why.length).toBeGreaterThan(40);
    }
  });

  it('reads every limit out of config/checks.json, so an explanation cannot drift from the verdict', () => {
    const c4 = explain('C4', config).data ?? expect.fail('no C4');
    const byName = new Map(c4.thresholds.map((threshold) => [threshold.name, threshold.value]));
    expect(byName.get('C4.warnLiquidityBelowUsd')).toBe(config.C4.warnLiquidityBelowUsd);
    expect(byName.get('C4.criticalLiquidityBelowUsd')).toBe(config.C4.criticalLiquidityBelowUsd);
    expect(byName.get('C4.warnTurnoverRatio')).toBe(config.C4.warnTurnoverRatio);
    expect(byName.get('C4.criticalTurnoverRatio')).toBe(config.C4.criticalTurnoverRatio);
    expect(byName.get('C4.warnOrderSharePercent')).toBe(config.C4.warnOrderSharePercent);
    expect(byName.get('C4.criticalOrderSharePercent')).toBe(config.C4.criticalOrderSharePercent);
  });

  it('hands back the provenance of the limits as the configuration records it', () => {
    const c1 = explain('C1', config).data ?? expect.fail('no C1');
    expect(c1.provenance).toBe(config.C1.notes);
    const c6 = explain('C6', config).data ?? expect.fail('no C6');
    expect(c6.provenance).toBe(config.C6.notes);
  });

  it('says why C2 cannot run, and gives it no limit to read', () => {
    const c2 = explain('C2', config).data ?? expect.fail('no C2');
    expect(c2.thresholds).toEqual([]);
    expect(c2.endpoints).toEqual([]);
    expect(c2.caveat).toContain('1006');
  });

  it('warns that the limits of C5 rest on one recorded asset', () => {
    const c5 = explain('C5', config).data ?? expect.fail('no C5');
    expect(c5.caveat).toContain('placeholders');
  });

  it('reads an identifier the way a caller may type it', () => {
    for (const typed of ['c4', 'C4', ' c4 ']) {
      expect(explain(typed, config).data?.id, `"${typed}" was not read as C4`).toBe('C4');
    }
  });

  it('refuses an identifier that is not a check, listing the seven', () => {
    const { isError, lines, data } = explain('C9', config);
    expect(isError).toBe(true);
    expect(data).toBeNull();
    for (const id of CHECK_IDS) expect(lines[0]).toContain(id);
  });
});

describe('the text an agent reads', () => {
  it('leads with the verdict and the asset, then the sentence the score wrote', async () => {
    const { lines } = await checkAsset(context(), 'PAXG');
    expect(lines[0]).toMatch(/^(ACT|CAUTION|DO_NOT_ACT) — PAXG/);
    expect(lines[0]).toContain(`CMC ${String(PAXG_ID)}`);
    const direct = await assessment('PAXG');
    expect(lines[1]).toBe(direct.score.summary);
  });

  it('lists every check that did not run, with its reason', async () => {
    const { data, lines } = await checkAsset(context(), 'BTC');
    const text = lines.join('\n');
    expect(text).toContain('Checks that did not run');
    for (const check of data?.checks ?? []) {
      if (check.points === null) expect(text).toContain(`${check.id} ${check.status}`);
    }
  });

  it('prints the evidence table, one line per answer read', async () => {
    const { data, lines } = await checkAsset(context(), 'PAXG');
    const evidence = lines.slice(lines.indexOf('Evidence') + 1);
    for (const source of data?.evidence ?? []) {
      expect(evidence.some((line) => line.includes(source.endpoint) && line.includes(source.path))).toBe(true);
    }
  });

  it('never carries an API key, in any tool, in either half of the answer', async () => {
    const answers = [
      await checkAsset(context(), 'PAXG'),
      await checkRwaToken(context(), 'PAXG'),
      await preflightTrade(context(), 'PAXG', 'buy', 250_000),
      explain('C4', config),
    ];
    for (const answer of answers) {
      const whole = `${answer.lines.join('\n')}\n${JSON.stringify(answer.data)}`;
      expect(whole).not.toMatch(/X-CMC_PRO_API_KEY/i);
      // Nothing shaped like a CMC key may reach an answer, masked or not.
      expect(whole).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
    }
  });

  it('describes an answer built by hand the same way, so the renderer has no hidden input', async () => {
    const built = assetAnswer(await assessment('PAXG'), ['C5'], ['A caveat of this test.']);
    const lines = describeAssetAnswer(built);
    expect(lines.join('\n')).toContain('A caveat of this test.');
    expect(lineWith(lines, 'What this answer does not cover')).toBeDefined();
  });
});
