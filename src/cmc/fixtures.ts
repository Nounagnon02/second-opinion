/**
 * Raw CMC API exchanges saved under fixtures/, with the API key masked.
 * They are the test input of the replay mode and the evidence behind every audit finding.
 */
import { isAbsolute, relative, sep } from 'node:path';
import { PROJECT_ROOT } from './config.js';

export const MASK = '***';

/** The request header that carries the API key. */
export const KEY_HEADER = 'X-CMC_PRO_API_KEY';

/** Shortest secret we agree to mask: a shorter one could also hide unrelated text. */
export const MIN_SECRET_LENGTH = 16;

export interface RecordedExchange {
  label: string;
  recordedAt: string;
  request: {
    method: 'GET';
    url: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
  };
  response: {
    status: number;
    statusText: string;
    latencyMs: number;
    headers: Record<string, string>;
    /** Parsed JSON when the body is JSON, the raw text otherwise. */
    body: unknown;
  };
}

/** Where an answer was recorded: the evidence a check or a finding cites. */
export interface FixtureRef {
  /** Relative to the project root (`fixtures/...`) when the fixture is inside it, absolute otherwise. */
  file: string;
  recordedAt: string;
  latencyMs: number;
}

/** Replaces every occurrence of `secret` in `text` with the mask. */
export function maskSecret(text: string, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Refusing to mask a secret shorter than ${MIN_SECRET_LENGTH} characters.`);
  }
  return text.replaceAll(secret, MASK);
}

/** Serializes an exchange for fixtures/: indented JSON, the secret masked everywhere, final newline. */
export function serializeExchange(exchange: RecordedExchange, secret: string): string {
  return `${maskSecret(JSON.stringify(exchange, null, 2), secret)}\n`;
}

/** The exchange of one GET request and its answer, with the key header masked. */
export function toExchange(
  label: string,
  recordedAt: string,
  request: { url: URL; headers: Readonly<Record<string, string>> },
  response: RecordedExchange['response'],
): RecordedExchange {
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      name.toLowerCase() === KEY_HEADER.toLowerCase() ? MASK : value,
    ]),
  );
  return {
    label,
    recordedAt,
    request: {
      method: 'GET',
      url: request.url.toString(),
      path: request.url.pathname,
      query: Object.fromEntries(request.url.searchParams),
      headers,
    },
    response,
  };
}

/**
 * What identifies a request for replay: the API path and the query parameters, sorted. The host is left out, and
 * so is the order in which the parameters were written.
 */
export function requestKey(url: URL): string {
  const params = [...url.searchParams].sort(([a, aValue], [b, bValue]) =>
    a === b ? compare(aValue, bValue) : compare(a, b),
  );
  return `${url.pathname}?${new URLSearchParams(params).toString()}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The path to cite for a fixture file: `fixtures/...` inside the project, absolute outside it. */
export function evidencePath(file: string): string {
  const path = relative(PROJECT_ROOT, file);
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return file;
  return path.split(sep).join('/');
}

/** Parses a response body as JSON, falling back to the raw text (HTML error pages, empty bodies). */
export function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
