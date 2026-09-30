import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');

// Fake keys are assembled at runtime so this file never contains a literal that the secret scan would flag.
const FAKE_UUID_KEY = ['0badc0de', 'dead', 'beef', 'f00d', '0123456789ab'].join('-');
const FAKE_HEX_KEY = FAKE_UUID_KEY.replaceAll('-', '');
const KEY_NAME = 'CMC_API_KEY';

interface RunResult {
  status: number | null;
  output: string;
}

let scratch: string;

/** Runs a copy of scripts/check-env.sh against the .env written in the scratch directory. */
function checkEnv(): RunResult {
  const result = spawnSync('bash', ['scripts/check-env.sh'], { cwd: scratch, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeEnv(content: string): void {
  writeFileSync(join(scratch, '.env'), content);
}

describe('check-env script', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'second-opinion-env-'));
    mkdirSync(join(scratch, 'scripts'));
    const script = join(scratch, 'scripts', 'check-env.sh');
    copyFileSync(join(projectRoot, 'scripts', 'check-env.sh'), script);
    chmodSync(script, 0o755);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it.each([
    ['32 hex digits', `${KEY_NAME}=${FAKE_HEX_KEY}\n`, FAKE_HEX_KEY],
    ['a double-quoted UUID', `# comment\n${KEY_NAME}="${FAKE_UUID_KEY}"\nCMC_CREDIT_BUDGET=500\n`, FAKE_UUID_KEY],
    ['CRLF line endings', `${KEY_NAME}=${FAKE_HEX_KEY}\r\nCMC_CREDIT_BUDGET=500\r\n`, FAKE_HEX_KEY],
  ])('passes with a key made of %s, without printing it', (_label, env, key) => {
    writeEnv(env);
    const result = checkEnv();

    expect(result.status).toBe(0);
    expect(result.output).toContain(`CMC_API_KEY is set in .env (${key.length} characters)`);
    expect(result.output).not.toContain(key);
  });

  it('fails when .env is missing', () => {
    const result = checkEnv();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('.env not found');
  });

  it('fails when .env.example was copied without filling the key in', () => {
    copyFileSync(join(projectRoot, '.env.example'), join(scratch, '.env'));
    const result = checkEnv();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('CMC_API_KEY is empty in .env');
  });

  it('fails when the key is not defined, even if commented out', () => {
    writeEnv(`# ${KEY_NAME}=${FAKE_HEX_KEY}\nCMC_CREDIT_BUDGET=500\n`);
    const result = checkEnv();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('CMC_API_KEY is not defined in .env');
  });

  it('fails when the key is defined twice', () => {
    writeEnv(`${KEY_NAME}=\n${KEY_NAME}=${FAKE_HEX_KEY}\n`);
    const result = checkEnv();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('CMC_API_KEY is defined 2 times in .env');
  });

  it.each([
    ['a placeholder', 'paste-your-key-here'],
    ['a truncated key', FAKE_HEX_KEY.slice(0, 31)],
    ['a trailing space', `${FAKE_HEX_KEY} `],
  ])('fails on a malformed key (%s) without printing it', (_label, value) => {
    writeEnv(`${KEY_NAME}=${value}\n`);
    const result = checkEnv();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`CMC_API_KEY has an unexpected format (${value.length} characters`);
    expect(result.output).not.toContain(value.trim());
  });
});
