/**
 * The post on X of T8.6, checked against the repository it describes.
 *
 * Four short posts are the smallest deliverable of this project and the most exposed: they are published once, to
 * an audience that cannot open a fixture, and every number in them is a claim about a recording that lives here.
 * A post is also the one place where a sentence has to be short — and shortening a sentence is exactly how a
 * measured figure turns into a remembered one.
 *
 * So the drafts are read the way the submission text is read: nothing for plausibility.
 *
 * 1. **Every figure is recomputed.** The calibration share from `docs/calibration.json`, the number of published
 *    audit entries from `docs/api_audit.json`, the assets sharing the ticker by normalising the recorded `map`
 *    answer, the price of the one it resolves to from the recorded quote, and the refusal by replaying both orders
 *    through `preflight_trade` with no key and no network.
 * 2. **Every count of the engine comes from the engine.** The verdict names from `VERDICTS`, the number of checks
 *    from `CHECK_IDS`, the three families of sources from the paths the client may actually send.
 * 3. **Each post is counted the way X counts it** — one per character, 23 per link — and the length the document
 *    declares has to be that number, and to fit.
 * 4. **The four placeholders are declared once and used once**, and no post carries a literal URL.
 * 5. **Post 1 carries the three things the rules ask for**: the BUIDL link, the video and the hashtag. That is the
 *    post that can go out alone, so it is the one held to the rules on its own.
 * 6. **The wording goes through the tone gate of `src/audit/review.ts`**, the same one the audit applies to its own
 *    entries.
 *
 * What is deliberately not checked is whether the post is worth reading, and whether the moment to publish it is
 * right. Both are judgements, and the document says so above the drafts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toneIssues } from '../src/audit/review.js';
import type { AuditRun } from '../src/audit/run.js';
import { assessAsset, parseSubject } from '../src/checks/assess.js';
import type { CalibrationRun } from '../src/calibration/run.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { ENDPOINTS, endpointForPath, type EndpointId } from '../src/cmc/endpoints.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { readTradeAnswer, type DemoTradeAnswer } from '../src/demo/answers.js';
import { DEMO_FIXTURES } from '../src/demo/run.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { normalizeAssetMap } from '../src/normalize/identity.js';
import { normalizeQuotes } from '../src/normalize/aggregated.js';
import { sourceFromBody } from '../src/normalize/model.js';
import { preflightTrade } from '../src/mcp/tools.js';
import { VERDICTS } from '../src/score/verdict.js';
import { CHECK_FIXTURES, paxosIndex } from './helpers/check-fixtures.js';
import { replayIndex } from './helpers/rwa-index.js';
import { projectRoot } from './helpers/endpoints-doc.js';

/** What X allows one post, and what it counts a link as whatever its length. Stated in the document too. */
const LIMIT = 280;
const LINK = 23;

const DOC = readFileSync(join(projectRoot, 'docs', 'X_POST.md'), 'utf8');
/** The document on one line: a sentence it states may be wrapped anywhere. */
const FLAT = DOC.replace(/\s+/g, ' ');
const SUBMISSION = readFileSync(join(projectRoot, 'docs', 'SUBMISSION.md'), 'utf8');
const SPEC = readFileSync(join(projectRoot, 'CAHIER_DES_CHARGES.md'), 'utf8');

const RUN = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;
const PANEL = JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as CalibrationRun;

/** One draft: the number of the section that carries it, and the text of its first fenced block. */
interface Post {
  number: number;
  title: string;
  text: string;
}

/** The drafts, in the order the document lays them out. */
const POSTS: Post[] = [...DOC.matchAll(/^### Post (\d+) — (.+)\n\n```text\n([\s\S]*?)\n```/gm)].map((match) => ({
  number: Number(match[1]),
  title: match[2] ?? '',
  text: match[3] ?? '',
}));

const [POST1, POST2, POST3, POST4] = POSTS;
if (POST1 === undefined || POST2 === undefined || POST3 === undefined || POST4 === undefined) {
  throw new Error('docs/X_POST.md no longer carries four drafts in fenced `text` blocks, so there is nothing to check.');
}

/** Everything the drafts say, on one line, for a claim that may be in any of them. */
const DRAFTS = POSTS.map((post) => post.text).join('\n');

/** How long X makes this post: one per character, and 23 for a link whatever its length. */
function countedLength(text: string): number {
  return [...text.replace(/\{\{[A-Z_]+\}\}/g, 'x'.repeat(LINK))].length;
}

/** The length the table above the drafts declares for one post, read from its row. */
function declaredLength(post: Post): number {
  const row = new RegExp(`\\| ${String(post.number)} \\| [^|]+ \\| (\\d+) of (\\d+) \\|`).exec(DOC);
  expect(row, `the table above the drafts no longer declares a length for post ${String(post.number)}`).not.toBeNull();
  expect(Number(row?.[2]), 'the table declares a limit other than the one X applies').toBe(LIMIT);
  return Number(row?.[1]);
}

/** What one sentence of the document states, by the pattern that finds it. Fails when the sentence is gone. */
function stated(pattern: RegExp, text = DRAFTS): string[] {
  const match = pattern.exec(text.replace(/\s+/g, ' '));
  expect(match, `the drafts no longer say: ${pattern.source}`).not.toBeNull();
  return (match ?? []).slice(1);
}

/** English for the counts the drafts spell out in words, so a count that moves fails rather than reading oddly. */
const SPELLED: Record<number, string> = { 3: 'three', 4: 'four', 6: 'six', 7: 'seven' };

function spelled(count: number): string {
  const word = SPELLED[count];
  if (word === undefined) throw new Error(`No English spelling is recorded for ${String(count)}.`);
  return word;
}

/** One recorded answer of the demonstration, with the endpoint that answered it. */
interface Recorded {
  file: string;
  exchange: RecordedExchange;
  endpoint: EndpointId | undefined;
}

const DEMO_ANSWERS: Recorded[] = readdirSync(DEMO_FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const file = join(DEMO_FIXTURES, name);
    const exchange = JSON.parse(readFileSync(file, 'utf8')) as RecordedExchange;
    return { file, exchange, endpoint: endpointForPath(exchange.request.path) };
  });

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

/** One order of the demonstration, replayed from the recorded answers: no key, and no network to reach. */
async function replayed(asset: string, sizeUsd: number): Promise<DemoTradeAnswer> {
  const client = createClientForMode({ kind: 'replay', dir: DEMO_FIXTURES }, { CMC_API_KEY: '' });
  // The index is rebuilt from the recorded walk rather than left to the cache of this clone: post 3 rests on what
  // C5 answered, and a clean checkout has no `.cache/` for it to fall back on (T9.1).
  const wrapperIndex = await replayIndex();
  const answer = await preflightTrade({ client, assess: { wrapperIndex } }, asset, 'buy', sizeUsd);
  if (answer.isError) throw new Error(`preflight_trade could not answer for ${asset}: ${answer.lines.join(' ')}`);
  return readTradeAnswer(answer.data);
}

const [REFUSED_SCENARIO] = SCENARIOS;
if (REFUSED_SCENARIO === undefined) {
  throw new Error('src/demo/scenarios.ts no longer carries the order these posts describe.');
}
const REFUSED = await replayed(REFUSED_SCENARIO.order.asset, REFUSED_SCENARIO.order.sizeUsd);

/** The checks of one replayed verdict, by id. */
function checkOf(answer: DemoTradeAnswer, id: (typeof CHECK_IDS)[number]) {
  const check = answer.checks.find((one) => one.id === id);
  if (check === undefined) throw new Error(`the replayed answer for ${answer.asked} carries no ${id}.`);
  return check;
}

describe('four drafts, each one short enough to publish', () => {
  it('lays out the posts in order, each in a fenced block of its own', () => {
    expect(POSTS.map((post) => post.number)).toEqual([1, 2, 3, 4]);
    for (const post of POSTS) expect(post.text.trim(), `post ${String(post.number)} is empty`).not.toBe('');
  });

  it('counts each post the way X counts it, and declares that number', () => {
    for (const post of POSTS) {
      const counted = countedLength(post.text);
      expect(counted, `the declared length of post ${String(post.number)} is not what it counts`).toBe(
        declaredLength(post),
      );
      expect(counted, `post ${String(post.number)} is over the limit`).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('states the two numbers that counting rests on, so a reader can redo it', () => {
    expect(FLAT).toContain(`holds ${String(LIMIT)} characters`);
    expect(FLAT).toContain(`every link counts as ${String(LINK)} of them`);
  });

  it('declares exactly the placeholders the drafts carry, once each, and carries no live URL', () => {
    // Declared in the table of the guidance: `| `{{BUIDL_URL}}` | what to put there | ... |`.
    const declared = [...DOC.matchAll(/\| `\{\{([A-Z_]+)\}\}` \|/g)].map((match) => match[1] ?? '');
    const used = [...DRAFTS.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1] ?? '');
    expect(declared).toHaveLength(4);
    expect(new Set(used)).toEqual(new Set(declared));
    expect(used, 'a placeholder is carried twice, so one of them would be filled in and forgotten').toHaveLength(4);
    expect(DRAFTS).not.toMatch(/https?:\/\//);
  });

  it('points the link this post will have at the placeholder that waits for it', () => {
    expect(FLAT).toContain('fills the `X_POST_URL` placeholder of `docs/SUBMISSION.md`');
    expect(SUBMISSION).toContain('{{X_POST_URL}}');
  });

  it('names every file it sends the reader to, and each one is here', () => {
    for (const path of new Set([...DOC.matchAll(/`((?:docs|src|tests|fixtures|config)\/[\w./-]+)`/g)].map((m) => m[1] ?? ''))) {
      expect(existsSync(join(projectRoot, path)), path).toBe(true);
    }
  });
});

describe('post 1, the one post that can go out alone', () => {
  it('carries the three things the rules ask of it', () => {
    expect(POST1.text).toContain('{{BUIDL_URL}}');
    expect(POST1.text).toContain('{{VIDEO_URL}}');
    expect(POST1.text).toContain('#BuildwithCMC');
    // And the document says as much, since that is what makes the thread optional rather than required.
    expect(FLAT).toContain('Publish post 1. It carries the three things the rules ask for and stands alone.');
  });

  it('names the three verdicts the engine answers, and only those', () => {
    const [act, caution, doNot] = stated(/answers (\w+), (\w+) or (\w+)\./, POST1.text);
    expect([act, caution, doNot]).toEqual([...VERDICTS]);
  });

  it('says what the demonstration agent does with the order, and that is what it does', () => {
    expect(POST1.text).toContain('the demo agent refuses');
    expect(REFUSED_SCENARIO.recorded).toBe('refused');
    // "Told to buy tokenised gold": the order it is given says so, in the words the agent is given them in.
    expect(REFUSED_SCENARIO.order.instruction.toLowerCase()).toContain('tokenised gold');
  });
});

describe('post 2, the method', () => {
  it('counts the checks the engine holds', () => {
    expect(stated(/(\w+) checks read one against another/, POST2.text)[0]?.toLowerCase()).toBe(
      spelled(CHECK_IDS.length),
    );
  });

  it('names three families of sources, and the client may send at least one path of each', () => {
    const paths = Object.values(ENDPOINTS).map((endpoint) => endpoint.path);
    const families = {
      'aggregated quotes': paths.filter((path) =>
        /\/cryptocurrency\/quotes\/latest$|\/simple\/price$|\/tools\/price-conversion$/.test(path),
      ),
      'DEX pools': paths.filter((path) => path.includes('/dex/')),
      'real-world-asset catalogue': paths.filter((path) => path.includes('/real-world-assets/')),
    };
    for (const [family, matched] of Object.entries(families)) {
      expect(POST2.text, family).toContain(family);
      expect(matched.length, family).toBeGreaterThan(0);
    }
    // Three families, and no path counted in two of them: that is what "do not derive from one another" rests on.
    const all = Object.values(families).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(stated(/How: (\w+) CoinMarketCap endpoint families/, POST2.text)[0]).toBe(spelled(3));
  });

  it('claims evidence behind every check, and every check that ran carries it', async () => {
    expect(POST2.text).toContain('every check names the answers it read');
    const client = createClientForMode({ kind: 'replay', dir: CHECK_FIXTURES }, {});
    const assessment = await assessAsset(client, parseSubject('PAXG'), { wrapperIndex: paxosIndex() });
    const ran = assessment.checks.filter((check) => check.status === 'evaluated');
    expect(ran.length, 'no check ran, so the claim rests on nothing').toBeGreaterThan(0);
    for (const check of ran) {
      expect(check.sources.length, `${check.id} names no answer`).toBeGreaterThan(0);
      for (const source of check.sources) {
        expect(existsSync(source.fixture?.file ?? ''), `${check.id} names an answer that is not here`).toBe(true);
      }
    }
  }, 60_000);
});

describe('post 3, the order it refused', () => {
  it('quotes the ticker the order was given under', () => {
    expect(POST3.text).toContain(`${REFUSED_SCENARIO.order.asset} is the ISO code for an ounce of gold`);
  });

  it('counts the assets the recorded map answer carries under that ticker', () => {
    const candidates = normalizeAssetMap(
      demoSource('E01', (answer) => answer.exchange.request.query['symbol'] === REFUSED_SCENARIO.order.asset),
    );
    expect(stated(/returns (\w+) assets under it/, POST3.text)[0]).toBe(spelled(candidates.items.length));
  });

  it('gives the order of magnitude the recorded quote carries for the one it resolved to', () => {
    const resolved = REFUSED.resolved;
    const quoted = normalizeQuotes(
      demoSource('E02', (answer) => answer.exchange.request.query['id'] === String(resolved?.cmcId)),
    );
    const priceUsd = quoted.items[0]?.priceUsd;
    expect(priceUsd, 'the recorded answer for the refused asset carries no price').toBeTypeOf('number');
    const magnitude = Number(stated(/priced around 1e(-\d+) USD/, POST3.text)[0]);
    expect(Math.round(Math.log10(priceUsd ?? 0))).toBe(magnitude);
  });

  it('claims two independent readings, and two of them read that way', () => {
    expect(POST3.text).toContain('Two independent readings stop the order');
    // C5: the index links the asset the ticker resolved to to no real-world asset, so the check does not apply.
    expect(checkOf(REFUSED, 'C5').status).toBe('not_applicable');
    // C4: the order is more than twice the depth of the deepest pool behind that price.
    const share = REFUSED.order.shareOfDeepestPoolPercent;
    expect(share, 'the refused answer weighed the order against no pool').not.toBeNull();
    expect(share ?? 0).toBeGreaterThan(200);
  });
});

describe('post 4, what it was measured against', () => {
  it('states the calibration panel and the share of it that reaches the first verdict', () => {
    const { summary } = PANEL;
    const [assets, reached, share] = stated(/top (\d+) by market cap, (\d+) answer ACT — (\d+)%/, POST4.text);
    expect(Number(assets)).toBe(summary.assets);
    expect(Number(reached)).toBe(summary.verdicts.ACT);
    expect(Number(share)).toBe(summary.actShare);
    expect(summary.meetsTarget).toBe(true);
  });

  it('counts the entries the audit published, and every one cites an answer that is here', () => {
    expect(Number(stated(/API audit: (\d+) entries/, POST4.text)[0])).toBe(RUN.findings.length);
    expect(POST4.text).toContain('each citing a recorded answer');
    for (const finding of RUN.findings) {
      const files = finding.evidence.map((evidence) => evidence.file).filter((file) => file.trim() !== '');
      expect(files.length, `${finding.id} cites no answer`).toBeGreaterThan(0);
      for (const file of files) expect(existsSync(join(projectRoot, file)), file).toBe(true);
    }
    // Nothing was withheld for want of proof, which is what lets the count stand as published.
    expect(RUN.review.unproven).toEqual([]);
  });
});

describe('the steps it leaves to a human', () => {
  it('gives the order to publish in, and the last check before send', () => {
    expect(FLAT).toContain('Two links point at each other');
    expect(FLAT).toContain('nothing goes out carrying a `{{`');
  });

  it('states the closing date the specification states', () => {
    const [day, month, year, hour, minute] = stated(/(\d{1,2}) (septembre) (\d{4}), (\d{2})h(\d{2}) UTC/, SPEC);
    expect(month).toBe('septembre');
    const iso = `${String(year)}-09-${String(day).padStart(2, '0')}`;
    expect(FLAT).toContain(`**${iso}, ${String(hour)}:${String(minute)} UTC**`);
  });
});

describe('the rule of tone, applied to the drafts as to the report', () => {
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
});
