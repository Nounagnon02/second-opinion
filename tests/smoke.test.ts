import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from '../src/index.js';

describe('toolchain smoke test', () => {
  it('imports the package entry point', () => {
    expect(PROJECT_NAME).toBe('second-opinion');
  });
});
