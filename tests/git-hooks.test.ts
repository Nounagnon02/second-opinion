import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const HOOK_FILES = ['scripts/check-secrets.sh', 'scripts/install-hooks.sh', '.githooks/pre-commit'];

// Fake keys are assembled at runtime so this file never contains a literal that the secret scan would flag.
const FAKE_UUID_KEY = ['0badc0de', 'dead', 'beef', 'f00d', '0123456789ab'].join('-');
const FAKE_HEX_KEY = FAKE_UUID_KEY.replaceAll('-', '');
const FAKE_ENV_KEY = 'not-a-real-key-only-for-tests';

interface RunResult {
  status: number | null;
  output: string;
}

let scratch: string;
let repo: string;

/** Runs a command isolated from the user's git config and from any repository the suite itself runs in. */
function run(command: string, args: string[], cwd = repo): RunResult {
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Second Opinion Tests',
    GIT_AUTHOR_EMAIL: 'tests@example.invalid',
    GIT_COMMITTER_NAME: 'Second Opinion Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.invalid',
  };
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function git(...args: string[]): RunResult {
  return run('git', args);
}

function write(path: string, content: string): void {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(path: string, content: string, ...flags: string[]): RunResult {
  write(path, content);
  expect(git('add', path).status).toBe(0);
  return git('commit', '--quiet', '-m', `add ${path}`, ...flags);
}

function commitCount(): number {
  return Number(git('rev-list', '--all', '--count').output.trim());
}

/** Copies the versioned hook files into `dir`, keeping them executable. */
function copyHookFiles(dir: string): void {
  for (const file of HOOK_FILES) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(projectRoot, file), target);
    chmodSync(target, 0o755);
  }
}

describe('the secret scan, and the pre-commit hook that runs it', { timeout: 20_000 }, () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'second-opinion-hooks-'));
    repo = join(scratch, 'repo');
    mkdirSync(repo);
    copyHookFiles(repo);
    expect(git('init', '--quiet').status).toBe(0);
    expect(run('bash', ['scripts/install-hooks.sh']).status).toBe(0);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('is enabled by the install script through core.hooksPath', () => {
    expect(git('config', 'core.hooksPath').output.trim()).toBe('.githooks');
  });

  it.each([
    ['request header', `X-CMC_PRO_API_KEY: ${FAKE_HEX_KEY}`],
    ['UUID-shaped request header', `X-CMC_PRO_API_KEY: ${FAKE_UUID_KEY}`],
    ['lower-cased header in a JSON fixture', `{ "x-cmc_pro_api_key": "${FAKE_UUID_KEY}" }`],
    ['query parameter', `https://example.com/api?CMC_PRO_API_KEY=${FAKE_UUID_KEY}`],
    ['env assignment', `CMC_API_KEY=${FAKE_UUID_KEY}`],
  ])('refuses a commit that leaks a fake key as a %s', (_label, leak) => {
    const result = commit('fixtures/leak.json', `${leak}\n`);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('API key pattern detected in the staged changes');
    expect(result.output).toContain('Commit refused');
    expect(commitCount()).toBe(0);
  });

  it('refuses a commit that contains the key configured in .env', () => {
    write('.env', `CMC_API_KEY="${FAKE_ENV_KEY}"\n`);
    const result = commit('src/config.ts', `export const apiKey = '${FAKE_ENV_KEY}';\n`);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('The real CMC API key appears in the staged changes');
    expect(commitCount()).toBe(0);
  });

  it('refuses a commit that tracks .env', () => {
    const result = commit('.env', 'CMC_API_KEY=\n');

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('.env is tracked by git');
    expect(commitCount()).toBe(0);
  });

  it('accepts a commit without secrets, including an empty key placeholder', () => {
    write('.env', `CMC_API_KEY=${FAKE_ENV_KEY}\n`);
    const result = commit('.env.example', 'CMC_API_KEY=\nCMC_CREDIT_BUDGET=500\n');

    expect(result.status).toBe(0);
    expect(commitCount()).toBe(1);
  });

  it('finds a key that reached the history by bypassing the hook', () => {
    expect(commit('fixtures/leak.json', `X-CMC_PRO_API_KEY: ${FAKE_UUID_KEY}\n`, '--no-verify').status).toBe(0);

    expect(run('bash', ['scripts/check-secrets.sh']).status).toBe(0);
    const history = run('bash', ['scripts/check-secrets.sh', '--history']);
    expect(history.status).not.toBe(0);
    expect(history.output).toContain('API key pattern detected in the git history');
  });

  // The repository these cases run in has no commit at all, which is the state the project itself is in: the two
  // scopes above read an index and a history that hold nothing, so only --worktree has files to answer for.
  it('finds a key in a file that was never added to the index, and names it', () => {
    write('fixtures/leak.json', `X-CMC_PRO_API_KEY: ${FAKE_UUID_KEY}\n`);

    expect(run('bash', ['scripts/check-secrets.sh']).status).toBe(0);
    const worktree = run('bash', ['scripts/check-secrets.sh', '--worktree']);
    expect(worktree.status).not.toBe(0);
    expect(worktree.output).toContain('API key pattern detected in the files a clone would carry');
    expect(worktree.output).toContain('fixtures/leak.json');
  });

  it('finds the key configured in .env inside a file a clone would carry', () => {
    write('.gitignore', '.env\n');
    write('.env', `CMC_API_KEY="${FAKE_ENV_KEY}"\n`);
    write('src/config.ts', `export const apiKey = '${FAKE_ENV_KEY}';\n`);

    const result = run('bash', ['scripts/check-secrets.sh', '--worktree']);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('The real CMC API key appears in the files a clone would carry');
    expect(result.output).toContain('src/config.ts');
    // .env carries the key as well, and is the one file a clone never receives: naming it would be a false lead.
    expect(result.output).not.toContain('.env');
  });

  it('reads a file git treats as binary rather than skipping it', () => {
    // A NUL byte is what makes git call the file binary. It stays in the scan, so a key cannot hide inside one.
    write('fixtures/blob.bin', `\u0000X-CMC_PRO_API_KEY: ${FAKE_HEX_KEY}\n`);

    const result = run('bash', ['scripts/check-secrets.sh', '--worktree']);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('fixtures/blob.bin');
  });

  it('passes over the files a clone would carry when the key is only in an ignored one', () => {
    write('.gitignore', '.env\nnode_modules/\n');
    write('.env', `CMC_API_KEY=${FAKE_UUID_KEY}\n`);
    write('.env.example', 'CMC_API_KEY=\nCMC_CREDIT_BUDGET=500\n');

    const result = run('bash', ['scripts/check-secrets.sh', '--worktree']);
    expect(result.output).toContain('No secret detected');
    expect(result.status).toBe(0);
  });

  it.each(['--histry', '--all', 'history'])('refuses the scope %s instead of reporting a clean scan', (scope) => {
    const result = run('bash', ['scripts/check-secrets.sh', scope]);

    expect(result.status).toBe(2);
    expect(result.output).toContain(`Unknown scope: ${scope}`);
    expect(result.output).not.toContain('No secret detected');
  });

  it('refuses two scopes at once, rather than answering for one of them', () => {
    const result = run('bash', ['scripts/check-secrets.sh', '--history', '--worktree']);

    expect(result.status).toBe(2);
    expect(result.output).toContain('One scope at a time');
  });

  it('fails instead of reporting a clean scan outside a git work tree', () => {
    const outside = join(scratch, 'not-a-repo');
    copyHookFiles(outside);
    const result = run('bash', ['scripts/check-secrets.sh'], outside);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Not inside a git work tree');
  });
});

/**
 * T9.3 read this repository once, by hand. Reading it here instead means the answer cannot go stale: a key that
 * reaches a file of this project fails the suite, whether or not anyone thinks to run the script again.
 */
describe('this repository, under each scope', { timeout: 60_000 }, () => {
  it.each([
    ['the staged changes', []],
    ['the git history', ['--history']],
    ['every file a clone would carry', ['--worktree']],
  ] as const)('carries no key across %s', (_label, scope) => {
    const result = run('bash', ['scripts/check-secrets.sh', ...scope], projectRoot);

    expect(result.output, `scripts/check-secrets.sh ${scope.join(' ')}`).toContain('No secret detected');
    expect(result.status).toBe(0);
  });
});
