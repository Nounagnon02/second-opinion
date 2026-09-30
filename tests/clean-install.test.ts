/**
 * The clean-install check of T9.1: `scripts/clean-install-check.sh`.
 *
 * Acceptance criterion 1 of the specification is that `npm install && npm run build && npm test` works on a clean
 * machine, and the only way to know is to start from one. The script copies the repository-visible files — tracked
 * plus untracked, with `.gitignore` applied — into a temporary directory and runs the gates there, so nothing this
 * clone built for itself travels: not `node_modules/`, not `dist/`, not `.cache/`, and above all not `.env`.
 *
 * That run is what the first version of it found: sixteen cases of five files read the wrapper index out of
 * `.cache/`, which only a machine that had already built it against the API had. They now rebuild it from
 * `fixtures/rwa-index/`; the last group here holds on to what makes that possible.
 *
 * Nothing below runs `npm install`: these cases read the script, and prove its one moving part — the file list — in
 * a throwaway repository of their own, so they stay offline and take milliseconds.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import { projectRoot } from './helpers/endpoints-doc.js';
import { replayIndex, RWA_INDEX_FIXTURES } from './helpers/rwa-index.js';

const SCRIPT = join(projectRoot, 'scripts', 'clean-install-check.sh');
const TEXT = readFileSync(SCRIPT, 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-clean-install-'));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** Runs a command isolated from the user's git configuration and from the repository this suite runs in. */
function run(command: string, args: readonly string[], cwd: string): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Second Opinion Tests',
    GIT_AUTHOR_EMAIL: 'tests@example.invalid',
    GIT_COMMITTER_NAME: 'Second Opinion Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.invalid',
  };
  const result = spawnSync(command, [...args], { cwd, env, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The `for ... in` list of a loop of the script, which is how it names what must and must not travel. */
function loopList(variable: string): string[] {
  const found = new RegExp(`for ${variable} in ([^;]+); do`).exec(TEXT)?.[1];
  if (found === undefined) throw new Error(`${SCRIPT} no longer has a \`for ${variable} in ...\` loop.`);
  return found.trim().split(/\s+/);
}

/** Every `run npm ...` line of the script, in the order it runs them. */
function gates(): string[] {
  return [...TEXT.matchAll(/^run npm (.+)$/gm)].map((match) => (match[1] ?? '').trim());
}

describe('the script that checks a clean install', () => {
  it('is an executable bash script the shell can parse', () => {
    expect(TEXT.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(TEXT).toContain('set -euo pipefail');
    expect(run('bash', ['-n', SCRIPT], projectRoot).status).toBe(0);
    // Executable for its owner: `npm test` has no business being the only way to run it.
    expect(run('test', ['-x', SCRIPT], projectRoot).status).toBe(0);
  });

  it('documents both of the options it accepts, and refuses any other', () => {
    for (const option of ['--keep', '--with-web']) {
      expect(TEXT, `${option} is accepted but not documented in the header`).toContain(`#   ${option}`);
      expect(TEXT).toContain(`${option}) `);
    }
    const refused = run('bash', [SCRIPT, '--rebuild-everything'], projectRoot);
    expect(refused.status).toBe(2);
    expect(refused.output).toContain('--rebuild-everything');
  });

  it('runs the five gates T9.1 asks for, in that order, and nothing before them', () => {
    // `npm install` and `npm test` are the two npm spells without `run`, and the two the specification uses.
    expect(gates().slice(0, 5)).toEqual(['install', 'run build', 'run lint', 'run typecheck', 'test']);
  });

  it('then replays the quick start the README promises works with no key', () => {
    const offline = gates().slice(5);
    expect(offline).toContain('run demo');
    expect(offline.some((gate) => gate.startsWith('run check -- PAXG --replay='))).toBe(true);
    const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
    expect(readme).toContain('npm run check -- PAXG --replay=fixtures/check');
    expect(readme).toContain('npm run demo');
  });

  it('is reachable as an npm script, like the other gates of this package', () => {
    expect(PACKAGE.scripts['check:clean']).toBe(`bash ${relative(projectRoot, SCRIPT)}`);
  });

  it('is named by the section of the README that tells a reader how to verify a clone', () => {
    const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
    const verifying = readme.split(/^## /m).find((part) => part.startsWith('Verifying a clone\n'));
    expect(verifying, 'README.md has no "## Verifying a clone" section').toBeDefined();
    expect(verifying).toContain('npm run check:clean');
    // The option is only useful if the reader is told it exists.
    expect(verifying).toContain('--with-web');
  });

  it('calls only npm scripts that exist', () => {
    for (const gate of gates()) {
      if (gate === 'install') continue; // The one npm command of the script that is not a script of this package.
      const name = /^(?:run )?([\w:]+)/.exec(gate)?.[1] ?? '';
      expect(Object.keys(PACKAGE.scripts), `npm ${gate} is not a script of this package`).toContain(name);
    }
  });
});

describe('what the copy it works from holds', () => {
  const absent = loopList('absent');
  const present = loopList('present');
  const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8');

  it('refuses the key and everything a clean machine builds for itself', () => {
    expect(absent).toEqual(expect.arrayContaining(['.env', 'node_modules', 'dist', '.cache']));
  });

  it('names nothing as absent that git would have copied anyway', () => {
    for (const path of absent) {
      if (path === '.git') continue; // Not ignored: never copied, because the copy is of files, not of history.
      const pattern = new RegExp(`^${path.replace('.', '\\.')}/?$`, 'm');
      expect(gitignore, `${path} is expected to stay behind, but .gitignore does not ignore it`).toMatch(pattern);
    }
  });

  it('requires everything the offline gates read, and all of it is here', () => {
    expect(present).toEqual(expect.arrayContaining(['package.json', 'package-lock.json', 'fixtures', 'tests', 'src']));
    for (const path of present) expect(existsSync(join(projectRoot, path)), `${path} is missing`).toBe(true);
  });

  it('lists the files with git, so the copy is what a clone would be', () => {
    expect(TEXT).toContain('git ls-files -z --cached --others --exclude-standard');
  });
});

describe('the file list that command produces', () => {
  /** A throwaway repository with this project's .gitignore and one file of each kind the copy cares about. */
  function repoWithProjectGitignore(): string {
    const repo = scratch();
    expect(run('git', ['init', '--quiet'], repo).status).toBe(0);
    copyFileSync(join(projectRoot, '.gitignore'), join(repo, '.gitignore'));
    const write = (path: string, content: string): void => {
      mkdirSync(join(repo, path, '..'), { recursive: true });
      writeFileSync(join(repo, path), content);
    };
    write('package.json', '{}\n');
    write('src/index.ts', 'export {};\n');
    write('fixtures/demo/E01.json', '{}\n');
    write('.env', 'CMC_API_KEY=not-a-real-key-only-for-tests\n');
    write('node_modules/left/index.js', '\n');
    write('dist/index.js', '\n');
    write('.cache/rwa/wrapper-index.json', '{}\n');
    // Committed, so the list is proven to carry tracked and untracked files alike.
    expect(run('git', ['add', 'package.json'], repo).status).toBe(0);
    expect(run('git', ['commit', '--quiet', '-m', 'first'], repo).status).toBe(0);
    return repo;
  }

  function listed(): string[] {
    const repo = repoWithProjectGitignore();
    const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], repo);
    expect(result.status).toBe(0);
    return result.output.split('\n').filter((line) => line !== '');
  }

  it('leaves the key behind, whatever else it takes', () => {
    expect(listed()).not.toContain('.env');
  });

  it('leaves behind everything a clean machine builds for itself', () => {
    const files = listed();
    for (const built of ['node_modules/left/index.js', 'dist/index.js', '.cache/rwa/wrapper-index.json']) {
      expect(files, `${built} would have travelled into the copy`).not.toContain(built);
    }
  });

  it('takes the sources and the fixtures, tracked or not', () => {
    expect(listed()).toEqual(
      expect.arrayContaining(['.gitignore', 'package.json', 'src/index.ts', 'fixtures/demo/E01.json']),
    );
  });
});

describe('the guard before any of it runs', () => {
  it('refuses to work outside a git work tree rather than copy nothing', () => {
    const outside = scratch();
    // Only meaningful where the temporary directory is not itself inside a repository.
    if (run('git', ['rev-parse', '--show-toplevel'], outside).status === 0) return;
    mkdirSync(join(outside, 'scripts'));
    const copy = join(outside, 'scripts', 'clean-install-check.sh');
    copyFileSync(SCRIPT, copy);
    chmodSync(copy, 0o755);
    const result = run('bash', [copy], outside);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Not inside a git work tree');
    // It stopped before npm: a failure here must not cost an install.
    expect(result.output).not.toContain('npm install');
  });
});

describe('what T9.1 found: the index a clean clone has no cache for', () => {
  it('is cached where git does not follow, which is why it cannot be relied on', () => {
    expect(DEFAULT_INDEX_FILE).toBe(join(projectRoot, '.cache', 'rwa', 'wrapper-index.json'));
    expect(readFileSync(join(projectRoot, '.gitignore'), 'utf8')).toMatch(/^\.cache\/?$/m);
  });

  it('can be rebuilt from answers the repository does carry, with no key and no network', async () => {
    expect(existsSync(RWA_INDEX_FIXTURES)).toBe(true);
    const index = await replayIndex();
    expect(index.entries.length).toBeGreaterThan(0);
    // The wrapper the accepted scenario of the demonstration rests on: without it C5 has nothing to follow.
    expect(index.entries.some((entry) => entry.cmcId === 4705)).toBe(true);
  });

  it('is rebuilt that way by every test that needs it, rather than read from the cache', () => {
    for (const file of ['demo-agent', 'demo-run', 'submission-doc', 'video-script-doc', 'x-post-doc']) {
      const source = readFileSync(join(projectRoot, 'tests', `${file}.test.ts`), 'utf8');
      expect(source, `tests/${file}.test.ts no longer builds the index it needs`).toMatch(
        /replayIndex\(\)|ensureWrapperIndex\(/,
      );
    }
  });
});
