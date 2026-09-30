/**
 * The three answers of the specification (F5) and how they rank.
 *
 * They live in their own file because `config/checks.json` names one of them — the best verdict a run carrying a
 * critical finding may reach — and the configuration is read before anything is scored.
 */

/** The three answers of the specification, best first. */
export const VERDICTS = ['ACT', 'CAUTION', 'DO_NOT_ACT'] as const;

export type Verdict = (typeof VERDICTS)[number];

/** How the three rank; a higher rank is the more careful answer. */
export const VERDICT_RANK: Record<Verdict, number> = { ACT: 0, CAUTION: 1, DO_NOT_ACT: 2 };

/** How each verdict reads in a sentence, for the outputs that spell it out rather than print the word. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  ACT: 'act on this data',
  CAUTION: 'act with caution',
  DO_NOT_ACT: 'do not act on this data',
};

/** The more careful of two verdicts. */
export function worstVerdict(left: Verdict, right: Verdict): Verdict {
  return VERDICT_RANK[right] > VERDICT_RANK[left] ? right : left;
}

/** Whether a string is one of the three, for the configuration reader. */
export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}
