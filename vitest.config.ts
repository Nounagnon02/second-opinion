import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Every test runs offline (T2.2): real HTTP calls fail, CMC answers come from scripted transports or fixtures.
    setupFiles: ['tests/setup/no-network.ts'],
  },
});
