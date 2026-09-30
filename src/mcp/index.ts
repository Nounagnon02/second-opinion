/**
 * The MCP server of the specification (F6): the four tools an agent calls before it acts — `check_asset`,
 * `check_rwa_token`, `preflight_trade` and `explain` — over the stdio transport.
 *
 * `tools.ts` is what the tools do and answers with plain objects; `server.ts` is the protocol around them, and
 * `explain.ts` is the plain-English account of each check with the limits it reads. The split is what lets every
 * tool be tested without a transport and the transport be tested without the network.
 */
export * from './explain.js';
export * from './server.js';
export * from './tools.js';
