import type { ExpectedLabels, RunRecord, RunScore } from "./types.js";

/**
 * Scores one run against its expected labels.
 *
 * Expected values are acceptable *sets*, not single values. Several cases in the
 * test set are genuinely ambiguous — a ticket reporting two unrelated problems
 * has no single correct category — and asserting one right answer there would
 * manufacture precision the underlying judgment does not have.
 *
 * Returns null for runs with no result, and for validation cases with no
 * expected labels.
 */
export function scoreRun(run: RunRecord, expected: ExpectedLabels | null): RunScore | null {
  if (!run.ok || !run.result || !expected) return null;

  const r = run.result;
  const [lo, hi] = expected.confidence_range;

  const category_match = expected.category.includes(r.category);
  const severity_match = expected.severity.includes(r.severity);
  const action_match = expected.action.includes(r.suggested_action);
  const confidence_in_range = r.confidence >= lo && r.confidence <= hi;

  return {
    ticket_id: run.ticket_id,
    run_index: run.run_index,
    category_match,
    severity_match,
    action_match,
    confidence_in_range,
    fully_correct: category_match && severity_match && action_match && confidence_in_range,
  };
}

export interface ConfidenceCalibration {
  /** Distinct confidence values observed across the whole sweep. */
  distinct_values: number;
  total_runs: number;
  /** The most-repeated value and how often it appeared. */
  most_common: { value: number; count: number } | null;
  /** Share of all runs taking the single most common value. */
  concentration: number;
  /**
   * True when confidence is suspiciously degenerate — nearly every run reusing
   * a handful of values suggests the score is a stylistic habit rather than a
   * live estimate. The Zod schema already enforces the 0..1 bound, so this
   * checks distribution, not range.
   */
  degenerate: boolean;
}

/**
 * Checks whether confidence spans a real range or clusters on a few stock values.
 *
 * A model that answers 0.85 to almost everything is not reporting uncertainty,
 * and any correlation computed against such a score is measuring noise.
 */
export function assessConfidenceCalibration(runs: RunRecord[]): ConfidenceCalibration {
  const values = runs.filter((r) => r.ok && r.result).map((r) => r.result!.confidence);

  if (values.length === 0) {
    return {
      distinct_values: 0,
      total_runs: 0,
      most_common: null,
      concentration: 0,
      degenerate: false,
    };
  }

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const concentration = count / values.length;

  return {
    distinct_values: counts.size,
    total_runs: values.length,
    most_common: { value, count },
    concentration,
    // Either almost everything collapses onto one value, or the model is
    // working from a tiny fixed vocabulary of scores across many runs.
    degenerate: concentration >= 0.8 || (counts.size <= 3 && values.length >= 20),
  };
}
