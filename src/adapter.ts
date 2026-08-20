import { execFileSync } from "node:child_process";
import "dotenv/config";
import { triageTicket } from "../vendor/ticket-triage-agent/src/agent.js";
import { getEscalationLog } from "../vendor/ticket-triage-agent/src/tools.js";
import { readTicket } from "./testset.js";
import { REPO_ROOT, type FailureKind, type RunRecord, type TestCase } from "./types.js";

/**
 * The agent's own default, duplicated here only for reporting.
 *
 * agent.ts reads CLAUDE_MODEL itself and does not export the resolved value, so
 * the harness cannot ask it which model it used. Keep this in sync with
 * vendor/ticket-triage-agent/src/agent.ts if that default ever changes.
 */
const AGENT_DEFAULT_MODEL = "claude-sonnet-4-6";

export function resolveModel(): string {
  return process.env.CLAUDE_MODEL || AGENT_DEFAULT_MODEL;
}

/** The exact agent revision these results are attributable to. */
export function resolveAgentCommit(): string {
  try {
    return execFileSync("git", ["-C", "vendor/ticket-triage-agent", "rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Silences the agent's own stdout for the duration of a sweep.
 *
 * tools.ts logs "[ESCALATION LOGGED] ..." on every escalate call, which would
 * bury the runner's progress output. Applied once per process rather than around
 * each call, because concurrent runs would otherwise race to restore it.
 * Escalation detection does not depend on this — it reads getEscalationLog().
 */
export function suppressAgentLogging(): () => void {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

/**
 * Maps an agent error string onto a failure kind.
 *
 * `config` is the important one to get right: a missing API key surfaces through
 * the same {ok:false} channel as a genuine model failure, and counting it as
 * drift would manufacture a finding out of a misconfigured shell.
 */
export function classifyFailure(error: string): FailureKind {
  const e = error.toLowerCase();

  if (
    e.includes("could not resolve authentication") ||
    e.includes("authentication_error") ||
    e.includes("invalid x-api-key") ||
    e.includes("401") ||
    e.includes("permission_error") ||
    e.includes("not_found_error") ||
    e.includes("404")
  ) {
    return "config";
  }
  // A billing or spend cap arrives as a 400, which would otherwise look like a
  // malformed request. It means no measurement happened and the sweep was simply
  // cut off, so it gets its own kind and its own remediation in the report.
  if (
    e.includes("usage limit") ||
    e.includes("regain access") ||
    e.includes("credit balance") ||
    e.includes("billing")
  ) {
    return "usage_limit";
  }
  if (e.includes("exceeded") && e.includes("tool-use iterations")) return "loop_exhausted";
  if (e.includes("did not return valid json") || e.includes("did not match the expected schema")) {
    return "malformed";
  }
  if (e.includes("claude api call failed")) return "api";
  return "api";
}

/** Escalation-log entries for one ticket, used as a before/after delta. */
function escalationsFor(ticketId: string) {
  return getEscalationLog().filter((e) => e.ticket_id === ticketId);
}

/**
 * Runs one triage attempt and returns a fully-formed run record.
 *
 * Never throws: a thrown error is captured into the record, because losing a run
 * to an exception would silently shrink the denominator of every published rate.
 *
 * Escalation detection reads the agent's in-process escalation log rather than
 * parsing stdout. Callers must serialize runs of the same ticket_id so the
 * before/after delta stays attributable; running different tickets concurrently
 * is safe because entries carry their own ticket_id.
 */
export async function runOnce(
  testCase: TestCase,
  runIndex: number,
  model: string,
  agentCommit: string,
): Promise<RunRecord> {
  const base = {
    ticket_id: testCase.ticket_id,
    run_index: runIndex,
    started_at: new Date().toISOString(),
    model,
    agent_commit: agentCommit,
    escalate_tool_fired: false,
  };
  const started = performance.now();

  // Replicates the agent CLI's pre-flight validation. A ticket rejected here
  // never reaches the API, which is the behavior T-1006 exists to verify.
  const loaded = readTicket(testCase);
  if (!loaded.ok) {
    return {
      ...base,
      duration_ms: Math.round(performance.now() - started),
      ok: false,
      failure_kind: "validation",
      error: loaded.error,
    };
  }

  const before = escalationsFor(testCase.ticket_id).length;

  let outcome: Awaited<ReturnType<typeof triageTicket>>;
  try {
    outcome = await triageTicket(loaded.ticket);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      duration_ms: Math.round(performance.now() - started),
      ok: false,
      failure_kind: classifyFailure(message),
      error: `Threw out of triageTicket: ${message}`,
    };
  }

  const duration_ms = Math.round(performance.now() - started);
  const after = escalationsFor(testCase.ticket_id);
  const fired = after.length > before;
  const escalation = fired
    ? { escalate_tool_fired: true, escalate_reason: after[after.length - 1]?.reason }
    : { escalate_tool_fired: false };

  if (!outcome.ok) {
    return {
      ...base,
      ...escalation,
      duration_ms,
      ok: false,
      failure_kind: classifyFailure(outcome.error),
      error: outcome.error,
      raw_output: outcome.rawOutput,
    };
  }

  return { ...base, ...escalation, duration_ms, ok: true, result: outcome.result };
}
