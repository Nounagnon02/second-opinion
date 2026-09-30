/**
 * Loaded before every test file (vitest.config.ts): `fetch`, the only way src/ reaches the network
 * (tests/no-network.test.ts checks that), fails instead of connecting.
 */
export const NETWORK_DISABLED = 'Network access is disabled in tests: use a scripted transport or --replay fixtures.';

globalThis.fetch = () => Promise.reject(new Error(NETWORK_DISABLED));
