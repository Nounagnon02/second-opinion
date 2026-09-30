/**
 * The `--record` / `--replay` flags (T2.2) and the `call` command that carries them.
 * `runCall` is exercised offline: replay reads the T1.2 fixtures, record writes to a scratch directory through a
 * scripted transport.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeResponse, parseCallArgs, runCall } from '../src/cli/call.js';
import { DEFAULT_FIXTURE_DIR, DEFAULT_RECORD_DIR } from '../src/cmc/config.js';
import { CmcError } from '../src/cmc/errors.js';
import { createClientForMode, parseRunMode } from '../src/cmc/mode.js';
import { projectRoot } from './helpers/endpoints-doc.js';
import { fixtureResponse, scriptedTransport } from './helpers/transport.js';

const DISCOVERY = join(projectRoot, 'fixtures', 'discovery');
const KEY = 'test-key-not-a-real-one';

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-call-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseRunMode', () => {
  it('runs live when no mode flag is given, and leaves the other arguments in order', () => {
    expect(parseRunMode(['E02', 'id=1', 'convert=USD'])).toEqual({
      mode: { kind: 'live' },
      args: ['E02', 'id=1', 'convert=USD'],
    });
  });

  it('records into fixtures/recorded and replays from fixtures/ by default', () => {
    expect(parseRunMode(['--record']).mode).toEqual({ kind: 'record', dir: DEFAULT_RECORD_DIR });
    expect(parseRunMode(['--replay']).mode).toEqual({ kind: 'replay', dir: DEFAULT_FIXTURE_DIR });
  });

  it('takes the flag out wherever it stands, and resolves a relative directory against the working directory', () => {
    const cwd = '/tmp/work';
    expect(parseRunMode(['E02', '--replay=fixtures/discovery', 'id=1'], cwd)).toEqual({
      mode: { kind: 'replay', dir: resolve(cwd, 'fixtures/discovery') },
      args: ['E02', 'id=1'],
    });
    expect(parseRunMode(['--record=/var/tmp/run', 'E02'], cwd).mode).toEqual({
      kind: 'record',
      dir: resolve('/var/tmp/run'),
    });
  });

  it('refuses two modes in the same run', () => {
    expect(() => parseRunMode(['--record', '--replay'])).toThrow(CmcError);
    expect(() => parseRunMode(['--record', '--replay'])).toThrow(/One mode per run/);
    expect(() => parseRunMode(['--replay=a', '--replay=b'])).toThrow(/One mode per run/);
  });

  it('refuses an empty directory', () => {
    expect(() => parseRunMode(['--replay='])).toThrow(/fixture directory is empty/);
  });
});

describe('parseCallArgs', () => {
  it('reads the endpoint, the parameters, the mode and --data', () => {
    expect(parseCallArgs(['E02', 'id=1,4705', 'convert=USD', '--replay', '--data'], '/tmp')).toEqual({
      endpoint: 'E02',
      query: { id: '1,4705', convert: 'USD' },
      mode: { kind: 'replay', dir: DEFAULT_FIXTURE_DIR },
      printData: true,
    });
  });

  it('defaults to a live call without printing the data', () => {
    expect(parseCallArgs(['E20'])).toMatchObject({ endpoint: 'E20', query: {}, mode: { kind: 'live' }, printData: false });
  });

  it('refuses an endpoint that is not a verified one, and lists those that are', () => {
    // E15 was refused by the Startup plan in T1.2 (docs/ENDPOINTS.md), so it is not callable.
    expect(() => parseCallArgs(['E15'])).toThrow(/verified endpoints/);
    expect(() => parseCallArgs([])).toThrow(/Usage: call/);
    expect(() => parseCallArgs(['E02', 'novalue'])).toThrow(/name=value/);
  });
});

describe('runCall', () => {
  const replay = (argv: string[]) => runCall(parseCallArgs([...argv, `--replay=${DISCOVERY}`]), {});

  it('replays a recorded answer: no network, no key, and it names the fixture', async () => {
    const { ok, lines } = await replay(['E02', 'id=1,4705', 'convert=USD']);
    expect(ok).toBe(true);
    expect(lines[0]).toContain('E02: HTTP 200, error_code 0, 1 credit(s)');
    expect(lines[0]).toContain('status.timestamp 2026-09-24T16:04:03.419Z');
    expect(lines[0]).toContain('replayed from fixtures/discovery/E02-quotes-latest-btc-paxg.json');
    expect(lines.at(-1)).toBe('Credits this run: 1 charged, 0 unconfirmed, 499 left of 500 (CMC_CREDIT_BUDGET).');
  });

  it('prints the data only when asked, as the API sent it', async () => {
    const recorded = JSON.parse(readFileSync(join(DISCOVERY, 'E14-rwa-quotes-gold.json'), 'utf8')) as {
      response: { body: { data: unknown } };
    };

    const without = await replay(['E14', 'rwa_id=1']);
    const withData = await replay(['E14', 'rwa_id=1', '--data']);

    expect(without.lines).toHaveLength(2);
    expect(withData.lines).toHaveLength(3);
    expect(JSON.parse(withData.lines[1] ?? 'null')).toEqual(recorded.response.body.data);
  });

  it('reports a request that was never recorded, and says how to record it', async () => {
    const { ok, lines } = await replay(['E02', 'id=2']);
    expect(ok).toBe(false);
    expect(lines[0]).toContain('no fixture recorded for this request');
    expect(lines[0]).toContain('--record');
    expect(lines.at(-1)).toContain('0 charged');
  });

  it('reports a recorded refusal with the fixture that proves it', async () => {
    const { ok, lines } = await replay(['E08', 'base_asset_ucid=4705', 'network_slug=ethereum', 'limit=10']);
    expect(ok).toBe(false);
    expect(lines[0]).toContain('HTTP 400');
    expect(lines[1]).toBe('Evidence: fixtures/discovery/E08-dex-spot-pairs-paxg.json');
  });

  it('records a live answer into the given directory and says where it went', async () => {
    const dir = scratch();
    const network = scriptedTransport(fixtureResponse('E01-map-btc-paxg'));
    const args = parseCallArgs(['E01', 'symbol=BTC,PAXG', `--record=${dir}`]);

    const { ok, lines } = await runCall(args, { CMC_API_KEY: KEY }, { network });

    const [file] = readdirSync(dir);
    expect(ok).toBe(true);
    expect(lines[0]).toContain(`recorded in ${join(dir, file ?? '')}`);
    expect(lines[0]).toContain('0 credit(s)');
  });

  it('refuses to run live or record without a key, without sending anything', async () => {
    const network = scriptedTransport(fixtureResponse('E01-map-btc-paxg'));
    await expect(runCall(parseCallArgs(['E01']), {}, { network })).rejects.toThrow(/CMC_API_KEY is not set/);
    await expect(runCall(parseCallArgs(['E01', `--record=${scratch()}`]), {}, { network })).rejects.toThrow(CmcError);
    expect(network.requests).toEqual([]);
  });
});

describe('describeResponse', () => {
  it('says when an answer came from the local cache rather than from the fixture again', async () => {
    const mode = { kind: 'replay', dir: DISCOVERY } as const;
    const client = createClientForMode(mode, {});
    await client.get('E14', { rwa_id: 1 });
    const again = await client.get('E14', { rwa_id: 1 });
    expect(describeResponse(again, mode)).toContain('from the local cache');
  });

  it('says "live" for an answer that was neither recorded nor replayed', async () => {
    const network = scriptedTransport(fixtureResponse('E01-map-btc-paxg'));
    const env = { CMC_API_KEY: KEY, CMC_CACHE_DIR: scratch() };
    const response = await createClientForMode({ kind: 'live' }, env, { network }).get('E01', { symbol: 'BTC,PAXG' });
    expect(describeResponse(response, { kind: 'live' })).toMatch(/, live$/);
  });
});
