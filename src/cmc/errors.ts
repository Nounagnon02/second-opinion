/**
 * Every failure of the CMC client is a CmcError. Callers turn it into an `unavailable` check (D9), with
 * `message` as the reason; `kind` and `retryable` say what happened. No message ever contains the API key.
 */
import type { FixtureRef } from './fixtures.js';
import type { CmcStatus } from './status.js';

export type CmcErrorKind =
  /** Missing API key or invalid setting: nothing was sent. */
  | 'config'
  /** The call would take the run past its credit budget: nothing was sent. */
  | 'budget'
  /** No answer within the per-call timeout. */
  | 'timeout'
  /** The request did not reach the API or the connection broke. */
  | 'network'
  /** The API answered with an error: HTTP status >= 400 or a non-zero `status.error_code`. */
  | 'api'
  /** HTTP 200 without a readable CMC `status` block. */
  | 'invalid_response'
  /** Replay mode: no recorded fixture matches the request. Nothing was sent and nothing is counted. */
  | 'replay_miss'
  /** Record mode: the API answered, but the fixture could not be written. */
  | 'record';

export interface CmcErrorDetails {
  endpoint?: string;
  httpStatus?: number;
  status?: CmcStatus;
  retryable?: boolean;
  attempts?: number;
  /** The recorded answer behind an `api` error, in record and replay modes. */
  fixture?: FixtureRef;
}

export class CmcError extends Error {
  override readonly name = 'CmcError';
  readonly endpoint: string | undefined;
  readonly httpStatus: number | undefined;
  readonly status: CmcStatus | undefined;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly fixture: FixtureRef | undefined;

  constructor(
    readonly kind: CmcErrorKind,
    message: string,
    details: CmcErrorDetails = {},
  ) {
    super(message);
    this.endpoint = details.endpoint;
    this.httpStatus = details.httpStatus;
    this.status = details.status;
    this.retryable = details.retryable ?? false;
    this.attempts = details.attempts ?? 0;
    this.fixture = details.fixture;
  }

  /** The same error, with the number of attempts made before giving up. */
  withAttempts(attempts: number): CmcError {
    return new CmcError(this.kind, this.message, {
      ...(this.endpoint === undefined ? {} : { endpoint: this.endpoint }),
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.fixture === undefined ? {} : { fixture: this.fixture }),
      retryable: this.retryable,
      attempts,
    });
  }
}

/** Error codes of HTTP 429 that do not clear within a run: daily (1009) and monthly (1010) limits. */
const LASTING_LIMITS = new Set([1009, 1010]);

/**
 * Whether an API error may succeed on a later attempt, following the CMC errors guide
 * (<https://coinmarketcap.com/api/documentation/guides/errors-and-rate-limits>, read on 2026-09-25):
 * 500 "Retry with exponential backoff"; 429 1008 (request rate, "Wait 60 seconds") and 1011 (IP rate limit) clear
 * with time. 400, 401, 402, 403 (1006: endpoint not in the plan) and the daily / monthly limits do not.
 */
export function isRetryable(httpStatus: number, errorCode: number | undefined): boolean {
  if (httpStatus >= 500) return true;
  if (httpStatus === 429) return errorCode === undefined || !LASTING_LIMITS.has(errorCode);
  return false;
}
