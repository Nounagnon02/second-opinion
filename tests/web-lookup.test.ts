/**
 * The one call a page makes (T7.1): a string a visitor typed, and either a page or a reason there is none.
 *
 * Every case is offline — the recorded `check` answers of 2026-09-25, replayed — and the network is disabled
 * for the whole suite, so an assertion here cannot be passing on a live call.
 *
 * Two of these cases are the promise the interface makes and has to keep: a failure never reaches a browser
 * with the key in it, and a deployment that would publish the key does not answer at all.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { MASK } from '../src/cmc/fixtures.js';
import { lookupAsset } from '../src/web/lookup.js';
import { createWebRuntime, DEFAULT_WEB_CACHE_DIR, resetRuntimeCaches, webCacheDir } from '../src/web/runtime.js';
import { CHECK_FIXTURES, paxosIndex } from './helpers/check-fixtures.js';

const config = loadChecksConfig();

/** A deployment reading the recorded answers, with the index the recorded PAXG run was read with (D6). */
const replayEnv = { SECOND_OPINION_MODE: 'replay', SECOND_OPINION_FIXTURES: CHECK_FIXTURES } as const;

function options() {
  return { config, wrapperIndex: paxosIndex() };
}

describe('lookupAsset on a recorded wrapper', () => {
  it('answers with the page, and says the figures were replayed', async () => {
    const result = await lookupAsset('PAXG', replayEnv, options());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.view.title).toBe('PAXG — PAX Gold — CMC 4705');
    expect(result.view.verdict).toBe('ACT');
    expect(result.modeNote).toContain('Replay');
    expect(result.modeNote).toContain('No request was sent');
    // Every answer the verdict rests on is a recorded one; nothing here reached the API.
    expect(result.view.evidence.length).toBeGreaterThan(0);
    expect(result.view.recordedCount).toBe(result.view.evidence.length);
  });

  it('details every check, which an agent answer does not', async () => {
    const result = await lookupAsset('PAXG', replayEnv, options());
    if (result.status !== 'ok') throw new Error('expected a page');
    // A tool answer details the one check it is about and leaves the others' measurements out; a page carries
    // all of them, so several checks at once come back with their numbers. C7 measures nothing by design: it
    // reports fields it could not read, which are findings rather than measurements.
    const withNumbers = result.view.checks.filter((check) => check.measurements.length > 0).map((check) => check.id);
    expect(withNumbers).toEqual(expect.arrayContaining(['C1', 'C3', 'C4', 'C5', 'C6']));
    expect(result.view.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
  });

  it('takes a numeric CMC ID, which skips resolution (D3)', async () => {
    const result = await lookupAsset('4705', replayEnv, options());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.view.evidence.some((source) => source.endpoint === 'E01')).toBe(false);
  });
});

describe('lookupAsset when there is nothing to answer with', () => {
  it('returns a reason rather than throwing, when the visitor typed nothing usable', async () => {
    const result = await lookupAsset('   ', replayEnv, options());
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.kind).toBe('config');
    expect(result.message).toContain('No asset was named');
  });

  it('refuses a live deployment with no key, in words a reader can act on', async () => {
    const result = await lookupAsset('PAXG', { SECOND_OPINION_MODE: 'live' }, options());
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toContain('CMC_API_KEY');
    expect(result.message).toContain('SECOND_OPINION_MODE=replay');
  });

  it('refuses to answer at all when the key is published to the browser', async () => {
    const result = await lookupAsset(
      'PAXG',
      { ...replayEnv, NEXT_PUBLIC_CMC_API_KEY: 'whatever' },
      options(),
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toContain('NEXT_PUBLIC_CMC_API_KEY');
  });

  it('still forms a verdict when no answer was recorded for the asset (D11)', async () => {
    const result = await lookupAsset('DOGE', replayEnv, options());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.view.verdict).toBe('DO_NOT_ACT');
    expect(result.view.score).toBeNull();
    expect(result.view.notRun).toHaveLength(CHECK_IDS.length);
  });
});

describe('what a page may never carry', () => {
  const key = 'k3y-that-must-not-be-rendered';

  it('masks the key in a message a page renders, whatever produced it', async () => {
    // A base URL carrying the key would put it in the message of the failure the client raises.
    const result = await lookupAsset('PAXG', {
      SECOND_OPINION_MODE: 'replay',
      SECOND_OPINION_FIXTURES: CHECK_FIXTURES,
      CMC_API_KEY: key,
      CMC_BASE_URL: `https://example.invalid/${key}`,
    }, options());
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(key);
    if (result.status === 'error') expect(result.message).toContain(MASK);
  });

  it('never carries the key anywhere in the page it builds', async () => {
    const result = await lookupAsset('PAXG', { ...replayEnv, CMC_API_KEY: key }, options());
    expect(JSON.stringify(result)).not.toContain(key);
  });
});

describe('the runtime one request holds', () => {
  it('caches a live deployment where a serverless host can write', () => {
    expect(DEFAULT_WEB_CACHE_DIR.startsWith(tmpdir())).toBe(true);
    expect(webCacheDir({})).toBe(DEFAULT_WEB_CACHE_DIR);
    expect(webCacheDir({ CMC_CACHE_DIR: '/var/data/cmc' })).toBe('/var/data/cmc');
  });

  it('reads the cached wrapper index when a deployment carries one (D6)', async () => {
    resetRuntimeCaches();
    const directory = mkdtempSync(join(tmpdir(), 'so-web-index-'));
    const file = join(directory, 'index.json');
    const index = paxosIndex();
    writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);

    const runtime = await createWebRuntime({ ...replayEnv, SECOND_OPINION_RWA_INDEX: file }, { config });
    expect(runtime.indexNote).toContain(file);
    expect(runtime.indexNote).toContain('cached');
    expect(runtime.context.assess?.wrapperIndex?.entries.length).toBe(index.entries.length);
    resetRuntimeCaches();
  });

  it('rebuilds the index offline from the recorded walk when there is no cache (D6)', async () => {
    resetRuntimeCaches();
    const missing = join(mkdtempSync(join(tmpdir(), 'so-web-noindex-')), 'index.json');
    const runtime = await createWebRuntime({ ...replayEnv, SECOND_OPINION_RWA_INDEX: missing }, { config });
    expect(runtime.indexNote).toContain('rebuilt in memory');
    expect(runtime.indexNote).toContain('0 credit spent');
    expect((runtime.context.assess?.wrapperIndex?.entries.length ?? 0) > 0).toBe(true);
    resetRuntimeCaches();
  });

  it('hands the page the same thresholds the score used', async () => {
    const runtime = await createWebRuntime(replayEnv, options());
    expect(runtime.config).toBe(config);
    expect(runtime.context.config).toBe(config);
  });
});
