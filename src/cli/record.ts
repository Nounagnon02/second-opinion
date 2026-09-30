/**
 * Endpoint discovery (T1.2): records one raw CMC API exchange into fixtures/discovery/<label>.json, with the API
 * key masked. Unlike the client and its `--record` mode, it accepts any API path, so that an endpoint can be tried
 * before it is verified in docs/ENDPOINTS.md.
 * Usage: npm run record -- <label> <api path> [name=value ...]
 * One network call (and its credits) per run. An existing fixture is never overwritten.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchTransport } from '../cmc/client.js';
import { DEFAULT_FIXTURE_DIR, DEFAULTS } from '../cmc/config.js';
import { KEY_HEADER, parseBody, serializeExchange, toExchange } from '../cmc/fixtures.js';
import { parseQuery } from './args.js';

const TIMEOUT_MS = 20_000;
const FIXTURE_DIR = join(DEFAULT_FIXTURE_DIR, 'discovery');

export interface RecordArgs {
  label: string;
  path: string;
  query: Record<string, string>;
}

/** Validates `<label> <api path> [name=value ...]`; throws a usage error otherwise. */
export function parseRecordArgs(argv: readonly string[]): RecordArgs {
  const [label, path, ...params] = argv;
  if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error('Usage: record <label> <api path> [name=value ...]; label: letters, digits, ".", "_", "-".');
  }
  if (!path || !/^\/v\d+\/[a-z0-9/_-]+$/.test(path)) {
    throw new Error(`Invalid API path "${path ?? ''}": expected an absolute path such as /vN/category/name.`);
  }
  return { label, path, query: parseQuery(params) };
}

/** One-line summary of the CMC `status` block, which every documented response carries. */
function summarize(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('status' in body)) return 'no status block';
  const status = body.status as Record<string, unknown>;
  return ['error_code', 'error_message', 'credit_count', 'elapsed']
    .map((field) => `${field}=${JSON.stringify(status[field])}`)
    .join(', ');
}

async function main(): Promise<void> {
  const { label, path, query } = parseRecordArgs(process.argv.slice(2));
  const key = process.env.CMC_API_KEY ?? '';
  if (!key) throw new Error('CMC_API_KEY is not set: run through `npm run record`, which loads .env.');
  const target = join(FIXTURE_DIR, `${label}.json`);
  if (existsSync(target)) throw new Error(`${target} already exists: pick another label.`);

  const url = new URL(path, process.env.CMC_BASE_URL || DEFAULTS.baseUrl);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const headers = { Accept: 'application/json', [KEY_HEADER]: key };

  const started = performance.now();
  const response = await fetchTransport({ url, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const latencyMs = Math.round(performance.now() - started);
  const body = parseBody(response.text);
  const exchange = toExchange(label, new Date().toISOString(), { url, headers }, {
    status: response.status,
    statusText: response.statusText,
    latencyMs,
    headers: response.headers,
    body,
  });

  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(target, serializeExchange(exchange, key), { flag: 'wx' });
  console.log(`${label}: HTTP ${response.status}, ${latencyMs} ms, ${summarize(body)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
