/**
 * Reading a tool answer back off the wire.
 *
 * The demonstration agent of F7 talks to the MCP server the way Claude Desktop does — a child process, a pipe,
 * JSON-RPC — so what comes back is `unknown`, not the `TradeAnswer` of `src/mcp/tools.ts`. Casting it would make
 * the agent claim a shape nobody checked; these schemas narrow it instead, and a field that stopped being sent
 * fails here with the path to it rather than three lines later as `undefined`.
 *
 * Only what the agent reads is declared. The server sends more (`failures`, `elapsedMs`, every measurement of the
 * detailed check); zod drops what is not named, which keeps this file a statement of what the agent's decision
 * actually rests on. The enums come from the engine's own constants, so a new check or a fourth verdict fails to
 * compile here instead of being quietly parsed away.
 */
import { z } from 'zod';
import { CHECK_IDS, CHECK_STATUSES, SEVERITIES } from '../checks/model.js';
import { ORDER_SIDES } from '../mcp/tools.js';
import { VERDICTS } from '../score/verdict.js';

const findingSchema = z.object({
  code: z.string(),
  severity: z.enum(SEVERITIES),
  message: z.string(),
});

const checkSchema = z.object({
  id: z.enum(CHECK_IDS),
  title: z.string(),
  status: z.enum(CHECK_STATUSES),
  severity: z.enum(SEVERITIES).nullable(),
  reason: z.string().nullable(),
  points: z.number().nullable(),
  findings: z.array(findingSchema),
});

const assetAnswerSchema = z.object({
  asked: z.string(),
  resolved: z
    .object({ cmcId: z.number().nullable(), symbol: z.string().nullable(), name: z.string().nullable() })
    .nullable(),
  verdict: z.enum(VERDICTS),
  score: z.number().nullable(),
  coverage: z.object({ evaluated: z.number(), total: z.number(), label: z.string() }),
  summary: z.string(),
  checks: z.array(checkSchema),
  evidence: z.array(
    z.object({
      endpoint: z.string(),
      path: z.string(),
      observedAt: z.string(),
      fixture: z.string().nullable(),
    }),
  ),
  credits: z.object({
    charged: z.number(),
    unconfirmed: z.number(),
    remaining: z.number(),
    budget: z.number(),
  }),
  caveats: z.array(z.string()),
});

const tradeAnswerSchema = assetAnswerSchema.extend({
  order: z.object({
    side: z.enum(ORDER_SIDES),
    sizeUsd: z.number(),
    shareOfDeepestPoolPercent: z.number().nullable(),
    warnAbovePercent: z.number(),
    criticalAbovePercent: z.number(),
  }),
});

/** One asset answer, narrowed to what the agent reads. */
export type DemoAssetAnswer = z.infer<typeof assetAnswerSchema>;

/** One `preflight_trade` answer: an asset answer with the order it weighed. */
export type DemoTradeAnswer = z.infer<typeof tradeAnswerSchema>;

/** One check inside either of them. */
export type DemoCheck = DemoAssetAnswer['checks'][number];

/**
 * A parse failure, with the tool and the field inside its answer. A plain `Error` rather than a `CmcError`: no
 * call to CoinMarketCap failed here, the MCP server answered and this package could not read what it sent.
 */
function narrow<T>(schema: z.ZodType<T>, value: unknown, tool: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`The answer of ${tool} is not shaped as this agent reads it — ${where}`);
}

/** The structured half of a `check_asset` or `check_rwa_token` result. */
export function readAssetAnswer(value: unknown, tool: string): DemoAssetAnswer {
  return narrow(assetAnswerSchema, value, tool);
}

/** The structured half of a `preflight_trade` result. */
export function readTradeAnswer(value: unknown): DemoTradeAnswer {
  return narrow(tradeAnswerSchema, value, 'preflight_trade');
}
