/**
 * The submission text of T8.4, checked against the repository it describes.
 *
 * This is the one deliverable nobody runs. It is pasted into a form, read once, and every figure in it is a claim
 * about code, recordings and reports that live elsewhere. Prose like that goes stale in silence: an endpoint added
 * to the client, a limit moved by a later calibration, an audit regenerated over a wider corpus — and a sentence
 * here quietly describes a repository that no longer exists. A judge would have no way of telling.
 *
 * So nothing in it is read for plausibility.
 *
 * 1. **The tables are generated data in prose form.** The endpoint table is checked against the only paths the
 *    client may send (`ENDPOINTS`), the check table against the titles the outputs use (`CHECK_TITLES`), and the
 *    refused endpoints against the inventory rows that recorded their refusal.
 * 2. **Every figure is recomputed, never copied.** The corpus and the audit counts come from
 *    `docs/api_audit.json` and from the recorded answers themselves, the calibration share from
 *    `docs/calibration.json`, the credit cost of a verdict from adding up `status.credit_count` over the two
 *    `check` runs recorded in `fixtures/check`, and the demonstration paragraph from replaying both orders
 *    through `preflight_trade` offline.
 * 3. **Every command and every path resolves** — a command against the scripts of `package.json`, a path against
 *    the filesystem.
 * 4. **The four placeholders are declared once and used once.** A fifth one fails, and so does a declared one the
 *    text never carries.
 * 5. **The wording goes through the tone gate of `src/audit/review.ts`**, the same one the audit applies to its
 *    own entries, which is how `CLAUDE.md` rule 6 is kept by the code rather than by intention.
 *
 * What is deliberately not checked is the pitch: whether the text convinces anyone is a judgement. The four links
 * it cannot carry yet are listed above the markers, for the person pasting it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toneIssues } from '../src/audit/review.js';
import type { AuditRun } from '../src/audit/run.js';
import { TARGET_ACT_SHARE, type CalibrationRun } from '../src/calibration/run.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS, CHECK_TITLES, type CheckId } from '../src/checks/model.js';
import { ENDPOINTS, endpointForPath, type EndpointId } from '../src/cmc/endpoints.js';
import { KEY_HEADER, MASK, type RecordedExchange } from '../src/cmc/fixtures.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { readTradeAnswer, type DemoTradeAnswer } from '../src/demo/answers.js';
import { DEMO_FIXTURES } from '../src/demo/run.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { normalizeQuotes } from '../src/normalize/aggregated.js';
import { normalizeAssetMap } from '../src/normalize/identity.js';
import { sourceFromBody } from '../src/normalize/model.js';
import { explainCheck } from '../src/mcp/explain.js';
import { preflightTrade, TOOL_NAMES } from '../src/mcp/tools.js';
import { projectRoot, readInventory } from './helpers/endpoints-doc.js';
import { replayIndex } from './helpers/rwa-index.js';

const DOC = readFileSync(join(projectRoot, 'docs', 'SUBMISSION.md'), 'utf8');
const START_MARKER = '<!-- submission text: paste from here -->';
const END_MARKER = '<!-- submission text: paste to here -->';

const start = DOC.indexOf(START_MARKER);
const end = DOC.indexOf(END_MARKER);
if (start < 0 || end <= start) {
  throw new Error('docs/SUBMISSION.md no longer carries both submission markers, so what gets pasted is undefined.');
}

/** What gets pasted, and only that: the guidance around it is not part of the submission. */
const TEXT = DOC.slice(start + START_MARKER.length, end);

/** The guidance above the markers, where the placeholders are declared and the human steps are listed. */
const GUIDE = DOC.slice(0, start);

/** The submission on one line, since any sentence it states may be wrapped anywhere. */
const FLAT = TEXT.replace(/\s+/g, ' ');

const RUN = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;
const PANEL = JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as CalibrationRun;
const SCRIPTS = (
  JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts;
const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');

/** What one sentence of the text states, by the pattern that finds it. Fails when the sentence is gone. */
function stated(pattern: RegExp): string[] {
  const match = pattern.exec(FLAT);
  expect(match, `the submission no longer says: ${pattern.source}`).not.toBeNull();
  return (match ?? []).slice(1);
}

/** The first number of such a sentence. */
function statedNumber(pattern: RegExp): number {
  return Number((stated(pattern)[0] ?? '').replace(/[, ]/g, ''));
}

/**
 * English for the counts this text spells out in words. A count that moves therefore fails here rather than
 * reading oddly: "Seventeen answered" against sixteen endpoints is not something a reader can catch.
 */
const SPELLED: Record<number, string> = {
  1: 'one',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  10: 'ten',
  17: 'seventeen',
  21: 'twenty-one',
};

function spelled(count: number): string {
  const word = SPELLED[count];
  if (word === undefined) throw new Error(`No English spelling is recorded for ${String(count)}.`);
  return word;
}

/** One recorded answer, with where it was read from and which endpoint answered it. */
interface Recorded {
  file: string;
  exchange: RecordedExchange;
  endpoint: EndpointId | undefined;
}

function recordedIn(dir: string): Recorded[] {
  return readdirSync(join(projectRoot, dir))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = `${dir}/${name}`;
      const exchange = JSON.parse(readFileSync(join(projectRoot, file), 'utf8')) as RecordedExchange;
      return { file, exchange, endpoint: endpointForPath(exchange.request.path) };
    });
}

/** What the API charged for one answer, as the answer itself reports it. */
function creditCount({ exchange }: Recorded): number {
  const body = exchange.response.body as { status?: { credit_count?: number } };
  return Number(body.status?.credit_count ?? 0);
}

function credits(answers: Recorded[]): number {
  return answers.reduce((total, answer) => total + creditCount(answer), 0);
}

/**
 * The recorded `check` answers, split into the runs they were captured in. The two live runs of T3.7 sit three
 * minutes apart, so a gap of a minute separates them without naming either asset here.
 */
function recordedRuns(dir: string): Recorded[][] {
  const runs: Recorded[][] = [];
  for (const answer of [...recordedIn(dir)].sort((a, b) =>
    a.exchange.recordedAt.localeCompare(b.exchange.recordedAt),
  )) {
    const current = runs.at(-1);
    const previous = current?.at(-1);
    const apart =
      previous === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(answer.exchange.recordedAt) - Date.parse(previous.exchange.recordedAt);
    if (current === undefined || apart > 60_000) runs.push([answer]);
    else current.push(answer);
  }
  return runs;
}

const CHECK_RUNS = recordedRuns('fixtures/check');
/** The run that reached the DEX endpoints is the one on a token with a contract; the other is the coin. */
const TOKEN_RUN = CHECK_RUNS.find((run) => run.some((answer) => answer.endpoint === 'E10'));
const COIN_RUN = CHECK_RUNS.find((run) => !run.some((answer) => answer.endpoint === 'E10'));
if (TOKEN_RUN === undefined || COIN_RUN === undefined) {
  throw new Error('fixtures/check no longer holds one run on a token with a contract and one on a coin.');
}

const DEMO_ANSWERS = recordedIn('fixtures/demo');

/** One recorded demonstration answer, read the way the normalisers read it. */
function demoSource(endpoint: EndpointId, match: (answer: Recorded) => boolean) {
  const answer = DEMO_ANSWERS.find((one) => one.endpoint === endpoint && match(one));
  if (answer === undefined) throw new Error(`fixtures/demo carries no ${endpoint} answer of the kind this needs.`);
  return sourceFromBody(endpoint, answer.exchange.response.body, {
    file: answer.file,
    recordedAt: answer.exchange.recordedAt,
    latencyMs: answer.exchange.response.latencyMs,
  });
}

/** Both orders of the demonstration, replayed from the recorded answers: no key, and no network to reach. */
async function replayed(asset: string, sizeUsd: number): Promise<DemoTradeAnswer> {
  const client = createClientForMode({ kind: 'replay', dir: DEMO_FIXTURES }, { CMC_API_KEY: '' });
  // The index is rebuilt from the recorded walk rather than left to the cache of this clone: the paragraph this
  // checks rests on what C5 answered, and a clean checkout has no `.cache/` for it to fall back on (T9.1).
  const wrapperIndex = await replayIndex();
  const answer = await preflightTrade({ client, assess: { wrapperIndex } }, asset, 'buy', sizeUsd);
  if (answer.isError) throw new Error(`preflight_trade could not answer for ${asset}: ${answer.lines.join(' ')}`);
  return readTradeAnswer(answer.data);
}

const [REFUSED_SCENARIO, ACCEPTED_SCENARIO] = SCENARIOS;
if (REFUSED_SCENARIO === undefined || ACCEPTED_SCENARIO === undefined) {
  throw new Error('src/demo/scenarios.ts no longer carries the two scenarios the submission describes.');
}
const REFUSED = await replayed(REFUSED_SCENARIO.order.asset, REFUSED_SCENARIO.order.sizeUsd);
const ACCEPTED = await replayed(ACCEPTED_SCENARIO.order.asset, ACCEPTED_SCENARIO.order.sizeUsd);

function checkOf(answer: DemoTradeAnswer, id: CheckId) {
  const check = answer.checks.find((one) => one.id === id);
  if (check === undefined) throw new Error(`the replayed answer for ${answer.asked} carries no ${id}.`);
  return check;
}

describe('the text it hands over is the text between the markers', () => {
  it('states the hackathon and the track above them, where the guidance sits', () => {
    expect(GUIDE).toContain('Build with CMC: API Hackathon');
    expect(GUIDE).toContain('AI Agents and Automation');
  });

  it('declares exactly the placeholders the text carries, and every one is a link nobody here can fill in', () => {
    // Declared in the table of the guidance: `| `{{REPO_URL}}` | what to put there | ... |`.
    const declared = [...GUIDE.matchAll(/\| `\{\{([A-Z_]+)\}\}` \|/g)].map((match) => match[1] ?? '');
    const used = [...TEXT.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1] ?? '');
    expect(declared).toHaveLength(4);
    expect(new Set(used)).toEqual(new Set(declared));
    // Every placeholder is spent on a link, so a filled-in one is a link this repository cannot check.
    expect(stated(/\| Repository \| \{\{(\w+)\}\} \|/)[0]).toBe('REPO_URL');
    expect(FLAT).not.toMatch(/https?:\/\//);
  });

  it('tells the person pasting it what to check before pressing submit', () => {
    expect(GUIDE).toContain('Replace all four placeholders');
    // Re-reading the tone of the audit is a human step of the specification, and the guidance has to ask for it.
    expect(GUIDE).toContain('docs/API_AUDIT.md');
  });
});

describe('what it says the tool is', () => {
  it('names the four tools the server registers, and says how many there are', () => {
    expect(stated(/registers (\w+) tools/)[0]).toBe(spelled(TOOL_NAMES.length));
    for (const name of TOOL_NAMES) expect(FLAT, name).toContain(`\`${name}\``);
  });

  it('gives each check the title the outputs give it', () => {
    const rows = TEXT.split('\n').flatMap((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      if (cells.length !== 4 || !/^C\d$/.test(cells[1] ?? '')) return [];
      return [{ id: cells[1] as CheckId, title: cells[2] ?? '' }];
    });
    expect(rows.map((row) => row.id)).toEqual([...CHECK_IDS]);
    for (const row of rows) expect(row.title, row.id).toBe(CHECK_TITLES[row.id]);
  });

  it('states the two verdict boundaries the configuration holds', () => {
    const { score } = loadChecksConfig();
    const [act, caution] = stated(/`ACT` at (\d+) and above, `CAUTION` from (\d+), `DO_NOT_ACT` below it/);
    expect(Number(act)).toBe(score.actAtOrAbove);
    expect(Number(caution)).toBe(score.cautionAtOrAbove);
    // The thresholds are in the configuration and the text says where: a reader can go and see them.
    expect(FLAT).toContain('`config/checks.json`');
  });

  it('counts the checks a run with this key reaches, and says which one it does not', () => {
    expect(stated(/(\w+) of the seven run on real answers/)[0]?.toLowerCase()).toBe(
      spelled(ACCEPTED.coverage.evaluated),
    );
    expect(ACCEPTED.coverage.total).toBe(CHECK_IDS.length);
    // C2 is the one, and it reports that in every output: the engine leaves it with no endpoint to read, where
    // every other check names at least one. The refused sources it would have read are named further down.
    expect(checkOf(ACCEPTED, 'C2').status).toBe('unavailable');
    expect(checkOf(REFUSED, 'C2').status).toBe('unavailable');
    const config = loadChecksConfig();
    expect(explainCheck('C2', config).endpoints).toEqual([]);
    for (const id of CHECK_IDS.filter((one) => one !== 'C2')) {
      expect(explainCheck(id, config).endpoints.length, id).toBeGreaterThan(0);
    }
    expect(FLAT).toContain('which the Startup plan does not answer');
  });
});

describe('the calibration it claims, recomputed from the run', () => {
  const act = PANEL.outcomes.filter((outcome) => outcome.verdict === 'ACT');
  const below = PANEL.outcomes.filter((outcome) => outcome.verdict !== 'ACT');

  it('reports the share the panel reached and the share the specification asks for', () => {
    const [reached, size, share, target] = stated(
      /(\d+) of the (\d+) reach `ACT` — (\d+) %, against the (\d+) % target/,
    );
    expect(Number(reached)).toBe(act.length);
    expect(Number(size)).toBe(PANEL.outcomes.length);
    expect(Number(share)).toBe(PANEL.summary.actShare);
    expect(Number(target)).toBe(TARGET_ACT_SHARE);
    expect(PANEL.summary.meetsTarget).toBe(true);
  });

  it('says what holds the rest below it, and a critical observation is what does', () => {
    expect(stated(/while (\w+) stay below it on a critical observation/)[0]).toBe(spelled(below.length));
    for (const outcome of below) {
      expect(
        outcome.checks.some((check) => check.severity === 'critical'),
        `${outcome.member.symbol} is below ACT`,
      ).toBe(true);
    }
  });

  it('dates the panel by the day it was read, not by the day the report was written', () => {
    expect(FLAT).toContain(`live on ${PANEL.panelObservedAt.slice(0, 10)}`);
    expect(FLAT).toContain('`docs/CALIBRATION.md`');
  });
});

describe('the demonstration it describes, replayed', () => {
  it('quotes the order the agent is actually given', () => {
    expect(TEXT).toContain(`> ${REFUSED_SCENARIO.order.instruction}`);
    expect(FLAT).toContain('`npm run demo`');
  });

  it('counts the assets the recorded map answer carries under that symbol', () => {
    const candidates = normalizeAssetMap(
      demoSource('E01', (answer) => answer.exchange.request.query['symbol'] === REFUSED_SCENARIO.order.asset),
    );
    expect(stated(/returns (\w+) assets under that symbol/)[0]).toBe(spelled(candidates.items.length));
    expect(FLAT).toContain(`\`${ENDPOINTS.E01.path}\``);
  });

  it('names the asset the symbol resolved to, and the price it was carrying', () => {
    const resolved = REFUSED.resolved;
    expect(resolved?.name).not.toBeNull();
    expect(FLAT).toContain(`${String(resolved?.name)} (CMC ${String(resolved?.cmcId)})`);

    const quoted = normalizeQuotes(
      demoSource('E02', (answer) => answer.exchange.request.query['id'] === String(resolved?.cmcId)),
    );
    const priceUsd = quoted.items[0]?.priceUsd;
    expect(priceUsd, 'the recorded answer for the refused asset carries no price').toBeTypeOf('number');
    // "around 1e-11 USD": the order of magnitude, which is the only thing a price that small is quoted for here.
    const magnitude = statedNumber(/priced around 1e(-\d+) USD/);
    expect(Math.round(Math.log10(priceUsd ?? 0))).toBe(magnitude);
  });

  it('names the two readings that stopped the order, and both of them read that way', () => {
    // C5: the index links the resolved asset to no real-world asset, so the check does not apply to it.
    expect(FLAT).toContain(`C5 links CMC ${String(REFUSED.resolved?.cmcId)} to no real-world asset at all`);
    expect(checkOf(REFUSED, 'C5').status).toBe('not_applicable');

    // C4: the order is more than twice the depth of the deepest pool, which is a share above 200 %.
    const share = REFUSED.order.shareOfDeepestPoolPercent;
    expect(share, 'the refused answer weighed the order against no pool').not.toBeNull();
    expect(share ?? 0).toBeGreaterThan(200);
    expect(FLAT).toContain(
      `C4 reports that ${REFUSED.order.sizeUsd.toLocaleString('en-US')} USD is more than twice the depth`,
    );
    expect(REFUSED.order.sizeUsd).toBe(REFUSED_SCENARIO.order.sizeUsd);
  });

  it('says what the same order does on the wrapper, and that is what it does', () => {
    expect(FLAT).toContain(`The same order on ${ACCEPTED_SCENARIO.order.asset}`);
    expect(stated(/runs (\w+) of the seven checks, none of them raising a warning/)[0]?.toLowerCase()).toBe(
      spelled(ACCEPTED.coverage.evaluated),
    );
    expect(ACCEPTED.verdict).toBe('ACT');
    // Three findings of its C5 are informational — an inferred unit, a wrapper left out of the spread — and none
    // of them weighs on the score. What the text claims is that nothing above `info` was raised.
    const raised = ACCEPTED.checks.flatMap((check) => check.findings);
    expect(raised.filter((finding) => finding.severity !== 'info')).toEqual([]);
    expect(ACCEPTED.order.sizeUsd).toBe(REFUSED.order.sizeUsd);
  });

  it('says the agent places nothing, which is what the demonstration undertakes', () => {
    expect(FLAT).toContain('places no order, signs nothing and holds no wallet');
    expect(REFUSED_SCENARIO.recorded).toBe('refused');
    expect(ACCEPTED_SCENARIO.recorded).toBe('simulated');
  });
});

describe('the endpoint table, against the endpoints the client may call', () => {
  const rows = TEXT.split('\n').flatMap((line) => {
    const cells = line.split('|').map((cell) => cell.trim());
    const endpoint = /^`(GET|POST) (\/v\d\/[^`]+)`$/.exec(cells[2] ?? '');
    if (cells.length !== 5 || !/^E\d{2}$/.test(cells[1] ?? '') || endpoint === null) return [];
    return [{ id: cells[1] ?? '', method: endpoint[1] ?? '', path: endpoint[2] ?? '', role: cells[3] ?? '' }];
  });
  const inventory = readInventory();

  it('lists every endpoint the client may send, once, with the path it sends', () => {
    expect(rows.map((row) => row.id)).toEqual(Object.keys(ENDPOINTS));
    for (const row of rows) {
      expect(row.method, row.id).toBe('GET');
      expect(row.path, row.id).toBe(ENDPOINTS[row.id as EndpointId].path);
      expect(row.role.length, `${row.id} says what it is read for`).toBeGreaterThan(20);
    }
  });

  it('counts what was inventoried, what answered and what was refused', () => {
    const verified = inventory.filter((row) => row.status === 'verified');
    const refused = inventory.filter((row) => row.status === 'refused');
    expect(stated(/(\w+(?:-\w+)?) endpoints were inventoried/)[0]?.toLowerCase()).toBe(spelled(inventory.length));
    expect(stated(/(\w+) answered on the Startup plan/)[0]?.toLowerCase()).toBe(spelled(verified.length));
    expect(stated(/(\w+) were refused by the plan/)[0]?.toLowerCase()).toBe(spelled(refused.length));
    expect(verified.map((row) => row.id)).toEqual(Object.keys(ENDPOINTS));
  });

  it('names every refused endpoint with its path, and none of them is in the client', () => {
    const refused = inventory.filter((row) => row.status === 'refused');
    expect(refused.length).toBeGreaterThan(0);
    for (const row of refused) {
      expect(FLAT, `${row.id} is refused and the submission has to name it`).toContain(`${row.id} \`${row.path}\``);
      expect(Object.keys(ENDPOINTS), row.id).not.toContain(row.id);
    }
    // The two the text singles out as the per-exchange pairs C2 would have read are refused, and do feed C2.
    for (const id of ['E04', 'E21']) {
      const row = inventory.find((one) => one.id === id);
      expect(row?.status, id).toBe('refused');
      expect(row?.checks, id).toContain('C2');
    }
  });

  it('states what a cold verdict costs, by adding up what the recorded runs were charged', () => {
    // The two live `check` runs of T3.7: one on a wrapper with a contract, one on a coin with neither.
    const wrapper = credits(TOKEN_RUN);
    const coin = credits(COIN_RUN);
    const token = credits(TOKEN_RUN.filter((answer) => answer.endpoint !== 'E14'));
    const [forCoin, forToken, forWrapper] = stated(
      /costs (\d+) credits for a coin with no token contract, (\d+) for a token with one, and (\d+) when that token is a wrapper/,
    );
    expect(Number(forCoin)).toBe(coin);
    expect(Number(forToken)).toBe(token);
    expect(Number(forWrapper)).toBe(wrapper);
  });

  it('names exactly the endpoints that report no credit cost', () => {
    const free = Object.entries(ENDPOINTS)
      .filter(([, endpoint]) => endpoint.credits === 0)
      .map(([id]) => id);
    expect(stated(/(E\d\d, E\d\d and E\d\d) report no credit cost/)[0]).toBe(
      `${free.slice(0, -1).join(', ')} and ${String(free.at(-1))}`,
    );
  });
});

describe('the corpus it rests on, counted', () => {
  const parts = RUN.corpus.parts;
  const answers = parts.flatMap((part) => recordedIn(part.dir));

  it('counts the recorded answers, the sessions they were captured in and the days they span', () => {
    expect(statedNumber(/is (\d+) recorded answers/)).toBe(answers.length);
    expect(answers.length).toBe(RUN.totals.answers);
    expect(stated(/captured in (\w+) sessions/)[0]?.toLowerCase()).toBe(spelled(parts.length));
    const days = answers.map(({ exchange }) => exchange.recordedAt.slice(0, 10)).sort();
    expect(FLAT).toContain(`between ${String(days.at(0))} and ${String(days.at(-1))}`);
    for (const part of parts) expect(recordedIn(part.dir), part.name).toHaveLength(part.answers);
  });

  it('splits them between the endpoints that answered and the refusals of those that did not', () => {
    const refusals = answers.filter(({ endpoint }) => endpoint === undefined);
    const [overEndpoints, endpoints, refused] = stated(
      /(\d+) over those (\d+) endpoints and (\d+) refusals of the (?:\w+) the plan does not answer/,
    );
    expect(Number(overEndpoints)).toBe(answers.length - refusals.length);
    expect(Number(endpoints)).toBe(RUN.totals.endpoints);
    expect(Number(refused)).toBe(refusals.length);
    expect(new Set(answers.map(({ endpoint }) => endpoint).filter((id) => id !== undefined)).size).toBe(
      RUN.totals.endpoints,
    );
  });

  it('has the key masked in every one of them, which is what it claims', () => {
    expect(FLAT).toContain('with the API key masked in every one');
    for (const { file, exchange } of answers) {
      expect(exchange.request.headers[KEY_HEADER], file).toBe(MASK);
    }
  });
});

describe('the audit it points at, against the run that was published', () => {
  const byKind = (kind: string): number => RUN.findings.filter((finding) => finding.kind === kind).length;

  it('counts the entries the report printed, by the kind the report gives them', () => {
    const [entries, measurements, signals, suggestions] = stated(
      /published (\d+) entries — (\d+) measurements, (\d+) things a consumer has to plan for, and (\d+) suggestion/,
    );
    expect(Number(entries)).toBe(RUN.findings.length);
    expect(Number(measurements)).toBe(byKind('observed'));
    expect(Number(signals)).toBe(byKind('signal'));
    expect(Number(suggestions)).toBe(byKind('suggestion'));
    expect(RUN.review.entries).toBe(RUN.findings.length);
  });

  it('counts the statements read back a second time, and says both drop counts were zero', () => {
    expect(statedNumber(/(\d+) statements were read back/)).toBe(RUN.review.claims);
    expect(FLAT).toContain('in this run both were zero');
    expect(RUN.withheld).toBe(0);
    expect(RUN.unproven).toBe(0);
    expect(RUN.review.unproven).toEqual([]);
  });

  it('states what the audit spends and what the captures reported', () => {
    expect(statedNumber(/costs (\d+) credits and reproduces on a clone/)).toBe(RUN.totals.creditsSpent);
    expect(statedNumber(/reported (\d+) credits between them/)).toBe(RUN.totals.creditsReported);
  });

  it('names the envelope observation under the wording the report published it with', () => {
    const shapes = stated(/the `status` envelope arrives in (\w+) shapes/)[0] ?? '';
    expect(RUN.findings.map((finding) => finding.title).join(' | ')).toContain(`arrives in ${shapes} shapes`);
  });

  it('counts the suggestions of the feedback note it sends the reader to', () => {
    const feedback = readFileSync(join(projectRoot, 'docs', 'API_FEEDBACK.md'), 'utf8');
    const suggestions = [...feedback.matchAll(/^### S\d+ · /gm)].length;
    expect(stated(/and (\w+) suggestions, each with the recorded answers/)[0]?.toLowerCase()).toBe(
      spelled(suggestions),
    );
  });

  it('says of the evidence page what the evidence page actually walks', () => {
    const evidence = readFileSync(join(projectRoot, 'docs', 'EVIDENCE.md'), 'utf8');
    const walked = /### \d+\.\d+ The sentence those (\w+) answers produce/.exec(evidence)?.[1];
    expect(walked, 'docs/EVIDENCE.md no longer closes its walk on a count of answers').toBeDefined();
    expect(stated(/from (\w+) recorded answers to the sentence they produce/)[0]).toBe(walked);
  });

  it('counts the refusals the way the recorded answers do', () => {
    // "three pages list a plan the key did not confirm": the refusals that came back 403 / 1006, not all four.
    const refusals = recordedIn('fixtures/discovery').filter(({ endpoint }) => endpoint === undefined);
    const byEndpoint = new Map<string, number[]>();
    for (const { exchange } of refusals) {
      const body = exchange.response.body as { status?: { error_code?: number | string } };
      byEndpoint.set(exchange.request.path, [
        ...(byEndpoint.get(exchange.request.path) ?? []),
        Number(body.status?.error_code),
      ]);
    }
    const plan = [...byEndpoint.values()].filter((codes) => codes.every((code) => code === 1006));
    const parameter = [...byEndpoint.values()].filter((codes) => codes.every((code) => code === 400));
    expect(stated(/(\w+) pages list a plan the key did not confirm/)[0]?.toLowerCase()).toBe(spelled(plan.length));
    expect(stated(/(\w+) 400 names no parameter/)[0]?.toLowerCase()).toBe(spelled(parameter.length));
  });
});

describe('everything it tells a reader to run or to open', () => {
  it('names only commands this package defines', () => {
    const commands = [...TEXT.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] ?? '');
    expect(commands.length).toBeGreaterThan(4);
    for (const command of new Set(commands)) expect(Object.keys(SCRIPTS), command).toContain(command);
    // `npm install` and `npm test` are npm's own, and the quick start opens on them.
    expect(FLAT).toContain('npm install');
    expect(SCRIPTS['test']).toBeDefined();
  });

  it('gives the replay flag the form the command line parses', () => {
    const [asset, dir] = stated(/npm run check -- (\w+) --replay=([\w/]+)/);
    expect(existsSync(join(projectRoot, dir ?? '')), dir).toBe(true);
    // The same invitation the README makes, so the two documents cannot drift apart on it.
    expect(README).toContain(`npm run check -- ${String(asset)} --replay=${String(dir)}`);
  });

  it('sends an MCP host at the entry point the mcp script runs', () => {
    const entry = stated(/point the host at `([\w/.]+)`/)[0] ?? '';
    expect(SCRIPTS['mcp']).toContain(entry);
    // A built path: it exists after `npm run build`, which the same sentence asks for.
    expect(FLAT).toContain('`npm run build`');
    for (const host of ['Claude Desktop', 'Claude Code']) expect(README, host).toContain(host);
    expect(existsSync(join(projectRoot, 'tests', 'mcp-config-doc.test.ts'))).toBe(true);
  });

  it('resolves every path in the repository it cites', () => {
    const cited = new Set(
      [...TEXT.matchAll(/`([\w.-]+(?:\/[\w.-]+)+)`/g)]
        .map((match) => match[1] ?? '')
        // `dist/` is a build output and is checked against the script that runs it instead.
        .filter((path) => !path.startsWith('dist/')),
    );
    expect(cited.size).toBeGreaterThan(5);
    for (const path of cited) expect(existsSync(join(projectRoot, path)), path).toBe(true);
  });

  it('backs the two claims it makes about the key with the code that holds them', () => {
    expect(FLAT).toContain('`NEXT_PUBLIC_`');
    expect(readFileSync(join(projectRoot, 'src', 'web', 'settings.ts'), 'utf8')).toContain(
      "export const PUBLIC_PREFIX = 'NEXT_PUBLIC_'",
    );
    expect(FLAT).toContain('`scripts/check-secrets.sh`');
  });
});

describe('the rule of tone, applied to the submission as to the report', () => {
  it('uses no word this project undertakes not to use about the API', () => {
    const issues = toneIssues({
      kind: 'observed',
      endpoints: [],
      title: '',
      statement: DOC,
      measurement: null,
      evidence: [],
    });
    expect(issues.map((issue) => issue.reason)).toEqual([]);
  });

  it('closes on the hashtag the rules ask for', () => {
    expect(FLAT).toContain('#BuildwithCMC');
  });
});
