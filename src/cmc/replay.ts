/**
 * Replay mode (specification F2): the client's requests are answered from recorded fixtures, without any network.
 * A request matches a fixture when the API path and the query parameters are the same, whatever the host and the
 * parameter order (`requestKey`). Recorded refusals replay as refusals. When several fixtures match, the latest
 * recording wins (then the last file name), so that recording a request again supersedes the older fixture
 * without deleting it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Transport, TransportResponse } from './client.js';
import { endpointForPath } from './endpoints.js';
import { CmcError } from './errors.js';
import { evidencePath, requestKey, type FixtureRef, type RecordedExchange } from './fixtures.js';

interface Entry {
  ref: FixtureRef;
  response: RecordedExchange['response'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listJsonFiles(path);
      return entry.name.endsWith('.json') ? [path] : [];
    })
    .sort();
}

/** Reads one fixture file, or says why it is not a recorded exchange. */
function readExchange(file: string): RecordedExchange {
  const fail = (reason: string): never => {
    throw new CmcError('config', `${evidencePath(file)} is not a recorded exchange: ${reason}.`);
  };
  let exchange: unknown;
  try {
    exchange = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(exchange) || !isRecord(exchange.request) || !isRecord(exchange.response)) {
    return fail('no request or response object');
  }
  const { recordedAt, request, response } = exchange;
  if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) return fail('no valid recordedAt');
  if (typeof request.url !== 'string' || !URL.canParse(request.url)) return fail('no valid request.url');
  if (typeof response.status !== 'number' || typeof response.statusText !== 'string') {
    return fail('no response status');
  }
  if (typeof response.latencyMs !== 'number' || !isRecord(response.headers) || !('body' in response)) {
    return fail('no response latencyMs, headers or body');
  }
  return exchange as unknown as RecordedExchange;
}

/** The fixtures of a directory and its subdirectories, indexed by request. */
export class FixtureIndex {
  private constructor(
    readonly dir: string,
    private readonly entries: ReadonlyMap<string, Entry>,
    readonly files: number,
  ) {}

  static load(dir: string): FixtureIndex {
    let isDirectory = false;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch {
      // Reported just below.
    }
    if (!isDirectory) throw new CmcError('config', `Replay: fixture directory not found: ${dir}.`);

    const entries = new Map<string, Entry>();
    const files = listJsonFiles(dir);
    for (const file of files) {
      const { recordedAt, request, response } = readExchange(file);
      const key = requestKey(new URL(request.url));
      const current = entries.get(key);
      // Files come sorted by path, so on equal times the last file name wins.
      if (current && Date.parse(current.ref.recordedAt) > Date.parse(recordedAt)) continue;
      entries.set(key, { ref: { file: evidencePath(file), recordedAt, latencyMs: response.latencyMs }, response });
    }
    return new FixtureIndex(dir, entries, files.length);
  }

  /** Distinct requests that can be replayed. */
  get size(): number {
    return this.entries.size;
  }

  /** The recorded answer to a request, as the transport received it. */
  find(url: URL): TransportResponse | undefined {
    const entry = this.entries.get(requestKey(url));
    if (!entry) return undefined;
    const { status, statusText, headers, body } = entry.response;
    return {
      status,
      statusText,
      headers: { ...headers },
      text: typeof body === 'string' ? body : JSON.stringify(body),
      fixture: { ...entry.ref },
    };
  }
}

/** A transport that only answers from `index`; a request without a fixture fails with a `replay_miss` error. */
export function replayTransport(index: FixtureIndex): Transport {
  return ({ url }) => {
    const answer = index.find(url);
    if (answer) return Promise.resolve(answer);
    const endpoint = endpointForPath(url.pathname);
    return Promise.reject(
      new CmcError(
        'replay_miss',
        `${endpoint ?? 'unknown endpoint'} ${requestKey(url)}: no fixture recorded for this request in ` +
          `${evidencePath(index.dir)} (record it first with --record).`,
        endpoint ? { endpoint } : {},
      ),
    );
  };
}
