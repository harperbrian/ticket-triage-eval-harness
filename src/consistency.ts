import { scoreRun } from "./score.js";
import type { FieldDrift, RunRecord, TestCase, TicketStats } from "./types.js";

/**
 * Failure kinds where no model response was obtained, plus the deterministic
 * pre-API rejection. Excluded from every rate: a missing key, a billing cap, an
 * overloaded endpoint, or a schema rejection all say nothing about how the agent
 * classifies tickets. Only `malformed` and `loop_exhausted` — where the model did
 * respond, badly — are counted as agent-attributable failures.
 */
const EXCLUDED_FAILURES = new Set(["config", "validation", "usage_limit", "api"]);

/**
 * Wilson score interval for a binomial rate, e.g. "6 of 8 runs disagreed with
 * the modal answer." Reported instead of a normal-approximation interval
 * because at the run counts this harness produces (n=8, n=20) the normal
 * approximation is unreliable near 0 and 1 — exactly where most of this
 * report's rates fall. A rate of 0/8 does not mean "0% drift"; it means the
 * true rate is anywhere in [0%, 32.4%] at 95% confidence. Publishing the
 * point estimate alone would overstate precision this run count cannot buy.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): [number, number] {
  if (trials === 0) return [0, 0];

  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/** Most frequent value, drift rate, and full distribution for one field. */
export function fieldDrift(values: string[]): FieldDrift {
  if (values.length === 0) {
    return { modal: "—", drift_rate: 0, distribution: [] };
  }

  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  // Ties broken alphabetically so a re-run of the same data reports the same
  // modal value rather than whichever the Map happened to yield first.
  const distribution = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const modal = distribution[0]!;
  return {
    modal: modal.value,
    drift_rate: 1 - modal.count / values.length,
    distribution,
  };
}

/** Sample standard deviation. Returns 0 for fewer than two values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;

  // Exact short-circuit for the common case of a perfectly stable ticket.
  // Computing it the long way leaves float noise around 1e-16, which would put
  // a spurious non-zero spread on a ticket that never varied.
  const first = values[0]!;
  if (values.every((v) => v === first)) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Aggregates every run of one ticket into its drift and confidence statistics.
 *
 * Drift is computed only over runs that produced a valid result. Runs that
 * failed in an agent-attributable way (malformed output, API error, loop
 * exhaustion) are counted separately in `failed_runs` rather than folded into
 * drift, because they have no classification triple to disagree with. The
 * report surfaces both numbers so a ticket that fails half the time cannot
 * appear stable.
 */
export function computeTicketStats(testCase: TestCase, runs: RunRecord[]): TicketStats {
  const forTicket = runs.filter((r) => r.ticket_id === testCase.ticket_id);

  const scored = forTicket.filter((r) => r.ok && r.result);
  const excluded = forTicket.filter(
    (r) => !r.ok && r.failure_kind && EXCLUDED_FAILURES.has(r.failure_kind),
  );
  const failed = forTicket.filter(
    (r) => !r.ok && (!r.failure_kind || !EXCLUDED_FAILURES.has(r.failure_kind)),
  );

  const categories = scored.map((r) => r.result!.category);
  const severities = scored.map((r) => r.result!.severity);
  const actions = scored.map((r) => r.result!.suggested_action);
  const confidences = scored.map((r) => r.result!.confidence);

  const triples = scored.map(
    (r) => `${r.result!.category} / ${r.result!.severity} / ${r.result!.suggested_action}`,
  );
  const tripleDrift = fieldDrift(triples);
  const actionDrift = fieldDrift(actions);

  const scores = forTicket
    .map((r) => scoreRun(r, testCase.expected))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    ticket_id: testCase.ticket_id,
    axis: testCase.axis,
    scored_runs: scored.length,
    failed_runs: failed.length,
    excluded_runs: excluded.length,

    modal_triple: tripleDrift.modal,
    triple_drift_rate: tripleDrift.drift_rate,
    // successes = runs that disagreed with the modal triple = total minus the modal count.
    triple_drift_ci: wilsonInterval(
      scored.length - (tripleDrift.distribution[0]?.count ?? 0),
      scored.length,
    ),

    category: fieldDrift(categories),
    severity: fieldDrift(severities),
    action: actionDrift,

    // With only two possible actions, drift on this field is exactly the rate
    // at which the auto-reply/escalate decision flipped between runs.
    action_flip_rate: actionDrift.drift_rate,
    action_flip_ci: wilsonInterval(
      scored.length - (actionDrift.distribution[0]?.count ?? 0),
      scored.length,
    ),

    confidence_mean:
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0,
    confidence_min: confidences.length > 0 ? Math.min(...confidences) : 0,
    confidence_max: confidences.length > 0 ? Math.max(...confidences) : 0,
    confidence_stdev: stdev(confidences),

    accuracy:
      scores.length > 0 ? scores.filter((s) => s.fully_correct).length / scores.length : null,
  };
}

/**
 * Groups tickets by a key and reports mean drift per group.
 * Used for the by-category and by-axis stability tables.
 */
export function groupStability(
  stats: TicketStats[],
  keyOf: (s: TicketStats) => string,
): Array<{ key: string; tickets: number; mean_drift: number; mean_confidence: number }> {
  const groups = new Map<string, TicketStats[]>();
  for (const s of stats) {
    const k = keyOf(s);
    const list = groups.get(k) ?? [];
    list.push(s);
    groups.set(k, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      tickets: list.length,
      mean_drift: list.reduce((a, s) => a + s.triple_drift_rate, 0) / list.length,
      mean_confidence: list.reduce((a, s) => a + s.confidence_mean, 0) / list.length,
    }))
    .sort((a, b) => b.mean_drift - a.mean_drift || a.key.localeCompare(b.key));
}
