import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transport, TransportRequest, TransportResponse } from '../../src/cmc/client.js';
import type { RecordedExchange } from '../../src/cmc/fixtures.js';
import { projectRoot } from './endpoints-doc.js';

/** The response of a recorded fixture, as the transport would have received it. */
export function fixtureResponse(label: string): TransportResponse {
  const path = join(projectRoot, 'fixtures', 'discovery', `${label}.json`);
  const exchange = JSON.parse(readFileSync(path, 'utf8')) as RecordedExchange;
  const { status, statusText, headers, body } = exchange.response;
  return { status, statusText, headers, text: typeof body === 'string' ? body : JSON.stringify(body) };
}

export function jsonResponse(status: number, body: unknown): TransportResponse {
  return { status, statusText: '', headers: { 'content-type': 'application/json' }, text: JSON.stringify(body) };
}

/** A CMC `status` block in the string shape of observation 1. */
export function statusBlock(errorCode: number, errorMessage = '', creditCount = 0) {
  return {
    timestamp: '2026-09-24T16:04:00.000Z',
    error_code: String(errorCode),
    error_message: errorMessage,
    elapsed: 1,
    credit_count: creditCount,
  };
}

/** One scripted step: a response, an error thrown by the transport, or no answer at all. */
export type Step = TransportResponse | Error | 'hang';

/** A transport that plays `steps` in order (the last one repeats) and keeps every request it received. */
export function scriptedTransport(...steps: Step[]): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const transport = (request: TransportRequest): Promise<TransportResponse> => {
    requests.push(request);
    const step = steps[Math.min(requests.length, steps.length) - 1];
    if (step === undefined) return Promise.reject(new Error('No scripted step left.'));
    if (step === 'hang') return new Promise<never>(() => undefined);
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(step);
  };
  return Object.assign(transport, { requests });
}
