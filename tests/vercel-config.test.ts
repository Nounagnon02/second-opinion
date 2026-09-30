/**
 * The deployment settings of T7.2, checked against the repository they describe.
 *
 * A deployment is the one thing this suite cannot run: it needs a host. So what is checkable here is everything
 * *but* the deploy — that the build settings still match the scripts they delegate to, that the README still
 * describes the file, and that the file still carries no secret. A deployment configuration rots in silence
 * otherwise: it is read once, by a machine nobody watches, months after the scripts under it were renamed.
 *
 * The test that matters most is the last one. `src/web/settings.ts` and `src/web/runtime.ts` decide how a
 * deployment behaves by reading the environment, and a variable added there without a line in the README is a
 * setting no operator knows exists. The list is therefore read out of the source, never restated here.
 *
 * Two project settings — the Root Directory, and permission to read above it — cannot be expressed in
 * `vercel.json` at all (Vercel's configuration has no property for either), so they are only checkable as prose:
 * the README has to name them, or nobody will set them. See `docs/DECISIONS.md` (D16).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './helpers/endpoints-doc.js';

const WEB_ROOT = join(projectRoot, 'web');

interface VercelConfig {
  $schema?: string;
  framework?: string;
  installCommand?: string;
  buildCommand?: string;
}

const config = JSON.parse(readFileSync(join(WEB_ROOT, 'vercel.json'), 'utf8')) as VercelConfig;

function scriptsOf(directory: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts;
}

const rootScripts = scriptsOf(projectRoot);
const webScripts = scriptsOf(WEB_ROOT);

const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');

/** The part of the README that describes the interface and its deployment, heading to next heading. */
function deploymentSection(): string {
  const match = /^## The web interface$([\s\S]*?)(?=^## )/m.exec(README);
  if (match === null) throw new Error('README.md no longer has a "## The web interface" section.');
  return match[1] ?? '';
}

const section = deploymentSection();

describe('web/vercel.json describes this repository', () => {
  it('sits in the directory Vercel is told to treat as the root', () => {
    // Vercel reads vercel.json from the project's Root Directory, not from the repository root: with the app in
    // `web/`, a file at the repository root would never be read at all.
    expect(readdirSync(WEB_ROOT)).toContain('vercel.json');
    expect(readdirSync(projectRoot)).not.toContain('vercel.json');
  });

  it('claims the framework the application actually uses', () => {
    const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(config.framework).toBe('nextjs');
    expect(manifest.dependencies.next).toBeTruthy();
  });

  it('installs the engine before the application, in that order', () => {
    // The application depends on this package as `file:..`, whose exports point at `dist/`: an install that
    // skips the parent leaves the build with nothing to compile against.
    expect(config.installCommand).toBe('npm install --prefix .. && npm install');
  });

  it('builds the engine before the application, through the scripts that do it', () => {
    const [engine, app] = (config.buildCommand ?? '').split(' && ');
    // The parent's `build` compiles to `dist/`; the application's own `build` is the Next.js build.
    expect(engine).toBe('npm run build --prefix ..');
    expect(rootScripts.build).toContain('tsc -p tsconfig.build.json');
    expect(app).toBe('npm run build');
    expect(webScripts.build).toBe('next build');
  });

  it('takes the same two steps as the script a clone runs, in the same order', () => {
    // `npm run web:build` is the command the repository is verified with; the deployment must not be a second,
    // untested build path. The same two steps, seen from `web/` instead of from the root.
    expect(rootScripts['web:build']).toBe('npm run build && npm run build --prefix web');
  });

  it('carries no credential: the key is set on the deployment, never committed', () => {
    const text = readFileSync(join(WEB_ROOT, 'vercel.json'), 'utf8');
    expect(text).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/i);
  });
});

describe('the README hands an operator everything vercel.json cannot', () => {
  it('names the two project settings that have no vercel.json property', () => {
    expect(section).toContain('Root Directory');
    expect(section).toContain('Include source files outside of the Root Directory in the Build Step');
  });

  it('quotes the build settings as the file actually has them', () => {
    // A configuration block in a document is worth what a reader copies out of it, so it is compared to the
    // file rather than read for plausibility. `$schema` is the one key the document leaves out.
    const blocks = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
      (match) => JSON.parse(match[1] ?? '') as VercelConfig,
    );
    const quoted = blocks.filter((block) => block.buildCommand !== undefined);
    expect(quoted).toHaveLength(1);
    const { $schema, ...file } = config;
    expect($schema).toBe('https://openapi.vercel.sh/vercel.json');
    expect(quoted[0]).toEqual(file);
  });

  it('documents every environment variable the interface reads', () => {
    const directory = join(projectRoot, 'src', 'web');
    const source = readdirSync(directory)
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const read = [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1] ?? ''))];

    // Enough to be measuring something: the mode, the key and the four paths.
    expect(read.length).toBeGreaterThanOrEqual(6);
    // Named rather than counted, so a failure says which variable an operator would have had to guess at.
    expect(read.filter((name) => !section.includes(name))).toEqual([]);
  });

  it('documents the escape hatch for a host that finds neither layout', () => {
    // `SECOND_OPINION_ROOT` is read in src/cmc/config.ts rather than src/web, so the check above misses it, and
    // it is the one variable a deployment with an unexpected working directory cannot do without.
    expect(readFileSync(join(projectRoot, 'src', 'cmc', 'config.ts'), 'utf8')).toContain('SECOND_OPINION_ROOT');
    expect(section).toContain('SECOND_OPINION_ROOT');
  });

  it('says how to run the interface locally, through the scripts the root defines', () => {
    for (const script of ['web:install', 'web:dev']) {
      expect(rootScripts[script], script).toBeTruthy();
      expect(section, script).toContain(`npm run ${script}`);
    }
  });
});
