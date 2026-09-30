/**
 * The server half of the web interface (specification F8).
 *
 * Everything a page needs is decided here — which mode the deployment runs in, what the engine answered, how a
 * check reads in plain English, what the audit report says — so that the Next.js application under `web/` holds
 * markup and routing and nothing that has to be reasoned about. The offline suite covers this half; the browser
 * half has nothing left in it to cover.
 *
 * See `docs/DECISIONS.md` (D15) for why the application is a separate package rather than a folder of this one.
 */
export * from './audit-view.js';
export * from './lookup.js';
export * from './runtime.js';
export * from './settings.js';
export * from './view.js';
