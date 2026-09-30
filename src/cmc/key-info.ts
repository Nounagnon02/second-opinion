/**
 * Plan and usage of the API key, as returned by E20 (0 credit, docs/DECISIONS.md D10). The client's own counter
 * covers one run; this one is the account-wide view kept by CMC.
 */
import { CmcError } from './errors.js';

export interface KeyInfo {
  creditLimitMonthly: number;
  /** `plan.credit_limit_monthly_reset_timestamp`, ISO 8601. */
  creditLimitMonthlyResetAt: string;
  rateLimitMinute: number;
  requestsLeftMinute: number;
  creditsUsedDay: number;
  creditsUsedMonth: number;
  creditsLeftMonth: number;
}

function field(data: unknown, path: string): unknown {
  let value = data;
  for (const name of path.split('.')) {
    value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;
  }
  return value;
}

function number(data: unknown, path: string): number {
  const value = field(data, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CmcError('invalid_response', `E20: data.${path} is not a number.`, { endpoint: 'E20' });
  }
  return value;
}

/** Reads the `data` object of an E20 response (shape observed in `fixtures/discovery/E20-key-info-before.json`). */
export function parseKeyInfo(data: unknown): KeyInfo {
  const resetAt = field(data, 'plan.credit_limit_monthly_reset_timestamp');
  if (typeof resetAt !== 'string') {
    throw new CmcError('invalid_response', 'E20: data.plan.credit_limit_monthly_reset_timestamp is not a string.', {
      endpoint: 'E20',
    });
  }
  return {
    creditLimitMonthly: number(data, 'plan.credit_limit_monthly'),
    creditLimitMonthlyResetAt: resetAt,
    rateLimitMinute: number(data, 'plan.rate_limit_minute'),
    requestsLeftMinute: number(data, 'usage.current_minute.requests_left'),
    creditsUsedDay: number(data, 'usage.current_day.credits_used'),
    creditsUsedMonth: number(data, 'usage.current_month.credits_used'),
    creditsLeftMonth: number(data, 'usage.current_month.credits_left'),
  };
}
