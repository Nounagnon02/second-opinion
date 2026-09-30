import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // `web/` is the Next.js application: it has its own TypeScript project and its own ESLint configuration,
  // because JSX and the bundler resolution of its tsconfig have no place in this one (D15). `npm run web:lint`.
  globalIgnores(['dist/', 'coverage/', '.next/', 'fixtures/', '.loop/', '.cache/', 'web/']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
