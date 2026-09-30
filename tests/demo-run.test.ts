/**
 * The demonstration agent, run the way the video and the judges will run it (T5.3): `npm run demo`.
 *
 * Nothing here calls the agent's functions directly. The real built server is spawned as a child process with the
 * real run-mode flag, the real MCP handshake happens over a real pipe, and every answer comes back over the wire —
 * because a demonstration whose protocol is stubbed out proves nothing about the track it is entered in.
 *
 * Three things the cases hold onto:
 * - **it stays offline.** Every spawned process is given an empty `CMC_API_KEY`, which takes precedence over the
 *   `.env` of this clone, and every source of every answer has to name the fixture it came from. A case that
 *   started calling the API would fail on the key rather than spend a credit;
 * - **the outcomes are the ones the catalogue claims.** `recorded` in `scenarios.ts` is prose the transcript shows
 *   to a viewer; here it is compared with what the agent actually does, so it cannot go stale in silence;
 * - **nothing is placed.** The words the demonstration uses for its own limits are checked in the transcript.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_TRADE_NOTICE } from '../src/demo/agent.js';
import { DemoHost } from '../src/demo/host.js';
import {
  DEMO_FIXTURES,
  describeRun,
  ensureWrapperIndex,
  parseDemoArgs,
  runScenario,
  RWA_INDEX_FIXTURES,
  SERVER_ENTRY,
  type ScenarioRun,
} from '../src/demo/run.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { REGISTERED_TOOLS } from '../src/mcp/server.js';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import { projectRoot } from './helpers/endpoints-doc.js';

/** The demonstration launches the built entry point, so the build runs first, exactly as `npm run demo` does. */
beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'pipe', timeout: 300_000 });
  // And so does the rest of what `npm run demo` does before it spawns anything: the server reads the index from
  // `.cache/`, which a clean checkout does not have, so it is rebuilt offline from `fixtures/rwa-index` first.
  // Without this the two scenarios both come back with C5 unavailable and this file fails on a fresh clone (T9.1).
  await ensureWrapperIndex(DEFAULT_INDEX_FILE);
}, 300_000);

const temporary: string[] = [];
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-demo-'));
  temporary.push(dir);
  return dir;
}

/** Every scenario, run once against one server, so that the server is spawned once for the whole file. */
const runs: ScenarioRun[] = [];
let log = '';
let tools: string[] = [];

beforeAll(async () => {
  const host = await DemoHost.connect({
    entry: SERVER_ENTRY,
    serverArgs: [`--replay=${DEMO_FIXTURES}`],
    // PATH so that the child finds what it needs; the empty key is the safety belt of the header.
    env: { PATH: process.env.PATH ?? '', CMC_API_KEY: '' },
    cwd: tmpdir(),
  });
  try {
    tools = await host.tools();
    for (const scenario of SCENARIOS) runs.push(await runScenario(host, scenario));
    log = host.log();
  } finally {
    await host.close();
  }
}, 120_000);

function runOf(id: string): ScenarioRun {
  const run = runs.find((candidate) => candidate.scenario.id === id);
  if (run === undefined) throw new Error(`no scenario ${id} was run.`);
  return run;
}

describe('the server the demonstration talks to', () => {
  it('is the built entry point the README hands to a host', () => {
    expect(SERVER_ENTRY).toBe(join(projectRoot, 'dist', 'mcp', 'server.js'));
    expect(existsSync(SERVER_ENTRY)).toBe(true);
  });

  it('declares the four tools of F6 over the handshake', () => {
    expect([...tools].sort()).toEqual([...REGISTERED_TOOLS].sort());
  });

  it('reports on its log that it is replaying, not calling the API', () => {
    expect(log).toContain('listening on stdio in replay mode');
  });
});

describe('the two scenarios of F7', () => {
  it('runs exactly the two the specification asks for: one refusal, one acceptance', () => {
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.decision.action).sort()).toEqual(['refused', 'simulated']);
  });

  it('does what the catalogue says it did when the answers were captured', () => {
    for (const run of runs) {
      expect(run.decision.action, `scenario ${run.scenario.id}`).toBe(run.scenario.recorded);
    }
  });

  it('asks the same order of both, so that only the asset differs', () => {
    const [first, second] = runs;
    expect(first?.scenario.order.sizeUsd).toBe(second?.scenario.order.sizeUsd);
    expect(first?.scenario.order.side).toBe(second?.scenario.order.side);
    expect(first?.scenario.order.realWorldAsset).toBe(true);
    expect(second?.scenario.order.realWorldAsset).toBe(true);
  });
});

describe('the refusal', () => {
  const run = (): ScenarioRun => runOf('rwa-refusal');

  it('goes through preflight_trade, which is the tool F7 names', () => {
    expect(run().calls.map((call) => call.tool)).toEqual(['check_rwa_token', 'preflight_trade', 'explain']);
    expect(run().calls.every((call) => !call.isError)).toBe(true);
  });

  it('refuses an order the ticker alone would have let through', () => {
    // The asset on its own is ACT; it is the size of the order against the depth that changes the answer.
    expect(run().rwa.verdict).toBe('ACT');
    expect(run().trade.verdict).toBe('CAUTION');
    expect(run().decision.action).toBe('refused');
  });

  it('names the token the ticker actually resolved to', () => {
    expect(run().decision.resolvedAs).toContain('XAU9999 Meme');
  });

  it('explains the check that decided it, in the words of the explain tool', () => {
    expect(run().decision.explain).toBe('C4');
    expect(run().explanation).toContain('Why it matters:');
  });
});

describe('the acceptance', () => {
  const run = (): ScenarioRun => runOf('rwa-accept');

  it('needs no explanation, because no check raised anything', () => {
    expect(run().decision.reasons).toEqual([]);
    expect(run().decision.explain).toBeNull();
    expect(run().calls.map((call) => call.tool)).toEqual(['check_rwa_token', 'preflight_trade']);
  });

  it('simulates the order and says in the same breath that nothing was placed', () => {
    expect(run().decision.action).toBe('simulated');
    expect(run().decision.headline).toContain(NO_TRADE_NOTICE);
  });

  it('read the wrapper against its underlying, which is what makes it the accepted case', () => {
    expect(run().trade.checks.find((check) => check.id === 'C5')?.status).toBe('evaluated');
  });
});

describe('no answer came from the network', () => {
  it('names a recorded fixture behind every source of every answer', () => {
    for (const run of runs) {
      for (const answer of [run.rwa, run.trade]) {
        expect(answer.evidence.length, `scenario ${run.scenario.id}`).toBeGreaterThan(0);
        for (const source of answer.evidence) {
          expect(source.fixture, `${run.scenario.id} ${source.endpoint}`).not.toBeNull();
          expect(source.fixture).toContain('fixtures/demo');
        }
      }
    }
  });

  it('reports nothing left unconfirmed, which is what a replay cannot have', () => {
    for (const run of runs) expect(run.trade.credits.unconfirmed).toBe(0);
  });
});

describe('the transcript', () => {
  const lines = (): string[] => describeRun(runs, { kind: 'replay', dir: DEMO_FIXTURES }, 'cached', '');

  it('opens and closes on what the demonstration never does', () => {
    const text = lines().join('\n');
    const opening = NO_TRADE_NOTICE.charAt(0).toUpperCase() + NO_TRADE_NOTICE.slice(1).split(' ').slice(0, 5).join(' ');
    expect(text.indexOf(opening)).toBeGreaterThanOrEqual(0);
    expect(text.lastIndexOf(opening)).toBeGreaterThan(text.indexOf(opening));
  });

  it('shows every tool call it made, with its arguments', () => {
    const text = lines().join('\n');
    expect(text).toContain('preflight_trade(asset="XAU", side="buy", size_usd=25000)');
    expect(text).toContain('check_rwa_token(asset="PAXG")');
  });

  it('prints one decision per scenario', () => {
    // Trimmed and anchored: `docs/DECISIONS.md` is cited inside the reason C2 gives, and is not a decision.
    expect(lines().filter((line) => line.trimStart().startsWith('DECISION '))).toHaveLength(runs.length);
  });

  it('does not claim that a replay spent credits', () => {
    const text = lines().join('\n');
    expect(text).toContain('this run spent none');
    expect(text).not.toContain('credit(s) charged');
  });

  it('carries what the answers do not cover, once each', () => {
    const text = lines().join('\n');
    expect(text).toContain('What these answers do not cover');
    expect(text.split('The side is recorded and echoed back')).toHaveLength(2);
  });
});

describe('the command line', () => {
  it('replays fixtures/demo when no flag is given, which is what the video types', () => {
    const args = parseDemoArgs([]);
    expect(args.mode).toEqual({ kind: 'replay', dir: DEMO_FIXTURES });
    expect(args.json).toBe(false);
  });

  it('takes --live for whoever wants the API as it is today', () => {
    expect(parseDemoArgs(['--live']).mode).toEqual({ kind: 'live' });
  });

  it('refuses two modes at once', () => {
    expect(() => parseDemoArgs(['--live', '--replay'])).toThrow(/One mode per run/);
  });

  it('refuses an argument it does not know', () => {
    expect(() => parseDemoArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('takes --json and --index=', () => {
    const args = parseDemoArgs(['--json', '--index=index.json'], '/tmp');
    expect(args.json).toBe(true);
    expect(args.indexFile).toBe('/tmp/index.json');
  });
});

describe('the wrapper index a clean clone does not have', () => {
  it('is rebuilt offline from the recorded walk, at no credit', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    const message = await ensureWrapperIndex(file);
    expect(message).toContain('rebuilt offline');
    expect(message).toContain('0 credit spent');
    expect(existsSync(file)).toBe(true);
  }, 60_000);

  it('is left alone when one is already cached', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    await ensureWrapperIndex(file);
    expect(await ensureWrapperIndex(file)).toContain('already cached');
  }, 60_000);

  it('points at the recorded walk this project captured', () => {
    expect(RWA_INDEX_FIXTURES).toBe(join(projectRoot, 'fixtures', 'rwa-index'));
    expect(existsSync(RWA_INDEX_FIXTURES)).toBe(true);
  });
});
