/**
 * The demonstration agent of specification F7: what an agent does with an answer from `preflight_trade`.
 *
 * It is deliberately small, because the point of the demonstration is not the agent. The point is that an agent
 * with a two-line policy refuses an order a market-data feed alone would have let through, and can say which
 * measurement stopped it. Everything it reports is read out of the tool answer; nothing here measures anything.
 *
 * Two rules make the decision, and both are written down so the transcript can cite them:
 * - **act on `ACT` only.** `CAUTION` is not a weaker yes. Second Opinion answers `CAUTION` when it has something
 *   to say about the data, and an agent that acts anyway has paid for the check and thrown the answer away;
 * - **an order named as a tokenised real-world asset needs C5 to have run.** C5 is the check that reads a wrapper
 *   against the price of its underlying across the other wrappers of it. When it reports `not_applicable`, the
 *   thing being bought is linked to no real-world asset at all — which is a different failure from a bad price,
 *   and one a verdict on its own does not spell out.
 *
 * **It places nothing.** `simulated` means a ticket was printed and thrown away. There is no wallet, no key, no
 * venue and no signature anywhere in this package.
 */
import { type CheckId, SEVERITY_RANK, type Severity } from '../checks/model.js';
import { formatPercent, formatUsd } from '../checks/prices.js';
import type { OrderSide } from '../mcp/tools.js';
import { formatScore } from '../score/score.js';
import type { Verdict } from '../score/verdict.js';
import type { DemoCheck, DemoTradeAnswer } from './answers.js';

/** The one verdict this agent acts on (rule 1 of the header). */
export const ACTS_ON: Verdict = 'ACT';

/** The check an order named as a tokenised real-world asset needs (rule 2 of the header). */
export const RWA_CHECK: CheckId = 'C5';

/** What this demonstration never does, said in the words it prints. */
export const NO_TRADE_NOTICE =
  'this agent places no order, holds no wallet, signs nothing and reaches no venue. A simulated decision means a ' +
  'ticket was printed and thrown away.';

/** The order the agent was told to carry out. */
export interface Order {
  /** The instruction in the words of whoever gave it, which is what the transcript shows. */
  instruction: string;
  /** The asset as the instruction named it: what the tools are asked about, right or wrong. */
  asset: string;
  side: OrderSide;
  sizeUsd: number;
  /**
   * `true` when the instruction says the target is a tokenised real-world asset. It is a property of the
   * instruction, not of the asset: whether the asset really is one is what the tool answer settles.
   */
  realWorldAsset: boolean;
}

/** What the agent did with the order. Neither value reaches a venue; see `NO_TRADE_NOTICE`. */
export type Action = 'refused' | 'simulated';

/** The agent's answer to one order, with everything it would say back. */
export interface Decision {
  order: Order;
  action: Action;
  verdict: Verdict;
  score: number | null;
  /** The asset every measurement was about, as the answers named it; `null` when no endpoint settled on one. */
  resolvedAs: string | null;
  /** What share of the deepest pool read the order would take, in full; `null` when no pool stated a depth. */
  orderLine: string | null;
  /** One sentence: what happened to the order. */
  headline: string;
  /** Why, one line each, every one of them read out of the tool answer. */
  reasons: string[];
  /** What the answer says was not measured. Carried whichever way the decision went. */
  notMeasured: string[];
  /** The check worth asking `explain` about; `null` when none raised anything and none blocked the order. */
  explain: CheckId | null;
}

/** The order as the transcript writes it. */
export function describeOrder(order: Order): string {
  const named = order.realWorldAsset ? `${order.asset}, named as a tokenised real-world asset` : order.asset;
  return `${order.side} ${formatUsd(order.sizeUsd)} of ${named}`;
}

/** The asset the answers settled on, or `null` when they settled on none. */
function resolvedAs(answer: DemoTradeAnswer): string | null {
  if (answer.resolved === null) return null;
  const { symbol, name, cmcId } = answer.resolved;
  const parts = [symbol, name, cmcId === null ? null : `CMC ${String(cmcId)}`].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length === 0 ? null : parts.join(' — ');
}

/** The order size against the depth behind the price, in the words `preflight_trade` measured it. */
function orderLine(answer: DemoTradeAnswer): string | null {
  const { sizeUsd, shareOfDeepestPoolPercent, warnAbovePercent, criticalAbovePercent } = answer.order;
  if (shareOfDeepestPoolPercent === null) return null;
  return (
    `${formatUsd(sizeUsd)} is ${formatPercent(shareOfDeepestPoolPercent)} of the deepest pool read ` +
    `(warning above ${formatPercent(warnAbovePercent)}, critical above ${formatPercent(criticalAbovePercent)})`
  );
}

/** The findings worth reporting, worst first: an `info` states a measurement and stops no order. */
function raised(answer: DemoTradeAnswer): { check: DemoCheck; severity: Severity; line: string }[] {
  return answer.checks
    .flatMap((check) =>
      check.findings
        .filter((finding) => finding.severity !== 'info')
        .map((finding) => ({
          check,
          severity: finding.severity,
          line: `${check.id} ${finding.severity} ${finding.code}: ${finding.message}`,
        })),
    )
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);
}

/** Rule 2 of the header: the ground on which an order named as an RWA is refused; `null` when the rule is met. */
function rwaGround(order: Order, answer: DemoTradeAnswer): { check: DemoCheck; line: string } | null {
  if (!order.realWorldAsset) return null;
  const check = answer.checks.find((candidate) => candidate.id === RWA_CHECK);
  if (check === undefined || check.status === 'evaluated') return null;
  return {
    check,
    line:
      `The order names a tokenised real-world asset, and ${RWA_CHECK} — the check that reads a wrapper against ` +
      `the price of its underlying across the other wrappers of it — did not run (${check.status}): ` +
      `${check.reason ?? 'no reason was given.'}`,
  };
}

/** What the answer says was not measured: the checks that scored nothing, each with the reason it gave (D9). */
function notMeasured(answer: DemoTradeAnswer): string[] {
  return answer.checks
    .filter((check) => check.points === null)
    .map((check) => `${check.id} ${check.status}: ${check.reason ?? 'No reason was given.'}`);
}

/**
 * The agent's decision on one order, from one `preflight_trade` answer.
 *
 * Both rules are evaluated whichever way the decision goes, so a refusal lists every ground it had rather than the
 * first one reached: an agent that reports one of two reasons invites the user to fix that one and try again.
 */
export function decide(order: Order, answer: DemoTradeAnswer): Decision {
  const reasons: string[] = [];

  if (answer.verdict !== ACTS_ON) {
    reasons.push(`The verdict is ${answer.verdict} and this agent acts on ${ACTS_ON} only — ${answer.summary}`);
  }

  const rwa = rwaGround(order, answer);
  if (rwa !== null) reasons.push(rwa.line);

  const findings = raised(answer);
  for (const finding of findings) reasons.push(finding.line);

  const action: Action = reasons.length === 0 ? 'simulated' : 'refused';
  const size = formatUsd(order.sizeUsd);
  const headline =
    action === 'refused'
      ? `Order refused: ${order.side} ${size} of ${order.asset} was not placed.`
      : `Order simulated: ${order.side} ${size} of ${order.asset} — ${NO_TRADE_NOTICE}`;

  return {
    order,
    action,
    verdict: answer.verdict,
    score: answer.score,
    resolvedAs: resolvedAs(answer),
    orderLine: orderLine(answer),
    headline,
    reasons,
    notMeasured: notMeasured(answer),
    explain: findings[0]?.check.id ?? rwa?.check.id ?? null,
  };
}

/** The verdict, the score and the coverage in one line, for the transcript. */
export function describeVerdict(answer: DemoTradeAnswer): string {
  const score = answer.score === null ? 'no score' : `${formatScore(answer.score)}/100`;
  return `${answer.verdict}, ${score}, ${answer.coverage.label}`;
}
