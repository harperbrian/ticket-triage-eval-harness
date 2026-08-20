import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TriageResult } from "../vendor/ticket-triage-agent/src/types.js";

export type { TicketInput, TriageResult } from "../vendor/ticket-triage-agent/src/types.js";

/** Repo root, resolved from this module rather than cwd so the CLIs work from anywhere. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Axis =
  | "clear_cut"
  | "ambiguous"
  | "unknown_customer"
  | "edge_case"
  | "validation";

export interface ExpectedLabels {
  category: string[];
  severity: string[];
  action: string[];
  confidence_range: [number, number];
}

export interface TestCase {
  ticket_id: string;
  /** Repo-relative path to the ticket JSON. May point into the vendored submodule. */
  path: string;
  axis: Axis;
  /** null for validation cases that never reach the API. */
  expected: ExpectedLabels | null;
  notes: string;
}

/**
 * Why a run produced no TriageResult.
 *
 * The distinction is load-bearing, and splits on one question: did the model
 * actually respond?
 *
 * `malformed` and `loop_exhausted` mean it did, and responded badly — those are
 * genuine reliability findings about the agent and are counted everywhere.
 *
 * `config`, `usage_limit`, and `api` mean no model response was ever obtained.
 * A missing key, a billing cap, or an overloaded endpoint says nothing about how
 * the agent classifies tickets, so these are excluded from drift statistics and
 * are re-attempted on resume rather than counting toward the requested run total.
 *
 * `validation` is its own case: the agent's schema rejected the input before any
 * API call. Deterministic by construction, so it is excluded from drift but does
 * count as done — re-running it would only produce the same rejection.
 */
export type FailureKind =
  | "config"
  | "validation"
  | "usage_limit"
  | "api"
  | "malformed"
  | "loop_exhausted";

export interface RunRecord {
  ticket_id: string;
  run_index: number;
  started_at: string;
  duration_ms: number;
  model: string;
  agent_commit: string;
  ok: boolean;
  result?: TriageResult;
  failure_kind?: FailureKind;
  error?: string;
  raw_output?: string;
  /** Whether the agent called the escalate tool during this run. */
  escalate_tool_fired: boolean;
  /** The reason string the agent passed to the escalate tool, when it fired. */
  escalate_reason?: string;
}

/** Per-run rubric result. Only computed for runs that produced a TriageResult. */
export interface RunScore {
  ticket_id: string;
  run_index: number;
  category_match: boolean;
  severity_match: boolean;
  action_match: boolean;
  confidence_in_range: boolean;
  /** All four of the above. */
  fully_correct: boolean;
}

export interface FieldDrift {
  /** Most frequent value across runs. */
  modal: string;
  /** Fraction of runs that disagreed with the modal value. 0 = perfectly stable. */
  drift_rate: number;
  /** Every distinct value observed, with counts, highest first. */
  distribution: Array<{ value: string; count: number }>;
}

export interface TicketStats {
  ticket_id: string;
  axis: Axis;
  /** Runs that produced a TriageResult — the denominator for every rate below. */
  scored_runs: number;
  /** Runs that failed in a way attributable to the agent (malformed, api, loop). */
  failed_runs: number;
  /** Runs excluded entirely (config errors, validation-layer rejections). */
  excluded_runs: number;

  /** Most frequent (category, severity, action) triple, and how often it recurred. */
  modal_triple: string;
  triple_drift_rate: number;

  category: FieldDrift;
  severity: FieldDrift;
  action: FieldDrift;

  /** auto_reply vs escalate specifically — the operationally load-bearing flip. */
  action_flip_rate: number;

  confidence_mean: number;
  confidence_min: number;
  confidence_max: number;
  confidence_stdev: number;

  /** Fraction of scored runs matching expected labels. null when expected is null. */
  accuracy: number | null;
}
