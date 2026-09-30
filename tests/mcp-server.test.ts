/**
 * The MCP server over the real protocol (T5.1), which is acceptance criterion 3 of the specification: "the MCP
 * server works in Claude Desktop or Claude Code with the example configuration provided".
 *
 * A host is not simulated here by hand: the SDK's own `Client` is connected to the server through a pair of linked
 * in-memory transports, so the handshake, the tool list and every call go through the same code a real host drives.
 * What the stdio transport adds on top of that is a pipe, and the one thing a pipe can break is stdout, which the
 * last group below guards by reading the source.
 *
 * Every call is offline, replayed from the answers the live `check` runs of 2026-09-25 recorded into `fixtures/check`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS } from '../src/checks/model.js';
import {
  createServer,
  REGISTERED_TOOLS,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  type ServerOptions,
} from '../src/mcp/server.js';
import { TOOL_NAMES } from '../src/mcp/tools.js';
import { CHECK_FIXTURES, paxosIndex } from './helpers/check-fixtures.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const config = loadChecksConfig();

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const closeable of open.splice(0)) await closeable.close();
});

/** A host talking to the server, both ends in this process. Replay mode by default: no key, no network. */
async function connect(options: ServerOptions = {}): Promise<Client> {
  const server = createServer({
    mode: { kind: 'replay', dir: CHECK_FIXTURES },
    env: {},
    config,
    assess: { wrapperIndex: paxosIndex() },
    ...options,
  });
  const client = new Client({ name: 'second-opinion-test-host', version: '0.0.0' });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  open.push(client, server);
  await Promise.all([client.connect(clientEnd), server.connect(serverEnd)]);
  return client;
}

/** One tool call, with the text half and the structured half of the answer separated. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; structured: Record<string, unknown> | undefined; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) => {
      if (typeof part !== 'object' || part === null || !('text' in part)) return '';
      return String(part.text);
    })
    .join('\n');
  return {
    text,
    structured: result.structuredContent as Record<string, unknown> | undefined,
    isError: result.isError === true,
  };
}

describe('the handshake a host makes', () => {
  it('names the server and its version', async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
  });

  it('tells the host what the server is for', async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('states it places no order, which is the one thing a trading host must be able to read up front', () => {
    expect(SERVER_INSTRUCTIONS).toContain('places no order');
  });

  it('is the version package.json declares, so a host never reports one that drifted', () => {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string };
    expect(SERVER_VERSION).toBe(manifest.version);
  });
});

describe('the tools a host lists', () => {
  it('is exactly the four of F6', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect([...REGISTERED_TOOLS]).toEqual([...TOOL_NAMES]);
  });

  it('describes each one well enough for a model to pick it without reading the code', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.title, `${tool.name} has no title`).toBeTruthy();
      expect((tool.description ?? '').length, `${tool.name} is thinly described`).toBeGreaterThan(120);
      expect(tool.annotations?.readOnlyHint, `${tool.name} is not marked read-only`).toBe(true);
    }
  });

  it('asks for the arguments the specification names, and marks them required', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
    expect(Object.keys(byName.get('check_asset')?.properties ?? {})).toEqual(['asset']);
    expect(Object.keys(byName.get('check_rwa_token')?.properties ?? {})).toEqual(['asset']);
    expect(Object.keys(byName.get('preflight_trade')?.properties ?? {}).sort()).toEqual(['asset', 'side', 'size_usd']);
    expect(Object.keys(byName.get('explain')?.properties ?? {})).toEqual(['check_id']);
    expect(byName.get('preflight_trade')?.required).toEqual(expect.arrayContaining(['asset', 'side', 'size_usd']));
  });

  it('constrains the side of an order to buy or sell in the schema itself', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const side = tools.find((tool) => tool.name === 'preflight_trade')?.inputSchema.properties?.side;
    expect(side).toMatchObject({ enum: ['buy', 'sell'] });
  });
});

describe('check_asset over the protocol', () => {
  it('answers with the verdict as text and as structured content', async () => {
    const client = await connect();
    const { text, structured, isError } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(isError).toBe(false);
    expect(text).toMatch(/^(ACT|CAUTION|DO_NOT_ACT) — PAXG/);
    expect(structured?.verdict).toBe(text.split(' —')[0]);
    expect(structured?.coverage).toMatchObject({ total: CHECK_IDS.length });
    expect(structured?.checks).toHaveLength(CHECK_IDS.length);
  });

  it('accepts a numeric CMC ID as well as a symbol', async () => {
    const client = await connect();
    const { structured, isError } = await call(client, 'check_asset', { asset: '4705' });
    expect(isError).toBe(false);
    expect(structured?.resolved).toMatchObject({ cmcId: 4705 });
  });

  it('carries the evidence into the structured half, so a host can cite it', async () => {
    const client = await connect();
    const { structured } = await call(client, 'check_asset', { asset: 'PAXG' });
    const evidence = structured?.evidence;
    expect(Array.isArray(evidence)).toBe(true);
    expect((evidence as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('check_rwa_token over the protocol', () => {
  it('details C5 for a wrapper the index links to a real-world asset', async () => {
    const client = await connect();
    const { text, structured, isError } = await call(client, 'check_rwa_token', { asset: 'PAXG' });
    expect(isError).toBe(false);
    expect(text).toContain('Wraps rwa_id');
    const checks = structured?.checks as { id: string; measurements: unknown }[];
    expect(checks.find((check) => check.id === 'C5')?.measurements).not.toBeNull();
  });
});

describe('preflight_trade over the protocol', () => {
  it('echoes the order and reports the share of the deepest pool it would take', async () => {
    const client = await connect();
    const { text, structured, isError } = await call(client, 'preflight_trade', {
      asset: 'PAXG',
      side: 'buy',
      size_usd: 250_000,
    });
    expect(isError).toBe(false);
    expect(text).toContain('Order weighed: buy 250000 USD');
    expect(structured?.order).toMatchObject({
      side: 'buy',
      sizeUsd: 250_000,
      warnAbovePercent: config.C4.warnOrderSharePercent,
      criticalAbovePercent: config.C4.criticalOrderSharePercent,
    });
  });

  it('refuses a size of 0 at the schema, naming the field, before any call is made', async () => {
    const client = await connect();
    const { text, isError, structured } = await call(client, 'preflight_trade', {
      asset: 'PAXG',
      side: 'buy',
      size_usd: 0,
    });
    // The schema refuses it before the handler runs, so there is no answer to structure — only the reason.
    expect(isError).toBe(true);
    expect(structured).toBeUndefined();
    expect(text).toContain('size_usd');
  });

  it('refuses a side that is not buy or sell, listing the two it accepts', async () => {
    const client = await connect();
    const { text, isError } = await call(client, 'preflight_trade', {
      asset: 'PAXG',
      side: 'hodl',
      size_usd: 100,
    });
    expect(isError).toBe(true);
    expect(text).toContain('side');
    expect(text).toContain('buy');
    expect(text).toContain('sell');
  });

  it('refuses a call with no asset at all, naming the argument it wanted', async () => {
    const client = await connect();
    const { text, isError } = await call(client, 'preflight_trade', { side: 'buy', size_usd: 100 });
    expect(isError).toBe(true);
    expect(text).toContain('asset');
  });
});

describe('explain over the protocol', () => {
  it('explains a check, and needs no key and no network to do it', async () => {
    const client = await connect({ mode: { kind: 'live' }, env: {} });
    const { text, structured, isError } = await call(client, 'explain', { check_id: 'C4' });
    expect(isError).toBe(false);
    expect(structured?.id).toBe('C4');
    expect(text).toContain('C4.warnOrderSharePercent');
  });

  it('explains all seven', async () => {
    const client = await connect();
    for (const id of CHECK_IDS) {
      const { structured, isError } = await call(client, 'explain', { check_id: id });
      expect(isError, `${id} could not be explained`).toBe(false);
      expect(structured?.id).toBe(id);
    }
  });

  it('answers an unknown identifier as a tool error, not as a broken server', async () => {
    const client = await connect();
    const { text, isError } = await call(client, 'explain', { check_id: 'C42' });
    expect(isError).toBe(true);
    expect(text).toContain('is not a check identifier');
  });
});

describe('a server that cannot reach the API', () => {
  it('still starts and still lists its four tools', async () => {
    const client = await connect({ mode: { kind: 'live' }, env: {} });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
  });

  it('reports the missing key on the tool that needed it, rather than failing to come up', async () => {
    const client = await connect({ mode: { kind: 'live' }, env: {} });
    const { text, isError } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(isError).toBe(true);
    expect(text).toContain('CMC_API_KEY');
  });

  it('keeps explain working while the asset tools cannot answer', async () => {
    const client = await connect({ mode: { kind: 'live' }, env: {} });
    expect((await call(client, 'check_asset', { asset: 'PAXG' })).isError).toBe(true);
    expect((await call(client, 'explain', { check_id: 'C1' })).isError).toBe(false);
  });

  it('names the directory when a replay run is pointed at one that is not there', async () => {
    const client = await connect({ mode: { kind: 'replay', dir: join(projectRoot, 'fixtures', 'nothing-here') } });
    const { text, isError } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(isError).toBe(true);
    expect(text).toContain('nothing-here');
  });
});

describe('the credit ceiling of a long-lived server', () => {
  it('counts credits per call, so the tenth call is answered like the first (F2)', async () => {
    const client = await connect();
    const first = await call(client, 'check_asset', { asset: 'PAXG' });
    for (let index = 0; index < 8; index += 1) await call(client, 'check_asset', { asset: 'PAXG' });
    const tenth = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(tenth.isError).toBe(false);
    expect(tenth.structured?.verdict).toBe(first.structured?.verdict);
    expect(tenth.structured?.credits).toEqual(first.structured?.credits);
  });
});

describe('stdout belongs to the protocol', () => {
  /** One module of `src/mcp`, comments stripped: only the code can write to a stream. */
  function code(name: string): string {
    return readFileSync(join(projectRoot, 'src', 'mcp', name), 'utf8').replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  }

  it('writes no diagnostic to stdout from the server, which would corrupt the JSON-RPC stream', () => {
    const source = code('server.ts');
    expect(source).not.toMatch(/console\.(log|info|debug|warn)\s*\(/);
    expect(source).not.toMatch(/process\.stdout/);
  });

  it('logs to stderr instead', () => {
    expect(code('server.ts')).toMatch(/console\.error\s*\(/);
  });

  it('holds for every other module of src/mcp, which write to no stream at all', () => {
    for (const name of ['tools.ts', 'explain.ts', 'index.ts']) {
      expect(code(name), `${name} writes to a stream`).not.toMatch(/console\.\w+\s*\(|process\.std(out|err)/);
    }
  });
});
