/**
 * What the web interface (specification F8) reads out of the environment, and the one rule that governs it: the
 * API key stays on the server.
 *
 * Next.js inlines every variable named `NEXT_PUBLIC_*` into the browser bundle. That is the single way a key
 * could leave the server in this application, so it is checked here rather than trusted: a deployment that puts
 * the key — or anything named like it — under that prefix refuses to start, with a message that names the
 * variable and never its value.
 *
 * Two modes are served, and no third one:
 * - **live** reads the API with the key, through the same client, cache and credit budget as every command here;
 * - **replay** reads the recorded answers of `fixtures/` and sends no request at all, so a clone with no key
 *   still shows real verdicts on real captured data.
 *
 * `--record` has no place behind an HTTP request: it writes files and spends credits per visitor, so a
 * deployment asking for it is refused rather than quietly downgraded.
 */
import { join } from 'node:path';
import { DEFAULT_FIXTURE_DIR, PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { MASK } from '../cmc/fixtures.js';
import type { RunMode } from '../cmc/mode.js';
import { DEFAULT_INDEX_FILE } from '../rwa/wrapper-index.js';

export type Env = Readonly<Record<string, string | undefined>>;

/** The published audit report the audit page reads (specification F9, written by `npm run audit -- --write`). */
export const DEFAULT_AUDIT_FILE = join(PROJECT_ROOT, 'docs', 'api_audit.json');

/** The recorded walk the wrapper index is rebuilt from when a deployment carries no cached one (D6). */
export const RWA_INDEX_FIXTURES = join(PROJECT_ROOT, 'fixtures', 'rwa-index');

/** The prefix Next.js inlines into the browser bundle. Nothing under it may carry the key. */
export const PUBLIC_PREFIX = 'NEXT_PUBLIC_';

/** The two modes a deployment may run in, in the words `SECOND_OPINION_MODE` is written with. */
export const WEB_MODES = ['live', 'replay'] as const;

export type WebModeName = (typeof WEB_MODES)[number];

export interface WebSettings {
  /** Live or replay; `record` is refused (see the header). */
  mode: RunMode;
  /** Where the cached token to real-world-asset index is read from (D6). */
  indexFile: string;
  /** Where the published audit report is read from. */
  auditFile: string;
  /** Why this mode is the one running, in one sentence the page prints. A reader should never have to guess. */
  modeReason: string;
}

/**
 * Whether a variable name is one this project would be embarrassed to see in a browser bundle: the key itself,
 * or anything else named like a credential.
 */
function looksLikeACredential(name: string): boolean {
  const bare = name.slice(PUBLIC_PREFIX.length).toUpperCase();
  return /(^|_)(API_)?KEY$|SECRET|TOKEN|PASSWORD/.test(bare);
}

/**
 * Refuses a deployment that would ship the key to the browser.
 *
 * Two ways that can happen, and both are caught: a variable *named* for a credential under `NEXT_PUBLIC_`, and a
 * variable of any name under that prefix whose value *is* the key. The error names the variable and never prints
 * what is in it.
 */
export function assertKeyStaysOnServer(env: Env = process.env): void {
  const key = env.CMC_API_KEY?.trim() ?? '';
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(PUBLIC_PREFIX)) continue;
    if (looksLikeACredential(name)) {
      throw new CmcError(
        'config',
        `${name} is set: Next.js inlines every ${PUBLIC_PREFIX}* variable into the browser bundle, so a ` +
          'credential must not be named under that prefix. The web interface reads CMC_API_KEY on the server ' +
          'only. Rename or remove it.',
      );
    }
    if (key !== '' && value?.trim() === key) {
      throw new CmcError(
        'config',
        `${name} carries the same value as CMC_API_KEY: Next.js inlines every ${PUBLIC_PREFIX}* variable into ` +
          'the browser bundle, which would publish the key. Remove it.',
      );
    }
  }
}

/**
 * Replaces the API key with the mask wherever it appears in a text that is about to be shown.
 *
 * Nothing in the engine puts the key in an error message — `CmcError` is built without it on purpose — so this is
 * the second lock rather than the first: a page renders whatever a failure said, and this is where that text
 * stops being able to carry the key by accident.
 */
export function redactSecrets(text: string, env: Env = process.env): string {
  const key = env.CMC_API_KEY?.trim() ?? '';
  return key === '' ? text : text.split(key).join(MASK);
}

/** The mode a deployment asked for, or the one its environment implies. */
function readMode(env: Env): { name: WebModeName; reason: string } {
  const asked = env.SECOND_OPINION_MODE?.trim().toLowerCase() ?? '';
  const hasKey = (env.CMC_API_KEY?.trim() ?? '') !== '';

  if (asked === 'record') {
    throw new CmcError(
      'config',
      'SECOND_OPINION_MODE=record is refused: recording writes fixture files and spends credits on every ' +
        'request, which is not something an HTTP endpoint should do. Record with `npm run record` instead, then ' +
        'serve the result with SECOND_OPINION_MODE=replay.',
    );
  }
  if (asked === 'live') {
    if (!hasKey) {
      throw new CmcError(
        'config',
        'SECOND_OPINION_MODE=live needs CMC_API_KEY, which is empty. Set the key on the server, or run with ' +
          'SECOND_OPINION_MODE=replay to serve the recorded answers instead.',
      );
    }
    return { name: 'live', reason: 'Live: every figure was read from the API for this page, with the key held on the server.' };
  }
  if (asked === 'replay') {
    return { name: 'replay', reason: 'Replay: every figure comes from an answer recorded earlier. No request was sent and no credit spent.' };
  }
  if (asked !== '') {
    throw new CmcError(
      'config',
      `SECOND_OPINION_MODE="${asked}" is not a mode: expected ${WEB_MODES.join(' or ')}, or leave it unset.`,
    );
  }
  return hasKey
    ? { name: 'live', reason: 'Live: every figure was read from the API for this page, with the key held on the server. (CMC_API_KEY is set and SECOND_OPINION_MODE is not.)' }
    : {
        name: 'replay',
        reason:
          'Replay: no CMC_API_KEY is set on this server, so every figure comes from an answer recorded earlier. ' +
          'No request was sent and no credit spent.',
      };
}

/** Everything the interface needs from the environment, with the key checked to be server-side only. */
export function readWebSettings(env: Env = process.env): WebSettings {
  assertKeyStaysOnServer(env);
  const { name, reason } = readMode(env);
  const fixtures = env.SECOND_OPINION_FIXTURES?.trim() || DEFAULT_FIXTURE_DIR;
  return {
    mode: name === 'live' ? { kind: 'live' } : { kind: 'replay', dir: fixtures },
    indexFile: env.SECOND_OPINION_RWA_INDEX?.trim() || DEFAULT_INDEX_FILE,
    auditFile: env.SECOND_OPINION_AUDIT_FILE?.trim() || DEFAULT_AUDIT_FILE,
    modeReason: reason,
  };
}
