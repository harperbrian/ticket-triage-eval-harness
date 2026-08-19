import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessConfidenceCalibration, scoreRun } from "../src/score.js";
import type { ExpectedLabels, RunRecord } from "../src/types.js";

const expected: ExpectedLabels = {
  category: ["account_access"],
  severity: ["P2", "P3"],
  action: ["auto_reply", "escalate"],
  confidence_range: [0.6, 0.95],
};

function run(overrides: Partial<RunRecord["result"]> = {}, ok = true): RunRecord {
  return {
    ticket_id: "T-1001",
    run_index: 0,
    started_at: "2026-08-11T14:00:00.000Z",
    duration_ms: 3000,
    model: "claude-sonnet-4-6",
    agent_commit: "07c1f50",
    ok,
    escalate_tool_fired: false,
    result: ok
      ? ({
          ticket_id: "T-1001",
          category: "account_access",
          severity: "P3",
          confidence: 0.82,
          suggested_action: "auto_reply",
          reasoning_summary: "…",
          ...overrides,
        } as RunRecord["result"])
      : undefined,
  };
}

describe("scoreRun", () => {
  it("accepts any member of an acceptable set", () => {
    const a = scoreRun(run({ severity: "P2" }), expected);
    const b = scoreRun(run({ severity: "P3" }), expected);
    assert.equal(a?.severity_match, true);
    assert.equal(b?.severity_match, true);
  });

  it("rejects a value outside the acceptable set", () => {
    const s = scoreRun(run({ severity: "P1" }), expected);
    assert.equal(s?.severity_match, false);
    assert.equal(s?.fully_correct, false);
  });

  it("treats the confidence range as inclusive at both bounds", () => {
    assert.equal(scoreRun(run({ confidence: 0.6 }), expected)?.confidence_in_range, true);
    assert.equal(scoreRun(run({ confidence: 0.95 }), expected)?.confidence_in_range, true);
    assert.equal(scoreRun(run({ confidence: 0.59 }), expected)?.confidence_in_range, false);
    assert.equal(scoreRun(run({ confidence: 0.96 }), expected)?.confidence_in_range, false);
  });

  it("requires all four fields for fully_correct", () => {
    assert.equal(scoreRun(run(), expected)?.fully_correct, true);
    assert.equal(scoreRun(run({ category: "billing" }), expected)?.fully_correct, false);
  });

  it("returns null for a failed run", () => {
    assert.equal(scoreRun(run({}, false), expected), null);
  });

  it("returns null when a case has no expected labels", () => {
    // Validation-axis cases carry expected: null and must not be scored.
    assert.equal(scoreRun(run(), null), null);
  });
});

describe("assessConfidenceCalibration", () => {
  it("flags a score that collapses onto one value", () => {
    const runs = Array.from({ length: 20 }, (_, i) => run({ confidence: 0.85 }, true));
    const c = assessConfidenceCalibration(runs);
    assert.equal(c.distinct_values, 1);
    assert.equal(c.concentration, 1);
    assert.equal(c.degenerate, true);
  });

  it("does not flag a genuinely spread distribution", () => {
    const values = [0.3, 0.45, 0.52, 0.6, 0.68, 0.75, 0.82, 0.88, 0.9, 0.95];
    const runs = values.map((confidence) => run({ confidence }));
    const c = assessConfidenceCalibration(runs);
    assert.equal(c.distinct_values, 10);
    assert.equal(c.degenerate, false);
  });

  it("flags a tiny fixed vocabulary of scores across many runs", () => {
    const runs = Array.from({ length: 30 }, (_, i) =>
      run({ confidence: [0.3, 0.8, 0.95][i % 3] }),
    );
    const c = assessConfidenceCalibration(runs);
    assert.equal(c.distinct_values, 3);
    assert.equal(c.degenerate, true);
  });

  it("handles an empty set without dividing by zero", () => {
    const c = assessConfidenceCalibration([]);
    assert.equal(c.total_runs, 0);
    assert.equal(c.most_common, null);
    assert.equal(c.degenerate, false);
  });
});
