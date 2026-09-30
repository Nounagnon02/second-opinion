/**
 * Calls one verified CMC endpoint through the client and prints what came back: the way to record or replay a
 * single call, until the `check` and `audit` commands use the same modes.
 * Usage: npm run call -- <endpoint ID> [name=value ...] [--record[=dir] | --replay[=dir]] [--data]
 *   no mode flag  live call, through the local cache (.cache/cmc); needs CMC_API_KEY;
 *   --record      live call, the answer also written to fixtures/recorded (or dir), key masked; needs CMC_API_KEY;
 *   --replay      answer read from fixtures/ (or dir): no network, no key;
 *   --data        also prints the `data` field of the answer, as JSON.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CmcResponse } from '../cmc/client.js';
import { PROJECT_ROOT } from '../cmc/config.js';
import { ENDPOINTS, type EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type ModeOverrides, type RunMode } from '../cmc/mode.js';
import { describeCredits, parseQuery } from './args.js';

export interface CallArgs {
  endpoint: EndpointId;
  query: Record<string, string>;
  mode: RunMode;
  printData: boolean;
}

function isEndpointId(value: string): value is EndpointId {
  return Object.hasOwn(ENDPOINTS, value);
}

/** Validates the command line; throws a usage error otherwise. */
export function parseCallArgs(argv: readonly string[], cwd = process.cwd()): CallArgs {
  const { mode, args } = parseRunMode(argv, cwd);
  const printData = args.includes('--data');
  const [endpoint, ...params] = args.filter((arg) => arg !== '--data');
  if (!endpoint || !isEndpointId(endpoint)) {
    throw new Error(
      'Usage: call <endpoint ID> [name=value ...] [--record[=dir] | --replay[=dir]] [--data]; ' +
        `endpoint ID: one of the verified endpoints ${Object.keys(ENDPOINTS).join(', ')} (docs/ENDPOINTS.md).`,
    );
  }
  return { endpoint, query: parseQuery(params), mode, printData };
}

function origin(response: CmcResponse, mode: RunMode): string {
  if (response.fromCache) return 'from the local cache';
  if (!response.fixture) return 'live';
  return `${mode.kind === 'replay' ? 'replayed from' : 'recorded in'} ${response.fixture.file}`;
}

/** One line: what answered, what it cost and where it comes from. */
export function describeResponse(response: CmcResponse, mode: RunMode): string {
  const { status } = response;
  return (
    `${response.endpoint}: HTTP ${response.httpStatus}, error_code ${status.errorCode}, ` +
    `${status.creditCount ?? 'unknown'} credit(s), status.timestamp ${status.timestamp}, ${response.latencyMs} ms, ` +
    origin(response, mode)
  );
}

/** Runs the call. A CMC failure is reported in the lines, with the fixture that proves it when there is one. */
export async function runCall(
  args: CallArgs,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ModeOverrides = {},
): Promise<{ ok: boolean; lines: string[] }> {
  const client = createClientForMode(args.mode, env, overrides);
  try {
    const response = await client.get(args.endpoint, args.query);
    const lines = [describeResponse(response, args.mode)];
    if (args.printData) lines.push(JSON.stringify(response.data, null, 2));
    return { ok: true, lines: [...lines, describeCredits(client.credits())] };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    const lines = [`❌ ${error.message}`];
    if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
    return { ok: false, lines: [...lines, describeCredits(client.credits())] };
  }
}

async function main(): Promise<void> {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { ok, lines } = await runCall(parseCallArgs(process.argv.slice(2)));
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
