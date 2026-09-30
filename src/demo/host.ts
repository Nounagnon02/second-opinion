/**
 * The half of the demonstration that is a host: it spawns the MCP server as a child process and talks to it over
 * a pipe, exactly as Claude Desktop does with the configuration the README hands out (T5.2).
 *
 * It would be shorter to call `preflightTrade` from `src/mcp/tools.ts` directly. It would also demonstrate
 * nothing: the claim of this project is that an agent gets a second opinion *through MCP*, and a demonstration
 * that skips the protocol cannot show the handshake, the tools the server declares, or a tool error arriving as
 * an answer rather than as a crash. So the real built entry point is launched, and every call goes over the wire.
 *
 * Two things are kept for the transcript: the tool calls in the order they were made, and everything the server
 * wrote to stderr, which is where a stdio server puts its log.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { OrderSide } from '../mcp/tools.js';
import { isRecord } from '../normalize/values.js';
import { readAssetAnswer, readTradeAnswer, type DemoAssetAnswer, type DemoTradeAnswer } from './answers.js';

/** How the demonstration names itself to the server, the way a host names itself. */
export const HOST_NAME = 'second-opinion-demo-agent';

export const HOST_VERSION = '0.1.0';

/** One tool call, as the transcript lists it. */
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  /** The first line of the answer: the verdict, or the reason there is none. */
  headline: string;
  isError: boolean;
}

export interface HostOptions {
  /** The built server entry point a host launches, `dist/mcp/server.js`. */
  entry: string;
  /** What follows it on the command line: the run-mode flag, and nothing else the server takes. */
  serverArgs?: readonly string[];
  /** The environment the server process gets. Nothing is inherited that is not named here. */
  env: Readonly<Record<string, string>>;
  /** The working directory of the server process; a host's own, never this project's. */
  cwd?: string;
}

/** A connected server, and the tools the agent uses as functions. */
export class DemoHost {
  private constructor(
    private readonly client: Client,
    private readonly stderr: () => string,
    /** Every tool call made through this host, in order. */
    readonly calls: ToolCall[],
  ) {}

  /** Spawns the server and completes the handshake. */
  static async connect(options: HostOptions): Promise<DemoHost> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [options.entry, ...(options.serverArgs ?? [])],
      env: { ...options.env },
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stderr: 'pipe',
    });
    let log = '';
    const client = new Client({ name: HOST_NAME, version: HOST_VERSION });
    await client.connect(transport);
    transport.stderr?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    return new DemoHost(client, () => log, []);
  }

  /** What the server wrote to stderr since the handshake. */
  log(): string {
    return this.stderr();
  }

  /** The tools the server declares, which is what a host shows its user. */
  async tools(): Promise<string[]> {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => tool.name);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** One call: the text half for the transcript, the structured half for the agent. */
  private async call(tool: string, args: Record<string, unknown>): Promise<{ text: string; structured: unknown }> {
    const result = await this.client.callTool({ name: tool, arguments: args });
    const content: unknown[] = Array.isArray(result.content) ? result.content : [];
    const text = content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n');
    const isError = result.isError === true;
    this.calls.push({ tool, args, headline: text.split('\n')[0] ?? '', isError });
    if (isError) throw new Error(`${tool} could not answer — ${text}`);
    return { text, structured: result.structuredContent };
  }

  /** `check_rwa_token(asset)`. */
  async checkRwaToken(asset: string): Promise<{ answer: DemoAssetAnswer; text: string }> {
    const { text, structured } = await this.call('check_rwa_token', { asset });
    return { answer: readAssetAnswer(structured, 'check_rwa_token'), text };
  }

  /** `preflight_trade(asset, side, size_usd)`. */
  async preflightTrade(
    asset: string,
    side: OrderSide,
    sizeUsd: number,
  ): Promise<{ answer: DemoTradeAnswer; text: string }> {
    const { text, structured } = await this.call('preflight_trade', { asset, side, size_usd: sizeUsd });
    return { answer: readTradeAnswer(structured), text };
  }

  /** `explain(check_id)` — the plain-English half, for the line the agent adds to its refusal. */
  async explain(checkId: string): Promise<string> {
    const { text } = await this.call('explain', { check_id: checkId });
    return text;
  }
}
