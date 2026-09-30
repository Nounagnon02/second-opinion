/**
 * The Next.js application under `web/` (T7.1), checked as source rather than run.
 *
 * The browser half holds markup and routing only — every decision it renders was made in `src/web/`, which the
 * rest of this suite covers — so what is left to check here is that it stays that way, and that the one rule
 * that cannot be caught at runtime holds: **nothing in the browser half may name the API key.**
 *
 * That rule needs a reader of the files, not a test of a function. `NEXT_PUBLIC_*` is inlined into the bundle
 * at build time, and a client component is shipped to the browser whole, so a mention of the key in either
 * place is a leak that no request would ever reveal. `readWebSettings` refuses such a deployment at runtime
 * (tests/web-settings.test.ts); this file refuses to let one be written.
 *
 * It also checks that what the application imports from this package is really exported by it, which is the one
 * kind of breakage the offline suite would otherwise miss entirely: `npm test` never loads `web/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_HEADER } from '../src/cmc/client.js';
import * as engine from '../src/index.js';
import * as web from '../src/web/index.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const WEB_ROOT = join(projectRoot, 'web');
const APP_ROOT = join(WEB_ROOT, 'app');

/** Every source file of the application, relative to the repository root. */
function appFiles(directory = APP_ROOT): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return appFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const files = appFiles().sort();
const sources = new Map(files.map((file) => [relative(projectRoot, file), readFileSync(file, 'utf8')]));

/** The named imports the application takes from this package, per file. */
function importsOfPackage(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'second-opinion(?:\/web)?'/g)) {
    for (const part of (match[2] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name !== undefined && name !== '') names.push(name);
    }
  }
  return names;
}

describe('the pages the specification asks for exist', () => {
  it('has a search page, an asset page and an audit page (F8)', () => {
    for (const page of ['app/page.tsx', 'app/asset/page.tsx', 'app/audit/page.tsx', 'app/layout.tsx']) {
      expect(existsSync(join(WEB_ROOT, page)), page).toBe(true);
    }
  });

  it('reads the asset it is asked about out of the URL, so a verdict can be linked to', () => {
    const page = sources.get(join('web', 'app', 'asset', 'page.tsx'));
    expect(page).toContain('searchParams');
    expect(sources.get(join('web', 'app', 'components', 'search-form.tsx'))).toContain('action="/asset"');
  });

  it('runs the asset page on Node, uncached: a cached verdict is the failure this project prevents', () => {
    const page = sources.get(join('web', 'app', 'asset', 'page.tsx')) ?? '';
    expect(page).toContain("export const runtime = 'nodejs'");
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });

  it('reads the audit report at request time, which is what next.config.ts traces it in for', () => {
    // Prerendering this page would freeze the build's environment, leaving SECOND_OPINION_AUDIT_FILE with no
    // effect and `outputFileTracingIncludes['/audit']` with no reader (D15).
    const page = sources.get(join('web', 'app', 'audit', 'page.tsx')) ?? '';
    expect(page).toContain("export const runtime = 'nodejs'");
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });
});

describe('the key stays on the server', () => {
  it('is named nowhere in the browser half', () => {
    for (const [name, text] of sources) {
      expect(text, name).not.toContain('CMC_API_KEY');
      expect(text, name).not.toContain(KEY_HEADER);
      expect(text, name).not.toContain('NEXT_PUBLIC_');
      expect(text, name).not.toMatch(/process\.env/);
    }
  });

  it('ships no client component at all, so there is nothing to leak into', () => {
    for (const [name, text] of sources) {
      expect(text.trimStart().startsWith("'use client'"), name).toBe(false);
      expect(text, name).not.toContain('"use client"');
    }
  });

  it('never reads the environment itself: the server module does, and refuses a published key', () => {
    expect(web.assertKeyStaysOnServer).toBeTypeOf('function');
    expect(web.readWebSettings).toBeTypeOf('function');
  });
});

describe('what the application imports is what this package exports', () => {
  it('resolves every named import to a real export', () => {
    const exported = new Set([...Object.keys(engine), ...Object.keys(web)]);
    // A type is erased before runtime, so it never appears in the namespace above; it is looked for in the
    // source of the server half instead.
    const serverHalf = readdirSync(join(projectRoot, 'src', 'web'))
      .map((name) => readFileSync(join(projectRoot, 'src', 'web', name), 'utf8'))
      .join('\n');
    const seen: string[] = [];
    for (const [name, text] of sources) {
      for (const imported of importsOfPackage(text)) {
        seen.push(imported);
        const isType = new RegExp(`export (interface|type) ${imported}\\b`).test(serverHalf);
        expect(exported.has(imported) || isType, `${name} imports ${imported}`).toBe(true);
      }
    }
    expect(seen.length).toBeGreaterThan(3);
  });

  it('is reachable under the entry point the application imports', () => {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; default: string }>;
    };
    expect(manifest.exports['./web']).toEqual({
      types: './dist/web/index.d.ts',
      default: './dist/web/index.js',
    });
  });
});

describe('the application is built and deployed as its own package (D15)', () => {
  const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it('depends on this repository rather than on a copy of it', () => {
    expect(manifest.dependencies['second-opinion']).toBe('file:..');
  });

  it('has the four scripts the root delegates to', () => {
    for (const script of ['dev', 'build', 'start', 'lint', 'typecheck']) {
      expect(manifest.scripts[script], script).toBeTruthy();
    }
    const root = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // The engine is rebuilt first: the application reads `dist/`, never `src/`.
    expect(root.scripts['web:build']).toBe('npm run build && npm run build --prefix web');
    expect(root.scripts['web:dev']).toBe('npm run build && npm run dev --prefix web');
  });

  it('traces the files the engine reads at request time into the deployment', () => {
    const config = readFileSync(join(WEB_ROOT, 'next.config.ts'), 'utf8');
    // Thresholds and the recorded walk the wrapper index is rebuilt from; without them a deployment answers
    // nothing at all.
    expect(config).toContain("'../config/**'");
    expect(config).toContain("'../fixtures/**'");
    expect(config).toContain("'../docs/api_audit.json'");
    expect(config).toContain('outputFileTracingRoot');
  });

  it('is left to its own linter, which is why the root one ignores it', () => {
    expect(readFileSync(join(projectRoot, 'eslint.config.js'), 'utf8')).toContain("'web/'");
    expect(existsSync(join(WEB_ROOT, 'eslint.config.js'))).toBe(true);
    expect(existsSync(join(WEB_ROOT, 'tsconfig.json'))).toBe(true);
  });
});
