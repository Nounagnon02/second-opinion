/**
 * Every decision the code cites is a decision that exists.
 *
 * `docs/DECISIONS.md` is the reason half of this project: the checks, the score, the MCP answers and the web
 * interface all point back at it rather than restating their own reasoning, and a comment reading "(D6)" is a
 * promise that a reader can go and find D6. A citation of a decision that was never written is worse than no
 * citation at all — it sends a reader looking for an argument nobody made.
 *
 * That is exactly what happened while T7.1 was being written: three files cited D15 before the entry existed.
 * Nothing caught it, because every other test of the document reads the document and never the code. This one
 * reads both, in the one direction that matters — a cited decision must exist. The reverse is not checked: a
 * decision may well be recorded without any file needing to point at it.
 *
 * The pattern is deliberately plain, `D` followed by one or two digits, because that is how this project cites
 * a decision everywhere. An identifier that happens to be spelt that way will fail here; renaming it is the
 * right answer, since a reader would have read it as a citation too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './helpers/endpoints-doc.js';

/** Where decisions get cited: the engine, its tests, the web application, and the linter that explains itself. */
const ROOTS = ['src', 'tests', join('web', 'app')];
const LOOSE_FILES = ['eslint.config.js'];

const SOURCE = /\.(tsx?|css|js)$/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

/** The decision numbers a text cites, in the form this project writes them. */
function citations(text: string): number[] {
  return [...text.matchAll(/\bD(\d{1,2})\b/g)].map((match) => Number(match[1]));
}

/** The decisions the document records, from its `## Dn — …` headings. */
function recorded(): Set<number> {
  const doc = readFileSync(join(projectRoot, 'docs', 'DECISIONS.md'), 'utf8');
  return new Set([...doc.matchAll(/^## D(\d+) —/gm)].map((match) => Number(match[1])));
}

describe('the decisions the code cites', () => {
  const sources = [
    ...ROOTS.flatMap((root) => filesUnder(join(projectRoot, root))),
    ...LOOSE_FILES.map((name) => join(projectRoot, name)),
  ].sort();

  const cited = sources.flatMap((file) =>
    citations(readFileSync(file, 'utf8')).map((number) => ({ file: relative(projectRoot, file), number })),
  );

  it('reads enough files and finds enough citations to be measuring anything', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(new Set(cited.map((one) => one.number)).size).toBeGreaterThan(5);
  });

  it('all exist in docs/DECISIONS.md', () => {
    const known = recorded();
    const dangling = cited.filter((one) => !known.has(one.number));
    // Named rather than counted: a failure should say which file promised which decision.
    expect(dangling.map((one) => `${one.file} cites D${String(one.number)}`)).toEqual([]);
  });

  it('are numbered from D1 without a gap, so a reader can follow the log', () => {
    const numbers = [...recorded()].sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });
});
