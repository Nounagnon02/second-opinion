/**
 * The two `check` runs recorded live on 2026-09-25 (T3.7), and what a test needs to replay them offline:
 * - **PAXG** goes through the whole plan of D1 — E01, then E02, E06, E05 and E14 in parallel, then E10 and E11 on
 *   the contract E05 gave — so it exercises every check that can run with this key;
 * - **BTC** is a coin: E05 lists no token contract for it and the index links it to no real-world asset, so it
 *   exercises the skipping side of D9, where a check reports why it did not run.
 *
 * Every body here is a real answer, with the key masked at recording time. Nothing writes a CMC payload by hand.
 */
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transport, TransportResponse } from '../../src/cmc/client.js';
import { endpointForPath, type EndpointId } from '../../src/cmc/endpoints.js';
import { CmcError } from '../../src/cmc/errors.js';
import { requestKey, type RecordedExchange } from '../../src/cmc/fixtures.js';
import { normalizeRwaIssuer } from '../../src/normalize/rwa.js';
import { entriesOfIssuer, type WrapperIndex } from '../../src/rwa/wrapper-index.js';
import { projectRoot } from './endpoints-doc.js';
import { recordedSource } from './normalize.js';

/** Where the recorded `check` answers live: the directory a replay run is pointed at. */
export const CHECK_FIXTURES = join(projectRoot, 'fixtures', 'check');

/** The asset each recorded run was about, named by the identifier its calls carry. */
export const PAXG_ID = 4705;
export const BTC_ID = 1;

interface RecordedCall {
  file: string;
  name: string;
  url: URL;
  endpoint: EndpointId | undefined;
  response: RecordedExchange['response'];
}

/** Every recorded `check` answer, with the request it answers. */
function recordedCalls(): RecordedCall[] {
  return readdirSync(CHECK_FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = join(CHECK_FIXTURES, name);
      const { request, response } = JSON.parse(readFileSync(file, 'utf8')) as RecordedExchange;
      const url = new URL(request.url);
      return { file, name, url, endpoint: endpointForPath(url.pathname), response };
    });
}

/**
 * Copies the recorded answers into `dir`, leaving out those of the endpoints named. A replay run pointed at the
 * result meets a `replay_miss` on exactly those endpoints, which is how a call that brings nothing back is
 * exercised without touching the network.
 */
export function copyCheckFixtures(dir: string, without: readonly EndpointId[] = []): number {
  let copied = 0;
  for (const call of recordedCalls()) {
    if (call.endpoint !== undefined && without.includes(call.endpoint)) continue;
    copyFileSync(call.file, join(dir, call.name));
    copied += 1;
  }
  return copied;
}

/**
 * Copies the recorded answers into `dir`, passing the body of every answer from `endpoint` through `edit` on the
 * way. A replay run pointed at the result reads a real answer with one field gone, which is how a field the
 * verdict needs but could not read is exercised without writing a CMC body by hand.
 *
 * Returns how many answers were edited, so a case cannot pass on an endpoint the recorded run never called.
 */
export function copyCheckFixturesEditing(
  dir: string,
  endpoint: EndpointId,
  edit: (body: Record<string, unknown>) => void,
): number {
  let edited = 0;
  for (const call of recordedCalls()) {
    if (call.endpoint !== endpoint) {
      copyFileSync(call.file, join(dir, call.name));
      continue;
    }
    const exchange = JSON.parse(readFileSync(call.file, 'utf8')) as RecordedExchange;
    edit(exchange.response.body as Record<string, unknown>);
    writeFileSync(join(dir, call.name), `${JSON.stringify(exchange, null, 2)}\n`);
    edited += 1;
  }
  return edited;
}

/**
 * A network that answers from the recorded `check` fixtures. Live and record modes read the network, so this is how
 * a run in either one is exercised offline; unlike replay it hands back no fixture reference, exactly as the API
 * would not.
 */
export function recordedCheckNetwork(): Transport & { requests: URL[] } {
  const answers = new Map<string, TransportResponse>();
  for (const { url, response } of recordedCalls()) {
    const { status, statusText, headers, body } = response;
    answers.set(requestKey(url), {
      status,
      statusText,
      headers: { ...headers },
      text: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }
  const requests: URL[] = [];
  const transport: Transport = ({ url }) => {
    requests.push(url);
    const answer = answers.get(requestKey(url));
    if (!answer) {
      return Promise.reject(new CmcError('replay_miss', `No recorded check answer for ${requestKey(url)}.`));
    }
    return Promise.resolve({ ...answer, headers: { ...answer.headers } });
  };
  return Object.assign(transport, { requests });
}

/**
 * The token to real-world-asset index the recorded PAXG run was read with, built from the one recorded issuer page
 * that links it: Paxos, and PAX Gold under it as `crypto_id` 4705 with `rwa_id` 1 (D6). Passing it explicitly keeps
 * these tests off the cache under `.cache/`, which a clean clone does not have.
 */
export function paxosIndex(): WrapperIndex {
  const answer = normalizeRwaIssuer(recordedSource('E19', 'E19-rwa-issuer-paxos'));
  const [issuer] = answer.items;
  if (issuer === undefined) throw new Error('the recorded Paxos answer carries no issuer.');
  const counted = entriesOfIssuer(issuer);
  return {
    builtAt: answer.source.observedAt,
    entries: counted.entries,
    stats: {
      issuers: 1,
      issuersRead: 1,
      calls: 1,
      credits: 1,
      creditsUnconfirmed: 0,
      tokens: counted.tokens,
      tokensWithoutLink: counted.withoutLink,
    },
    sources: [answer.source],
  };
}
