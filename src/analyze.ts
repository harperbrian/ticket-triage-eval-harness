import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { computeTicketStats, groupStability } from "./consistency.js";
import { correlateWithPermutation, interpret } from "./correlate.js";
import { assessConfidenceCalibration, scoreRun } from "./score.js";
import { loadTestSet } from "./testset.js";
import { REPO_ROOT, type RunRecord, type TestCase, type TicketStats } from "./types.js";

const USAGE = `
Usage: npm run analyze -- [options]

  --in <path>    Runs JSONL to analyze (default: most recent file in runs/)
  --out <path>   Report output (default: reports/<model>.md)
  --stdout       Print the report instead of writing it
  --help
`.trim();

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number, dp = 2) => n.toFixed(dp);

function mostRecentRunsFile(): string {
  const dir = path.join(REPO_ROOT, "runs");
  if (!fs.existsSync(dir)) throw new Error("No runs/ directory. Run a sweep first: npm run eval");

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error("No .jsonl files in runs/. Run a sweep first: npm run eval");
  return path.join(dir, files[0]!.f);
}

function readRuns(inPath: string): RunRecord[] {
  const runs = fs
    .readFileSync(inPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as RunRecord;
      } catch {
        throw new Error(`${path.relative(REPO_ROOT, inPath)} line ${i + 1} is not valid JSON.`);
      }
    });

  if (runs.length === 0) throw new Error(`${path.relative(REPO_ROOT, inPath)} contains no runs.`);
  return runs;
}

/** Failure kinds meaning the model was never reached, so no measurement occurred. */
const BLOCKED_KINDS = new Set(["config", "usage_limit", "api"]);

interface Coverage {
  intended: number;
  complete: string[];
  partial: Array<{ ticket_id: string; got: number }>;
  missing: string[];
  blockedRuns: number;
  /** Distinct verbatim reasons the model could not be reached. */
  reasons: string[];
}

/**
 * Establishes how much of the intended sweep actually produced measurements.
 *
 * A sweep cut short by a billing cap or an outage yields a report that looks
 * complete but silently rests on whichever tickets happened to run first. This
 * is what lets the report say so, loudly, before any number is presented.
 */
function assessCoverage(runs: RunRecord[], cases: TestCase[], intended: number): Coverage {
  const complete: string[] = [];
  const partial: Array<{ ticket_id: string; got: number }> = [];
  const missing: string[] = [];

  for (const c of cases) {
    if (c.axis === "validation") continue;
    const scored = runs.filter((r) => r.ticket_id === c.ticket_id && r.ok).length;
    if (scored === 0) missing.push(c.ticket_id);
    else if (scored < intended) partial.push({ ticket_id: c.ticket_id, got: scored });
    else complete.push(c.ticket_id);
  }

  const blocked = runs.filter((r) => r.failure_kind && BLOCKED_KINDS.has(r.failure_kind));
  const reasons = [
    ...new Set(
      blocked.map((r) =>
        (r.error ?? "")
          .replace(/^Claude API call failed:\s*/, "")
          .replace(/\{"type":"error","error":\{"type":"[^"]+","message":"/, "")
          .replace(/"\},?"?request_id.*$/, "")
          .slice(0, 160),
      ),
    ),
  ];

  return { intended, complete, partial, missing, blockedRuns: blocked.length, reasons };
}

/** True when the runs came from the offline fixture rather than a real sweep. */
function isSyntheticSource(inPath: string): boolean {
  const rel = path.relative(REPO_ROOT, inPath).split(path.sep).join("/");
  return rel.startsWith("test/fixtures/");
}

/** Renders a GitHub-flavoured markdown table. */
function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `|${headers.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

/** Compact rendering of a value distribution, e.g. "P3 x6, P2 x2". */
function dist(d: { value: string; count: number }[]): string {
  if (d.length === 0) return "—";
  return d.map((e) => `${e.value} ×${e.count}`).join(", ");
}

function buildReport(runs: RunRecord[], cases: TestCase[], inPath: string): string {
  const models = [...new Set(runs.map((r) => r.model))];
  const commits = [...new Set(runs.map((r) => r.agent_commit))];
  const model = models[0] ?? "unknown";

  const byId = new Map(cases.map((c) => [c.ticket_id, c]));
  const measuredCases = cases.filter((c) => c.axis !== "validation");
  const validationCases = cases.filter((c) => c.axis === "validation");

  const stats = measuredCases
    .map((c) => computeTicketStats(c, runs))
    .filter((s) => s.scored_runs + s.failed_runs > 0);

  const withData = stats.filter((s) => s.scored_runs > 0);

  const totalRuns = runs.length;
  const totalFailed = runs.filter((r) => !r.ok).length;
  const configFailures = runs.filter((r) => r.failure_kind === "config").length;

  const out: string[] = [];

  out.push(`# Classification Reliability Report`);
  out.push("");

  // A report built from the synthetic fixture is shaped exactly like a real one,
  // right down to a plausible p-value. Label it unmistakably at the top so it can
  // never be mistaken for measurement.
  if (isSyntheticSource(inPath)) {
    out.push(`> ## ⚠️ SYNTHETIC DATA — NOT A MEASUREMENT`);
    out.push(`>`);
    out.push(
      `> This report was generated from \`test/fixtures/sample-runs.jsonl\`, which contains ` +
        `**fabricated run data** used to exercise the analysis pipeline offline. No API calls ` +
        `were made and no agent behaviour was observed. Every number below is an artefact of the ` +
        `fixture generator and must not be cited as a finding.`,
    );
    out.push(`>`);
    out.push(`> Real measurements come from \`runs/\` — see the README.`);
    out.push("");
  }

  out.push(
    `Measures run-to-run classification drift in the [Support Ticket Triage Agent](https://github.com/harperbrian/ticket-triage-agent): ` +
      `the same ticket submitted repeatedly, and how often the answer changes.`,
  );
  out.push("");

  // Intended runs per ticket, inferred from the best-covered ticket. A sweep that
  // was cut off still has some ticket that reached the target.
  const intendedRuns = Math.max(
    1,
    ...measuredCases.map((c) => runs.filter((r) => r.ticket_id === c.ticket_id && r.ok).length),
  );
  const coverage = assessCoverage(runs, cases, intendedRuns);
  const incomplete = coverage.missing.length > 0 || coverage.partial.length > 0;

  if (incomplete) {
    out.push(`> ## ⚠️ INCOMPLETE SWEEP — PARTIAL COVERAGE`);
    out.push(`>`);
    out.push(
      `> This sweep did not finish. Of ${measuredCases.length} measurable tickets, ` +
        `**${coverage.complete.length} have the full ${intendedRuns} runs**, ` +
        `${coverage.partial.length} are partial, and **${coverage.missing.length} have no data at all**. ` +
        `${coverage.blockedRuns} run(s) never reached the model.`,
    );
    out.push(`>`);
    if (coverage.reasons.length > 0) {
      out.push(`> Reason reported by the API:`);
      out.push(`>`);
      for (const r of coverage.reasons.slice(0, 3)) out.push(`> - \`${r}\``);
      out.push(`>`);
    }
    if (coverage.missing.length > 0) {
      out.push(`> **No data:** ${coverage.missing.map((t) => `\`${t}\``).join(", ")}`);
      out.push(`>`);
    }
    if (coverage.partial.length > 0) {
      out.push(
        `> **Partial:** ` +
          coverage.partial.map((p) => `\`${p.ticket_id}\` (${p.got}/${intendedRuns})`).join(", "),
      );
      out.push(`>`);
    }
    out.push(
      `> Every figure below is computed **only over tickets that produced data**, and is not ` +
        `representative of the full test set. The missing tickets are disproportionately the ` +
        `newer, harder cases, so the drift rates here are likely an underestimate. Re-run the ` +
        `sweep to completion before citing any of this.`,
    );
    out.push("");
  }

  // ---- 1. Run configuration -------------------------------------------------
  out.push(`## Run configuration`);
  out.push("");
  out.push(
    table(
      ["Field", "Value"],
      [
        ["Model", `\`${models.join(", ")}\``],
        ["Agent commit", `\`${commits.map((c) => c.slice(0, 10)).join(", ")}\``],
        ["Tickets measured", String(stats.length)],
        ["Total runs", String(totalRuns)],
        ["Failed runs", `${totalFailed} (${pct(totalFailed / totalRuns)})`],
        ["Source", `\`${path.relative(REPO_ROOT, inPath)}\``],
        ["Generated", new Date().toISOString()],
      ],
    ),
  );
  out.push("");

  if (models.length > 1) {
    out.push(
      `> **Warning:** this file mixes runs from ${models.length} different models. ` +
        `Every rate below is computed across that mixture and should not be read as a ` +
        `property of any single model.`,
    );
    out.push("");
  }
  if (configFailures > 0) {
    out.push(
      `> **Note:** ${configFailures} run(s) failed with configuration errors (bad credentials or ` +
        `model id). These are excluded from all drift statistics — they measure the harness, not the agent.`,
    );
    out.push("");
  }

  if (withData.length === 0) {
    out.push(`## No usable data`);
    out.push("");
    out.push(
      `Not one run produced a valid classification, so there is nothing to measure. ` +
        `This is almost always a configuration problem rather than a finding — check ` +
        `\`ANTHROPIC_API_KEY\` and the model id, then re-run the sweep.`,
    );
    return out.join("\n") + "\n";
  }

  // ---- 2. Headline ----------------------------------------------------------
  const meanDrift = withData.reduce((a, s) => a + s.triple_drift_rate, 0) / withData.length;
  const drifting = withData.filter((s) => s.triple_drift_rate > 0);
  const flipping = withData.filter((s) => s.action_flip_rate > 0);
  const worst = [...withData].sort((a, b) => b.triple_drift_rate - a.triple_drift_rate)[0]!;
  const runsPerTicket = Math.round(totalRuns / cases.length);

  out.push(`## Headline`);
  out.push("");
  if (drifting.length === 0) {
    out.push(
      `**No drift observed.** Across ${withData.length} tickets at roughly ${runsPerTicket} runs each, ` +
        `every ticket returned the same category, severity, and action on every run. ` +
        `On this test set, at this run count, the agent's classifications were stable. ` +
        `That is a real result and not a null one — but note that absence of observed drift ` +
        `at ${runsPerTicket} runs does not establish absence of drift at higher run counts.`,
    );
  } else {
    out.push(
      `**${drifting.length} of ${withData.length} tickets changed their answer between runs.** ` +
        `Mean drift across all measured tickets is ${pct(meanDrift)}. ` +
        `The least stable is **${worst.ticket_id}** at ${pct(worst.triple_drift_rate)} ` +
        `(${dist(worst.category.distribution)} / ${dist(worst.severity.distribution)} / ${dist(worst.action.distribution)}).`,
    );
    out.push("");
    if (flipping.length > 0) {
      out.push(
        `**${flipping.length} ticket(s) flipped the auto-reply / escalate decision between identical runs.** ` +
          `This is the operationally consequential form of drift: the difference between a customer ` +
          `receiving an automated response and a human reading the ticket, decided by nothing the ` +
          `customer did differently.`,
      );
    } else {
      out.push(
        `No ticket flipped the auto-reply / escalate decision — drift, where it occurred, was ` +
          `confined to category and severity labels and never changed what the system would actually do.`,
      );
    }
  }
  out.push("");

  // ---- 3. Per-ticket drift --------------------------------------------------
  out.push(`## Per-ticket drift`);
  out.push("");
  out.push(
    `\`Drift\` is the fraction of scored runs that disagreed with the ticket's most common ` +
      `(category / severity / action) triple. 0% means every run agreed.`,
  );
  out.push("");
  out.push(
    table(
      ["Ticket", "Axis", "Runs", "Modal result", "Drift", "Action flip", "Confidence (mean ± sd)", "Failed"],
      [...stats]
        .sort((a, b) => b.triple_drift_rate - a.triple_drift_rate || a.ticket_id.localeCompare(b.ticket_id))
        .map((s) => [
          `\`${s.ticket_id}\``,
          s.axis,
          String(s.scored_runs),
          s.scored_runs > 0 ? s.modal_triple : "—",
          s.scored_runs > 0 ? pct(s.triple_drift_rate) : "—",
          s.scored_runs > 0 ? pct(s.action_flip_rate) : "—",
          s.scored_runs > 0
            ? `${num(s.confidence_mean)} ± ${num(s.confidence_stdev)}`
            : "—",
          s.failed_runs > 0 ? String(s.failed_runs) : "",
        ]),
    ),
  );
  out.push("");

  const varied = withData.filter(
    (s) => s.category.distribution.length > 1 || s.severity.distribution.length > 1 || s.action.distribution.length > 1,
  );
  if (varied.length > 0) {
    out.push(`### Where the variation was`);
    out.push("");
    out.push(
      table(
        ["Ticket", "Category", "Severity", "Action"],
        varied.map((s) => [
          `\`${s.ticket_id}\``,
          dist(s.category.distribution),
          dist(s.severity.distribution),
          dist(s.action.distribution),
        ]),
      ),
    );
    out.push("");
    out.push(
      `Decomposing drift by field matters because the three are not equally consequential: ` +
        `an unstable severity label that never changes the action is a reporting problem, ` +
        `while an unstable action is a behavioural one.`,
    );
    out.push("");
  }

  // ---- 4. Stability by group ------------------------------------------------
  out.push(`## Stability by ticket type`);
  out.push("");
  out.push(`**By test-set axis** — the property each ticket was written to probe:`);
  out.push("");
  out.push(
    table(
      ["Axis", "Tickets", "Mean drift", "Mean confidence"],
      groupStability(withData, (s) => s.axis).map((g) => [
        g.key,
        String(g.tickets),
        pct(g.mean_drift),
        num(g.mean_confidence),
      ]),
    ),
  );
  out.push("");
  out.push(`**By modal category** — which classifications the agent holds most steadily:`);
  out.push("");
  out.push(
    table(
      ["Category", "Tickets", "Mean drift", "Mean confidence"],
      groupStability(withData, (s) => s.category.modal).map((g) => [
        g.key,
        String(g.tickets),
        pct(g.mean_drift),
        num(g.mean_confidence),
      ]),
    ),
  );
  out.push("");
  out.push(
    `> Group sizes here are small — several rows rest on one or two tickets — so these ` +
      `comparisons are descriptive of this test set and should not be read as general ` +
      `properties of the categories.`,
  );
  out.push("");

  // ---- 5. The confidence question ------------------------------------------
  out.push(`## Does self-reported confidence predict consistency?`);
  out.push("");
  out.push(
    `The agent emits a \`confidence\` score with every classification. If that score is ` +
      `meaningful, tickets it feels sure about should be the ones it answers the same way ` +
      `every time. This section tests that directly, and had no assumed answer.`,
  );
  out.push("");

  const calibration = assessConfidenceCalibration(runs);
  const confidences = withData.map((s) => s.confidence_mean);
  const consistency = withData.map((s) => 1 - s.triple_drift_rate);
  const correlation = correlateWithPermutation(confidences, consistency);

  out.push(
    table(
      ["Ticket", "Mean confidence", "Consistency", "Runs"],
      [...withData]
        .sort((a, b) => b.confidence_mean - a.confidence_mean)
        .map((s) => [
          `\`${s.ticket_id}\``,
          num(s.confidence_mean),
          pct(1 - s.triple_drift_rate),
          String(s.scored_runs),
        ]),
    ),
  );
  out.push("");
  out.push(`**Result:** ${interpret(correlation)}`);
  out.push("");

  out.push(
    `Confidence spread across the sweep: ${calibration.distinct_values} distinct values over ` +
      `${calibration.total_runs} runs` +
      (calibration.most_common
        ? `, most commonly ${num(calibration.most_common.value)} (${pct(calibration.concentration)} of runs).`
        : "."),
  );
  if (calibration.degenerate) {
    out.push("");
    out.push(
      `> **The confidence score is close to degenerate on this test set.** It collapses onto a ` +
        `narrow set of stock values rather than spanning a range, which limits how much any ` +
        `correlation against it can mean — there is little variance to correlate with.`,
    );
  }
  out.push("");

  // ---- 6. Accuracy ----------------------------------------------------------
  const scored = runs
    .map((r) => scoreRun(r, byId.get(r.ticket_id)?.expected ?? null))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  out.push(`## Accuracy against expected labels`);
  out.push("");
  out.push(
    `Reported separately from consistency, because they are different properties: an agent can ` +
      `be reliably wrong, or unreliably right. Expected labels are **the author's judgment**, ` +
      `not ground truth, and genuinely ambiguous tickets carry a set of acceptable answers rather ` +
      `than one. Read these numbers as agreement with a documented rubric — the reasoning for ` +
      `each is in \`testset/cases.json\`.`,
  );
  out.push("");

  if (scored.length > 0) {
    const rate = (f: (s: (typeof scored)[number]) => boolean) =>
      pct(scored.filter(f).length / scored.length);
    out.push(
      table(
        ["Field", "Agreement"],
        [
          ["Category", rate((s) => s.category_match)],
          ["Severity", rate((s) => s.severity_match)],
          ["Action", rate((s) => s.action_match)],
          ["Confidence in expected band", rate((s) => s.confidence_in_range)],
          ["**All four**", `**${rate((s) => s.fully_correct)}**`],
        ],
      ),
    );
    out.push("");

    const disagreed = withData
      .filter((s) => s.accuracy !== null && s.accuracy < 1)
      .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    if (disagreed.length > 0) {
      out.push(`Tickets where at least one run fell outside the expected sets:`);
      out.push("");
      out.push(
        table(
          ["Ticket", "Agreement", "Modal result", "Expected"],
          disagreed.map((s) => {
            const e = byId.get(s.ticket_id)?.expected;
            return [
              `\`${s.ticket_id}\``,
              pct(s.accuracy ?? 0),
              s.modal_triple,
              // " or " rather than "|" — a raw pipe would split the table cell.
              e
                ? `${e.category.join(" or ")} / ${e.severity.join(" or ")} / ${e.action.join(" or ")}`
                : "—",
            ];
          }),
        ),
      );
      out.push("");
    }
  }

  // ---- 7. Validation layer --------------------------------------------------
  if (validationCases.length > 0) {
    out.push(`## Validation layer`);
    out.push("");
    out.push(
      `These tickets are rejected by the agent's input schema before any API call, so they are ` +
        `deterministic by construction and cannot drift. They are **excluded from every statistic ` +
        `above** — counting them as perfectly stable would inflate apparent stability with runs ` +
        `that never reached the model.`,
    );
    out.push("");
    out.push(
      table(
        ["Ticket", "Runs", "Outcome", "Detail"],
        validationCases.map((c) => {
          const rs = runs.filter((r) => r.ticket_id === c.ticket_id);
          const rejected = rs.filter((r) => r.failure_kind === "validation").length;
          return [
            `\`${c.ticket_id}\``,
            String(rs.length),
            rs.length > 0 && rejected === rs.length
              ? "Rejected pre-API on every run"
              : `${rejected}/${rs.length} rejected pre-API`,
            rs[0]?.error?.slice(0, 90) ?? "—",
          ];
        }),
      ),
    );
    out.push("");
  }

  // ---- 8. Limitations -------------------------------------------------------
  out.push(`## How to read this`);
  out.push("");
  out.push(
    [
      `- **Test set size.** ${withData.length} tickets is enough to demonstrate a method and to ` +
        `surface drift where it is large. It is not enough to estimate drift rates precisely, and ` +
        `the correlation in particular rests on ${correlation.n} paired observations.`,
      `- **Run count.** At roughly ${runsPerTicket} runs per ticket, the finest drift rate ` +
        `distinguishable from zero is one flip in ${runsPerTicket} runs. A ticket reported at 0% ` +
        `drift may still be unstable at a rate below this resolution.`,
      `- **Sampling parameters.** The agent does not set \`temperature\`, so these runs use the ` +
        `API default. The harness measures the agent exactly as shipped and deliberately does not ` +
        `modify it; the observed variance is the variance a real deployment of this agent would have.`,
      `- **Expected labels are judgment.** The accuracy section measures agreement with a written ` +
        `rubric, not correctness against ground truth. Consistency measurements do not depend on ` +
        `those labels at all, which is why they are reported first.`,
      `- **Mock data.** Customer and knowledge-base lookups are backed by local JSON fixtures in ` +
        `the agent repo, not a real CRM. Drift attributable to live data changing is out of scope here.`,
    ].join("\n"),
  );
  out.push("");

  return out.join("\n") + "\n";
}

function main() {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      stdout: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(USAGE);
    process.exit(0);
  }

  const inPath = values.in ? path.resolve(REPO_ROOT, values.in) : mostRecentRunsFile();
  const runs = readRuns(inPath);
  const cases = loadTestSet();

  const report = buildReport(runs, cases, inPath);

  if (values.stdout) {
    process.stdout.write(report);
    return;
  }

  const model = runs[0]!.model.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outPath = values.out
    ? path.resolve(REPO_ROOT, values.out)
    : path.join(REPO_ROOT, "reports", `${model}.md`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report);
  console.error(`Report written to ${path.relative(REPO_ROOT, outPath)}`);
}

main();
