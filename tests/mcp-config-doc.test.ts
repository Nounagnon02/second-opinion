/**
 * The MCP configuration the README hands to a host (T5.2), which is the second half of acceptance criterion 3 of the
 * specification: "the MCP server works in Claude Desktop or Claude Code with the example configuration provided".
 *
 * A configuration example is worth what a host makes of it, so nothing here paraphrases the README: the JSON blocks
 * are parsed out of it and the server is launched from them — the real built entry point, a real pipe, the SDK's own
 * client at the other end, started from a directory that is not this one so that the absolute paths have to stand on
 * their own. The offline block is driven all the way to a verdict; the live block is driven as far as a host without
 * a key gets, which is the handshake, the four tools and `explain`.
 *
 * Nothing reaches the network. The offline block replays `fixtures/check`, `explain` reads no market data, and every
 * spawned process is given an empty `CMC_API_KEY` — which takes precedence over the `.env` of this clone — so that a
 * tool that reads the API fails on the missing key instead of spending a credit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHECK_IDS, CHECK_TITLES } from '../src/checks/model.js';
import { REGISTERED_TOOLS, SERVER_NAME, SERVER_VERSION } from '../src/mcp/server.js';
import { isRecord } from '../src/normalize/values.js';
import { CHECK_FIXTURES } from './helpers/check-fixtures.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');

/** The path a reader replaces with their own clone. These tests put this clone in its place. */
const PLACEHOLDER = '/absolute/path/to/second-opinion';

/** The built entry point a host launches, relative to the project. */
const ENTRY = 'dist/mcp/server.js';

const PACKAGE = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const CALIBRATION = JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as {
  summary: { actShare: number; targetShare: number; verdicts: Record<string, number> };
};

/** The server is launched from the README, so the README's first instruction — build it — runs first. */
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'pipe', timeout: 300_000 });
}, 300_000);

interface DocumentedServer {
  /** Which fenced block of the README it came from, for a failure that has to be found again. */
  block: number;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

function string(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string in the README configuration.`);
  return value;
}

/** Every fenced ```json block of the README, parsed. A block that is not JSON fails here, which is the point. */
function jsonBlocks(): unknown[] {
  return [...README.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match, index) => {
    try {
      return JSON.parse(match[1] ?? '') as unknown;
    } catch (cause) {
      throw new Error(`JSON block ${index + 1} of the README does not parse.`, { cause });
    }
  });
}

/** Every server the README declares, in the order the blocks declare them. */
function documentedServers(): DocumentedServer[] {
  const servers: DocumentedServer[] = [];
  for (const [index, parsed] of jsonBlocks().entries()) {
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) continue;
    for (const [name, entry] of Object.entries(parsed.mcpServers)) {
      if (!isRecord(entry)) throw new Error(`README block ${index + 1}: server ${name} is not an object.`);
      const args = Array.isArray(entry.args) ? entry.args : [];
      const env = isRecord(entry.env) ? entry.env : {};
      servers.push({
        block: index + 1,
        name,
        command: string(entry.command, `block ${index + 1}, ${name}.command`),
        args: args.map((arg, position) => string(arg, `block ${index + 1}, ${name}.args[${position}]`)),
        env: Object.fromEntries(
          Object.entries(env).map(([key, value]) => [key, string(value, `block ${index + 1}, ${name}.env.${key}`)]),
        ),
      });
    }
  }
  return servers;
}

const servers = documentedServers();

/** The replay directory a block carries, once the placeholder is replaced by this clone. */
function replayDir(server: DocumentedServer): string | undefined {
  for (const arg of server.args) {
    const match = /^--replay=(.+)$/.exec(arg.replaceAll(PLACEHOLDER, projectRoot));
    if (match) return match[1];
  }
  return undefined;
}

const liveBlock = servers.find((server) => replayDir(server) === undefined);
const offlineBlock = servers.find((server) => replayDir(server) !== undefined);

/** The block, with the reader's path put in — exactly what a host would spawn. */
function spawnable(server: DocumentedServer): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: server.command,
    args: server.args.map((arg) => arg.replaceAll(PLACEHOLDER, projectRoot)),
    // PATH so that `node` is found; the empty key is the safety belt described in the header.
    env: { PATH: process.env.PATH ?? '', CMC_API_KEY: '' },
  };
}

const open: Client[] = [];
afterEach(async () => {
  for (const client of open.splice(0)) await client.close();
});

interface Host {
  client: Client;
  /** What the server wrote to stderr, which is where a stdio server puts everything it has to say. */
  log: () => string;
}

/** Launches one documented block and connects to it over a real pipe. */
async function launch(server: DocumentedServer): Promise<Host> {
  const transport = new StdioClientTransport({
    ...spawnable(server),
    // A host's own working directory, never this one.
    cwd: tmpdir(),
    stderr: 'pipe',
  });
  let log = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  const client = new Client({ name: 'second-opinion-readme-host', version: '0.0.0' });
  open.push(client);
  await client.connect(transport);
  return { client, log: () => log };
}

/** One tool call, text half and structured half apart. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; structured: Record<string, unknown> | undefined; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n');
  return {
    text,
    structured: result.structuredContent as Record<string, unknown> | undefined,
    isError: result.isError === true,
  };
}

describe('what the README declares', () => {
  it('declares at least one live block and one offline block', () => {
    expect(servers.length).toBeGreaterThanOrEqual(2);
    expect(liveBlock, 'no block without a --replay flag').toBeDefined();
    expect(offlineBlock, 'no block with a --replay flag').toBeDefined();
  });

  it('names every server as the server names itself', () => {
    expect(servers.map((server) => server.name)).toEqual(servers.map(() => SERVER_NAME));
  });

  it('launches node on the built entry point, never npm, whose banner would corrupt the stream', () => {
    for (const server of servers) {
      expect(server.command, `block ${server.block}`).toBe('node');
      expect(server.args[0], `block ${server.block}`).toBe(`${PLACEHOLDER}/${ENTRY}`);
      expect(server.args.join(' ')).not.toContain('npm');
    }
  });

  it('points at the entry point the mcp script runs, so the two cannot drift apart', () => {
    expect(PACKAGE.scripts.mcp).toContain(ENTRY);
  });

  it('leaves every path of the clone to the reader, and absolute', () => {
    for (const server of servers) {
      for (const arg of server.args) {
        const path = arg.startsWith('--') ? (arg.split('=')[1] ?? '') : arg;
        expect(path, `block ${server.block}: ${arg}`).toContain(PLACEHOLDER);
        expect(path.startsWith('/'), `block ${server.block}: ${arg} is not absolute`).toBe(true);
      }
    }
  });

  it('names only variables .env.example documents, and no key of its own', () => {
    const example = readFileSync(join(projectRoot, '.env.example'), 'utf8');
    for (const server of servers) {
      for (const [key, value] of Object.entries(server.env)) {
        expect(example, `block ${server.block}: ${key}`).toContain(`${key}=`);
        // A placeholder, never something that could be taken for a key: 32 hexadecimal digits with dashes is what
        // CMC issues.
        expect(value).not.toMatch(/^[0-9a-f-]{20,}$/i);
      }
    }
  });

  it('replays the directory the recorded check runs were written to', () => {
    const dir = offlineBlock === undefined ? '' : replayDir(offlineBlock);
    expect(dir).toBe(CHECK_FIXTURES);
    expect(existsSync(CHECK_FIXTURES)).toBe(true);
    expect(readdirSync(CHECK_FIXTURES).filter((name) => name.endsWith('.json')).length).toBeGreaterThan(0);
  });

  it('adds the same command through the Claude Code CLI', () => {
    const line = /^claude mcp add (.+)$/m.exec(README)?.[1] ?? '';
    expect(line).toContain(`${SERVER_NAME} `);
    expect(line).toContain('-e CMC_API_KEY=');
    expect(line).toContain(`-- node ${PLACEHOLDER}/${ENTRY}`);
  });

  it('builds the entry point it points at', () => {
    expect(existsSync(join(projectRoot, ENTRY))).toBe(true);
    expect(README).toContain('npm run build');
  });
});

describe('the live block, launched exactly as the README writes it', () => {
  it('completes the handshake and names the server and its version', async () => {
    if (liveBlock === undefined) throw new Error('no live block');
    const { client } = await launch(liveBlock);
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
  }, 30_000);

  it('lists the four tools a host shows', async () => {
    if (liveBlock === undefined) throw new Error('no live block');
    const { client } = await launch(liveBlock);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...REGISTERED_TOOLS].sort());
  }, 30_000);

  it('answers explain with no key at all', async () => {
    if (liveBlock === undefined) throw new Error('no live block');
    const { client } = await launch(liveBlock);
    const { text, isError } = await call(client, 'explain', { check_id: 'C1' });
    expect(isError).toBe(false);
    expect(text).toContain(CHECK_TITLES.C1);
  }, 30_000);

  it('reports a missing key on the tool that needed it rather than failing to come up', async () => {
    if (liveBlock === undefined) throw new Error('no live block');
    const { client } = await launch(liveBlock);
    const { text, isError } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(isError).toBe(true);
    expect(text).toContain('CMC_API_KEY');
  }, 30_000);

  it('says on stderr which mode it came up in, and writes nothing else anywhere', async () => {
    if (liveBlock === undefined) throw new Error('no live block');
    const { client, log } = await launch(liveBlock);
    await client.listTools();
    expect(log()).toContain('live mode');
    expect(log()).toContain(`${SERVER_NAME} ${SERVER_VERSION}`);
  }, 30_000);
});

describe('the offline block, launched exactly as the README writes it', () => {
  it('reaches a verdict for PAXG with no key and no network', async () => {
    if (offlineBlock === undefined) throw new Error('no offline block');
    const { client } = await launch(offlineBlock);
    const { text, structured, isError } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(isError).toBe(false);
    expect(['ACT', 'CAUTION', 'DO_NOT_ACT']).toContain(structured?.verdict);
    expect(text).toContain('PAXG');
  }, 30_000);

  it('cites the recorded answers it read', async () => {
    if (offlineBlock === undefined) throw new Error('no offline block');
    const { client } = await launch(offlineBlock);
    const { text } = await call(client, 'check_asset', { asset: 'PAXG' });
    expect(text).toContain('fixtures/check/');
  }, 30_000);

  it('covers BTC too, the second run those fixtures hold', async () => {
    if (offlineBlock === undefined) throw new Error('no offline block');
    const { client } = await launch(offlineBlock);
    const { isError, structured } = await call(client, 'check_asset', { asset: 'BTC' });
    expect(isError).toBe(false);
    expect(['ACT', 'CAUTION', 'DO_NOT_ACT']).toContain(structured?.verdict);
  }, 30_000);

  it('says on stderr that it came up in replay mode', async () => {
    if (offlineBlock === undefined) throw new Error('no offline block');
    const { client, log } = await launch(offlineBlock);
    await client.listTools();
    expect(log()).toContain('replay mode');
  }, 30_000);
});

describe('why the README sends a host to node and not to npm run mcp', () => {
  it('npm prints its own banner on stdout, where the JSON-RPC stream lives', () => {
    // npm hands its own `--silent` down to a child npm run through npm_config_loglevel, so a suite started with
    // `npm run -s test` — which is how scripts/presubmit.sh runs it — would read an empty stdout as npm printing
    // no banner at all, and this test would pass or fail on how the suite was invoked rather than on npm. What is
    // under test is npm's default verbosity, the one a host running `npm run mcp` meets, so an inherited level is
    // dropped instead of passed on.
    const env: NodeJS.ProcessEnv = { ...process.env, CMC_API_KEY: '' };
    delete env.npm_config_loglevel;
    delete env.npm_config_silent;

    const stdout = execFileSync('npm', ['run', 'mcp'], {
      cwd: projectRoot,
      // Closing stdin at once is what makes the server exit instead of waiting for a host.
      input: '',
      encoding: 'utf8',
      // stderr piped as well: the server's own log line belongs to the host, not to this test's output.
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      timeout: 120_000,
    });
    // npm opens with a blank line, then the banner: the first thing a host would try to parse as a frame.
    const banner = stdout.split('\n').find((line) => line.trim() !== '') ?? '';
    expect(banner).toMatch(/^> /);
    expect(() => JSON.parse(banner) as unknown, 'the banner is not a JSON-RPC frame').toThrow();
    expect(README).toContain('not `npm run mcp`');
  }, 120_000);
});

describe('the rest of the README says what the code and the measurements say', () => {
  /** The tool table: rows whose first cell is a backticked name. */
  function documentedTools(): string[] {
    return [...README.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1] ?? '');
  }

  /** The check table: `| C1 | title |`. */
  function documentedChecks(): Record<string, string> {
    const rows = [...README.matchAll(/^\| (C\d) \| (.+?) \|$/gm)];
    return Object.fromEntries(rows.map((match) => [match[1] ?? '', match[2] ?? '']));
  }

  it('lists exactly the tools the server registers', () => {
    expect(documentedTools().sort()).toEqual([...REGISTERED_TOOLS].sort());
  });

  it('lists the seven checks with the titles the engine gives them', () => {
    const documented = documentedChecks();
    expect(Object.keys(documented)).toEqual([...CHECK_IDS]);
    for (const id of CHECK_IDS) expect(documented[id]).toBe(CHECK_TITLES[id]);
  });

  it('quotes the calibration share docs/calibration.json carries', () => {
    const { actShare, targetShare, verdicts } = CALIBRATION.summary;
    expect(README).toContain(`**${actShare} % reach \`ACT\`**`);
    expect(README).toContain(`${targetShare} %`);
    // Three assets below ACT, written out in the prose: a different count has to be rewritten there.
    expect(verdicts.CAUTION).toBe(3);
    expect(README).toContain('three assets stay below it');
  });

  it('mentions only npm scripts package.json defines', () => {
    const mentioned = new Set([...README.matchAll(/npm run ([a-z:]+)/g)].map((match) => match[1] ?? ''));
    expect(mentioned.size).toBeGreaterThan(3);
    for (const script of mentioned) expect(PACKAGE.scripts, script).toHaveProperty(script);
  });
});
