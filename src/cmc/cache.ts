/**
 * Local cache of successful CMC responses, to save credits across calls and runs.
 * Entries hold the response only: never the request headers, so never the API key.
 * Expiry is decided by the client from the entry's `storedAt` and the TTL of the endpoint's cache class.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureRef } from './fixtures.js';

export interface StoredResponse {
  url: string;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  latencyMs: number;
  /** Local time the response arrived, ISO 8601; in record and replay modes, the time it was recorded. */
  receivedAt: string;
  /** The fixture that holds this answer, in record and replay modes. */
  fixture?: FixtureRef;
}

export interface CacheEntry {
  /** Local epoch milliseconds of the write. */
  storedAt: number;
  response: StoredResponse;
}

export interface ResponseCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

/** In-process cache, for tests and for long-lived servers. */
export class MemoryCache implements ResponseCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }
}

interface CacheFile extends CacheEntry {
  key: string;
}

/** One JSON file per request under `dir` (`.cache/cmc` by default, ignored by git), so CLI runs share it. */
export class FileCache implements ResponseCache {
  constructor(readonly dir: string) {}

  private fileFor(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  get(key: string): CacheEntry | undefined {
    let file: CacheFile;
    try {
      file = JSON.parse(readFileSync(this.fileFor(key), 'utf8')) as CacheFile;
    } catch {
      // Missing or unreadable entry: a miss, the next successful call rewrites it.
      return undefined;
    }
    if (file.key !== key || typeof file.storedAt !== 'number' || typeof file.response !== 'object') return undefined;
    return { storedAt: file.storedAt, response: file.response };
  }

  set(key: string, entry: CacheEntry): void {
    mkdirSync(this.dir, { recursive: true });
    const target = this.fileFor(key);
    const temporary = `${target}.${process.pid}.tmp`;
    const file: CacheFile = { key, ...entry };
    writeFileSync(temporary, `${JSON.stringify(file)}\n`);
    // Atomic on the same file system: a parallel run never reads a half-written entry.
    renameSync(temporary, target);
  }
}
