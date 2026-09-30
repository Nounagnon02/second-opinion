/**
 * How a measured value is written, whatever reads it.
 *
 * Every output of this project — the `check` report, the web page, the MCP answers through the view of F8 — has
 * the same rule: no bare number ever appears, a value is always written in the unit it was measured in. That rule
 * is one switch, and it lives here so that there is only one of it. A second copy is the one that would drift.
 *
 * It sits in `src/checks/` rather than beside an output because `Unit` is the checks' own vocabulary
 * (`model.ts`), and because the four writers it dispatches to already live under this directory.
 */
import type { Unit } from './model.js';
import { formatDuration } from './c3-freshness.js';
import { formatMultiple } from './c4-liquidity.js';
import { formatPercent, formatUsd } from './prices.js';

/** A measured value in the unit it was measured in; `not readable` when there is no value to write. */
export function formatValue(value: number | null, unit: Unit): string {
  if (value === null) return 'not readable';
  switch (unit) {
    case 'usd':
      return formatUsd(value);
    case 'percent':
      return formatPercent(value);
    case 'seconds':
      return formatDuration(value);
    case 'ratio':
      return formatMultiple(value);
    case 'count':
      return String(value);
  }
}
