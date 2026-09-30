import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Two settings, both about the same thing: the engine reads files at request time.
 *
 * `config/checks.json` holds every threshold, `fixtures/` holds the recorded answers a replay deployment serves
 * and the walk the wrapper index is rebuilt from (D6), and `docs/api_audit.json` is the published audit report.
 * None of the three is imported, so the bundler cannot see them: they are traced into the deployment by name.
 *
 * The tracing root is the repository rather than this directory, because all three sit above it, and because
 * the engine finds them by walking up from the working directory once it has been inlined into the server
 * bundle (`locateProjectRoot` in `src/cmc/config.ts`). `SECOND_OPINION_ROOT` overrides that walk on a host
 * whose layout matches neither case.
 */
const repositoryRoot = join(import.meta.dirname, '..');

const config: NextConfig = {
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingIncludes: {
    '/asset': ['../config/**', '../fixtures/**'],
    '/audit': ['../docs/api_audit.json'],
  },
};

export default config;
