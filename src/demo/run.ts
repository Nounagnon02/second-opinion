/**
 * The demonstration agent of specification F7, end to end: `npm run demo`.
 *
 * It replays the two answers recorded on 2026-09-26 (`fixtures/demo`) through the real MCP server, over a real
 * pipe, and prints what an agent did with them. No network call, no API key, no credit — and no order: see
 * `NO_TRADE_NOTICE`, which this command prints before it does anything and again after it is done.
 *
 * Usage: npm run demo -- [--live | --record[=dir] | --replay[=dir]] [--json] [--index=<path>]
 *   no flag         replays fixtures/demo: offline, deterministic, free;
 *   --live          calls the API with CMC_API_KEY, which spends credits;
 *   --record[=dir]  calls the API and records the answers, so this run can be replayed later;
 *   --replay[=dir]  replays another directory;
 *   --json          prints the whole run as JSON instead of the transcript;
 *   --index=<path>  where the token to real-world-asset index is cached (D6).
 *
 * The exit status is 0 when every scenario reached a decision, and 1 when one of them could not — a tool that
 * could not answer, a fixture that is not there. It is never the verdict: a refusal is the demonstration working.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wrap } from '../cli/args.js';
import { PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type RunMode } from '../cmc/mode.js';
import { buildWrapperIndex, DEFAULT_INDEX_FILE, loadWrapperIndex, saveWrapperIndex } from '../rwa/wrapper-index.js';
import { decide, describeOrder, describeVerdict, NO_TRADE_NOTICE, type Decision } from './agent.js';
import type { DemoAssetAnswer, DemoTradeAnswer } from './answers.js';
import { DemoHost, type ToolCall } from './host.js';
import { SCENARIOS, type Scenario } from './scenarios.js';

/** The answers this demonstration replays by default: the live capture of 2026-09-26. */
export const DEMO_FIXTURES = join(PROJECT_ROOT, 'fixtures', 'demo');

/** The recorded walk the token to real-world-asset index is rebuilt from when no cached one is there (D6). */
export const RWA_INDEX_FIXTURES = join(PROJECT_ROOT, 'fixtures', 'rwa-index');

/** The built entry point a host launches, the same one the README hands out. */
export const SERVER_ENTRY = join(PROJECT_ROOT, 'dist', 'mcp', 'server.js');

const INDEX_FLAG = /^--index=(.*)$/;
const MODE_FLAG = /^--(record|replay)(?:=.*)?$/;

const USAGE = 'Usage: demo [--live | --record[=dir] | --replay[=dir]] [--json] [--index=<path>]';

export interface DemoArgs {
  mode: RunMode;
  json: boolean;
  /** Where the wrapper index is cached. */
  indexFile: string;
}

/**
 * Validates the command line; throws a usage error otherwise.
 *
 * The default is replay rather than live, which is the opposite of every other command here. A demonstration that
 * spends credits and reads a moving market is not one anyone can repeat, and F7 asks for one resting on captured
 * data; `--live` is there for whoever wants to point the same agent at the API as it is today.
 */
export function parseDemoArgs(argv: readonly string[], cwd = process.cwd()): DemoArgs {
  const chosen = argv.some((arg) => MODE_FLAG.test(arg));
  const live = argv.includes('--live');
  const { mode, args } = parseRunMode(
    argv.filter((arg) => arg !== '--live'),
    cwd,
  );
  if (live && chosen) {
    throw new Error(`One mode per run: --live and a --record/--replay flag were both given. ${USAGE}`);
  }

  let json = false;
  let indexFile = DEFAULT_INDEX_FILE;
  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    const match = INDEX_FLAG.exec(arg);
    if (match) {
      const file = match[1] ?? '';
      if (file === '') throw new Error(`--index=: the path is empty. ${USAGE}`);
      indexFile = resolve(cwd, file);
      continue;
    }
    throw new Error(`Unknown argument "${arg}". ${USAGE}`);
  }
  return { mode: chosen || live ? mode : { kind: 'replay', dir: DEMO_FIXTURES }, json, indexFile };
}

/**
 * The cached token to real-world-asset index, built offline from the recorded walk when it is not there yet.
 *
 * C5 is half of what this demonstration shows, and it needs the index: without one it reports that no index has
 * been built and says nothing about wrappers. Building it here from `fixtures/rwa-index` costs no credit and no
 * network call, and it is the same walk `npm run rwa:index -- --build` makes against the API (D6). A clean clone
 * therefore runs the demonstration with nothing but `npm install && npm run build`.
 */
export async function ensureWrapperIndex(file: string): Promise<string> {
  const cached = loadWrapperIndex(file);
  if (cached !== null) {
    return `already cached at ${file} — built ${cached.builtAt}, ${String(cached.entries.length)} wrapper(s).`;
  }
  if (!existsSync(RWA_INDEX_FIXTURES)) {
    throw new CmcError(
      'config',
      `no wrapper index at ${file}, and the recorded walk it would be rebuilt from is not at ` +
        `${RWA_INDEX_FIXTURES}. Build one against the API with \`npm run rwa:index -- --build\`.`,
    );
  }
  const client = createClientForMode({ kind: 'replay', dir: RWA_INDEX_FIXTURES }, { CMC_API_KEY: '' });
  const index = await buildWrapperIndex(client);
  saveWrapperIndex(index, file);
  return (
    `rebuilt offline from ${RWA_INDEX_FIXTURES} — answers of ${index.builtAt}, ` +
    `${String(index.entries.length)} wrapper(s), 0 credit spent. Cached at ${file}.`
  );
}

/** One scenario, run: what the agent asked, what came back, and what it did. */
export interface ScenarioRun {
  scenario: Scenario;
  /** The answer to the first question an agent should ask: is this a wrapper at all? */
  rwa: DemoAssetAnswer;
  /** The answer the decision rests on. */
  trade: DemoTradeAnswer;
  decision: Decision;
  /** `explain` on the check that decided it; `null` when no check raised anything. */
  explanation: string | null;
  /** The tool calls this scenario made, in order. */
  calls: ToolCall[];
}

/**
 * One scenario, from the instruction to the decision.
 *
 * Two questions, in the order an agent should ask them: `check_rwa_token` settles whether the thing named is a
 * tokenised real-world asset at all, and `preflight_trade` weighs the order against the depth behind its price.
 * `explain` follows only when something was raised, because there is nothing to explain otherwise.
 *
 * Both calls assess the same asset, so a live run reads the second one from the client's cache on disk rather
 * than paying for it twice (F2).
 */
export async function runScenario(host: DemoHost, scenario: Scenario): Promise<ScenarioRun> {
  const before = host.calls.length;
  const { order } = scenario;
  const { answer: rwa } = await host.checkRwaToken(order.asset);
  const { answer: trade } = await host.preflightTrade(order.asset, order.side, order.sizeUsd);
  const decision = decide(order, trade);
  const explanation = decision.explain === null ? null : await host.explain(decision.explain);
  return { scenario, rwa, trade, decision, explanation, calls: host.calls.slice(before) };
}

/**
 * The half of an explanation a refusal rests on: why the measurement matters before acting. The rest of what
 * `explain` returns — the endpoints, the limits, where they were settled — is in the answer and stays there; a
 * transcript that reprinted all of it would bury the sentence the user needs.
 */
export function explanationHead(explanation: string): string {
  const lines = explanation.split('\n');
  return lines.find((line) => line.startsWith('Why it matters:')) ?? lines.find((line) => line.trim() !== '') ?? '';
}

/** `NO_TRADE_NOTICE` as a sentence of its own. */
function notice(): string[] {
  return wrap(NO_TRADE_NOTICE.charAt(0).toUpperCase() + NO_TRADE_NOTICE.slice(1), '');
}

/** How the run says where its answers came from. */
function describeMode(mode: RunMode): string {
  switch (mode.kind) {
    case 'replay':
      return `Replaying recorded answers from ${mode.dir}: no network call, no API key, no credit.`;
    case 'record':
      return `Calling the API and recording every answer into ${mode.dir}. This spends credits.`;
    case 'live':
      return 'Calling the API live, through the local cache. This spends credits.';
  }
}

/** One scenario as the transcript prints it. */
export function describeScenario(run: ScenarioRun, position: number, total: number): string[] {
  const { scenario, decision, trade } = run;
  const lines = [
    '',
    '─'.repeat(100),
    `Scenario ${String(position)} of ${String(total)} — ${scenario.id}: ${scenario.title}`,
    '',
    `  Instruction  "${scenario.order.instruction}"`,
    `  Order        ${describeOrder(scenario.order)}`,
    '',
    '  Tool calls over MCP',
  ];
  for (const call of run.calls) {
    const args = Object.entries(call.args)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join(', ');
    lines.push(`    ${call.tool}(${args})`, `      → ${call.headline}`);
  }

  lines.push('', '  What the answers said');
  lines.push(`    Asset      ${scenario.order.asset} resolved to ${decision.resolvedAs ?? 'no entry at all'}`);
  lines.push(`    Verdict    ${describeVerdict(trade)}`);
  if (run.rwa.verdict !== trade.verdict) {
    lines.push(
      `               the asset on its own answers ${run.rwa.verdict}; ` +
        `weighed against this order it answers ${trade.verdict}`,
    );
  }
  if (decision.orderLine !== null) lines.push(`    Order size ${decision.orderLine}`);
  const fixtures = trade.evidence.filter((source) => source.fixture !== null).length;
  const endpoints = [...new Set(trade.evidence.map((source) => source.endpoint))].join(', ');
  lines.push(
    `    Evidence   ${String(trade.evidence.length)} answer(s) from ${endpoints}, ` +
      `${String(fixtures)} of them replayed from a recorded fixture`,
  );

  if (decision.reasons.length > 0) {
    lines.push('', '  Why the agent refused');
    for (const reason of decision.reasons) lines.push(...wrap(`- ${reason}`, '    '));
  }
  if (run.explanation !== null && decision.explain !== null) {
    lines.push('', `  ${decision.explain}, in the words of explain()`);
    lines.push(...wrap(explanationHead(run.explanation), '    '));
  }
  if (decision.notMeasured.length > 0) {
    lines.push('', '  What was not measured');
    for (const line of decision.notMeasured) lines.push(...wrap(`- ${line}`, '    '));
  }

  lines.push('', ...wrap(`DECISION  ${decision.headline}`, '  '));
  if (decision.action !== scenario.recorded) {
    lines.push(
      ...wrap(
        `Note: when these answers were captured, this agent ${scenario.recorded} this order. The data has moved ` +
          'since; the decision above is what it says today.',
        '  ',
      ),
    );
  }
  return lines;
}

/** The whole run as the transcript prints it. */
export function describeRun(runs: readonly ScenarioRun[], mode: RunMode, index: string, log: string): string[] {
  const lines = [
    'Second Opinion — demonstration agent (specification F7)',
    ...notice(),
    '',
    describeMode(mode),
    `Wrapper index: ${index}`,
  ];
  const serverLine = log.split('\n').find((line) => line.trim() !== '');
  if (serverLine !== undefined) lines.push(`Server: ${serverLine.trim()}`);

  runs.forEach((run, position) => lines.push(...describeScenario(run, position + 1, runs.length)));

  const caveats = [...new Set(runs.flatMap((run) => run.trade.caveats))];
  if (caveats.length > 0) {
    lines.push('', '─'.repeat(100), 'What these answers do not cover');
    for (const caveat of caveats) lines.push(...wrap(`- ${caveat}`, '  '));
  }

  const refused = runs.filter((run) => run.decision.action === 'refused').length;
  const charged = runs.reduce((total, run) => total + run.trade.credits.charged, 0);
  // In replay the meter reports what the recorded live run cost, not what this run spent, which was nothing.
  const credits =
    mode.kind === 'replay'
      ? `${String(charged)} credit(s) are what the recorded answers cost when they were captured; this run spent none.`
      : `${String(charged)} credit(s) charged.`;
  lines.push(
    '',
    '─'.repeat(100),
    `${String(runs.length)} scenario(s): ${String(refused)} refused, ${String(runs.length - refused)} simulated.`,
    ...wrap(credits, ''),
    ...notice(),
  );
  return lines;
}

/** Runs every scenario of F7 against one server. */
export async function runDemo(args: DemoArgs): Promise<{ runs: ScenarioRun[]; index: string; log: string }> {
  const index = await ensureWrapperIndex(args.indexFile);
  if (!existsSync(SERVER_ENTRY)) {
    throw new CmcError('config', `the server is not built: ${SERVER_ENTRY} is not there. Run \`npm run build\`.`);
  }
  const serverArgs = args.mode.kind === 'live' ? [] : [`--${args.mode.kind}=${args.mode.dir}`];
  const host = await DemoHost.connect({
    entry: SERVER_ENTRY,
    serverArgs,
    // An empty key in replay: a tool that reached for the API would fail on it rather than spend a credit.
    env:
      args.mode.kind === 'replay'
        ? { PATH: process.env.PATH ?? '', CMC_API_KEY: '' }
        : { PATH: process.env.PATH ?? '' },
  });
  try {
    const runs: ScenarioRun[] = [];
    for (const scenario of SCENARIOS) runs.push(await runScenario(host, scenario));
    return { runs, index, log: host.log() };
  } finally {
    await host.close();
  }
}

async function main(): Promise<void> {
  const args = parseDemoArgs(process.argv.slice(2));
  const { runs, index, log } = await runDemo(args);
  if (args.json) {
    console.log(JSON.stringify({ mode: args.mode, index, runs }, null, 2));
    return;
  }
  console.log(describeRun(runs, args.mode, index, log).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const reason = error instanceof CmcError ? `${error.kind}: ${error.message}` : String(error);
    console.error(`❌ ${reason}`);
    process.exitCode = 1;
  });
}
