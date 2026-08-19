# AI Reliability Evaluation Harness

Measures **run-to-run classification drift** in my [Support Ticket Triage Agent](https://github.com/harperbrian/ticket-triage-agent): the same ticket submitted repeatedly, and how often the answer changes.

While manually testing that agent I hit something I hadn't designed for. An identical ticket — same text, same customer, no changes of any kind — came back as **P3 / 0.82 / auto_reply** on one run and **P2 / 0.88 / escalate** on another. Two different severities, two different decisions about whether a human ever sees the ticket.

That went into the agent's README as one row in a table. One row is an anecdote. This project turns it into a measurement.

The harness runs a fixed set of 18 tickets through the *existing, unmodified* agent N times each, logs every individual run, and reports how often the classification changed — plus the question I actually wanted answered: **does the model's own confidence score predict which tickets it will be consistent about?**

That question had no assumed answer when I built this. If the correlation turns out to be weak, or drift turns out to be rare and boring, the report says so. There is no version of this repo where the numbers get to be more interesting than the data.

---

## What it measures

**Consistency (the core).** For each ticket: the most common `(category, severity, action)` result, and the fraction of runs that disagreed with it. Reported per-field too, because the three are not equally consequential — an unstable severity label that never changes the action is a reporting problem, while an unstable *action* is a behavioural one. The `auto_reply` ↔ `escalate` flip rate is called out separately: that is the difference between a customer getting a bot response and a human reading their ticket.

**None of the consistency math depends on my opinions about the right answer.** It only compares runs against each other, which is what makes it the strongest part of the result.

**Accuracy (reported separately).** How often results matched labels I wrote by hand. Kept apart from consistency on purpose — an agent can be reliably wrong, or unreliably right, and collapsing the two hides which one you have.

**Confidence calibration.** Whether the confidence score spans a real range or collapses onto a handful of stock values. A model that answers `0.85` to everything isn't reporting uncertainty, and a correlation computed against such a score is measuring noise.

---

## Results

No measurement sweep has been published yet. When one runs, its report lands in [`reports/`](reports/) and the raw per-run data in [`runs/`](runs/).

Raw JSONL is committed alongside every report, so any number in a report can be recomputed from the runs that produced it. Nothing is averaged away at write time.

---

## Running it without spending anything

The entire harness — every module, the full test suite, and end-to-end report generation — runs offline against recorded fixtures with **no API key and no API calls**:

```bash
git clone --recurse-submodules https://github.com/harperbrian/ticket-triage-eval-harness.git
cd ticket-triage-eval-harness
npm install
npm test                                                    # 66 tests, no network
npx tsx src/analyze.ts --in test/fixtures/sample-runs.jsonl --stdout
```

That last command prints a complete report built from synthetic data. It is labelled as synthetic in a banner at the top, because a fabricated report shaped exactly like a real one is precisely the thing this project exists not to produce.

Already cloned without submodules? `git submodule update --init --recursive`.

---

## Running a real measurement

Requires an [Anthropic API key](https://console.anthropic.com/). This calls the Messages API and **costs money** — it is not covered by a Claude Pro or Max subscription, which bill on a separate rail.

```bash
cp .env.example .env        # add your ANTHROPIC_API_KEY

npm run eval -- --ticket T-1007 --runs 2   # smoke test first, a couple of cents
npm run eval -- --runs 8                   # full sweep
npm run analyze                            # writes reports/<model>.md
```

Rough cost, measured from the agent's actual system prompt and tool schemas (~1,100 input tokens on the first call, ~3.5 calls per triage as the tool loop runs, ~700 output tokens):

| Sweep | Triages | Approx. cost |
|---|---|---|
| 8 runs × 18 tickets, Sonnet 4.6 | 144 | ~$4.00 |
| 5 runs × 18 tickets, Sonnet 4.6 | 90 | ~$2.50 |
| 8 runs × 18 tickets, Haiku 4.5 | 144 | ~$1.30 |

Useful flags:

| Flag | Effect |
|---|---|
| `--runs <n>` | Runs per ticket (default 8) |
| `--ticket <id>` | Restrict to one ticket; repeatable |
| `--model <id>` | Model to measure (default `claude-sonnet-4-6`) |
| `--concurrency <n>` | Tickets in parallel (default 4) |
| `--fresh` | Discard existing runs instead of topping up |

Output is append-only JSONL flushed after every run, so an interrupted sweep loses nothing — re-running tops up to `--runs` rather than starting over. Each output file is scoped to a single model, and the runner refuses to append runs from a different model to an existing file, because mixing them would silently corrupt every rate downstream.

---

## How the agent is integrated

The agent is vendored as a **git submodule pinned to a specific commit**, at [`vendor/ticket-triage-agent`](vendor/ticket-triage-agent). Results are therefore attributable to an exact revision, which is recorded in every run record and printed in every report.

The harness calls the agent's real entry point:

```ts
import { triageTicket } from "../vendor/ticket-triage-agent/src/agent.js";
```

**The agent repo is read-only and was not modified for this project.** No exported hooks were added, no injectable client, no temperature seam. It is measured exactly as shipped, because a measurement of a modified artifact would not be a measurement of the thing I actually built.

Four consequences worth knowing, since they shaped the harness:

- The agent never sets `temperature`, so runs use the API default. That variance is the finding, not a flaw to control away.
- Its `agent.ts` doesn't load `dotenv` (only its CLI does), so the harness loads env itself. A missing key surfaces through the same `{ok: false}` channel as a genuine model failure, so the harness classifies failure kinds and **excludes configuration errors from all drift statistics** — a misconfigured shell must never be reported as the agent changing its mind.
- Its `escalate` tool logs to stdout. Escalation detection reads the agent's in-process escalation log instead of parsing that output, and runs of the same ticket stay sequential so the before/after delta stays attributable.
- Its `index.ts` calls `process.exit()` at import time, so the harness imports `agent.ts` directly and never that file.

---

## The test set

18 tickets in [`testset/cases.json`](testset/cases.json) — the agent's original 7 (referenced from the submodule, not copied) plus 11 written for this harness. Each new ticket probes a distinct axis rather than rephrasing an existing one:

| Axis | Tickets | What it probes |
|---|---|---|
| `clear_cut` | 7 | Cases with one defensible answer. Drift here would be the most alarming result. |
| `ambiguous` | 3 | Genuinely underdetermined tickets, including one reporting two unrelated problems at once. |
| `unknown_customer` | 3 | Missing account context, including one with no email field at all. |
| `edge_case` | 4 | Urgent tone over cosmetic content; a buried issue under four sentences of noise; a four-word ticket that is short but perfectly clear; a question that trips a knowledge-base false positive. |
| `validation` | 1 | Malformed input, rejected before any API call. |

**Expected labels are acceptable *sets*, not single values, wherever a case is honestly ambiguous.** A ticket reporting both a billing discrepancy and an export failure has no single correct category, and asserting one would manufacture precision the underlying judgment doesn't have. Every case carries a written justification in `cases.json` for exactly why its labels are what they are, so the rubric is auditable rather than asserted.

The validation ticket is **excluded from all drift and correlation statistics**. It is rejected by the agent's schema before any API call, making it deterministic by construction — counting it as "100% stable" would pad the stability numbers with runs that never reached the model.

---

## Statistics

Spearman's rank correlation between mean confidence and actual consistency, with a **permutation test** for the p-value rather than a normal approximation — at n ≈ 17 the approximation isn't trustworthy. The permutation uses a seeded PRNG so a published p-value is reproducible on re-run.

Three failure modes are handled explicitly rather than papered over:

- **Undefined vs. weak.** If every ticket is perfectly stable there is no variance to correlate against, and the report says the correlation is mathematically undefined rather than reporting a misleading zero.
- **Ties.** Drift rates over 8 runs take few distinct values, so ties are common. The implementation uses the rank-Pearson form, not the `6·Σd²` shortcut, which is only valid without ties.
- **Inconclusive results stay inconclusive.** A non-significant result is reported as "the data do not support a claim in either direction," with an explicit note that a real effect could go undetected at this sample size — not as evidence of no relationship.

---

## Project layout

```
src/
  adapter.ts       wraps triageTicket: env, timing, failure classification
  testset.ts       loads cases.json, replicates the agent's input validation
  score.ts         rubric against acceptable sets; confidence calibration
  consistency.ts   modal classification, drift rates, per-field decomposition
  correlate.ts     Spearman + seeded permutation test
  runner.ts        sweep → append-only JSONL
  analyze.ts       JSONL → markdown report
testset/           18 cases with documented expected labels
test/              66 offline tests + the fixture generator
runs/              raw per-run JSONL (committed)
reports/           generated reports (committed)
```

---

## Honest framing

This is demo-scale. Customer and knowledge-base lookups are backed by local JSON fixtures in the agent repo, not a real CRM — **it is not connected to any production system**, and no real customer data is involved. The test set is 18 tickets, which is enough to demonstrate a method and to surface drift where it is large, and not enough to estimate drift rates precisely. Every report states these limits in its own "How to read this" section rather than leaving them to this file.

Built with AI assistance, same as the rest of my portfolio. TypeScript/Node here matches the [Ticket Triage Agent](https://github.com/harperbrian/ticket-triage-agent) and [Finnhub connector](https://github.com/harperbrian/finnhub-connector) — my production work is SQL, HTML, and JSON; JavaScript and Python are coursework-level, and extending an existing TypeScript project is a continuation of that, not a claim beyond it.

## License

MIT
