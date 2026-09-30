/**
 * The `status` block that every CMC response carries, in either of its two observed shapes
 * (docs/ENDPOINTS.md, observation 1):
 * - `error_code` a number, `error_message` null (or the error text) and a `notice` field (E01, E05, E07, E20);
 * - `error_code` a string, `error_message` an empty string (or the error text) and no `notice` (E02, E03, E06, E08–E19).
 */

export interface CmcStatus {
  /** Server time of the response, ISO 8601. C3 measures data age against it, never against the local clock (D4). */
  timestamp: string;
  errorCode: number;
  /** `null` when the API sent `null` or an empty string. */
  errorMessage: string | null;
  elapsed: number | null;
  /** `null` when the block carries no usable `credit_count`: the cost of the call is then unknown. */
  creditCount: number | null;
  notice: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Reads the `status` block of a parsed body; `undefined` when there is none or it lacks `timestamp` / `error_code`. */
export function parseStatus(body: unknown): CmcStatus | undefined {
  if (!isRecord(body) || !isRecord(body.status)) return undefined;
  const { timestamp, error_code, error_message, elapsed, credit_count, notice } = body.status;
  const errorCode = toErrorCode(error_code);
  if (typeof timestamp !== 'string' || errorCode === null) return undefined;
  return {
    timestamp,
    errorCode,
    errorMessage: toText(error_message),
    elapsed: toCount(elapsed),
    creditCount: toCount(credit_count),
    notice: toText(notice),
  };
}
