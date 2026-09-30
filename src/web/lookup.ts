/**
 * The one call a page makes (specification F8): a string a visitor typed in, a page to render or a reason there
 * is none.
 *
 * It never throws. A browser asking about a symbol that resolves to nothing, a key that is not set, an endpoint
 * that timed out — each of those is an answer a visitor is owed in words, not a stack trace, and each of them
 * comes back here as `{ status: 'error' }` with the reason. Anything that is not a `CmcError` is a fault of this
 * code rather than of the request, and is left to propagate.
 *
 * Every measurement of every check travels with the page: unlike an MCP answer, which details only the check
 * the calling tool is about so as not to bury an agent in numbers, a page has room to put them behind a
 * disclosure and a reader who opens one is asking for exactly that.
 *
 * Two guarantees, both tested:
 * - **the key never reaches the browser.** The runtime refuses to start if it is published under a
 *   `NEXT_PUBLIC_` name, and every message rendered from here passes through `redactSecrets` first;
 * - **the page says where its figures came from.** Live or replayed, with the credits the run spent.
 */
import { assessAsset, parseSubject } from '../checks/assess.js';
import { CHECK_IDS } from '../checks/model.js';
import { CmcError } from '../cmc/errors.js';
import { assetAnswer } from '../mcp/tools.js';
import { createWebRuntime, type RuntimeOptions } from './runtime.js';
import { redactSecrets, type Env } from './settings.js';
import { assetView, type AssetView } from './view.js';

/** A page. */
export interface LookupOk {
  status: 'ok';
  view: AssetView;
  /** Live or replay, in the sentence the page prints under the verdict. */
  modeNote: string;
  /** Where the wrapper index came from, or why there is none (D6). */
  indexNote: string;
}

/** No page, and why. */
export interface LookupFailed {
  status: 'error';
  /** What went wrong, in one sentence, with the key masked. */
  message: string;
  /** The kind of `CmcError` behind it, for the page that groups causes; `null` when the cause is not one. */
  kind: string | null;
  /** The recorded answer the failure carries, when it carries one. */
  fixture: string | null;
}

export type LookupResult = LookupOk | LookupFailed;

/** A `CmcError` as a visitor reads it, with the key masked whatever the message says. */
function failure(error: CmcError, env: Env): LookupFailed {
  return {
    status: 'error',
    message: redactSecrets(error.message, env),
    kind: error.kind,
    fixture: error.fixture?.file ?? null,
  };
}

/**
 * Reads one asset through the whole engine and returns the page for it.
 *
 * `query` is what the visitor typed: a symbol like `PAXG`, or a numeric CMC ID, which skips resolution (D3).
 */
export async function lookupAsset(
  query: string,
  env: Env = process.env,
  options: RuntimeOptions = {},
): Promise<LookupResult> {
  let runtime;
  try {
    runtime = await createWebRuntime(env, options);
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return failure(error, env);
  }

  try {
    const subject = parseSubject(query);
    const assessment = await assessAsset(runtime.context.client, subject, {
      ...runtime.context.assess,
      config: runtime.config,
    });
    return {
      status: 'ok',
      // Every check in detail: a page has room for the numbers an agent answer leaves out.
      view: assetView(assetAnswer(assessment, CHECK_IDS), runtime.config),
      modeNote: runtime.settings.modeReason,
      indexNote: runtime.indexNote,
    };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return failure(error, env);
  }
}
