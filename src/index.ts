/** Package entry point. Public modules (client, checks, score, MCP) are re-exported here as they land. */
export const PROJECT_NAME = 'second-opinion';

export { CmcClient, createClientFromEnv, fetchTransport, KEY_HEADER } from './cmc/client.js';
export type { CmcClientOptions, CmcResponse, Query, Transport, TransportRequest, TransportResponse } from './cmc/client.js';
export { FileCache, MemoryCache } from './cmc/cache.js';
export type { CacheEntry, ResponseCache, StoredResponse } from './cmc/cache.js';
export { loadClientConfig, loadClientSettings } from './cmc/config.js';
export type { ClientConfig } from './cmc/config.js';
export type { CreditUsage } from './cmc/credits.js';
export { ENDPOINTS } from './cmc/endpoints.js';
export type { CacheClass, EndpointId } from './cmc/endpoints.js';
export { CmcError } from './cmc/errors.js';
export type { CmcErrorKind } from './cmc/errors.js';
export { evidencePath, requestKey } from './cmc/fixtures.js';
export type { FixtureRef, RecordedExchange } from './cmc/fixtures.js';
export type { KeyInfo } from './cmc/key-info.js';
export { createClientForMode, parseRunMode } from './cmc/mode.js';
export type { ModeOverrides, RunMode } from './cmc/mode.js';
export { recordingTransport } from './cmc/recorder.js';
export { RATE_WINDOW_MS, throttledTransport } from './cmc/throttle.js';
export type { ThrottleOptions } from './cmc/throttle.js';
export { FixtureIndex, replayTransport } from './cmc/replay.js';
export type { CmcStatus } from './cmc/status.js';

// The common model and the normaliser of every verified source (specification F3).
export * from './normalize/index.js';

// The consistency engine and its thresholds (specification F4).
export * from './checks/index.js';

// The reliability score and the verdict it leads to (specification F5).
export * from './score/index.js';

// The token to real-world-asset index C5 answers a wrapper symbol with (D6).
export {
  buildWrapperIndex,
  DEFAULT_INDEX_FILE,
  describeWrapperIndex,
  entriesOfIssuer,
  loadWrapperIndex,
  lookupWrapper,
  MAX_PAGE_SIZE,
  parseWrapperIndex,
  saveWrapperIndex,
  serializeWrapperIndex,
} from './rwa/wrapper-index.js';
export type { BuildOptions, WrapperIndex, WrapperIndexEntry, WrapperIndexStats } from './rwa/wrapper-index.js';

// The calibration of the score on the first assets by market capitalisation (specification F5, T4.1).
export * from './calibration/index.js';

// The four tools an agent calls before it acts, and the stdio server around them (specification F6, T5.1).
export * from './mcp/index.js';

// The audit of the API, measured from the recorded answers alone (specification F9, T6.1).
export * from './audit/index.js';

// The server half of the web interface: the runtime a page reads through, and the views it renders (F8, T7.1).
export * from './web/index.js';
