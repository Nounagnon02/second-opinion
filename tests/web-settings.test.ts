/**
 * What the web interface reads out of the environment (T7.1), and the rule it exists to enforce: the API key
 * stays on the server.
 *
 * Nothing here touches the network or the engine. These are the checks a deployment fails fast on.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXTURE_DIR } from '../src/cmc/config.js';
import { CmcError } from '../src/cmc/errors.js';
import { MASK } from '../src/cmc/fixtures.js';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import {
  assertKeyStaysOnServer,
  DEFAULT_AUDIT_FILE,
  PUBLIC_PREFIX,
  readWebSettings,
  redactSecrets,
  WEB_MODES,
} from '../src/web/settings.js';

const KEY = 'a-real-looking-key-0123456789';

describe('assertKeyStaysOnServer', () => {
  it('accepts an environment that keeps the key to itself', () => {
    expect(() => {
      assertKeyStaysOnServer({ CMC_API_KEY: KEY, NEXT_PUBLIC_SITE_NAME: 'Second Opinion' });
    }).not.toThrow();
  });

  it('refuses a variable named for a credential under the public prefix', () => {
    for (const name of [
      'NEXT_PUBLIC_CMC_API_KEY',
      'NEXT_PUBLIC_API_KEY',
      'NEXT_PUBLIC_CMC_SECRET',
      'NEXT_PUBLIC_ACCESS_TOKEN',
      'NEXT_PUBLIC_DB_PASSWORD',
    ]) {
      expect(() => {
        assertKeyStaysOnServer({ [name]: 'anything' });
      }).toThrow(name);
    }
  });

  it('refuses a public variable of any name that carries the key', () => {
    let thrown: unknown;
    try {
      assertKeyStaysOnServer({ CMC_API_KEY: KEY, NEXT_PUBLIC_BUILD_TAG: ` ${KEY} ` });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CmcError);
    expect((thrown as CmcError).message).toContain('NEXT_PUBLIC_BUILD_TAG');
    // The refusal names the variable and never prints what is in it.
    expect((thrown as CmcError).message).not.toContain(KEY);
  });

  it('leaves an unrelated public variable alone, even when a key is set', () => {
    expect(() => {
      assertKeyStaysOnServer({ CMC_API_KEY: KEY, NEXT_PUBLIC_ANALYTICS_ID: 'G-123' });
    }).not.toThrow();
  });

  it('is about the prefix Next.js publishes and no other', () => {
    expect(PUBLIC_PREFIX).toBe('NEXT_PUBLIC_');
    expect(() => {
      assertKeyStaysOnServer({ CMC_API_KEY: KEY, INTERNAL_COPY_OF_KEY: KEY });
    }).not.toThrow();
  });
});

describe('redactSecrets', () => {
  it('masks the key wherever it appears', () => {
    const said = `GET failed with ${KEY} in the header, twice: ${KEY}`;
    const masked = redactSecrets(said, { CMC_API_KEY: KEY });
    expect(masked).not.toContain(KEY);
    expect(masked.split(MASK)).toHaveLength(3);
  });

  it('leaves a text alone when no key is set', () => {
    expect(redactSecrets('nothing to hide', {})).toBe('nothing to hide');
  });
});

describe('readWebSettings', () => {
  it('runs live when a key is set and no mode is asked for', () => {
    const settings = readWebSettings({ CMC_API_KEY: KEY });
    expect(settings.mode).toEqual({ kind: 'live' });
    expect(settings.modeReason).toContain('Live');
    expect(settings.indexFile).toBe(DEFAULT_INDEX_FILE);
    expect(settings.auditFile).toBe(DEFAULT_AUDIT_FILE);
  });

  it('falls back to replay when there is no key, and says so', () => {
    const settings = readWebSettings({});
    expect(settings.mode).toEqual({ kind: 'replay', dir: DEFAULT_FIXTURE_DIR });
    expect(settings.modeReason).toContain('no CMC_API_KEY');
    expect(settings.modeReason).toContain('No request was sent');
  });

  it('replays the directory it is pointed at', () => {
    const settings = readWebSettings({ SECOND_OPINION_MODE: 'replay', SECOND_OPINION_FIXTURES: '/tmp/answers' });
    expect(settings.mode).toEqual({ kind: 'replay', dir: '/tmp/answers' });
  });

  it('refuses live mode without a key rather than serving something else', () => {
    expect(() => readWebSettings({ SECOND_OPINION_MODE: 'live' })).toThrow(/CMC_API_KEY/);
  });

  it('refuses to record behind an HTTP request', () => {
    expect(() => readWebSettings({ SECOND_OPINION_MODE: 'record', CMC_API_KEY: KEY })).toThrow(/npm run record/);
  });

  it('refuses a mode it does not serve', () => {
    expect(() => readWebSettings({ SECOND_OPINION_MODE: 'dry-run' })).toThrow(/live or replay/);
    expect(WEB_MODES).toEqual(['live', 'replay']);
  });

  it('refuses to start at all when the key is published', () => {
    expect(() => readWebSettings({ CMC_API_KEY: KEY, NEXT_PUBLIC_CMC_API_KEY: KEY })).toThrow(
      /NEXT_PUBLIC_CMC_API_KEY/,
    );
  });

  it('takes the audit report and the index from the environment when they are named', () => {
    const settings = readWebSettings({
      SECOND_OPINION_AUDIT_FILE: '/tmp/audit.json',
      SECOND_OPINION_RWA_INDEX: '/tmp/index.json',
    });
    expect(settings.auditFile).toBe('/tmp/audit.json');
    expect(settings.indexFile).toBe('/tmp/index.json');
  });
});
