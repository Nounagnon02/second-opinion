/**
 * Record mode (specification F2): every answer the API gives to the client is also written to a fixture directory,
 * with the key masked, so that a later run can replay it offline and a check or a finding can cite it.
 * Errors answered by the API (HTTP 4xx / 5xx) are recorded too: a refusal is evidence as well. Timeouts and network
 * failures have no answer, so nothing is written for them. A fixture is never overwritten.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transport } from './client.js';
import { endpointForPath } from './endpoints.js';
import { CmcError } from './errors.js';
import {
  evidencePath,
  MIN_SECRET_LENGTH,
  parseBody,
  requestKey,
  serializeExchange,
  toExchange,
  type RecordedExchange,
} from './fixtures.js';
import { parseStatus } from './status.js';

export interface RecorderOptions {
  /** Directory of the new fixtures, created when missing. */
  dir: string;
  /** The API key, masked in every file. */
  secret: string;
  /** Local clock, epoch milliseconds: the `recordedAt` of each fixture. */
  now?: () => number;
}

/** `<endpoint ID>-<request hash>-<UTC time>`: the recordings of one request sort together, oldest first. */
export function fixtureLabel(url: URL, recordedAt: string): string {
  const hash = createHash('sha256').update(requestKey(url)).digest('hex').slice(0, 8);
  return `${endpointForPath(url.pathname) ?? 'X'}-${hash}-${recordedAt.replace(/[-:.]/g, '')}`;
}

/** Writes `<label>.json`, or `<label>-2.json` and so on when a parallel identical request took the name first. */
function writeNew(dir: string, label: string, text: (label: string) => string): string {
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? label : `${label}-${n}`;
    const file = join(dir, `${name}.json`);
    try {
      writeFileSync(file, text(name), { flag: 'wx' });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Wraps the network transport so that each answer is saved before the client reads it. */
export function recordingTransport(network: Transport, { dir, secret, now = Date.now }: RecorderOptions): Transport {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new CmcError(
      'config',
      `Record mode masks the API key in every fixture: a key shorter than ${MIN_SECRET_LENGTH} characters is refused.`,
    );
  }
  return async (request) => {
    const started = performance.now();
    const answer = await network(request);
    const latencyMs = Math.round(performance.now() - started);
    const recordedAt = new Date(now()).toISOString();
    const body = parseBody(answer.text);
    const response: RecordedExchange['response'] = {
      status: answer.status,
      statusText: answer.statusText,
      latencyMs,
      headers: answer.headers,
      body,
    };

    let file: string;
    try {
      file = writeNew(dir, fixtureLabel(request.url, recordedAt), (label) =>
        serializeExchange(toExchange(label, recordedAt, request, response), secret),
      );
    } catch (error) {
      // The call is paid for: its reported cost goes with the error, so the credit counter stays exact.
      const status = parseStatus(body);
      const endpoint = endpointForPath(request.url.pathname);
      throw new CmcError(
        'record',
        `${endpoint ?? 'unknown endpoint'} ${requestKey(request.url)}: the API answered HTTP ${answer.status} but ` +
          `the fixture could not be written in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
        { ...(endpoint ? { endpoint } : {}), httpStatus: answer.status, ...(status ? { status } : {}) },
      );
    }
    return { ...answer, fixture: { file: evidencePath(file), recordedAt, latencyMs } };
  };
}
