/**
 * The policy of the demonstration agent (T5.3): what it does with an answer, and why.
 *
 * Every answer a case starts from is a real one — the two runs recorded on 2026-09-26 in `fixtures/demo`, replayed
 * through `preflightTrade` and read back through the same schemas the demonstration uses over MCP. A case that
 * needs an outcome the capture did not produce edits a copy of a real answer and says which field it moved; no
 * CMC payload and no verdict is written by hand here.
 *
 * Nothing reaches the network: replay mode reads the recorded answers and `fetch` is disabled for every test file.
 */
import { describe, expect, it } from 'vitest';
import { createClientForMode } from '../src/cmc/mode.js';
import { ACTS_ON, decide, describeOrder, describeVerdict, NO_TRADE_NOTICE, RWA_CHECK } from '../src/demo/agent.js';
import type { Order } from '../src/demo/agent.js';
import { readTradeAnswer, type DemoTradeAnswer } from '../src/demo/answers.js';
import { DEMO_FIXTURES } from '../src/demo/run.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { preflightTrade } from '../src/mcp/tools.js';
import { replayIndex } from './helpers/rwa-index.js';

/** One recorded answer, read back exactly as the demonstration reads it off the wire. */
async function recordedAnswer(asset: string, sizeUsd: number): Promise<DemoTradeAnswer> {
  const client = createClientForMode({ kind: 'replay', dir: DEMO_FIXTURES }, { CMC_API_KEY: '' });
  // The index is rebuilt from the recorded walk rather than left to the cache of this clone: C5 is what separates
  // the two scenarios, and a clean checkout has no `.cache/` for it to fall back on (T9.1).
  const wrapperIndex = await replayIndex();
  const answer = await preflightTrade({ client, assess: { wrapperIndex } }, asset, 'buy', sizeUsd);
  expect(answer.isError, `preflight_trade could not answer for ${asset}: ${answer.lines.join(' ')}`).toBe(false);
  return readTradeAnswer(answer.data);
}

const [refusalScenario, acceptScenario] = SCENARIOS;
if (refusalScenario === undefined || acceptScenario === undefined) throw new Error('two scenarios were expected.');

const refusal = await recordedAnswer(refusalScenario.order.asset, refusalScenario.order.sizeUsd);
const accept = await recordedAnswer(acceptScenario.order.asset, acceptScenario.order.sizeUsd);

/** A copy of a real answer with one thing moved, for a case the capture did not produce. */
function edited(answer: DemoTradeAnswer, edit: (copy: DemoTradeAnswer) => void): DemoTradeAnswer {
  const copy = structuredClone(answer);
  edit(copy);
  return copy;
}

describe('the recorded answers the two scenarios rest on', () => {
  it('reads the refusal scenario back as a CAUTION on a token linked to no real-world asset', () => {
    expect(refusal.verdict).toBe('CAUTION');
    expect(refusal.resolved?.cmcId).toBe(37470);
    expect(refusal.checks.find((check) => check.id === RWA_CHECK)?.status).toBe('not_applicable');
  });

  it('reads the accept scenario back as an ACT on a wrapper C5 could follow', () => {
    expect(accept.verdict).toBe('ACT');
    expect(accept.resolved?.cmcId).toBe(4705);
    expect(accept.checks.find((check) => check.id === RWA_CHECK)?.status).toBe('evaluated');
  });

  it('weighs the same order size against both, and finds one pool far too thin for it', () => {
    expect(refusal.order.sizeUsd).toBe(accept.order.sizeUsd);
    const thin = refusal.order.shareOfDeepestPoolPercent;
    const deep = accept.order.shareOfDeepestPoolPercent;
    expect(thin).not.toBeNull();
    expect(deep).not.toBeNull();
    expect(thin ?? 0).toBeGreaterThan(refusal.order.criticalAbovePercent);
    expect(deep ?? 0).toBeLessThan(accept.order.warnAbovePercent);
  });
});

describe('what the agent does', () => {
  it('refuses the recorded RWA order and places nothing', () => {
    const decision = decide(refusalScenario.order, refusal);
    expect(decision.action).toBe('refused');
    expect(decision.headline).toContain('was not placed');
  });

  it('gives every ground it had, not the first one it reached', () => {
    const { reasons } = decide(refusalScenario.order, refusal);
    expect(reasons.some((reason) => reason.includes('acts on ACT only'))).toBe(true);
    expect(reasons.some((reason) => reason.startsWith('The order names a tokenised real-world asset'))).toBe(true);
    expect(reasons.some((reason) => reason.startsWith('C4 critical order_above_liquidity_share'))).toBe(true);
  });

  it('puts the worst finding first and asks explain about that check', () => {
    const decision = decide(refusalScenario.order, refusal);
    const findings = decision.reasons.filter((reason) => /^C[1-7] (warning|critical) /.test(reason));
    expect(findings[0]).toMatch(/^C4 critical /);
    expect(decision.explain).toBe('C4');
  });

  it('simulates the recorded order on the wrapper, and says it placed nothing', () => {
    const decision = decide(acceptScenario.order, accept);
    expect(decision.action).toBe('simulated');
    expect(decision.reasons).toEqual([]);
    expect(decision.headline).toContain(NO_TRADE_NOTICE);
  });

  it('carries what was not measured whichever way it decided', () => {
    for (const [order, answer] of [
      [refusalScenario.order, refusal],
      [acceptScenario.order, accept],
    ] as const) {
      const { notMeasured } = decide(order, answer);
      expect(notMeasured.some((line) => line.startsWith('C2 unavailable:'))).toBe(true);
    }
  });

  it('reports the asset the answers settled on, not the one it was asked about', () => {
    const { resolvedAs } = decide(refusalScenario.order, refusal);
    expect(resolvedAs).toContain('XAU9999 Meme');
    expect(resolvedAs).toContain('CMC 37470');
  });
});

describe('rule 1 — it acts on ACT only', () => {
  it('refuses a verdict below ACT even when no check raised anything', () => {
    // The accepted answer with its verdict moved down: the case where the score alone stops an order.
    const lowered = edited(accept, (copy) => {
      copy.verdict = 'CAUTION';
      copy.score = 60;
      copy.summary = 'CAUTION: 60 out of 100.';
    });
    const decision = decide(acceptScenario.order, lowered);
    expect(decision.action).toBe('refused');
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toContain(`acts on ${ACTS_ON} only`);
  });

  it('refuses DO_NOT_ACT the same way', () => {
    const refused = edited(accept, (copy) => {
      copy.verdict = 'DO_NOT_ACT';
      copy.score = null;
    });
    expect(decide(acceptScenario.order, refused).action).toBe('refused');
  });
});

describe('rule 2 — an order named as an RWA needs C5 to have run', () => {
  it('refuses an ACT whose C5 could not run, when the instruction named an RWA', () => {
    // A real ACT answer with C5 put back to the status the other recorded run gave it.
    const unlinked = edited(accept, (copy) => {
      const c5 = copy.checks.find((check) => check.id === RWA_CHECK);
      if (c5 === undefined) throw new Error('the recorded answer carries no C5.');
      c5.status = 'not_applicable';
      c5.reason = 'This asset is not in the token to real-world-asset index.';
      c5.points = null;
      c5.findings = [];
    });
    const decision = decide(acceptScenario.order, unlinked);
    expect(decision.action).toBe('refused');
    expect(decision.reasons[0]).toContain(`${RWA_CHECK} — the check that reads a wrapper`);
    expect(decision.explain).toBe(RWA_CHECK);
  });

  it('does not apply the rule to an order that never claimed to be an RWA', () => {
    const order: Order = { ...acceptScenario.order, realWorldAsset: false };
    const unlinked = edited(accept, (copy) => {
      const c5 = copy.checks.find((check) => check.id === RWA_CHECK);
      if (c5 === undefined) throw new Error('the recorded answer carries no C5.');
      c5.status = 'not_applicable';
      c5.points = null;
    });
    expect(decide(order, unlinked).action).toBe('simulated');
  });

  it('is satisfied by a C5 that ran, which is what the accepted scenario shows', () => {
    expect(decide(acceptScenario.order, accept).reasons).toEqual([]);
  });
});

describe('the lines the transcript prints', () => {
  it('says of an RWA order that it was named as one', () => {
    expect(describeOrder(refusalScenario.order)).toContain('named as a tokenised real-world asset');
    expect(describeOrder({ ...refusalScenario.order, realWorldAsset: false })).not.toContain('named as');
  });

  it('puts the verdict, the score and the coverage in one line', () => {
    expect(describeVerdict(accept)).toBe('ACT, 100/100, 6 of 7 checks evaluated');
  });

  it('states the order against the depth, with both limits it was read against', () => {
    const { orderLine } = decide(refusalScenario.order, refusal);
    expect(orderLine).toContain('of the deepest pool read');
    expect(orderLine).toContain(`critical above ${String(refusal.order.criticalAbovePercent)}`);
  });

  it('has no order line when no pool stated a depth', () => {
    const noPool = edited(accept, (copy) => {
      copy.order.shareOfDeepestPoolPercent = null;
    });
    expect(decide(acceptScenario.order, noPool).orderLine).toBeNull();
  });
});
