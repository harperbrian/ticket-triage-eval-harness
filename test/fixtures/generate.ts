/**
 * Generates test/fixtures/sample-runs.jsonl — synthetic but realistically shaped
 * run data that lets the entire analysis pipeline be developed and tested with
 * zero API calls.
 *
 * This is NOT measurement data and must never be presented as a finding. It exists
 * so the scorer, drift math, correlation, and report generator can be exercised
 * against known inputs. Real sweeps write to runs/.
 *
 * Regenerate with:  npx tsx test/fixtures/generate.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "../../src/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS_PER_TICKET = 8;
const MODEL = "claude-sonnet-4-6";
const COMMIT = "07c1f50ea448715c2c593becf0b09a7e947c5f0b";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(424242);

type Outcome = { category: string; severity: string; action: string; confidence: number };

/**
 * Each ticket declares weighted outcomes. Weights drive how often each variant
 * appears, which is what produces measurable drift for the tests to assert on.
 */
const PLAN: Record<string, { outcomes: Array<[Outcome, number]>; malformed?: number }> = {
  // Reproduces the shape of the original finding: stable category, unstable
  // severity, and an action that flips with it.
  "T-1001": {
    outcomes: [
      [{ category: "account_access", severity: "P3", action: "auto_reply", confidence: 0.82 }, 5],
      [{ category: "account_access", severity: "P2", action: "escalate", confidence: 0.88 }, 3],
    ],
  },
  "T-1002": {
    outcomes: [[{ category: "billing", severity: "P2", action: "escalate", confidence: 0.85 }, 8]],
  },
  // Vague ticket: category itself is unstable, confidence honestly low.
  "T-1003": {
    outcomes: [
      [{ category: "technical", severity: "P3", action: "escalate", confidence: 0.3 }, 5],
      [{ category: "other", severity: "P3", action: "escalate", confidence: 0.35 }, 3],
    ],
  },
  "T-1004": {
    outcomes: [
      [{ category: "technical", severity: "P3", action: "escalate", confidence: 0.52 }, 6],
      [{ category: "technical", severity: "P2", action: "escalate", confidence: 0.58 }, 2],
    ],
  },
  "T-1005": {
    outcomes: [[{ category: "technical", severity: "P1", action: "escalate", confidence: 0.95 }, 8]],
  },
  "T-1007": {
    outcomes: [[{ category: "technical", severity: "P3", action: "auto_reply", confidence: 0.78 }, 8]],
  },
  "T-2001": {
    outcomes: [
      [{ category: "feature_request", severity: "P4", action: "escalate", confidence: 0.9 }, 7],
      [{ category: "feature_request", severity: "P3", action: "escalate", confidence: 0.86 }, 1],
    ],
  },
  "T-2002": {
    outcomes: [[{ category: "other", severity: "P4", action: "escalate", confidence: 0.83 }, 8]],
  },
  "T-2003": {
    outcomes: [[{ category: "technical", severity: "P3", action: "auto_reply", confidence: 0.8 }, 8]],
  },
  // KB false positive: sometimes auto-replies with irrelevant proration guidance.
  "T-2004": {
    outcomes: [
      [{ category: "billing", severity: "P4", action: "escalate", confidence: 0.7 }, 6],
      [{ category: "billing", severity: "P3", action: "auto_reply", confidence: 0.74 }, 2],
    ],
  },
  // Dual-issue ticket: the strongest category-drift case in the set.
  "T-2005": {
    outcomes: [
      [{ category: "billing", severity: "P2", action: "escalate", confidence: 0.6 }, 4],
      [{ category: "technical", severity: "P2", action: "escalate", confidence: 0.55 }, 3],
      [{ category: "billing", severity: "P3", action: "escalate", confidence: 0.62 }, 1],
    ],
  },
  // Urgent tone, cosmetic content — severity inflated on some runs.
  "T-2006": {
    outcomes: [
      [{ category: "technical", severity: "P4", action: "escalate", confidence: 0.75 }, 5],
      [{ category: "technical", severity: "P2", action: "escalate", confidence: 0.72 }, 3],
    ],
  },
  "T-2007": {
    outcomes: [
      [{ category: "technical", severity: "P1", action: "escalate", confidence: 0.72 }, 7],
      [{ category: "technical", severity: "P2", action: "escalate", confidence: 0.68 }, 1],
    ],
  },
  "T-2008": {
    outcomes: [[{ category: "account_access", severity: "P4", action: "escalate", confidence: 0.88 }, 8]],
  },
  // Includes one malformed run, so the failure path is exercised end to end.
  "T-2009": {
    outcomes: [[{ category: "technical", severity: "P2", action: "escalate", confidence: 0.68 }, 7]],
    malformed: 1,
  },
  "T-2010": {
    outcomes: [[{ category: "billing", severity: "P2", action: "escalate", confidence: 0.87 }, 8]],
  },
  "T-2011": {
    outcomes: [
      [{ category: "account_access", severity: "P2", action: "escalate", confidence: 0.65 }, 5],
      [{ category: "technical", severity: "P2", action: "escalate", confidence: 0.6 }, 3],
    ],
  },
};

/** Expands weights into a run-length list, then shuffles so order is not an artefact. */
function schedule(outcomes: Array<[Outcome, number]>): Outcome[] {
  const list: Outcome[] = [];
  for (const [outcome, weight] of outcomes) {
    for (let i = 0; i < weight; i++) list.push(outcome);
  }
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

const records: RunRecord[] = [];
let clock = Date.parse("2026-08-11T14:00:00.000Z");

for (const [ticketId, plan] of Object.entries(PLAN)) {
  const outcomes = schedule(plan.outcomes);
  const malformedAt = plan.malformed ? outcomes.length : -1;

  for (let i = 0; i < RUNS_PER_TICKET; i++) {
    clock += 1000 + Math.floor(rand() * 4000);
    const base = {
      ticket_id: ticketId,
      run_index: i,
      started_at: new Date(clock).toISOString(),
      duration_ms: 2200 + Math.floor(rand() * 5200),
      model: MODEL,
      agent_commit: COMMIT,
    };

    if (i === malformedAt) {
      records.push({
        ...base,
        ok: false,
        failure_kind: "malformed",
        error:
          "Model did not return valid JSON on completion, even after attempting to extract it from markdown/prose.",
        raw_output: "I'd be happy to help triage this ticket. Based on my analysis...",
        escalate_tool_fired: false,
      });
      continue;
    }

    const o = outcomes[i]!;
    const escalated = o.action === "escalate";
    records.push({
      ...base,
      ok: true,
      result: {
        ticket_id: ticketId,
        category: o.category as never,
        severity: o.severity as never,
        confidence: o.confidence,
        suggested_action: o.action as never,
        ...(escalated ? {} : { draft_reply: "Thanks for reaching out — here's what to try..." }),
        reasoning_summary: `Classified as ${o.category} at ${o.severity}.`,
      },
      escalate_tool_fired: escalated,
      ...(escalated ? { escalate_reason: `${o.severity} severity requires human review.` } : {}),
    });
  }
}

// T-1006 is rejected by the agent's input schema before any API call.
for (let i = 0; i < RUNS_PER_TICKET; i++) {
  clock += 40;
  records.push({
    ticket_id: "T-1006",
    run_index: i,
    started_at: new Date(clock).toISOString(),
    duration_ms: 1,
    model: MODEL,
    agent_commit: COMMIT,
    ok: false,
    failure_kind: "validation",
    error: "Rejected by agent input schema before any API call — body: ticket body cannot be empty",
    escalate_tool_fired: false,
  });
}

const outPath = path.join(HERE, "sample-runs.jsonl");
fs.writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`Wrote ${records.length} synthetic runs to ${path.relative(process.cwd(), outPath)}`);
