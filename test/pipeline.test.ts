import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { classifyFailure } from "../src/adapter.js";
import { loadTestSet, readTicket } from "../src/testset.js";
import { REPO_ROOT } from "../src/types.js";

const FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "sample-runs.jsonl");

describe("classifyFailure", () => {
  it("labels a missing API key as config, not as agent instability", () => {
    // This is the one that matters most: a misconfigured shell must never be
    // reported as the agent changing its mind.
    assert.equal(
      classifyFailure(
        "Claude API call failed: Could not resolve authentication method. Expected either apiKey or authToken to be set.",
      ),
      "config",
    );
  });

  it("labels a bad model id as config", () => {
    assert.equal(
      classifyFailure("Claude API call failed: 404 not_found_error: model: claude-nonexistent"),
      "config",
    );
  });

  it("labels unparseable model output as malformed — a real finding", () => {
    assert.equal(
      classifyFailure("Model did not return valid JSON on completion, even after attempting to extract it"),
      "malformed",
    );
  });

  it("labels schema violations as malformed", () => {
    assert.equal(classifyFailure("Model output did not match the expected schema: ..."), "malformed");
  });

  it("labels loop exhaustion distinctly", () => {
    assert.equal(
      classifyFailure("Exceeded 6 tool-use iterations without reaching a final answer."),
      "loop_exhausted",
    );
  });

  it("falls back to api for transport and rate-limit errors", () => {
    assert.equal(classifyFailure("Claude API call failed: 529 overloaded_error"), "api");
    assert.equal(classifyFailure("Claude API call failed: 429 rate_limit_error"), "api");
  });
});

describe("test set", () => {
  const cases = loadTestSet();

  it("loads all 18 cases with unique ids and resolvable ticket files", () => {
    assert.equal(cases.length, 18);
    assert.equal(new Set(cases.map((c) => c.ticket_id)).size, 18);
  });

  it("gives every non-validation case expected labels", () => {
    for (const c of cases) {
      if (c.axis === "validation") assert.equal(c.expected, null, `${c.ticket_id}`);
      else assert.ok(c.expected, `${c.ticket_id} is missing expected labels`);
    }
  });

  it("documents the reasoning for every case", () => {
    // The notes are what make the expected labels auditable rather than asserted.
    for (const c of cases) {
      assert.ok(c.notes.length > 40, `${c.ticket_id} notes are too thin to justify its labels`);
    }
  });

  it("covers every category the agent can emit", () => {
    const covered = new Set(cases.flatMap((c) => c.expected?.category ?? []));
    for (const category of ["billing", "technical", "account_access", "feature_request", "other"]) {
      assert.ok(covered.has(category), `no case expects category "${category}"`);
    }
  });

  it("covers every severity the agent can emit", () => {
    const covered = new Set(cases.flatMap((c) => c.expected?.severity ?? []));
    for (const severity of ["P1", "P2", "P3", "P4"]) {
      assert.ok(covered.has(severity), `no case expects severity "${severity}"`);
    }
  });

  it("includes at least two auto_reply cases so that action stability is measurable", () => {
    const autoReply = cases.filter((c) => c.expected?.action.includes("auto_reply"));
    assert.ok(autoReply.length >= 2, "with fewer than two, auto_reply drift cannot be observed");
  });
});

describe("readTicket", () => {
  const cases = loadTestSet();

  it("accepts every non-validation ticket", () => {
    for (const c of cases.filter((c) => c.axis !== "validation")) {
      assert.equal(readTicket(c).ok, true, `${c.ticket_id} failed the agent's input schema`);
    }
  });

  it("rejects the malformed ticket before any API call", () => {
    const validation = cases.find((c) => c.axis === "validation")!;
    const result = readTicket(validation);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /body/i);
  });
});

describe("analyze CLI", () => {
  const report = execFileSync(
    "npx",
    ["tsx", "src/analyze.ts", "--in", "test/fixtures/sample-runs.jsonl", "--stdout"],
    { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );

  it("generates a report from recorded data with no API key", () => {
    assert.ok(report.length > 2000);
    assert.match(report, /# Classification Reliability Report/);
  });

  it("includes every required section", () => {
    for (const heading of [
      "## Run configuration",
      "## Headline",
      "## Per-ticket drift",
      "## Stability by ticket type",
      "## Does self-reported confidence predict consistency?",
      "## Accuracy against expected labels",
      "## Validation layer",
      "## How to read this",
    ]) {
      assert.ok(report.includes(heading), `missing section: ${heading}`);
    }
  });

  it("surfaces drift on T-1001, the ticket the original finding came from", () => {
    const row = report.split("\n").find((l) => l.startsWith("| `T-1001`"));
    assert.ok(row, "T-1001 has no row in the per-ticket table");
    assert.ok(!row!.includes("| 0.0% |"), `expected non-zero drift, got: ${row}`);
  });

  it("reports the validation ticket separately and excludes it from drift", () => {
    const validationSection = report.split("## Validation layer")[1] ?? "";
    assert.match(validationSection, /T-1006/);
    assert.match(validationSection, /excluded from every statistic/i);

    // T-1006 must not appear in the per-ticket drift table.
    const driftSection = report.split("## Per-ticket drift")[1]?.split("##")[0] ?? "";
    assert.ok(!driftSection.includes("T-1006"), "validation ticket leaked into drift statistics");
  });

  it("states the sample-size limitation rather than implying precision", () => {
    assert.match(report, /paired observations|Test set size/);
  });

  it("marks a fixture-derived report as synthetic, unmissably and at the top", () => {
    // The fixture produces a realistic-looking report with a plausible p-value.
    // Without this banner it would be indistinguishable from a real measurement.
    assert.match(report, /SYNTHETIC DATA — NOT A MEASUREMENT/);
    assert.ok(
      report.indexOf("SYNTHETIC DATA") < report.indexOf("## Run configuration"),
      "the warning must precede the data, not follow it",
    );
    assert.match(report, /must not be cited as a finding/);
  });

  it("does not mark a report from runs/ as synthetic", () => {
    const tmp = path.join(REPO_ROOT, "runs", "__banner-check.jsonl");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.copyFileSync(FIXTURE, tmp);
    try {
      const real = execFileSync(
        "npx",
        ["tsx", "src/analyze.ts", "--in", "runs/__banner-check.jsonl", "--stdout"],
        { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      assert.ok(!real.includes("SYNTHETIC DATA"), "real sweeps must not carry the synthetic banner");
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it("renders the expected-labels column without breaking the markdown table", () => {
    // Acceptable sets are joined with " or "; a raw "|" would split the cell.
    const accuracySection = report.split("## Accuracy against expected labels")[1] ?? "";
    for (const line of accuracySection.split("\n").filter((l) => l.startsWith("| `T-"))) {
      const cells = line.split("|").length - 2;
      assert.equal(cells, 4, `row has ${cells} cells, expected 4: ${line}`);
    }
  });
});

describe("fixture integrity", () => {
  it("is present and parseable", () => {
    assert.ok(fs.existsSync(FIXTURE), "run: npx tsx test/fixtures/generate.ts");
    const lines = fs.readFileSync(FIXTURE, "utf-8").trim().split("\n");
    assert.equal(lines.length, 144);
    for (const line of lines) JSON.parse(line);
  });

  it("only references ticket ids that exist in the test set", () => {
    const known = new Set(loadTestSet().map((c) => c.ticket_id));
    const lines = fs.readFileSync(FIXTURE, "utf-8").trim().split("\n");
    for (const line of lines) {
      const record = JSON.parse(line);
      assert.ok(known.has(record.ticket_id), `fixture references unknown ticket ${record.ticket_id}`);
    }
  });
});
