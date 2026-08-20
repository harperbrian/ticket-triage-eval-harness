import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTicketStats, fieldDrift, groupStability, stdev, wilsonInterval } from "../src/consistency.js";
import type { RunRecord, TestCase } from "../src/types.js";

function ok(ticket_id: string, i: number, category: string, severity: string, action: string, confidence: number): RunRecord {
  return {
    ticket_id,
    run_index: i,
    started_at: "2026-08-11T14:00:00.000Z",
    duration_ms: 3000,
    model: "m",
    agent_commit: "c",
    ok: true,
    escalate_tool_fired: action === "escalate",
    result: {
      ticket_id,
      category: category as never,
      severity: severity as never,
      confidence,
      suggested_action: action as never,
      reasoning_summary: "…",
    },
  };
}

function fail(ticket_id: string, i: number, kind: RunRecord["failure_kind"]): RunRecord {
  return {
    ticket_id,
    run_index: i,
    started_at: "2026-08-11T14:00:00.000Z",
    duration_ms: 5,
    model: "m",
    agent_commit: "c",
    ok: false,
    failure_kind: kind,
    error: `simulated ${kind}`,
    escalate_tool_fired: false,
  };
}

const testCase: TestCase = {
  ticket_id: "T-X",
  path: "testset/tickets/whatever.json",
  axis: "ambiguous",
  expected: {
    category: ["account_access"],
    severity: ["P2", "P3"],
    action: ["auto_reply", "escalate"],
    confidence_range: [0.6, 0.95],
  },
  notes: "…",
};

describe("fieldDrift", () => {
  it("reports zero drift when every value agrees", () => {
    const d = fieldDrift(["P3", "P3", "P3", "P3"]);
    assert.equal(d.modal, "P3");
    assert.equal(d.drift_rate, 0);
  });

  it("computes drift as the fraction disagreeing with the mode", () => {
    const d = fieldDrift(["P3", "P3", "P3", "P2"]);
    assert.equal(d.modal, "P3");
    assert.equal(d.drift_rate, 0.25);
  });

  it("breaks ties deterministically so re-runs agree", () => {
    const a = fieldDrift(["b", "a"]);
    const b = fieldDrift(["a", "b"]);
    assert.equal(a.modal, b.modal);
    assert.equal(a.modal, "a");
  });

  it("orders the distribution by count, highest first", () => {
    const d = fieldDrift(["x", "y", "y", "z", "y", "x"]);
    assert.deepEqual(d.distribution.map((e) => e.value), ["y", "x", "z"]);
  });

  it("handles an empty input", () => {
    assert.deepEqual(fieldDrift([]), { modal: "—", drift_rate: 0, distribution: [] });
  });
});

describe("stdev", () => {
  it("is zero for identical values", () => {
    assert.equal(stdev([0.8, 0.8, 0.8]), 0);
  });

  it("uses the sample formula (n-1)", () => {
    // Population sd of [2,4,4,4,5,5,7,9] is 2; sample sd is ~2.138.
    assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.13809) < 1e-4);
  });

  it("returns zero rather than NaN for a single value", () => {
    assert.equal(stdev([0.9]), 0);
  });
});

describe("computeTicketStats", () => {
  it("computes drift across the classification triple", () => {
    const runs = [
      ok("T-X", 0, "account_access", "P3", "auto_reply", 0.82),
      ok("T-X", 1, "account_access", "P3", "auto_reply", 0.82),
      ok("T-X", 2, "account_access", "P3", "auto_reply", 0.82),
      ok("T-X", 3, "account_access", "P2", "escalate", 0.88),
    ];
    const s = computeTicketStats(testCase, runs);
    assert.equal(s.scored_runs, 4);
    assert.equal(s.modal_triple, "account_access / P3 / auto_reply");
    assert.equal(s.triple_drift_rate, 0.25);
    assert.equal(s.category.drift_rate, 0, "category was stable");
    assert.equal(s.severity.drift_rate, 0.25, "severity drifted");
    assert.equal(s.action_flip_rate, 0.25, "the action flipped with it");
  });

  it("excludes config failures from drift, since they measure the harness", () => {
    const runs = [
      ok("T-X", 0, "account_access", "P3", "auto_reply", 0.8),
      ok("T-X", 1, "account_access", "P3", "auto_reply", 0.8),
      fail("T-X", 2, "config"),
    ];
    const s = computeTicketStats(testCase, runs);
    assert.equal(s.scored_runs, 2);
    assert.equal(s.excluded_runs, 1);
    assert.equal(s.failed_runs, 0);
    assert.equal(s.triple_drift_rate, 0, "a missing API key is not instability");
  });

  it("counts malformed output as an agent-attributable failure, not an exclusion", () => {
    const runs = [
      ok("T-X", 0, "account_access", "P3", "auto_reply", 0.8),
      fail("T-X", 1, "malformed"),
    ];
    const s = computeTicketStats(testCase, runs);
    assert.equal(s.failed_runs, 1, "a model returning garbage is a real finding");
    assert.equal(s.excluded_runs, 0);
  });

  it("ignores runs belonging to other tickets", () => {
    const runs = [
      ok("T-X", 0, "account_access", "P3", "auto_reply", 0.8),
      ok("T-OTHER", 0, "billing", "P1", "escalate", 0.5),
    ];
    assert.equal(computeTicketStats(testCase, runs).scored_runs, 1);
  });

  it("scores accuracy only over runs with results", () => {
    const runs = [
      ok("T-X", 0, "account_access", "P3", "auto_reply", 0.8), // in every set
      ok("T-X", 1, "billing", "P3", "auto_reply", 0.8), // wrong category
      fail("T-X", 2, "malformed"),
    ];
    const s = computeTicketStats(testCase, runs);
    assert.equal(s.accuracy, 0.5);
  });

  it("returns null accuracy when the case has no expected labels", () => {
    const validationCase: TestCase = { ...testCase, axis: "validation", expected: null };
    const s = computeTicketStats(validationCase, [fail("T-X", 0, "validation")]);
    assert.equal(s.accuracy, null);
  });
});

describe("groupStability", () => {
  it("averages drift within each group and sorts least stable first", () => {
    const stats = [
      computeTicketStats(testCase, [
        ok("T-X", 0, "billing", "P3", "escalate", 0.8),
        ok("T-X", 1, "technical", "P3", "escalate", 0.8),
      ]),
      computeTicketStats({ ...testCase, ticket_id: "T-Y", axis: "clear_cut" }, [
        ok("T-Y", 0, "billing", "P3", "escalate", 0.9),
        ok("T-Y", 1, "billing", "P3", "escalate", 0.9),
      ]),
    ];
    const groups = groupStability(stats, (s) => s.axis);
    assert.equal(groups[0]!.key, "ambiguous");
    assert.equal(groups[0]!.mean_drift, 0.5);
    assert.equal(groups[1]!.key, "clear_cut");
    assert.equal(groups[1]!.mean_drift, 0);
  });
});

describe("wilsonInterval", () => {
  it("returns [0, 0] for zero trials", () => {
    assert.deepEqual(wilsonInterval(0, 0), [0, 0]);
  });

  it("matches the known Wilson bound for 0/8", () => {
    const [lower, upper] = wilsonInterval(0, 8);
    assert.equal(lower, 0);
    assert.ok(Math.abs(upper - 0.324) < 0.001, `expected ~0.324, got ${upper}`);
  });

  it("matches the known Wilson bound for 0/20", () => {
    const [lower, upper] = wilsonInterval(0, 20);
    assert.equal(lower, 0);
    assert.ok(Math.abs(upper - 0.161) < 0.001, `expected ~0.161, got ${upper}`);
  });

  it("is symmetric-ish and centered near p for a mid-range rate", () => {
    const [lower, upper] = wilsonInterval(10, 20);
    assert.ok(lower < 0.5 && upper > 0.5, "interval should straddle 0.5");
    assert.ok(upper - 0.5 < 0.3 && 0.5 - lower < 0.3, "interval should be reasonably tight at n=20");
  });

  it("narrows as trials increase for the same rate", () => {
    const [l8, u8] = wilsonInterval(2, 8);
    const [l80, u80] = wilsonInterval(20, 80);
    assert.ok(u80 - l80 < u8 - l8, "interval at n=80 should be narrower than at n=8");
  });

  it("stays within [0, 1] at the extremes", () => {
    const [lowerAllFail, upperAllFail] = wilsonInterval(8, 8);
    assert.ok(upperAllFail <= 1);
    assert.ok(lowerAllFail >= 0);
    const [lowerNone, upperNone] = wilsonInterval(0, 8);
    assert.ok(upperNone <= 1);
    assert.ok(lowerNone >= 0);
  });
});
