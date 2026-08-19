import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { TicketInputSchema } from "../vendor/ticket-triage-agent/src/types.js";
import { REPO_ROOT, type TestCase } from "./types.js";

const ExpectedLabelsSchema = z.object({
  category: z.array(z.string()).min(1),
  severity: z.array(z.string()).min(1),
  action: z.array(z.string()).min(1),
  confidence_range: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
});

const TestCaseSchema = z.object({
  ticket_id: z.string().min(1),
  path: z.string().min(1),
  axis: z.enum(["clear_cut", "ambiguous", "unknown_customer", "edge_case", "validation"]),
  expected: ExpectedLabelsSchema.nullable(),
  notes: z.string().min(1),
});

export const CASES_PATH = path.join(REPO_ROOT, "testset", "cases.json");

/**
 * Loads and validates the test set. Fails loudly on any inconsistency — a
 * silently skipped case would quietly shrink the denominator of every rate
 * the report goes on to publish.
 */
export function loadTestSet(casesPath: string = CASES_PATH): TestCase[] {
  const raw = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  const cases = z.array(TestCaseSchema).parse(raw);

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.ticket_id)) {
      throw new Error(`Duplicate ticket_id in test set: ${c.ticket_id}`);
    }
    seen.add(c.ticket_id);

    const resolved = path.resolve(REPO_ROOT, c.path);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Ticket file missing for ${c.ticket_id}: ${c.path}\n` +
          `If this path points into vendor/, the submodule may not be initialized — ` +
          `run: git submodule update --init --recursive`,
      );
    }

    const ticket = JSON.parse(fs.readFileSync(resolved, "utf-8"));
    if (ticket.ticket_id !== c.ticket_id) {
      throw new Error(
        `ticket_id mismatch: cases.json says ${c.ticket_id}, ${c.path} says ${ticket.ticket_id}`,
      );
    }

    if (c.expected) {
      const [lo, hi] = c.expected.confidence_range;
      if (lo > hi) {
        throw new Error(`${c.ticket_id}: confidence_range is inverted ([${lo}, ${hi}])`);
      }
    } else if (c.axis !== "validation") {
      throw new Error(
        `${c.ticket_id}: expected is null but axis is "${c.axis}" — only validation cases may omit expected labels.`,
      );
    }
  }

  return cases;
}

export interface LoadedTicket {
  /** Parsed and schema-valid, ready to hand to triageTicket. */
  ok: true;
  ticket: z.infer<typeof TicketInputSchema>;
}
export interface RejectedTicket {
  /** Rejected by the agent's own input schema, exactly as its CLI would reject it. */
  ok: false;
  error: string;
}

/**
 * Reads a ticket file and runs it through the agent's own TicketInputSchema.
 *
 * This replicates the validation step the agent's CLI performs before calling
 * triageTicket (see vendor/ticket-triage-agent/src/index.ts). Doing it here
 * keeps the harness faithful to the real pipeline and is what makes T-1006
 * fail fast and free rather than burning an API call.
 */
export function readTicket(testCase: TestCase): LoadedTicket | RejectedTicket {
  const resolved = path.resolve(REPO_ROOT, testCase.path);
  const json = JSON.parse(fs.readFileSync(resolved, "utf-8"));

  const parsed = TicketInputSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Rejected by agent input schema before any API call — ${detail}` };
  }
  return { ok: true, ticket: parsed.data };
}
