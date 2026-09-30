/**
 * The offline guarantee of T2.2: the whole suite runs without a network, so it is deterministic and costs no credit.
 * Two halves: `fetch` is disabled while the tests run (tests/setup/no-network.ts), and `fetch` is the only door
 * src/ has to the outside — everything else goes through a `Transport`, which record and replay mode substitute.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchTransport } from '../src/cmc/client.js';
import { NETWORK_DISABLED } from './setup/no-network.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const SRC = join(projectRoot, 'src');

/** The only file allowed to call `fetch`: it is the network transport the client is given. */
const NETWORK_FILE = 'src/cmc/client.ts';

/**
 * Other ways out: sockets, HTTP clients, browser APIs. None of them belongs in src/.
 *
 * A module name only opens a connection where it is imported, so the quoted names are anchored to the positions
 * that pull a module in — `from '…'`, `import '…'`, and any call, which covers `require('…')`, `import('…')` and
 * `createRequire(…)('…')`. Unanchored, the same word is matched wherever it is merely data: `kind: 'http'` names
 * a discriminant in src/audit/review.ts and reaches no network. Anchoring narrows the match to the one place
 * that matters rather than relaxing what counts as an offence.
 */
const OTHER_NETWORK_APIS =
  /(?<![\w$])(XMLHttpRequest|WebSocket|EventSource)\b|(?:\bfrom|\bimport|\()\s*['"](node:)?(http|https|http2|net|tls|dgram|undici|axios|node-fetch|got|superagent)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const sources = sourceFiles(SRC).map((file) => ({
  name: relative(projectRoot, file).split(sep).join('/'),
  // Line comments and block comments talk about fetch and about HTTP; only the code matters here.
  code: readFileSync(file, 'utf8').replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
}));

describe('tests run offline', () => {
  it('has sources to scan', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.map((source) => source.name)).toContain(NETWORK_FILE);
  });

  it('refuses a real fetch, naming the way out', async () => {
    await expect(fetch('https://pro-api.coinmarketcap.com/v1/key/info')).rejects.toThrow(NETWORK_DISABLED);
  });

  it('refuses the network transport itself, so a forgotten stub fails the test instead of spending credits', async () => {
    const request = {
      url: new URL('https://pro-api.coinmarketcap.com/v1/key/info'),
      headers: {},
      signal: AbortSignal.abort(),
    };
    await expect(fetchTransport(request)).rejects.toThrow(NETWORK_DISABLED);
  });

  it('calls fetch in the network transport only', () => {
    const callers = sources.filter((source) => /(?<![\w$.])fetch\s*\(/.test(source.code)).map((source) => source.name);
    expect(callers).toEqual([NETWORK_FILE]);
  });

  it('opens no other connection: no socket, no HTTP client, no browser API', () => {
    const offenders = sources.filter((source) => OTHER_NETWORK_APIS.test(source.code)).map((source) => source.name);
    expect(offenders).toEqual([]);
  });

  // The scan above passes both when src/ is clean and when the pattern stopped matching anything at all. These
  // two cases tell those apart, so a guarantee that quietly went blind fails here instead of staying green.
  it('still catches every way a connection is opened', () => {
    const ways = [
      "import { createServer } from 'node:http';",
      "import { request } from 'https';",
      "import net from 'net';",
      "import 'node:dgram';",
      "const { connect } = require('tls');",
      "const undici = await import('undici');",
      "createRequire(import.meta.url)('http2');",
      "import axios from 'axios';",
      "import got from 'got';",
      "const socket = new WebSocket(url);",
      "const source = new EventSource(url);",
      "const xhr = new XMLHttpRequest();",
    ];
    for (const way of ways) expect(OTHER_NETWORK_APIS.test(way)).toBe(true);
  });

  it('leaves a module name that is only data alone', () => {
    const data = [
      "case 'http':",
      "claims.push({ kind: 'http', status: 500 });",
      "type Claim = { kind: 'http'; status: number };",
      "const scheme = protocol === 'https' ? 443 : 80;",
      "const label = { net: 'net', tls: 'tls' };",
    ];
    for (const one of data) expect(OTHER_NETWORK_APIS.test(one)).toBe(false);
  });
});
