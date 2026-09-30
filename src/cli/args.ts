/** Command-line helpers shared by the commands. */
import type { CreditUsage } from '../cmc/credits.js';

/** What a run spent, in the words every command ends with: the meter of the client, never an estimate. */
export function describeCredits(usage: CreditUsage): string {
  const { charged, unconfirmed, remaining, budget } = usage;
  return (
    `Credits this run: ${String(charged)} charged, ${String(unconfirmed)} unconfirmed, ` +
    `${String(remaining)} left of ${String(budget)} (CMC_CREDIT_BUDGET).`
  );
}

/** Reads `name=value` parameters into a query; `=` may appear inside the value. */
export function parseQuery(params: readonly string[]): Record<string, string> {
  const query: Record<string, string> = {};
  for (const param of params) {
    const separator = param.indexOf('=');
    if (separator < 1 || param.startsWith('--')) throw new Error(`Invalid parameter "${param}": expected name=value.`);
    query[param.slice(0, separator)] = param.slice(separator + 1);
  }
  return query;
}

/**
 * Width the prose of a report is wrapped to, so that a long sentence stays readable in a terminal. Tables are not
 * wrapped: breaking a path or a fixture name across two lines would make it unciteable.
 */
export const WRAP_AT = 112;

/** Breaks a sentence into lines of at most `WRAP_AT` characters, each one indented. A long word is never cut. */
export function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    if (current === '') current = word;
    else if (`${current} ${word}`.length + indent.length <= WRAP_AT) current = `${current} ${word}`;
    else {
      lines.push(indent + current);
      current = word;
    }
  }
  if (current !== '') lines.push(indent + current);
  return lines;
}
