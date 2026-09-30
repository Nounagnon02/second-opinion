/**
 * The shooting script of T8.5, checked against the runs it films.
 *
 * A video script is a promise about frames that do not exist yet: someone will sit down, type what it says and
 * expect the lines it quotes to appear. If a limit moves, a fixture is re-recorded or a message is reworded, the
 * script keeps reading perfectly well while describing a run nobody can reproduce — and the person recording finds
 * out with the camera on.
 *
 * So every **Land on** block is held against a real run made here, offline:
 *
 * 1. **the demonstration transcript** — the built MCP server is spawned with `--replay=fixtures/demo`, both
 *    scenarios are driven over stdio and `describeRun` renders the same lines `npm run demo` prints;
 * 2. **the `check` output** — the command is run against `fixtures/check`, the way the script types it;
 * 3. **the asset page** — read through `lookupAsset`, the one call the page makes;
 * 4. **the audit page** — read through `loadAuditView`, the one call that page makes.
 *
 * A quoted line that no longer appears in the run its shot names fails here, whitespace aside. Around that: the
 * shots have to be contiguous and add up to 90 seconds, each declared word count has to match its narration and
 * read at a speakable rate, every command has to be one `package.json` defines, every path has to exist, the two
 * placeholders have to be declared once and used once, the limits the narration quotes have to be the ones in
 * `config/checks.json`, and the wording goes through the tone gate of `src/audit/review.ts`.
 *
 * What is not checked is the directing: whether nine seconds is enough to read a line, or whether the cut works.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { toneIssues } from '../src/audit/review.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { parseCheckArgs, runCheck } from '../src/cli/check.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { DemoHost } from '../src/demo/host.js';
import {
  DEMO_FIXTURES,
  SERVER_ENTRY,
  describeRun,
  ensureWrapperIndex,
  runScenario,
  type ScenarioRun,
} from '../src/demo/run.js';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { loadAuditView, type AuditView } from '../src/web/audit-view.js';
import { lookupAsset } from '../src/web/lookup.js';
import { DEFAULT_AUDIT_FILE } from '../src/web/settings.js';
import { CHECK_FIXTURES, paxosIndex } from './helpers/check-fixtures.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const DOC = readFileSync(join(projectRoot, 'docs', 'VIDEO_SCRIPT.md'), 'utf8');
const FLAT = flat(DOC);
const SCRIPTS = (
  JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts;
const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');
const SUBMISSION = readFileSync(join(projectRoot, 'docs', 'SUBMISSION.md'), 'utf8');

/** One line, whitespace collapsed: the transcript wraps at 100 columns and a document wraps where it likes. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The runs the shots are checked against, by the label a shot names. `null` is a card, which films nothing. */
const SOURCES = new Map<string, () => string | null>();

/** The label of every shot, in shot order, and what the shot says a viewer should read. */
interface Shot {
  number: number;
  start: number;
  end: number;
  length: number;
  title: string;
  source: string;
  landOn: string[];
  declaredWords: number;
  narration: string;
  typed: string[];
  fences: string[];
}

const HEADING = /^### Shot (\d+) — (\d):(\d{2}) → (\d):(\d{2}) \((\d+) s\) · (.+)$/gm;

function seconds(minutes: string, rest: string): number {
  return Number(minutes) * 60 + Number(rest);
}

/** Every fenced block of one section, in order, without its fences. */
function fencesOf(body: string): string[] {
  return [...body.matchAll(/```\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
}

/** The fenced block that follows a marker, or null when the marker carries prose instead. */
function fenceAfter(body: string, marker: string): string | null {
  const at = body.indexOf(marker);
  if (at < 0) return null;
  const next = body.indexOf('**', at + marker.length);
  const section = body.slice(at, next < 0 ? body.length : next);
  return fencesOf(section)[0] ?? null;
}

function parseShots(): Shot[] {
  const heads = [...DOC.matchAll(HEADING)];
  return heads.map((head) => {
    const from = head.index;
    // The section ends at the next heading of any level: the prose after the last shot names the same markers,
    // and a body that ran to the end of the file would read them as part of it.
    const after = DOC.slice(from + head[0].length);
    const next = /\n#{2,3} /.exec(after);
    const body = head[0] + after.slice(0, next === null ? after.length : next.index);
    const source = /\*\*Checked against\*\* `([^`]+)`/.exec(body)?.[1] ?? '';
    const say = /\*\*Say\*\* \((\d+) words\)\n\n((?:> .*\n)+)/.exec(body);
    const landOn = fenceAfter(body, '**Land on**');
    const typed = fenceAfter(body, '**Type**');
    return {
      number: Number(head[1]),
      start: seconds(head[2] ?? '', head[3] ?? ''),
      end: seconds(head[4] ?? '', head[5] ?? ''),
      length: Number(head[6]),
      title: head[7] ?? '',
      source,
      landOn: (landOn ?? '').split('\n').filter((line) => line.trim() !== ''),
      declaredWords: Number(say?.[1] ?? '0'),
      narration: (say?.[2] ?? '').replace(/^> /gm, '').trim(),
      typed: (typed ?? '').split('\n').filter((line) => line.trim() !== ''),
      fences: fencesOf(body),
    };
  });
}

const SHOTS = parseShots();
if (SHOTS.length === 0) throw new Error('docs/VIDEO_SCRIPT.md carries no shot heading this test can read.');

/** The transcript `npm run demo` prints, rendered from a real run of the real server over stdio. */
let TRANSCRIPT = '';
/** What `npm run check -- PAXG --replay=fixtures/check` prints. */
let CHECK = '';
/** The asset page of shot 6, and the audit page of shot 7. */
let PAGE = '';
let AUDIT: AuditView | null = null;

beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'pipe', timeout: 300_000 });
  // The spawned server reads the index from `.cache/`, which a clean checkout does not have; `npm run demo` rebuilds
  // it offline before spawning anything, and so does this, or shot 4 would film a transcript missing C5 (T9.1).
  await ensureWrapperIndex(DEFAULT_INDEX_FILE);
}, 300_000);

beforeAll(async () => {
  // The same spawn the demonstration makes, with an empty key so that a run reaching the API would fail on the
  // key rather than spend a credit.
  const host = await DemoHost.connect({
    entry: SERVER_ENTRY,
    serverArgs: [`--replay=${DEMO_FIXTURES}`],
    env: { PATH: process.env.PATH ?? '', CMC_API_KEY: '' },
    cwd: tmpdir(),
  });
  const runs: ScenarioRun[] = [];
  let log: string;
  try {
    for (const scenario of SCENARIOS) runs.push(await runScenario(host, scenario));
    log = host.log();
  } finally {
    await host.close();
  }
  TRANSCRIPT = flat(describeRun(runs, { kind: 'replay', dir: DEMO_FIXTURES }, 'cached', log).join('\n'));

  const args = parseCheckArgs(['PAXG', `--replay=${CHECK_FIXTURES}`], projectRoot);
  const run = await runCheck(args, {}, {}, { wrapperIndex: paxosIndex() });
  expect(run.ok, 'the check run the script films no longer succeeds').toBe(true);
  CHECK = flat(run.lines.join('\n'));

  // No mode and no key, which is the state the browser was in: the interface falls back to replay and says so.
  const page = await lookupAsset(
    'XAU',
    { SECOND_OPINION_FIXTURES: DEMO_FIXTURES },
    { config: loadChecksConfig(), wrapperIndex: paxosIndex() },
  );
  if (page.status !== 'ok') throw new Error(`the asset page of shot 6 no longer answers for XAU: ${page.status}`);
  PAGE = flat([page.view.title, page.view.summary, page.modeNote].join('\n'));

  AUDIT = loadAuditView(DEFAULT_AUDIT_FILE);
  if (AUDIT === null) throw new Error('docs/api_audit.json is not readable, so shot 7 films nothing.');

  SOURCES.set('demo transcript', () => TRANSCRIPT);
  SOURCES.set('check output', () => CHECK);
  SOURCES.set('asset page', () => PAGE);
  SOURCES.set('audit page', () => flat((AUDIT?.stats ?? []).map((stat) => `${stat.value} ${stat.label}`).join('\n')));
  SOURCES.set('title card', () => null);
}, 300_000);

describe('the shots, as a timeline', () => {
  it('runs from 0:00 to 1:30 with no gap and no overlap', () => {
    expect(SHOTS.map((shot) => shot.number)).toEqual(SHOTS.map((_, index) => index + 1));
    expect(SHOTS[0]?.start).toBe(0);
    expect(SHOTS.at(-1)?.end).toBe(90);
    for (const [index, shot] of SHOTS.entries()) {
      const previous = SHOTS[index - 1];
      if (previous !== undefined) expect(shot.start, `shot ${String(shot.number)} starts`).toBe(previous.end);
      expect(shot.end - shot.start, `shot ${String(shot.number)} lasts`).toBe(shot.length);
    }
    expect(SHOTS.reduce((total, shot) => total + shot.length, 0)).toBe(90);
  });

  it('is the timeline the table at the top announces', () => {
    const rows = [...DOC.matchAll(/^\| (\d+) \| (\d):(\d{2}) \| (\d):(\d{2}) \| (\d+) s \| (.+?) \|$/gm)];
    expect(rows).toHaveLength(SHOTS.length);
    for (const [index, row] of rows.entries()) {
      const shot = SHOTS[index];
      expect(Number(row[1])).toBe(shot?.number);
      expect(seconds(row[2] ?? '', row[3] ?? '')).toBe(shot?.start);
      expect(seconds(row[4] ?? '', row[5] ?? '')).toBe(shot?.end);
      expect(Number(row[6])).toBe(shot?.length);
    }
  });

  it('adds up the shorter cut it offers', () => {
    const listed = /Shots ([\d, and]+) are the demonstration and the close/.exec(FLAT)?.[1] ?? '';
    const numbers = [...listed.matchAll(/\d+/g)].map((match) => Number(match[0]));
    expect(numbers.length).toBeGreaterThan(2);
    const kept = numbers.map((number) => {
      const shot = SHOTS.find((one) => one.number === number);
      expect(shot, `the shorter cut names shot ${String(number)}, which does not exist`).toBeDefined();
      return shot?.length ?? 0;
    });
    const stated = Number(/hold together on their own at about (\d+) seconds/.exec(FLAT)?.[1] ?? '0');
    expect(kept.reduce((total, length) => total + length, 0)).toBe(stated);
  });
});

describe('what each shot tells the viewer to read', () => {
  it('names a run this test can make, and every one of them is used', () => {
    const named = new Set(SHOTS.map((shot) => shot.source));
    for (const source of named) expect([...SOURCES.keys()], source).toContain(source);
    expect(named).toEqual(new Set(SOURCES.keys()));
  });

  it('quotes only lines that run still prints', () => {
    let quoted = 0;
    for (const shot of SHOTS) {
      const text = SOURCES.get(shot.source)?.() ?? null;
      if (text === null) {
        expect(shot.landOn, `shot ${String(shot.number)} films a card and cannot land on a line`).toEqual([]);
        continue;
      }
      expect(shot.landOn.length, `shot ${String(shot.number)} lands on nothing`).toBeGreaterThan(0);
      for (const line of shot.landOn) {
        quoted += 1;
        expect(text, `shot ${String(shot.number)} quotes a line ${shot.source} no longer prints: ${line}`).toContain(
          flat(line),
        );
      }
    }
    expect(quoted).toBeGreaterThan(15);
  });

  it('films answers that were replayed, which is what lets the recording need no key', () => {
    expect(CHECK).toContain('fixtures/check/');
    expect(PAGE).toContain('Replay: no CMC_API_KEY is set on this server');
    expect(FLAT).toContain('send no request and spend no credit');
  });

  it('closes on the two things the rules ask a card to carry', () => {
    const card = SHOTS.find((shot) => shot.source === 'title card');
    expect(card?.fences.join('\n')).toContain('{{REPO_URL}}');
    expect(card?.fences.join('\n')).toContain('#BuildwithCMC');
  });
});

describe('the narration', () => {
  it('declares the number of words it actually carries', () => {
    for (const shot of SHOTS) {
      const words = shot.narration.split(/\s+/).filter((word) => word !== '').length;
      expect(words, `shot ${String(shot.number)} declares ${String(shot.declaredWords)} words`).toBe(
        shot.declaredWords,
      );
    }
  });

  it('can be spoken in the time the shot lasts', () => {
    for (const shot of SHOTS) {
      const rate = (shot.declaredWords / shot.length) * 60;
      expect(rate, `shot ${String(shot.number)} reads at ${rate.toFixed(0)} words a minute`).toBeGreaterThanOrEqual(
        100,
      );
      expect(rate, `shot ${String(shot.number)} reads at ${rate.toFixed(0)} words a minute`).toBeLessThanOrEqual(180);
    }
    const words = SHOTS.reduce((total, shot) => total + shot.declaredWords, 0);
    const overall = (words / 90) * 60;
    expect(overall).toBeGreaterThanOrEqual(120);
    expect(overall).toBeLessThanOrEqual(165);
  });

  it('holds the limits it quotes against the ones the run was configured with', () => {
    const limits = loadChecksConfig().C4;
    const [warn, critical] = [
      /The share of the pool an order takes is measured; the (\d+) %/.exec(FLAT)?.[1],
      /and (\d+) % lines it is read against were set by hand/.exec(FLAT)?.[1],
    ];
    expect(Number(warn)).toBe(limits.warnOrderSharePercent);
    expect(Number(critical)).toBe(limits.criticalOrderSharePercent);
  });

  it('holds the score it quotes for the asset on its own against the page', () => {
    const stated = /answers ACT for XAU, at ([\d.]+) out of 100/.exec(FLAT)?.[1] ?? '';
    expect(PAGE).toContain(`ACT: ${stated} out of 100`);
  });

  it('dates the recordings from the answers the shots replay', () => {
    const days = new Set<string>();
    for (const dir of [CHECK_FIXTURES, DEMO_FIXTURES]) {
      for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
        const exchange = JSON.parse(readFileSync(join(dir, name), 'utf8')) as RecordedExchange;
        days.add(exchange.recordedAt.slice(0, 10));
      }
    }
    const named = new Set([...DOC.matchAll(/\b(2026-\d{2}-\d{2})\b/g)].map((match) => match[1] ?? ''));
    expect(named).toEqual(days);
  });
});

describe('everything it tells the person recording to run or to open', () => {
  it('names only commands this package defines', () => {
    const commands = [...DOC.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] ?? '');
    expect(commands.length).toBeGreaterThan(5);
    for (const command of new Set(commands)) expect(Object.keys(SCRIPTS), command).toContain(command);
    expect(FLAT).toContain('npm install');
  });

  it('types commands rather than prose in the shots that type anything', () => {
    const typed = SHOTS.filter((shot) => shot.source !== 'title card').flatMap((shot) => shot.typed);
    expect(typed.length).toBeGreaterThan(1);
    for (const line of typed) {
      const script = /^npm run ([\w:]+)/.exec(line)?.[1] ?? '';
      expect(Object.keys(SCRIPTS), line).toContain(script);
    }
    // The command of shot 5 is the invitation the README makes, so the two cannot drift apart on the flag.
    expect(typed).toContain('npm run check -- PAXG --replay=fixtures/check');
    expect(README).toContain('npm run check -- PAXG --replay=fixtures/check');
  });

  it('offers the built entry points the same scripts run', () => {
    for (const entry of ['node dist/demo/run.js', 'node dist/cli/check.js']) {
      expect(FLAT, entry).toContain(entry);
      const built = entry.replace('node ', '');
      expect(Object.values(SCRIPTS).some((script) => script.includes(built)), built).toBe(true);
    }
  });

  it('resolves every path in the repository it cites', () => {
    const cited = new Set(
      [...DOC.matchAll(/`([\w.-]+(?:\/[\w.-]+)+)`/g)]
        .map((match) => match[1] ?? '')
        // A build output, checked against the script that runs it instead; a URL is not a path.
        .filter((path) => !path.startsWith('dist/') && !path.includes('localhost')),
    );
    expect(cited.size).toBeGreaterThan(4);
    for (const path of cited) expect(existsSync(join(projectRoot, path)), path).toBe(true);
  });

  it('sends the viewer at the pages the interface serves', () => {
    for (const page of ['/asset?q=XAU', '/audit']) expect(FLAT, page).toContain(`http://localhost:3000${page}`);
    expect(existsSync(join(projectRoot, 'web', 'app', 'asset', 'page.tsx'))).toBe(true);
    expect(existsSync(join(projectRoot, 'web', 'app', 'audit', 'page.tsx'))).toBe(true);
  });
});

describe('the links it cannot carry yet', () => {
  it('declares two placeholders and uses each of them once', () => {
    const declared = [...DOC.matchAll(/^\| `\{\{(\w+)\}\}` \|/gm)].map((match) => match[1] ?? '');
    expect(declared).toEqual(['REPO_URL', 'DEMO_URL']);
    const used = [...DOC.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '');
    for (const name of declared) {
      // Once in the table that declares it, once in the shot that carries it.
      expect(used.filter((one) => one === name), name).toHaveLength(2);
    }
    expect(new Set(used)).toEqual(new Set(declared));
  });

  it('points the link the video will have at the placeholder that waits for it', () => {
    expect(FLAT).toContain('`VIDEO_URL` placeholder of `docs/SUBMISSION.md`');
    expect(SUBMISSION).toContain('{{VIDEO_URL}}');
  });
});

describe('the rule of tone, applied to the script as to the report', () => {
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
