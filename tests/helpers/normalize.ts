import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EndpointId } from '../../src/cmc/endpoints.js';
import type { RecordedExchange } from '../../src/cmc/fixtures.js';
import { sourceFromBody, type SourceResponse } from '../../src/normalize/model.js';
import { projectRoot } from './endpoints-doc.js';

/**
 * A recorded discovery fixture, read as the input of a normaliser, with the evidence reference the checks cite.
 * Every normaliser test works from these real answers: no hand-written CMC body stands in for one.
 */
export function recordedSource(endpoint: EndpointId, label: string): SourceResponse {
  const file = join(projectRoot, 'fixtures', 'discovery', `${label}.json`);
  const exchange = JSON.parse(readFileSync(file, 'utf8')) as RecordedExchange;
  return sourceFromBody(endpoint, exchange.response.body, {
    file: `fixtures/discovery/${label}.json`,
    recordedAt: exchange.recordedAt,
    latencyMs: exchange.response.latencyMs,
  });
}

/** The same answer with one part of its `data` replaced, to test what a normaliser does with a damaged field. */
export function damaged(
  endpoint: EndpointId,
  label: string,
  edit: (data: Record<string, unknown> | unknown[]) => void,
): SourceResponse {
  const source = recordedSource(endpoint, label);
  const data = structuredClone(source.data) as Record<string, unknown> | unknown[];
  edit(data);
  return { ...source, data };
}
