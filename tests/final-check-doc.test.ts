/**
 * The final check of T9.2, read back against the artefacts it cites.
 *
 * This document makes eight verdicts about the project, and a verdict is the one kind of sentence that costs
 * nothing to write and everything to be wrong about. So the properties checked here are the ones that would let
 * a verdict drift away from what produced it:
 *
 * 1. **It covers section 8, and only section 8.** The criteria are counted from the specification, not from this
 *    file: a ninth entry, or a missing one, fails here rather than reading plausibly.
 * 2. **Every figure is recomputed** from the file that holds it — the calibration figures from
 *    `docs/calibration.json`, the audit figures from `docs/api_audit.json`, the live run from the seven answers
 *    it recorded in `fixtures/final-check/`. A figure edited by hand stops matching its source.
 * 3. **A reservation is not optional.** Each row the summary marks as reserved has to carry a paragraph that
 *    states the reservation, and each row it marks as met plainly must not.
 * 4. **The live run left no key behind.** The seven fixtures the document leans on are read for the masked
 *    header, and swept for anything key-shaped.
 * 5. **Every path and every command exists**, as in the sibling documents.
 * 6. **The two words outside the report are counted, not described.** The document says four occurrences across
 *    two files; the count is recomputed from `ACCUSATORY`, so it cannot quietly grow.
 * 7. **The wording goes through the tone gate of `src/audit/review.ts`**, like every other document in `docs/`.
 *
 * What no test can judge is whether a reservation is the right one to have drawn. The document states each one
 * in full, next to the measurement it qualifies, so that judgement is left where it can be made.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCUSATORY, toneIssues } from '../src/audit/review.js';
import type { AuditRun } from '../src/audit/run.js';
import type { CalibrationRun } from '../src/calibration/run.js';
import { TOOL_NAMES } from '../src/mcp/tools.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const DOC = readFileSync(join(projectRoot, 'docs', 'FINAL_CHECK.md'), 'utf8');
/** The document on one line: a sentence it states may be wrapped anywhere. */
const FLAT = DOC.replace(/\s+/g, ' ');

const SPEC = readFileSync(join(projectRoot, 'CAHIER_DES_CHARGES.md'), 'utf8');
const PANEL = JSON.parse(readFileSync(join(projectRoot, 'docs', 'calibration.json'), 'utf8')) as CalibrationRun;
const AUDIT = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;

/** The rows of the summary table: `| 4 | … | met | … |`. */
const ROWS = [...DOC.matchAll(/^\| (\d) \| (.+?) \| (met[^|]*?) \| (.+?) \|$/gm)].map((match) => ({
  number: Number(match[1]),
  asks: match[2] ?? '',
  result: (match[3] ?? '').trim(),
  says: match[4] ?? '',
}));

/** The body of one criterion: from its `## N.` heading to the next heading of any level. */
function section(number: number): string {
  const at = DOC.search(new RegExp(`^## ${number}\\. `, 'm'));
  expect(at, `criterion ${number} has a section`).toBeGreaterThan(-1);
  const rest = DOC.slice(at + 3);
  const next = rest.search(/^#{2,3} /m);
  return (next === -1 ? rest : rest.slice(0, next)).replace(/\s+/g, ' ');
}

/** The answers the live run of criterion 2 recorded, one file each. */
interface Recorded {
  label: string;
  recordedAt: string;
  request: { headers: Record<string, string> };
  response: { status: number; latencyMs: number; body: { status?: { credit_count?: number; timestamp?: string } } };
}
const LIVE_DIR = join(projectRoot, 'fixtures', 'final-check');
const LIVE = readdirSync(LIVE_DIR).map(
  (name) => JSON.parse(readFileSync(join(LIVE_DIR, name), 'utf8')) as Recorded,
);

describe('the criteria it answers are the criteria the specification sets', () => {
  /** Section 8 of the specification, as its numbered lines. */
  const criteria = [...SPEC.slice(SPEC.indexOf('## 8. '), SPEC.indexOf('## 9. ')).matchAll(/^(\d+)\. /gm)].map(
    (match) => Number(match[1]),
  );

  it('answers every one of them, once, in order, and invents none', () => {
    expect(criteria).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ROWS.map((row) => row.number)).toEqual(criteria);
    for (const number of criteria) expect(section(number).length, `criterion ${number}`).toBeGreaterThan(200);
    // A ninth section would be a criterion nobody asked for.
    expect([...DOC.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]))).toEqual(criteria);
  });

  it('states a reservation wherever it claims one, and nowhere else', () => {
    const reserved = ROWS.filter((row) => row.result.includes('reservation')).map((row) => row.number);
    expect(reserved.length, 'reserved criteria').toBeGreaterThan(0);
    for (const row of ROWS) {
      const stated = section(row.number).includes('**The reservation.**');
      expect(stated, `criterion ${row.number} states a reservation`).toBe(reserved.includes(row.number));
    }
    // The count in the prose has to be the count in the table.
    const spelled = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
    expect(FLAT).toContain(`**${spelled[ROWS.length - reserved.length] ?? ''} criteria are met outright.`);
    expect(FLAT).toContain(`${spelled[reserved.length] ?? ''} are met on everything`);
  });

  it('claims no criterion is unmet, which is what "met" in every row means', () => {
    expect(ROWS).toHaveLength(8);
    for (const row of ROWS) expect(row.result.startsWith('met'), `criterion ${row.number}`).toBe(true);
    expect(FLAT).toContain('None is unmet.');
  });
});

describe('the calibration figures of criterion 4', () => {
  const { summary } = PANEL;

  it('are the ones docs/calibration.json holds', () => {
    const body = section(4);
    expect(body).toContain(`| Assets in the panel | ${summary.assets} |`);
    for (const verdict of ['ACT', 'CAUTION', 'DO_NOT_ACT'] as const) {
      expect(body, verdict).toContain(`| \`${verdict}\` | ${summary.verdicts[verdict]} |`);
    }
    expect(body).toContain(`**${summary.actShare} %**, against the **${summary.targetShare} %**`);
    expect(summary.meetsTarget).toBe(true);
    expect(body).toContain(`| \`meetsTarget\` | \`${String(summary.meetsTarget)}\` |`);
    expect(body).toContain(
      `min ${summary.score.min}, median ${summary.score.median}, max ${summary.score.max}, ` +
        `mean ${summary.score.mean}, ${summary.score.unscored} unscored`,
    );
    expect(body).toContain(PANEL.panelObservedAt);
  });

  it('names the assets the panel still holds below ACT, all of them', () => {
    const below = PANEL.outcomes.filter((outcome) => outcome.verdict !== 'ACT');
    expect(below.length).toBeGreaterThan(0);
    const body = section(4);
    for (const { member } of below) {
      // An asset E03 left unnamed is named here by its CMC ID, which is the only handle the answer gave.
      const named = member.symbol ?? String(member.cmcId);
      expect(body, named).toContain(named);
    }
    // Naming them is the point: a widened limit that lets one through has to show up as a name that left.
    expect(body).toContain('the engine is not blinded');
  });
});

describe('the audit figures of criterion 6', () => {
  const citations = AUDIT.findings.flatMap((finding) => finding.evidence);

  it('are the ones docs/api_audit.json holds', () => {
    const body = section(6);
    expect(body).toContain(`| Entries published | **${AUDIT.findings.length}**`);
    expect(body).toContain(`| Citations behind them | **${citations.length}**`);
    expect(body).toContain(`| Entries withheld for want of proof | ${AUDIT.withheld} |`);
    expect(body).toContain(`${AUDIT.review.claims}, of which **${AUDIT.review.unproven.length} unproven**`);
    expect(body).toContain(`| Tone flags raised by the same gate | **${AUDIT.review.tone.length}** |`);
    expect(body).toContain(
      `${AUDIT.totals.answers}, of which ${AUDIT.totals.accepted} accepted, across ${AUDIT.totals.endpoints}`,
    );
    expect(body).toContain(`${AUDIT.totals.creditsReported} reported by the answers, ${AUDIT.totals.creditsSpent}`);
  });

  it('is right that every citation names a file that is here', () => {
    expect(citations.length).toBeGreaterThan(0);
    for (const evidence of citations) {
      if (evidence.file.trim() === '') continue;
      expect(existsSync(join(projectRoot, evidence.file)), evidence.file).toBe(true);
    }
    expect(section(6)).toContain(`all ${citations.length} name a file that exists`);
  });

  it('is right that the report itself carries no tone flag', () => {
    const report = readFileSync(join(projectRoot, 'docs', 'API_AUDIT.md'), 'utf8');
    const issues = toneIssues({
      kind: 'observed',
      endpoints: [],
      title: '',
      statement: report,
      measurement: null,
      evidence: [],
    });
    expect(issues.map((issue) => issue.reason)).toEqual([]);
  });
});

describe('the live run of criterion 2', () => {
  it('rests on the answers it recorded, all of them accepted', () => {
    const body = section(2);
    expect(LIVE).toHaveLength(7);
    expect(body).toContain(`${LIVE.length} attempts for ${LIVE.length} answers`);
    for (const answer of LIVE) expect(answer.response.status, answer.label).toBe(200);
    expect(body).toContain('All seven answered **HTTP 200**');

    for (const id of new Set(LIVE.map((answer) => answer.label.slice(0, 3)))) expect(body, id).toContain(id);
  });

  it('charges the credits those answers reported', () => {
    const charged = LIVE.reduce((total, answer) => total + (answer.response.body.status?.credit_count ?? 0), 0);
    expect(section(2)).toContain(`**${charged} credits charged**`);
    expect(FLAT).toContain(`It spent **${charged} credits**`);
  });

  it('reports the latencies and the span those answers hold, inside the ten seconds asked for', () => {
    const latencies = LIVE.map((answer) => answer.response.latencyMs);
    const body = section(2);
    expect(body).toContain(`between **${Math.min(...latencies)} ms and ${Math.max(...latencies)} ms**`);

    const started = LIVE.map((answer) => answer.recordedAt).sort()[0] ?? '';
    const ended =
      LIVE.map((answer) => answer.response.body.status?.timestamp ?? '')
        .sort()
        .at(-1) ?? '';
    expect(body).toContain(`from \`${started}\` to \`${ended}\``);
    // The criterion is a ten-second budget: the span of the run has to fit inside it.
    expect(Date.parse(ended) - Date.parse(started)).toBeLessThan(10_000);
  });

  it('left no key in what it recorded', () => {
    for (const answer of LIVE) expect(answer.request.headers['X-CMC_PRO_API_KEY'], answer.label).toBe('***');
    const raw = readdirSync(LIVE_DIR)
      .map((name) => readFileSync(join(LIVE_DIR, name), 'utf8'))
      .join('\n');
    // The sweep of scripts/check-secrets.sh: a key-shaped value assigned to a CMC key name. A bare run of hex is
    // not one — the answers carry `x-server-traceid`, which has the same shape and is not a secret.
    expect(raw).not.toMatch(
      /CMC(_PRO)?_API_KEY["']?\s*[:=]\s*["']?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-)/i,
    );
    expect(section(2)).toContain('"X-CMC_PRO_API_KEY": "***"');
  });
});

describe('the server of criterion 3 and the documents of criterion 7', () => {
  it('names the four tools the server defines, and no fifth', () => {
    const body = section(3);
    for (const name of TOOL_NAMES) expect(body, name).toContain(`\`${name}\``);
    expect(body).toContain('exactly the four tools of F6');
    expect(TOOL_NAMES).toHaveLength(4);
  });

  it('starts the server the way the README does', () => {
    const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
    expect(readme).toContain('dist/mcp/server.js');
    expect(readme).toContain('--replay=');
    expect(section(3)).toContain('node dist/mcp/server.js --replay=fixtures/check');
  });

  it('lists every document section 7 of the specification names, and gives each a test that is here', () => {
    const seven = SPEC.slice(SPEC.indexOf('## 7. '), SPEC.indexOf('## 8. '));
    const named = [...new Set([...seven.matchAll(/`(docs\/[\w.]+)`/g)].map((match) => match[1] ?? ''))];
    expect(named.length).toBeGreaterThan(0);

    const body = section(7);
    for (const path of named) {
      expect(existsSync(join(projectRoot, path)), path).toBe(true);
      expect(body, path).toContain(`\`${path}\``);
    }
    for (const test of [...body.matchAll(/`(tests\/[\w.-]+\.ts)`/g)].map((match) => match[1] ?? '')) {
      expect(existsSync(join(projectRoot, test)), test).toBe(true);
    }
  });

  it('is right that the links left open are the ones a person still has to produce', () => {
    const open = [...new Set([...section(7).matchAll(/`([A-Z_]+_URL)`/g)].map((match) => match[1] ?? ''))];
    const checklist = readFileSync(join(projectRoot, 'docs', 'HUMAN_CHECKLIST.md'), 'utf8');
    expect(open.length).toBeGreaterThan(0);
    for (const link of open) expect(checklist, link).toContain(`{{${link}}}`);
  });
});

describe('everything it sends the reader to', () => {
  const scripts = Object.keys(
    (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
      .scripts,
  );

  it('names only commands this project defines', () => {
    const named = new Set([...DOC.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] ?? ''));
    expect(named.size).toBeGreaterThan(0);
    for (const command of named) expect(scripts, `npm run ${command}`).toContain(command);
  });

  it('names only files that are here', () => {
    const pattern = /`((?:\.githooks|\.loop|config|docs|fixtures|scripts|src|tests|dist|web)\/[\w.*/-]+)`/g;
    const paths = new Set([...DOC.matchAll(pattern)].map((match) => match[1] ?? ''));
    expect(paths.size).toBeGreaterThan(10);
    for (const path of paths) {
      // `dist/` is built rather than kept, so what it names is checked against the source it comes from.
      const here = path.startsWith('dist/')
        ? join(projectRoot, path.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'))
        : join(projectRoot, path);
      expect(existsSync(here), path).toBe(true);
    }
  });

  it('names the human steps it defers to, and they are the ones the checklist defines', () => {
    const checklist = readFileSync(join(projectRoot, 'docs', 'HUMAN_CHECKLIST.md'), 'utf8');
    const steps = [...DOC.matchAll(/\*\*(H\d+)(?:\/(H\d+))?\*\*/g)].flatMap((match) => [match[1], match[2]]);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of new Set(steps)) {
      if (step === undefined) continue;
      expect(checklist, step).toMatch(new RegExp(`^## ${step} — `, 'm'));
    }
    // The reading of the tone is a person's, and this file has to send it to the step that does it.
    expect(checklist).toMatch(/^## H5 — Read the tone/m);
    expect(FLAT).toContain('it is **H5** of `docs/HUMAN_CHECKLIST.md`');
  });
});

describe('the two words it counts outside the report', () => {
  const [first, second] = ACCUSATORY;

  it('counts them where it says they are', () => {
    const occurrences = (path: string): number => {
      const text = readFileSync(join(projectRoot, path), 'utf8').toLowerCase();
      return [first, second].reduce((total, word) => total + text.split(word ?? '').length - 1, 0);
    };
    expect(occurrences('docs/CALIBRATION.md')).toBe(1);
    expect(occurrences('docs/DECISIONS.md')).toBe(3);
    expect(FLAT).toContain('**four occurrences across two files**');
    expect(FLAT).toContain('one in `docs/CALIBRATION.md` and three in `docs/DECISIONS.md`');
    expect(FLAT).toContain('the first and the second of the eighteen');
    expect(ACCUSATORY).toHaveLength(18);
  });

  it('is right that the documents it calls clean are clean', () => {
    for (const name of ['API_AUDIT.md', 'API_FEEDBACK.md', 'SUBMISSION.md', 'HUMAN_CHECKLIST.md', 'FINAL_CHECK.md']) {
      const text = readFileSync(join(projectRoot, 'docs', name), 'utf8');
      const issues = toneIssues({
        kind: 'observed',
        endpoints: [],
        title: '',
        statement: text,
        measurement: null,
        evidence: [],
      });
      expect(issues.map((issue) => issue.reason), name).toEqual([]);
    }
  });
});

describe('the rule of tone, applied to this file as to the report', () => {
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

  it('says what it does not settle, so the reader knows what is left to judgement', () => {
    expect(FLAT).toContain('## What no command here settles');
    expect(FLAT).toContain('`tests/final-check-doc.test.ts` reads this file back against the artefacts it cites');
  });
});
