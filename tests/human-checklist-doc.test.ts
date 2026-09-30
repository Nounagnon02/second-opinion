/**
 * The human checklist of T8.7, checked against the repository it describes.
 *
 * This document is different from the other pieces of the submission: it is not read by a judge, it is read by one
 * person under time pressure, once, with the deadline in sight. What it gets wrong is not a paragraph — it is a step
 * skipped, or a step taken before the thing it needs exists.
 *
 * So the one property that matters most is checked as a property rather than as prose:
 *
 * 1. **The order is an order.** Every step a row says it depends on has to be a step this document defines, and to
 *    stand earlier in the document than the row itself. A cycle, a forward reference or a dependency on a step that
 *    does not exist fails here rather than reading plausibly.
 * 2. **The summary and the sections agree.** Each step's own `**Depends on**` line has to name the same steps as its
 *    row of the table, so the map and the territory cannot drift apart.
 * 3. **The links are the ones the other documents are actually waiting for.** The set of placeholders comes from the
 *    tables of `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md` and `docs/X_POST.md`; each is produced by exactly one
 *    step, and each document said to be waiting for one really carries it.
 * 4. **Nothing human is invented, and nothing is dropped.** The six lines `TASKS.md` reserves for a person are read
 *    from it and each has to be covered by a step; a seventh row, or a row that is not one of those lines, fails.
 *    Section 9 of the specification has to list as many.
 * 5. **Every figure is recomputed** from the file that holds it — the two interrupted walks from the directories
 *    they sit in, the counts of the sibling documents from those documents, the engine's own counts from the engine.
 * 6. **Every command is one `package.json` defines and every path exists** — except the two files Next.js writes,
 *    which have to be ignored rather than present.
 * 7. **The wording goes through the tone gate of `src/audit/review.ts`**, like every other document in `docs/`.
 *
 * What no test can judge is whether this is the order a person will follow when the clock is short. The document
 * says so itself, at the end.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCUSATORY, CAUSAL, toneIssues } from '../src/audit/review.js';
import type { AuditRun } from '../src/audit/run.js';
import type { CalibrationRun } from '../src/calibration/run.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import { TOOL_NAMES } from '../src/mcp/tools.js';
import { projectRoot, readInventory } from './helpers/endpoints-doc.js';

const DOC = readFileSync(join(projectRoot, 'docs', 'HUMAN_CHECKLIST.md'), 'utf8');
/** The document on one line: a sentence it states may be wrapped anywhere. */
const FLAT = DOC.replace(/\s+/g, ' ');

const TASKS = readFileSync(join(projectRoot, 'TASKS.md'), 'utf8');
const SPEC = readFileSync(join(projectRoot, 'CAHIER_DES_CHARGES.md'), 'utf8');
const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');
const BLOCKED = readFileSync(join(projectRoot, '.loop', 'BLOCKED.md'), 'utf8');
const FINAL_CHECK = readFileSync(join(projectRoot, 'docs', 'FINAL_CHECK.md'), 'utf8');

/** The three documents that wait on a link this checklist orders the production of. */
const WAITING = ['docs/SUBMISSION.md', 'docs/VIDEO_SCRIPT.md', 'docs/X_POST.md'] as const;
const SUBMISSION = readFileSync(join(projectRoot, 'docs', 'SUBMISSION.md'), 'utf8');
const VIDEO = readFileSync(join(projectRoot, 'docs', 'VIDEO_SCRIPT.md'), 'utf8');
const XPOST = readFileSync(join(projectRoot, 'docs', 'X_POST.md'), 'utf8');
const EVIDENCE = readFileSync(join(projectRoot, 'docs', 'EVIDENCE.md'), 'utf8');

const RUN = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;
const PANEL = JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as CalibrationRun;

/** One row of the table of steps: the step, what it produces, what it waits for, and where it comes from. */
interface Row {
  id: string;
  produces: string;
  depends: string[];
  source: string;
}

/** The rows of the table of steps, in the order the table lists them. */
const ROWS: Row[] = [...DOC.matchAll(/^\| (H\d+) \| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$/gm)].map((match) => ({
  id: match[1] ?? '',
  produces: match[2] ?? '',
  depends: [...(match[3] ?? '').matchAll(/H\d+/g)].map((found) => found[0]),
  source: (match[4] ?? '').trim(),
}));

/** The sections, in the order the document lays them out: `## H3 — Create the public repository and push`. */
const SECTIONS = [...DOC.matchAll(/^## (H\d+) — (.+)$/gm)].map((match) => ({
  id: match[1] ?? '',
  title: match[2] ?? '',
  at: match.index,
}));

/** The body of one step's section: from its heading to the next heading of any level. */
function bodyOf(id: string): string {
  const start = DOC.indexOf(`## ${id} — `);
  expect(start, `${id} has no section of its own`).toBeGreaterThan(-1);
  const next = DOC.slice(start + 1).search(/^## /m);
  return next === -1 ? DOC.slice(start) : DOC.slice(start, start + 1 + next);
}

/** The steps a section's own `**Depends on**` line names, read up to the next bold run or blank line. */
function dependsOfSection(id: string): string[] {
  const found = /\*\*Depends on\*\* ([\s\S]*?)(?:\*\*|\n\n)/.exec(bodyOf(id));
  expect(found, `${id} no longer states what it depends on`).not.toBeNull();
  return [...(found?.[1] ?? '').matchAll(/H\d+/g)].map((match) => match[0]);
}

/** What one sentence of the document states, by the pattern that finds it. Fails when the sentence is gone. */
function stated(pattern: RegExp, text = FLAT): string[] {
  const match = pattern.exec(text.replace(/\s+/g, ' '));
  expect(match, `the checklist no longer says: ${pattern.source}`).not.toBeNull();
  return (match ?? []).slice(1);
}

/** English for the counts the document spells out in words, so a count that moves fails rather than reading oddly. */
const SPELLED: Record<number, string> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  10: 'ten',
  17: 'seventeen',
  50: 'fifty',
};

function spelled(count: number): string {
  const word = SPELLED[count];
  if (word === undefined) throw new Error(`No English spelling is recorded for ${String(count)}.`);
  return word;
}

/** The placeholders one document declares, in the shape all four of them use: `| `{{REPO_URL}}` | … |`. */
function declaredIn(doc: string): Set<string> {
  return new Set([...doc.matchAll(/\| `\{\{([A-Z_]+)\}\}` \|/g)].map((match) => match[1] ?? ''));
}

describe('the ten steps, as an order rather than as a list', () => {
  it('gives every step of the table a section of its own, in the same order', () => {
    expect(ROWS.length).toBeGreaterThan(0);
    expect(SECTIONS.map((section) => section.id)).toEqual(ROWS.map((row) => row.id));
    const positions = SECTIONS.map((section) => section.at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('numbers them from one, without a gap', () => {
    expect(ROWS.map((row) => row.id)).toEqual(ROWS.map((_, index) => `H${String(index + 1)}`));
  });

  it('states how many there are', () => {
    expect(FLAT).toContain(`## The ${spelled(ROWS.length)} steps`);
  });

  it('never waits on a step that comes later, or on one that does not exist', () => {
    const position = new Map(ROWS.map((row, index) => [row.id, index]));
    for (const [index, row] of ROWS.entries()) {
      for (const needed of row.depends) {
        const at = position.get(needed);
        expect(at, `${row.id} waits on ${needed}, which this document does not define`).not.toBeUndefined();
        expect(at ?? Infinity, `${row.id} waits on ${needed}, which comes after it`).toBeLessThan(index);
      }
    }
  });

  it('says in each section what its row of the table says', () => {
    for (const row of ROWS) {
      expect(dependsOfSection(row.id), `${row.id}: the table and the section disagree`).toEqual(row.depends);
    }
  });

  it('leaves the steps that wait on nothing free, and says why they sit where they do', () => {
    const free = ROWS.filter((row) => row.depends.length === 0).map((row) => row.id);
    expect(free).toEqual(['H1', 'H5', 'H6']);
    // H1 waits on nothing but has to precede the commit, which is the one thing it cannot come after.
    expect(bodyOf('H1')).toContain('**Do it before H2**');
    for (const id of ['H5', 'H6']) {
      expect(bodyOf(id), `${id} says which step needs it`).toContain('**Needed by H8.**');
    }
    expect(FLAT).toContain('H5 and H6 depend on nothing and can be done at any point before H8');
  });

  it('gives every step a source, and only the two that are not the backlog say so', () => {
    const fromBacklog = ROWS.filter((row) => row.source === '`TASKS.md`').map((row) => row.id);
    const fromJournal = ROWS.filter((row) => row.source === '`.loop/BLOCKED.md`').map((row) => row.id);
    expect([...fromBacklog, ...fromJournal]).toHaveLength(ROWS.length);
    expect(fromJournal).toEqual(['H1', 'H2']);
    expect(FLAT).toContain('H1 and H2 are not on that list. They come from `.loop/BLOCKED.md`');
  });
});

describe('the links the steps exist to produce', () => {
  const declared = declaredIn(DOC);

  it('declares exactly the placeholders the three documents are waiting for', () => {
    const waited = new Set([...declaredIn(SUBMISSION), ...declaredIn(VIDEO), ...declaredIn(XPOST)]);
    expect(declared).toEqual(waited);
    expect(declared.size).toBe(5);
    expect(FLAT).toContain(`## The ${spelled(declared.size)} links nobody here can fill in`);
  });

  it('has exactly one step produce each of them, and none produce two', () => {
    const produced = ROWS.flatMap((row) => [...row.produces.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1] ?? ''));
    expect(new Set(produced)).toEqual(declared);
    expect(
      produced,
      'a placeholder is produced by two steps, so one of them is not the step that produces it',
    ).toHaveLength(declared.size);
  });

  it('names, for each link, the step that produces it and every document that waits for it', () => {
    const rows = [...DOC.matchAll(/^\| `\{\{([A-Z_]+)\}\}` \| (H\d+) \| (.+?) \|$/gm)];
    expect(rows).toHaveLength(declared.size);
    const producer = new Map(ROWS.map((row) => [row.id, row.produces]));
    for (const row of rows) {
      const name = row[1] ?? '';
      expect(producer.get(row[2] ?? ''), `${name} is produced by ${String(row[2])}`).toContain(`{{${name}}}`);
      const named = new Set([...(row[3] ?? '').matchAll(/`(docs\/[\w.]+)`/g)].map((match) => match[1] ?? ''));
      const actually = new Set(
        WAITING.filter((path) => declaredIn(readFileSync(join(projectRoot, path), 'utf8')).has(name)),
      );
      expect(named, `the documents waiting for {{${name}}}`).toEqual(actually);
      for (const path of named) {
        expect(readFileSync(join(projectRoot, path), 'utf8'), path).toContain(`{{${name}}}`);
      }
    }
  });

  it('carries no filled-in link of its own, only the local one the video films', () => {
    const urls = new Set([...DOC.matchAll(/https?:\/\/[^\s`)]+/g)].map((match) => match[0]));
    expect(urls).toEqual(new Set(['http://localhost:3000']));
    expect(VIDEO, 'the video script films that address').toContain('http://localhost:3000');
  });
});

describe('what it says is already done', () => {
  it('counts the recorded answers and the credits as the evidence page counts them', () => {
    const [answers, credits] = stated(/recorded \*\*(\d+) answers\*\* reporting \*\*(\d+) credits\*\*/);
    expect(EVIDENCE).toContain(`Five captures, ${String(answers)} recorded answers, are what this project reads.`);
    expect(EVIDENCE).toContain(`The five captures reported ${String(credits)} credits between them`);
    expect(stated(/(\w+) capture sessions between [\d-]+ and [\d-]+ recorded/)[0]?.toLowerCase()).toBe(spelled(5));
  });

  it('counts the checks, the tools and the calibration panel from the engine', () => {
    expect(stated(/engine and its (\w+) checks/)[0]?.toLowerCase()).toBe(spelled(CHECK_IDS.length));
    expect(stated(/MCP server and its (\w+) tools/)[0]?.toLowerCase()).toBe(spelled(TOOL_NAMES.length));
    expect(stated(/first (\w+) assets by market/)[0]?.toLowerCase()).toBe(spelled(PANEL.outcomes.length));
  });

  it('lists as already written every document the rules ask for, and each one is here', () => {
    // The list ends on the last document it names, so the sentence is read to that anchor rather than to a full stop.
    const sentence = stated(/and the documents: (.+?`docs\/X_POST\.md`)\./)[0] ?? '';
    const listed = [...sentence.matchAll(/`([\w./]+)`/g)].map((match) => match[1] ?? '');
    expect(listed.length).toBeGreaterThanOrEqual(9);
    for (const path of listed) expect(existsSync(join(projectRoot, path)), path).toBe(true);
    for (const path of WAITING) expect(listed, `${path} is one of them`).toContain(path);
  });
});

describe('H1, against the working tree it describes', () => {
  const root = join(projectRoot, 'fixtures', 'calibration');
  const loose = readdirSync(root).filter((name) => name.endsWith('.json'));
  const partial = join(root, 'live-2026-09-26');

  it('counts the two interrupted walks, and the date the loose one was captured on', () => {
    const [count, day] = stated(/(\d+) loose `fixtures\/calibration\/E\*\.json` files from ([\d-]+)/);
    expect(Number(count)).toBe(loose.length);
    const stamp = (day ?? '').replaceAll('-', '');
    for (const name of loose) expect(name, `${name} was captured on ${String(day)}`).toContain(stamp);
    expect(Number(stated(/live-2026-09-26\/`, (\d+) files from a walk/)[0])).toBe(
      readdirSync(partial).filter((name) => name.endsWith('.json')).length,
    );
  });

  it('says where that walk stopped, as its own log recorded it', () => {
    const [at, of] = stated(/a walk stopped at (\d+) assets of (\d+)/);
    const log = readFileSync(join(projectRoot, '.loop', 'calibrate-live.progress'), 'utf8');
    const last = [...log.matchAll(/\[(\d+)\/(\d+)\]/g)].at(-1);
    expect(last?.[1], 'the last asset its log reached').toBe(at);
    expect(last?.[2]).toBe(of);
  });

  it('sizes them as they are on disk', () => {
    const files = [
      ...loose.map((name) => join(root, name)),
      ...readdirSync(partial).map((name) => join(partial, name)),
    ];
    const bytes = files.reduce((total, path) => total + statSync(path).size, 0);
    expect(FLAT).toContain('just under 2 MB of JSON');
    expect(bytes).toBeLessThan(2_000_000);
    expect(bytes, 'below 1.9 MB the sentence would read as an overstatement').toBeGreaterThan(1_900_000);
  });

  it('points at the complete walk as the one that is read, and it is', () => {
    const complete = stated(/the tests all read `fixtures\/calibration\/(live-[\w-]+)\/`, the complete walk/)[0] ?? '';
    expect(existsSync(join(root, complete))).toBe(true);
    expect(readFileSync(join(projectRoot, 'tests', 'helpers', 'calibration-fixtures.ts'), 'utf8')).toContain(complete);
    expect(readFileSync(join(projectRoot, 'src', 'audit', 'run.ts'), 'utf8')).toContain(complete);
  });

  it('is right that removing both would take two tests and a paragraph with them', () => {
    // The assertion of the evidence page that requires one of the two to survive; the checklist names it.
    expect(
      readFileSync(join(projectRoot, 'tests', 'evidence-doc.test.ts'), 'utf8'),
      'the assertion the checklist sends the reader to',
    ).toContain('live-2026-09-26');
    expect(EVIDENCE, 'the paragraph the checklist sends the reader to').toContain('live-2026-09-26/');
    expect(loose.length > 0 || existsSync(partial), 'one of the two still has to be here').toBe(true);
    expect(FLAT).toContain('`tests/evidence-doc.test.ts` and `tests/human-checklist-doc.test.ts`');
  });

  it('is right that the two files Next.js writes cannot enter a commit', () => {
    const ignored = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    for (const path of ['web/AGENTS.md', 'web/CLAUDE.md']) {
      expect(FLAT, path).toContain(`\`${path}\``);
      expect(ignored, `${path} is ignored rather than committed`).toContain(path);
    }
    expect(ignored, 'the key itself is ignored too, which H1 states as an action to skip').toMatch(/^\.env$/m);
  });
});

describe('H2, against the hook and the script it names', () => {
  it('names the script that enables the hook, and what that script writes', () => {
    expect(FLAT).toContain('`npm run prepare`');
    const install = readFileSync(join(projectRoot, 'scripts', 'install-hooks.sh'), 'utf8');
    expect(install).toContain(stated(/writes `([\w.=/]+)` into this clone/)[0] ?? '');
  });

  it('is right about what the hook it enables then runs', () => {
    expect(readFileSync(join(projectRoot, '.githooks', 'pre-commit'), 'utf8')).toContain('scripts/check-secrets.sh');
    expect(FLAT).toContain('run `scripts/check-secrets.sh` on the commit you are about to make');
  });

  it('states the conflict of conventions the journal leaves open, with both sides', () => {
    expect(FLAT).toContain('`CLAUDE.md` asks for commits like');
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain(
      stated(/asks for commits like `(T[\d.]+: [^`]+)`/)[0] ?? '',
    );
    expect(BLOCKED).toContain('Conflit de conventions à trancher');
  });

  it('sends the reader to the option of the journal that carries the command', () => {
    expect(FLAT).toContain('`.loop/BLOCKED.md`, option 3, carries the command');
    expect(BLOCKED).toMatch(/^3\. Ou committer à la main/m);
  });
});

describe('H4, against the deployment the README describes', () => {
  /** The environment table of the README: `| `CMC_API_KEY` | … |`. */
  const variables = [...README.matchAll(/^\| `([A-Z_]+)` \| /gm)].map((match) => match[1] ?? '');

  it('names the two project settings that no file in the repository can express', () => {
    for (const setting of ['Root Directory', 'Include source files outside of the Root Directory in the Build Step']) {
      expect(FLAT, setting).toContain(setting);
      expect(README, `the README carries the reasoning for: ${setting}`).toContain(setting);
    }
    expect(stated(/\| Root Directory \| `(\w+)` \|/)[0]).toBe('web');
  });

  it('accounts for every environment variable the README lists, once', () => {
    expect(variables.length).toBeGreaterThan(0);
    expect(stated(/two of them are the decision worth making here: - `([A-Z_]+)`/)[0]).toBe('CMC_API_KEY');
    const named = new Set([...DOC.matchAll(/`([A-Z_]{4,})`/g)].map((match) => match[1] ?? ''));
    for (const variable of variables) expect(named, `${variable} is accounted for`).toContain(variable);
    const rest = stated(/The other (\w+) — (.+?) — have defaults/);
    expect(rest[0]?.toLowerCase()).toBe(spelled(variables.length - 2));
    expect([...(rest[1] ?? '').matchAll(/`([A-Z_]+)`/g)].map((match) => match[1] ?? '')).toEqual(
      variables.filter((name) => name !== 'CMC_API_KEY' && name !== 'SECOND_OPINION_MODE'),
    );
    expect(FLAT).toContain(`The README lists all ${spelled(variables.length)}`);
  });

  it('is right that a credential under the public prefix stops the interface', () => {
    const prefix = stated(/may be given a `(NEXT_PUBLIC_)` prefix/)[0] ?? '';
    expect(readFileSync(join(projectRoot, 'src', 'web', 'settings.ts'), 'utf8')).toContain(`= '${prefix}'`);
  });

  it('names the file that carries what the dashboard does not have to', () => {
    const vercel = JSON.parse(readFileSync(join(projectRoot, 'web', 'vercel.json'), 'utf8')) as Record<string, unknown>;
    expect(FLAT).toContain('`web/vercel.json` carries the build and install commands');
    expect(Object.keys(vercel)).toContain('buildCommand');
    expect(Object.keys(vercel)).toContain('installCommand');
  });
});

describe('H5, against the gate it says cannot do the reading for you', () => {
  it('counts the audit entries the report published', () => {
    expect(Number(stated(/`docs\/API_AUDIT\.md` — (\d+) published entries/)[0])).toBe(RUN.findings.length);
  });

  it('names the section of the submission it asks to be read, and that section is there', () => {
    const section = stated(/the \*(What the API made possible, and what took work)\* section/)[0] ?? '';
    expect(SUBMISSION).toContain(`### ${section}`);
  });

  it('is right about what the gate refuses and what it cannot judge', () => {
    expect(FLAT).toContain('refuses a list of accusatory words and of turns of phrase that state a cause');
    expect(ACCUSATORY.length).toBeGreaterThan(0);
    expect(CAUSAL.length).toBeGreaterThan(0);
  });
});

describe('H7, against the script it sends the reader to', () => {
  it('counts the shots, the seconds, and the preparations before recording', () => {
    const [shots, seconds] = stated(/is (\w+) shots, (\d+) seconds/);
    expect(shots).toBe(spelled([...VIDEO.matchAll(/^### Shot \d+ — /gm)].length));
    const last = [...VIDEO.matchAll(/^\| \d+ \| \d:\d\d \| (\d):(\d\d) \| /gm)].at(-1);
    expect(Number(last?.[1]) * 60 + Number(last?.[2])).toBe(Number(seconds));
    const before = VIDEO.slice(VIDEO.indexOf('## Before you hit record'), VIDEO.indexOf('## The eight shots'));
    expect(stated(/section carries (\w+) things to set up first/)[0]?.toLowerCase()).toBe(
      spelled([...before.matchAll(/^\d+\. /gm)].length),
    );
  });

  it('counts the claims the narration has to stay away from', () => {
    const rules = VIDEO.slice(
      VIDEO.indexOf('## What the narration must not say'),
      VIDEO.indexOf('## What keeps this script true'),
    );
    expect(stated(/lists (\w+) things the narration must not claim/)[0]?.toLowerCase()).toBe(
      spelled([...rules.matchAll(/^- \*\*/gm)].length),
    );
  });

  it('repeats the one instruction of that script a video cannot take back', () => {
    expect(FLAT).toContain('do not open `.env`, do not run `npm run check:env`');
    expect(VIDEO).toContain('**No key on screen.**');
  });

  it('is right that the shots it films need no key', () => {
    expect(VIDEO.replace(/\s+/g, ' ')).toContain('Shots 1 to 7 need no API key, send no request and spend no credit');
    expect(FLAT).toContain('Shots 1 to 7 need no key, send no request and spend no credit');
  });
});

describe('H8, against the text it asks to be pasted', () => {
  it('counts the checks the submission asks for before pressing submit, and repeats them all', () => {
    const before = SUBMISSION.slice(
      SUBMISSION.indexOf('## Before pressing submit'),
      SUBMISSION.indexOf('## What keeps this text true'),
    );
    const checks = [...before.matchAll(/^\d+\. /gm)].length;
    expect(stated(/section is (\w+) checks/)[0]?.toLowerCase()).toBe(spelled(checks));
    expect([...bodyOf('H8').matchAll(/^\d+\. /gm)]).toHaveLength(checks);
  });

  it('names the markers that bound the text, and the track it is submitted to', () => {
    expect(FLAT).toContain('between its two `submission text` markers');
    expect(SUBMISSION).toContain('<!-- submission text: paste from here -->');
    expect(FLAT).toContain('**AI Agents and Automation**');
    expect(SPEC).toContain('AI Agents and Automation');
  });

  it('counts the endpoints the submission names, from the client and the inventory', () => {
    expect(stated(/names the (\w+) endpoints the code may call/)[0]?.toLowerCase()).toBe(
      spelled(Object.keys(ENDPOINTS).length),
    );
    expect(stated(/the (\w+) the plan refused/)[0]?.toLowerCase()).toBe(
      spelled(readInventory().filter((row) => row.status === 'refused').length),
    );
  });
});

describe('H9 and H10, against the drafts and the two links that point at each other', () => {
  it('counts the drafts, and names the one the rules ask for', () => {
    const posts = [...XPOST.matchAll(/^### Post (\d+) — /gm)].map((match) => match[1] ?? '');
    expect(stated(/carries (\w+) drafts/)[0]?.toLowerCase()).toBe(spelled(posts.length));
    expect(FLAT).toContain('**Post 1 is the one the rules ask for**');
    expect(FLAT).toContain(`Posts 2 to ${posts.at(-1) ?? ''} are a thread under it`);
    expect(XPOST).toContain('**Post 1 below is that post**');
  });

  it('counts post 1 the way the draft counts it', () => {
    const [length, limit] = stated(/post 1 is (\d+) of (\d+)/);
    expect(XPOST).toContain(`| 1 | The BUIDL link, the video, the hashtag | ${String(length)} of ${String(limit)} |`);
    expect(stated(/(\d+) per link whatever its length/)[0]).toBe('23');
    expect(XPOST).toContain('every link counts as 23 of them');
  });

  it('names the hashtag the rules ask for', () => {
    expect(FLAT).toContain('`#BuildwithCMC`');
    expect(SPEC).toContain('#BuildwithCMC');
  });

  it('closes the loop between the submission and the post, and allows the other order', () => {
    expect(bodyOf('H10')).toContain('`{{X_POST_URL}}`');
    expect(bodyOf('H10')).toContain('If DoraHacks hands out no URL before a BUIDL is submitted, H8 and H9 swap');
    expect(XPOST).toContain('If DoraHacks hands out no URL before a BUIDL is submitted, swap steps 3 and 4');
  });

  it('repeats, in all three steps, the search that catches an unfilled link', () => {
    for (const id of ['H8', 'H9', 'H10']) expect(bodyOf(id), id).toContain('{{');
    expect(bodyOf('H9')).toContain('**Nothing goes out carrying a `{{`.**');
  });
});

describe('the deadline and the shortest path', () => {
  it('quotes the date the specification closes on', () => {
    const [date, time] = stated(/Submissions close on \*\*([\d-]+), ([\d:]+) UTC\*\*/);
    const [year, month, day] = (date ?? '').split('-');
    expect(month, 'the specification writes that month in French, so only September is spelled out here').toBe('09');
    const [hour, minute] = (time ?? '').split(':');
    // The specification carries the same instant in French: `mercredi 30 septembre 2026, 23h59 UTC`.
    expect(SPEC).toContain(`${String(Number(day))} septembre ${String(year)}, ${String(hour)}h${String(minute)} UTC`);
  });

  it('drops the one step that is not a requirement, and says what the rules do ask for', () => {
    expect(FLAT).toContain('**H4 is the only step that can be dropped**');
    const section = stated(/Section (\d+) of `CAHIER_DES_CHARGES\.md` maps each/)[0] ?? '';
    expect(SPEC).toMatch(new RegExp(`^## ${section}\\. `, 'm'));
    // Dropping H4 costs only the deployment, so nothing may wait on it but the two steps that already allow for it.
    expect(ROWS.filter((row) => row.depends.includes('H4')).map((row) => row.id)).toEqual(['H8', 'H9']);
    expect(XPOST.replace(/\s+/g, ' ')).toContain(
      'if the Vercel deployment does not happen, post 4 goes out without its last line',
    );
  });
});

describe('what it says the loop still owes', () => {
  /** The tasks of the backlog that are neither done nor reserved for a person. */
  const open = [...TASKS.matchAll(/^- \[ \] (T[\d.]+)/gm)].map((match) => match[1] ?? '');

  it('claims nothing is left to the loop only while nothing is', () => {
    stated(/Every task of `TASKS\.md` that is not reserved for a person is ticked/);
    // A task reopened, or a new one added, makes that sentence false: it has to be rewritten rather than left.
    expect(open).toEqual([]);
  });

  it('is right about the ones it says are done', () => {
    const sentence =
      stated(/stood together at the end, and all three are now done\. (.+?)Read `docs\/FINAL_CHECK/)[0] ?? '';
    const done = [...sentence.matchAll(/\*\*(T[\d.]+)\*\*/g)].map((match) => match[1] ?? '');
    expect(done).toHaveLength(3);
    expect(FLAT).toContain(`The last ${spelled(done.length)} tasks of the backlog stood together`);
    for (const id of done) expect(TASKS, `${id} is ticked in the backlog`).toContain(`- [x] ${id} `);
  });

  it('is right that the history check proves nothing until the work is committed', () => {
    expect(FLAT).toContain('`scripts/check-secrets.sh --history`');
    expect(readFileSync(join(projectRoot, 'scripts', 'check-secrets.sh'), 'utf8')).toContain('--history');
    expect(FLAT).toContain('until **H2** puts them there');
  });

  it('is right that a third scope reads the files a clone would carry instead', () => {
    expect(FLAT).toContain('`scripts/check-secrets.sh --worktree`');
    expect(readFileSync(join(projectRoot, 'scripts', 'check-secrets.sh'), 'utf8')).toContain('--worktree');
    // It sends the count to the one document that dates its figures, rather than carrying a number that rots here.
    expect(FLAT).toContain('`docs/FINAL_CHECK.md` records how many files that was');
    expect(FINAL_CHECK).toMatch(/^\| 8 \|.*\d+ files \|$/m);
  });
});

describe('the six lines the backlog reserves for a person', () => {
  /** Those lines, with their backticks removed, which is how the checklist quotes them. */
  const reserved = [...TASKS.matchAll(/^- \[H\] (.+)$/gm)].map((match) => (match[1] ?? '').replaceAll('`', ''));
  /** The coverage table: `| Dépôt GitHub public | H3 |`. */
  const covered = [...DOC.matchAll(/^\| ([^|`]+?) \| (H\d+(?:, H\d+)*) \|$/gm)].map((match) => ({
    line: match[1] ?? '',
    steps: [...(match[2] ?? '').matchAll(/H\d+/g)].map((found) => found[0]),
  }));

  it('covers each of them, with steps this document defines', () => {
    expect(reserved).toHaveLength(6);
    expect(covered.map((row) => row.line)).toEqual(reserved);
    const defined = new Set(ROWS.map((row) => row.id));
    for (const row of covered) {
      expect(row.steps.length, `${row.line} is left to no step`).toBeGreaterThan(0);
      for (const step of row.steps) expect(defined, `${row.line} is left to ${step}`).toContain(step);
    }
  });

  it('leaves no step of the backlog uncovered, and invents no seventh', () => {
    const fromBacklog = ROWS.filter((row) => row.source === '`TASKS.md`').map((row) => row.id);
    expect(new Set(covered.flatMap((row) => row.steps))).toEqual(new Set(fromBacklog));
    expect(FLAT).toContain(`The backlog reserves ${spelled(reserved.length)} lines for a person`);
  });

  it('is right that the specification lists as many', () => {
    const section = SPEC.slice(SPEC.indexOf('## 9. '), SPEC.indexOf('## 10. '));
    expect([...section.matchAll(/^- /gm)]).toHaveLength(reserved.length);
    expect(FLAT).toContain('section 9 of `CAHIER_DES_CHARGES.md` lists the same six');
  });
});

describe('every command and every path it sends the reader to', () => {
  const scripts = Object.keys(
    (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts,
  );

  it('names only commands this project defines', () => {
    const named = new Set([...DOC.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] ?? ''));
    expect(named.size).toBeGreaterThan(0);
    for (const command of named) expect(scripts, `npm run ${command}`).toContain(command);
  });

  it('names only files that are here', () => {
    const written = ['web/AGENTS.md', 'web/CLAUDE.md'];
    const pattern = /`((?:\.githooks|\.loop|config|docs|fixtures|scripts|src|tests|web)\/[\w.*/-]+)`/g;
    const paths = new Set([...DOC.matchAll(pattern)].map((match) => match[1] ?? ''));
    expect(paths.size).toBeGreaterThan(10);
    for (const path of paths) {
      if (written.includes(path)) continue;
      if (path.includes('*')) {
        // A glob stands for a set of files rather than one: at least one of them has to be there.
        const at = path.lastIndexOf('/');
        const prefix = path.slice(at + 1).split('*')[0] ?? '';
        expect(
          readdirSync(join(projectRoot, path.slice(0, at))).some((name) => name.startsWith(prefix)),
          path,
        ).toBe(true);
        continue;
      }
      expect(existsSync(join(projectRoot, path)), path).toBe(true);
    }
    // T9.2 wrote the one file this list used to name as missing; it is read back by its own suite.
    expect(paths).toContain('docs/FINAL_CHECK.md');
    expect(FLAT).toContain('the file this list used to name as the one that did not exist yet');
  });

  it('names only root files that are here, and leaves the key out of that sweep', () => {
    for (const file of ['README.md', 'TASKS.md', 'CLAUDE.md', 'CAHIER_DES_CHARGES.md', 'package.json']) {
      if (!DOC.includes(`\`${file}\``)) continue;
      expect(existsSync(join(projectRoot, file)), file).toBe(true);
    }
    // `.env` is named, and is the one file whose absence from a clone is the point: its existence is not asserted.
    expect(FLAT).toContain('`.env` carries `CMC_API_KEY`');
  });
});

describe('the rule of tone, applied to this list as to the report', () => {
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

  it('says what it does not check, so the reader knows what is left to judgement', () => {
    expect(FLAT).toContain('What no test can judge is whether the order above is the one that will actually be');
    expect(FLAT).toContain('`tests/human-checklist-doc.test.ts` reads this file against the repository it describes');
  });
});
