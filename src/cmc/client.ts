/**
 * The single CMC API client (specification F2): API key from the environment, typed errors, retries with
 * exponential backoff, local cache with a TTL per endpoint class, credit counter and per-run ceiling.
 * Only the verified endpoints of `ENDPOINTS` can be called. The network goes through a `Transport`, so that tests
 * and the replay mode never open a connection (see mode.ts for the record and replay transports).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { FileCache, MemoryCache, type ResponseCache, type StoredResponse } from './cache.js';
import { DEFAULTS, loadClientConfig, type ClientConfig } from './config.js';
import { CreditMeter, type CreditUsage } from './credits.js';
import { ENDPOINTS, type CacheClass, type EndpointId, type EndpointSpec } from './endpoints.js';
import { CmcError, isRetryable } from './errors.js';
import { KEY_HEADER, MASK, parseBody, type FixtureRef } from './fixtures.js';
import { parseKeyInfo, type KeyInfo } from './key-info.js';
import { parseStatus, type CmcStatus } from './status.js';

export { KEY_HEADER };

export interface TransportRequest {
  url: URL;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
  /** Set by the record and replay transports: the fixture that holds this answer. */
  fixture?: FixtureRef;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** The real network, through `fetch`. Cookies are dropped: nothing in the API needs them. */
export const fetchTransport: Transport = async ({ url, headers, signal }) => {
  const response = await fetch(url, { headers, signal });
  const text = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') responseHeaders[name] = value;
  });
  return { status: response.status, statusText: response.statusText, headers: responseHeaders, text };
};

export type Query = Readonly<Record<string, string | number | boolean>>;

export interface CmcResponse extends StoredResponse {
  endpoint: EndpointId;
  /** The query as sent, sorted by name. */
  query: Record<string, string>;
  status: CmcStatus;
  /** `body.data`. Its shape depends on the endpoint; the normalisers (T2.3) read it. */
  data: unknown;
  /** Network attempts made for this answer; 0 when it came from the cache. */
  attempts: number;
  fromCache: boolean;
}

export interface CmcClientOptions extends Partial<Omit<ClientConfig, 'apiKey' | 'cacheDir'>> {
  apiKey: string;
  /** Backoff before retry n: between half and all of min(max, base × 2^(n-1)) milliseconds. */
  retryDelayMs?: { base: number; max: number };
  /** In memory by default; `createClientFromEnv` uses the file cache. */
  cache?: ResponseCache;
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Local clock, epoch milliseconds: cache expiry and `receivedAt` only, never data freshness (D4). */
  now?: () => number;
}

export class CmcClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly ttlSeconds: { market: number; static: number };
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: { base: number; max: number };
  private readonly cache: ResponseCache;
  private readonly transport: Transport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly meter: CreditMeter;

  constructor(options: CmcClientOptions) {
    if (options.apiKey.trim() === '') throw new CmcError('config', 'The CMC API key is empty.');
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? DEFAULTS.baseUrl;
    this.ttlSeconds = options.cacheTtlSeconds ?? DEFAULTS.cacheTtlSeconds;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.retryDelayMs = options.retryDelayMs ?? { base: 500, max: 4_000 };
    this.cache = options.cache ?? new MemoryCache();
    this.transport = options.transport ?? fetchTransport;
    this.sleep = options.sleep ?? ((ms) => delay(ms));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.meter = new CreditMeter(options.creditBudget ?? DEFAULTS.creditBudget);
  }

  /** Credits of this run so far. */
  credits(): CreditUsage {
    return this.meter.usage();
  }

  /** Plan and account-wide usage of the key (E20, 0 credit, never cached). */
  async keyInfo(): Promise<KeyInfo> {
    return parseKeyInfo((await this.get('E20')).data);
  }

  /** Calls a verified endpoint, from the cache when a fresh entry exists. Throws a CmcError on failure. */
  async get(endpoint: EndpointId, query: Query = {}): Promise<CmcResponse> {
    const spec: EndpointSpec = ENDPOINTS[endpoint];
    const sorted = Object.fromEntries(
      Object.entries(query)
        .map(([name, value]): [string, string] => [name, String(value)])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const url = new URL(spec.path, this.baseUrl);
    for (const [name, value] of Object.entries(sorted)) url.searchParams.set(name, value);
    const cacheKey = url.toString();
    const ttlMs = this.ttlMs(spec.cache);

    if (ttlMs > 0) {
      const hit = this.cache.get(cacheKey);
      const status = hit && this.now() - hit.storedAt <= ttlMs ? parseStatus(hit.response.body) : undefined;
      if (hit && status) return this.answer(endpoint, sorted, hit.response, status, 0, true);
    }

    for (let attempt = 1; ; attempt += 1) {
      let reservation;
      try {
        reservation = this.meter.reserve(endpoint, spec.credits);
      } catch (error) {
        throw error instanceof CmcError ? error.withAttempts(attempt - 1) : error;
      }
      let reported: number | null = null;
      let sent = true;
      try {
        const { response, status } = await this.send(endpoint, url);
        reported = status.creditCount;
        if (ttlMs > 0) this.store(cacheKey, response);
        return this.answer(endpoint, sorted, response, status, attempt, false);
      } catch (error) {
        const failure =
          error instanceof CmcError
            ? error
            : new CmcError('network', `${endpoint} ${spec.path}: ${this.describe(error)}`, { endpoint, retryable: true });
        reported = failure.status?.creditCount ?? null;
        sent = failure.kind !== 'replay_miss';
        if (!sent) throw failure.withAttempts(attempt - 1);
        if (!failure.retryable || attempt > this.maxRetries) throw failure.withAttempts(attempt);
      } finally {
        if (sent) this.meter.settle(reservation, reported);
        else this.meter.release(reservation);
      }
      await this.sleep(this.backoffMs(attempt));
    }
  }

  private ttlMs(cacheClass: CacheClass): number {
    return cacheClass === 'none' ? 0 : this.ttlSeconds[cacheClass] * 1000;
  }

  private store(cacheKey: string, response: StoredResponse): void {
    try {
      this.cache.set(cacheKey, { storedAt: this.now(), response });
    } catch {
      // The answer is already paid for and valid: a cache that cannot be written only costs a later call.
    }
  }

  private backoffMs(attempt: number): number {
    const ceiling = Math.min(this.retryDelayMs.max, this.retryDelayMs.base * 2 ** (attempt - 1));
    return Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
  }

  /** Error text for messages, with the key masked in case a lower layer ever echoed it. */
  private describe(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.cause instanceof Error) text += ` (${error.cause.message})`;
    return text.replaceAll(this.apiKey, MASK);
  }

  /** One attempt: the request, the timeout, and the reading of the answer. */
  private async send(endpoint: EndpointId, url: URL): Promise<{ response: StoredResponse; status: CmcStatus }> {
    const where = `${endpoint} ${url.pathname}`;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CmcError('timeout', `${where}: no answer within ${this.timeoutMs} ms.`, { endpoint, retryable: true }));
      }, this.timeoutMs);
    });

    const started = performance.now();
    let raw: TransportResponse;
    try {
      raw = await Promise.race([
        this.transport({
          url,
          headers: { Accept: 'application/json', [KEY_HEADER]: this.apiKey },
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof CmcError) throw error;
      throw new CmcError('network', `${where}: request failed: ${this.describe(error)}`, { endpoint, retryable: true });
    } finally {
      clearTimeout(timer);
    }

    const body = parseBody(raw.text);
    const status = parseStatus(body);
    // A recorded answer keeps the latency and the time of its recording, so that a replay reports the same values.
    const response: StoredResponse = {
      url: url.toString(),
      httpStatus: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
      body,
      latencyMs: raw.fixture?.latencyMs ?? Math.round(performance.now() - started),
      receivedAt: raw.fixture?.recordedAt ?? new Date(this.now()).toISOString(),
      ...(raw.fixture ? { fixture: raw.fixture } : {}),
    };

    if (raw.status >= 400 || (status !== undefined && status.errorCode !== 0)) {
      const detail = status
        ? `error_code ${status.errorCode}${status.errorMessage ? `: ${status.errorMessage}` : ''}`
        : 'no CMC status block';
      throw new CmcError('api', `${where}: HTTP ${raw.status}, ${detail}`, {
        endpoint,
        httpStatus: raw.status,
        ...(status ? { status } : {}),
        ...(raw.fixture ? { fixture: raw.fixture } : {}),
        retryable: isRetryable(raw.status, status?.errorCode),
      });
    }
    if (!status) {
      throw new CmcError('invalid_response', `${where}: HTTP ${raw.status} without a readable CMC status block.`, {
        endpoint,
        httpStatus: raw.status,
      });
    }
    return { response, status };
  }

  private answer(
    endpoint: EndpointId,
    query: Record<string, string>,
    response: StoredResponse,
    status: CmcStatus,
    attempts: number,
    fromCache: boolean,
  ): CmcResponse {
    const { body } = response;
    const data = typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : undefined;
    return { ...response, endpoint, query, status, data, attempts, fromCache };
  }
}

/** The client of a CLI run: settings from the environment, responses cached under `.cache/cmc`. */
export function createClientFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: Omit<CmcClientOptions, 'apiKey'> = {},
): CmcClient {
  const { cacheDir, ...config } = loadClientConfig(env);
  return new CmcClient({ ...config, cache: new FileCache(cacheDir), ...overrides });
}
