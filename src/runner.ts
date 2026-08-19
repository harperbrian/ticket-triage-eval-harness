import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  resolveAgentCommit,
  resolveModel,
  runOnce,
  suppressAgentLogging,
} from "./adapter.js";
import { loadTestSet } from "./testset.js";
import { REPO_ROOT, type RunRecord, type TestCase } from "./types.js";

const USAGE = `
Usage: npm run eval -- [options]

  --runs <n>          Runs per ticket (default 8)
  --ticket <id>       Restrict to one ticket; repeatable (default: all)
  --model <id>        Model to measure (default: $CLAUDE_MODEL, else claude-sonnet-4-6)
  --out <path>        JSONL output (default: runs/<model>.jsonl)
  --concurrency <n>   Tickets processed in parallel (default 4)
  --fresh             Ignore and overwrite existing runs instead of topping up
  --help

Output is append-only JSONL, one line per run, flushed as each run completes —
an interrupted sweep loses nothing and re-running tops up to --runs.

Each output file is scoped to a single model so that sweeps of different models
can never be mixed into one analysis.
`.trim();

interface Options {
  runs: number;
  tickets: string[];
  model: string;
  out: string;
  concurrency: number;
  fresh: boolean;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      runs: { type: "string" },
      ticket: { type: "string", multiple: true },
      model: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string" },
      fresh: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(USAGE);
    process.exit(0);
  }

  // Set CLAUDE_MODEL before resolveModel() so the agent itself picks it up —
  // agent.ts reads this env var directly and takes no model parameter.
  if (values.model) process.env.CLAUDE_MODEL = values.model;
  const model = resolveModel();

  const runs = values.runs ? Number(values.runs) : 8;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got: ${values.runs}`);
  }

  const concurrency = values.concurrency ? Number(values.concurrency) : 4;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got: ${values.concurrency}`);
  }

  return {
    runs,
    tickets: values.ticket ?? [],
    model,
    out: values.out
      ? path.resolve(REPO_ROOT, values.out)
      : path.join(REPO_ROOT, "runs", `${model}.jsonl`),
    concurrency,
    fresh: values.fresh ?? false,
  };
}

function readExisting(outPath: string): RunRecord[] {
  if (!fs.existsSync(outPath)) return [];
  return fs
    .readFileSync(outPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RunRecord);
}

/** Processes tasks with a bounded number in flight, preserving completion order in the log. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const opts = parseOptions();
  const allCases = loadTestSet();

  const cases =
    opts.tickets.length > 0
      ? allCases.filter((c) => opts.tickets.includes(c.ticket_id))
      : allCases;

  if (cases.length === 0) {
    throw new Error(
      `No matching tickets. Requested: ${opts.tickets.join(", ")}\n` +
        `Available: ${allCases.map((c) => c.ticket_id).join(", ")}`,
    );
  }

  const agentCommit = resolveAgentCommit();
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  if (opts.fresh && fs.existsSync(opts.out)) fs.rmSync(opts.out);

  const existing = readExisting(opts.out);

  // Mixing models in one file would silently corrupt every rate downstream.
  const foreignModel = existing.find((r) => r.model !== opts.model);
  if (foreignModel) {
    throw new Error(
      `${path.relative(REPO_ROOT, opts.out)} already contains runs from model ` +
        `"${foreignModel.model}", but this sweep is for "${opts.model}".\n` +
        `Use --out to write elsewhere, or --fresh to discard the existing file.`,
    );
  }

  const doneByTicket = new Map<string, number>();
  for (const r of existing) {
    doneByTicket.set(r.ticket_id, (doneByTicket.get(r.ticket_id) ?? 0) + 1);
  }

  const work = cases
    .map((testCase) => {
      const done = doneByTicket.get(testCase.ticket_id) ?? 0;
      return { testCase, done, needed: Math.max(0, opts.runs - done) };
    })
    .filter((w) => w.needed > 0);

  const totalPlanned = work.reduce((a, w) => a + w.needed, 0);

  console.error(`Model:       ${opts.model}`);
  console.error(`Agent:       ${agentCommit.slice(0, 10)}`);
  console.error(`Tickets:     ${cases.length}`);
  console.error(`Runs/ticket: ${opts.runs}`);
  console.error(`Output:      ${path.relative(REPO_ROOT, opts.out)}`);
  if (existing.length > 0) {
    console.error(`Resuming:    ${existing.length} runs already recorded`);
  }
  console.error(`To execute:  ${totalPlanned} runs\n`);

  if (totalPlanned === 0) {
    console.error("Nothing to do — every ticket already has the requested number of runs.");
    return;
  }

  const restoreLogging = suppressAgentLogging();
  let completed = 0;
  let failed = 0;

  const runTicket = async ({ testCase, done, needed }: { testCase: TestCase; done: number; needed: number }) => {
    // Runs of the same ticket stay sequential: escalation detection reads a
    // before/after delta on the agent's in-process log, which is only
    // attributable while one run per ticket_id is in flight.
    for (let i = 0; i < needed; i++) {
      const record = await runOnce(testCase, done + i, opts.model, agentCommit);
      fs.appendFileSync(opts.out, JSON.stringify(record) + "\n");

      completed++;
      if (!record.ok) failed++;
      const status = record.ok
        ? `${record.result!.category}/${record.result!.severity}/${record.result!.suggested_action} @ ${record.result!.confidence}`
        : `FAILED (${record.failure_kind}) ${record.error?.slice(0, 60)}`;
      process.stderr.write(
        `[${String(completed).padStart(3)}/${totalPlanned}] ${testCase.ticket_id} #${record.run_index}  ${status}\n`,
      );
    }
  };

  try {
    await pool(work, opts.concurrency, runTicket);
  } finally {
    restoreLogging();
  }

  console.error(`\nDone. ${completed} runs written, ${failed} failed.`);
  console.error(`Analyze with: npm run analyze -- --in ${path.relative(REPO_ROOT, opts.out)}`);

  // A sweep where everything failed is almost always a misconfiguration
  // (missing key, bad model id) rather than a finding. Exit non-zero so it
  // cannot be mistaken for a completed measurement in a script.
  if (failed === completed && completed > 0) {
    console.error("\nEvery run failed — check ANTHROPIC_API_KEY and the model id before analyzing.");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
