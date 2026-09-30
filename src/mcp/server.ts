/**
 * The MCP server of the specification (F6): the four tools of `tools.ts` over the stdio transport, so that Claude
 * Desktop or Claude Code can ask "is this data worth acting on?" before an agent acts.
 *
 * Four rules shape it:
 * - **stdout belongs to the protocol.** A stdio server speaks JSON-RPC on stdout, so nothing here prints to it.
 *   Every diagnostic goes to stderr, where the host shows it as a server log. One stray `console.log` would corrupt
 *   the stream and the host would drop the connection;
 * - **the server starts even when it cannot call the API.** A missing key is reported by the tool that needed it,
 *   not by a process that refuses to come up: `explain` works with no key at all, and a host that shows four tools
 *   and one clear error message is more use to an agent than one that shows nothing;
 * - **one client per call.** `CMC_CREDIT_BUDGET` is a ceiling per run (F2), and a server lives for many calls; a
 *   client shared between them would spend the ceiling once and refuse every later call. A fresh client per call
 *   keeps the budget and the credit report per call, and still reads the cache on disk that earlier calls filled,
 *   so nothing is paid for twice;
 * - **the run mode is the host's choice.** `--replay[=dir]` and `--record[=dir]` are read from the command line
 *   exactly as `check` reads them, so the same server answers from recorded fixtures with no key and no network —
 *   which is what makes an offline demo possible (T5.3).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { AssessOptions } from '../checks/assess.js';
import { loadChecksConfig, type ChecksConfig } from '../checks/config.js';
import type { CmcClient } from '../cmc/client.js';
import { PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type ModeOverrides, type RunMode } from '../cmc/mode.js';
import {
  checkAsset,
  checkRwaToken,
  explain,
  ORDER_SIDES,
  preflightTrade,
  TOOL_NAMES,
  type ToolAnswer,
  type ToolContext,
} from './tools.js';

/** How the server names itself to the host. */
export const SERVER_NAME = 'second-opinion';

/** Kept in step with `package.json` by `tests/mcp-server.test.ts`. */
export const SERVER_VERSION = '0.1.0';

/** What the host shows about the server as a whole, before any tool is called. */
export const SERVER_INSTRUCTIONS =
  'Second Opinion cross-checks the CoinMarketCap API against itself and answers ACT, CAUTION or DO_NOT_ACT with the ' +
  'evidence behind the verdict. Call check_asset before acting on a price, check_rwa_token for a tokenised ' +
  'real-world asset, and preflight_trade when the size of the order matters. Every answer names the endpoints it ' +
  'was read from and says which of the seven checks could not run and why. It places no order and holds no wallet.';

/** The tools this server registers, in the order it registers them. */
export const REGISTERED_TOOLS = TOOL_NAMES;

/** What the server needs beyond the tool arguments: the run mode, the environment, and the engine configuration. */
export interface ServerOptions {
  /** Live, `--record` or `--replay`; live by default. */
  mode?: RunMode;
  env?: Readonly<Record<string, string | undefined>>;
  /** Passed to `createClientForMode`, which is how a test substitutes the network. */
  overrides?: ModeOverrides;
  /** Thresholds and weights; `config/checks.json` by default, read once at start-up. */
  config?: ChecksConfig;
  /** Passed through to `assessAsset`, which is how a test supplies a wrapper index of its own (D6). */
  assess?: Omit<AssessOptions, 'config' | 'orderSizeUsd'>;
}

/** An error as one sentence, whatever it is. A tool answer never carries a stack. */
function reason(error: unknown): string {
  if (error instanceof CmcError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a tool result looks like on the wire. The index signature is the one the protocol type carries, for the
 * `_meta` passthrough the specification allows; nothing here puts anything else in it.
 */
interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

/**
 * The text the agent reads, and the same answer structured beside it. No output schema is declared, so the
 * structured half is handed over as it is rather than validated twice: the shapes live in `tools.ts` as TypeScript,
 * and a second copy of them in zod would be a second thing to keep in step.
 */
function toolResult<T>(answer: ToolAnswer<T>): ToolResult {
  const content = [{ type: 'text' as const, text: answer.lines.join('\n') }];
  if (answer.data === null || typeof answer.data !== 'object') return { content, isError: answer.isError };
  return { content, structuredContent: answer.data as Record<string, unknown>, isError: answer.isError };
}

/** A tool that could not even be attempted — no key, no fixture directory — said the way every other failure is. */
function failure(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: `This tool could not answer: ${message}` }], isError: true };
}

/**
 * Builds the server and registers the four tools.
 *
 * The client is built inside each call rather than here, so that a missing key becomes the answer of the tool that
 * needed it and the credit ceiling is counted per call (see the header).
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const mode = options.mode ?? { kind: 'live' };
  const env = options.env ?? process.env;
  const config = options.config ?? loadChecksConfig();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  /** One call of a tool that reads the API: its own client, or the reason there is none. */
  const withContext = async <T>(run: (context: ToolContext) => Promise<ToolAnswer<T>>): Promise<ToolResult> => {
    let client: CmcClient;
    try {
      client = createClientForMode(mode, env, options.overrides ?? {});
    } catch (error) {
      return failure(reason(error));
    }
    const context: ToolContext = {
      client,
      config,
      ...(options.assess ? { assess: options.assess } : {}),
    };
    return toolResult(await run(context));
  };

  const asset = z
    .string()
    .min(1)
    .describe('Symbol as CoinMarketCap writes it, for example PAXG or BTC, or a numeric CMC ID such as 4705.');

  server.registerTool(
    'check_asset',
    {
      title: 'Check one asset before acting on its price',
      description:
        'Cross-checks the CoinMarketCap data for one asset and answers ACT, CAUTION or DO_NOT_ACT with a score out ' +
        'of 100. Runs the seven consistency checks — aggregated price against DEX venues, freshness, depth behind ' +
        'the price, RWA premium, agreement between endpoints, fields that could not be read — and returns the ' +
        'observation each one raised, the reason any of them could not run, and the endpoint answers behind every ' +
        'statement. Call it before acting on a price.',
      inputSchema: { asset },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ asset: named }) => withContext((context) => checkAsset(context, named)),
  );

  server.registerTool(
    'check_rwa_token',
    {
      title: 'Check a tokenised real-world asset',
      description:
        'The same assessment as check_asset, with the real-world-asset check (C5) in full detail: how far this ' +
        'wrapper sits from the average tokenized price CoinMarketCap publishes over the wrappers of the same ' +
        'underlying asset, and how widely those wrappers spread around it. Use it for a tokenised commodity or ' +
        'security such as PAXG. When the token is linked to no real-world asset, the answer says so rather than ' +
        'inventing a link.',
      inputSchema: { asset },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ asset: named }) => withContext((context) => checkRwaToken(context, named)),
  );

  server.registerTool(
    'preflight_trade',
    {
      title: 'Weigh one order against the depth behind the price',
      description:
        'The verdict for an order of a given size: the whole assessment of the asset, plus what share of the ' +
        'deepest pool read an order of this size would take. A size that is large against the depth available ' +
        'lowers the verdict, because the price read is not the price such an order would get. Use it instead of ' +
        'check_asset whenever the size of the order matters. It weighs the order and places nothing.',
      inputSchema: {
        asset,
        side: z.enum(ORDER_SIDES).describe('buy or sell. Recorded and echoed back; it changes no measurement.'),
        size_usd: z.number().positive().describe('Notional size of the order in USD; must be above 0.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ asset: named, side, size_usd }) => withContext((context) => preflightTrade(context, named, side, size_usd)),
  );

  server.registerTool(
    'explain',
    {
      title: 'Explain one of the seven checks',
      description:
        'What a check measures, why it matters before acting, which endpoints it reads, the limits it is read ' +
        'against, and the recorded measurements those limits were settled on. Call it to turn a check identifier ' +
        'from any other answer into a plain-English explanation. Reads no market data and needs no API key.',
      inputSchema: { check_id: z.string().min(1).describe('One of C1, C2, C3, C4, C5, C6, C7.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ check_id }) => toolResult(explain(check_id, config)),
  );

  return server;
}

/** Starts the server on stdio and returns once the transport is connected. */
export async function startServer(options: ServerOptions = {}): Promise<McpServer> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

async function main(): Promise<void> {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { mode, args } = parseRunMode(process.argv.slice(2));
  if (args.length > 0) {
    throw new CmcError(
      'config',
      `unknown argument(s) ${args.join(', ')}. Usage: mcp [--record[=dir] | --replay[=dir]] — the tools take their ` +
        'own arguments from the host.',
    );
  }
  await startServer({ mode });
  // stderr, never stdout: stdout carries the JSON-RPC stream the host reads.
  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} listening on stdio in ${mode.kind} mode; ` +
      `tools: ${REGISTERED_TOOLS.join(', ')}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${reason(error)}`);
    process.exitCode = 1;
  });
}
