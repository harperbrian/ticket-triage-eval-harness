# Classification Reliability Report

Measures run-to-run classification drift in the [Support Ticket Triage Agent](https://github.com/harperbrian/ticket-triage-agent): the same ticket submitted repeatedly, and how often the answer changes.

## Run configuration

| Field | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Agent commit | `07c1f50ea4` |
| Tickets measured | 17 |
| Scored runs | 136 (8 per ticket) |
| Agent-attributable failures | 0 — every run that reached the model returned valid output |
| Validation rejections | 8 — rejected pre-API by design, excluded from all rates |
| Blocked before reaching the model | 78 — never reached a model, excluded from all rates |
| Total records in log | 222 |
| Source | `runs/claude-sonnet-4-6.jsonl` |
| Generated | 2026-08-20T02:53:20.140Z |

## Headline

**6 of 17 tickets changed their answer between runs.** Mean drift across all measured tickets is 12.5%. The least stable is **T-2008** at 62.5% [30.6%–86.3%] (feature_request ×5, account_access ×3 / P2 ×6, P3 ×2 / escalate ×8).

**Every rate in this report is a 95% Wilson score interval, not a point estimate.** At 8 runs per ticket, a rate observed at 0% is consistent with a true rate as high as 32.4% — the interval, not the point, is the honest claim. Ranges narrow with more runs; they do not narrow by wishing.

**1 ticket(s) flipped the auto-reply / escalate decision between identical runs.** This is the operationally consequential form of drift: the difference between a customer receiving an automated response and a human reading the ticket, decided by nothing the customer did differently.

## Per-ticket drift

`Drift` is the fraction of scored runs that disagreed with the ticket's most common (category / severity / action) triple. 0% means every run agreed.

| Ticket | Axis | Runs | Modal result | Drift (95% CI) | Action flip (95% CI) | Confidence (mean ± sd) | Failed |
|---|---|---|---|---|---|---|---|
| `T-2008` | ambiguous | 8 | account_access / P2 / escalate | 62.5% [30.6%–86.3%] | 0.0% [0.0%–32.4%] | 0.67 ± 0.10 |  |
| `T-2005` | ambiguous | 8 | other / P2 / escalate | 50.0% [21.5%–78.5%] | 0.0% [0.0%–32.4%] | 0.72 ± 0.05 |  |
| `T-1004` | unknown_customer | 8 | technical / P3 / auto_reply | 37.5% [13.7%–69.4%] | 37.5% [13.7%–69.4%] | 0.61 ± 0.08 |  |
| `T-1003` | ambiguous | 8 | technical / P2 / escalate | 25.0% [7.1%–59.1%] | 0.0% [0.0%–32.4%] | 0.28 ± 0.04 |  |
| `T-2004` | edge_case | 8 | billing / P2 / escalate | 25.0% [7.1%–59.1%] | 0.0% [0.0%–32.4%] | 0.86 ± 0.02 |  |
| `T-2009` | edge_case | 8 | technical / P2 / escalate | 12.5% [2.2%–47.1%] | 0.0% [0.0%–32.4%] | 0.83 ± 0.02 |  |
| `T-1001` | ambiguous | 8 | account_access / P3 / auto_reply | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.79 ± 0.05 |  |
| `T-1002` | clear_cut | 8 | billing / P2 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.88 ± 0.00 |  |
| `T-1005` | clear_cut | 8 | technical / P1 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.95 ± 0.01 |  |
| `T-1007` | clear_cut | 8 | technical / P3 / auto_reply | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.78 ± 0.02 |  |
| `T-2001` | clear_cut | 8 | feature_request / P4 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.95 ± 0.01 |  |
| `T-2002` | clear_cut | 8 | other / P3 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.81 ± 0.04 |  |
| `T-2003` | clear_cut | 8 | technical / P3 / auto_reply | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.87 ± 0.02 |  |
| `T-2006` | edge_case | 8 | technical / P4 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.82 ± 0.01 |  |
| `T-2007` | unknown_customer | 8 | technical / P1 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.83 ± 0.04 |  |
| `T-2010` | edge_case | 8 | billing / P2 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.74 ± 0.03 |  |
| `T-2011` | unknown_customer | 8 | account_access / P1 / escalate | 0.0% [0.0%–32.4%] | 0.0% [0.0%–32.4%] | 0.81 ± 0.03 |  |

_95% CI is the Wilson score interval on the drift/flip rate at this ticket's run count — the range the true rate plausibly falls in, not the rate itself. See "How to read this."_

### Where the variation was

| Ticket | Category | Severity | Action |
|---|---|---|---|
| `T-1003` | technical ×6, other ×2 | P2 ×8 | escalate ×8 |
| `T-1004` | technical ×8 | P3 ×6, P2 ×2 | auto_reply ×5, escalate ×3 |
| `T-2004` | billing ×8 | P2 ×6, P3 ×2 | escalate ×8 |
| `T-2005` | other ×4, billing ×2, technical ×2 | P2 ×8 | escalate ×8 |
| `T-2008` | feature_request ×5, account_access ×3 | P2 ×6, P3 ×2 | escalate ×8 |
| `T-2009` | technical ×8 | P2 ×7, P1 ×1 | escalate ×8 |

Decomposing drift by field matters because the three are not equally consequential: an unstable severity label that never changes the action is a reporting problem, while an unstable action is a behavioural one.

## Stability by ticket type

**By test-set axis** — the property each ticket was written to probe:

| Axis | Tickets | Mean drift | Mean confidence |
|---|---|---|---|
| ambiguous | 4 | 34.4% | 0.62 |
| unknown_customer | 3 | 12.5% | 0.75 |
| edge_case | 4 | 9.4% | 0.81 |
| clear_cut | 6 | 0.0% | 0.87 |

**By modal category** — which classifications the agent holds most steadily:

| Category | Tickets | Mean drift | Mean confidence |
|---|---|---|---|
| feature_request | 2 | 31.3% | 0.81 |
| other | 2 | 25.0% | 0.76 |
| technical | 8 | 9.4% | 0.75 |
| billing | 3 | 8.3% | 0.83 |
| account_access | 2 | 0.0% | 0.80 |

> Group sizes here are small — several rows rest on one or two tickets — so these comparisons are descriptive of this test set and should not be read as general properties of the categories.
>
> **The axis comparison above is affected by a post-hoc reclassification.** `T-2008` was moved from **clear_cut** to **ambiguous** after the sweep. The reasoning is in the revision block further down, but the effect is worth naming here: moving a high-drift ticket out of one group and into another makes the separation between those groups look cleaner than the unrevised data showed. Judge the reclassification on its stated reasoning, not on how tidy the resulting table is.

## Does self-reported confidence predict consistency?

The agent emits a `confidence` score with every classification. If that score is meaningful, tickets it feels sure about should be the ones it answers the same way every time. This section tests that directly, and had no assumed answer.

| Ticket | Mean confidence | Consistency | Runs |
|---|---|---|---|
| `T-1005` | 0.95 | 100.0% | 8 |
| `T-2001` | 0.95 | 100.0% | 8 |
| `T-1002` | 0.88 | 100.0% | 8 |
| `T-2003` | 0.87 | 100.0% | 8 |
| `T-2004` | 0.86 | 75.0% | 8 |
| `T-2007` | 0.83 | 100.0% | 8 |
| `T-2009` | 0.83 | 87.5% | 8 |
| `T-2006` | 0.82 | 100.0% | 8 |
| `T-2011` | 0.81 | 100.0% | 8 |
| `T-2002` | 0.81 | 100.0% | 8 |
| `T-1001` | 0.79 | 100.0% | 8 |
| `T-1007` | 0.78 | 100.0% | 8 |
| `T-2010` | 0.74 | 100.0% | 8 |
| `T-2005` | 0.72 | 50.0% | 8 |
| `T-2008` | 0.67 | 37.5% | 8 |
| `T-1004` | 0.61 | 62.5% | 8 |
| `T-1003` | 0.28 | 75.0% | 8 |

**Result:** Spearman's rho = 0.565 across 17 tickets, indicating a moderate positive rank association between mean self-reported confidence and actual run-to-run consistency. This reaches conventional significance (p = 0.0186), but with n = 17 the estimate is imprecise and the effect size should be treated as indicative, not settled.

Confidence spread across the sweep: 19 distinct values over 136 runs, most commonly 0.82 (30.1% of runs).

## Accuracy against expected labels

> ### ⚠️ 1 case had expected labels revised after a sweep
>
> Changing expectations after seeing results is the main way a study like this quietly becomes worthless. The original labels are preserved in `testset/cases.json` and reproduced below so the change can be audited rather than taken on trust. **Only the accuracy figures are affected — every drift and consistency number in this report is computed without reference to expected labels at all.**
>
> **`T-2008`** (revised 2026-08-19)
>
> - Was: `account_access / P3 or P4 / escalate / conf 0.6–1`
> - Now: `account_access or feature_request / P2 or P3 or P4 / escalate / conf 0.5–1`
>
> Revised AFTER the first sweep, which is normally the exact thing this project exists to avoid — so the original labels are preserved above and the change is declared here rather than quietly applied. Two concrete authoring errors, both demonstrable from the ticket and the agent's own configuration without reference to what the agent actually output. (1) CATEGORY: the knowledge base contains no article on role scoping, so the agent has no way to determine whether project-scoped view-only permissions are a supported feature or an unbuilt capability. 'feature_request' is therefore defensible from the information available to it, and asserting 'account_access' as the single right answer assumed knowledge the agent cannot obtain. (2) SEVERITY: the original P3/P4 band ignored the ticket's stated deadline ('contractor starts next week') and the customer's enterprise tier and 842-day tenure — factors the agent's own system prompt explicitly directs it to weight toward faster escalation. P2 is defensible on those grounds. The axis was corrected from clear_cut to ambiguous for the same reason: a case whose category is undetermined by the available evidence is by definition not clear-cut. The action remains strict at escalate — no KB match means auto_reply is never appropriate. SCOPE OF THIS REVISION: T-2004 was reviewed at the same time and deliberately NOT revised. The agent rates it P2 on commercial grounds ('high-value sales opportunity'), but the ticket states no deadline and nothing is broken, so the original P3/P4 band stands and that disagreement is reported as a finding rather than corrected away. Only cases with an identifiable authoring error were changed.
>

Reported separately from consistency, because they are different properties: an agent can be reliably wrong, or unreliably right. Expected labels are **the author's judgment**, not ground truth, and genuinely ambiguous tickets carry a set of acceptable answers rather than one. Read these numbers as agreement with a documented rubric — the reasoning for each is in `testset/cases.json`.

| Field | Agreement |
|---|---|
| Category | 97.1% |
| Severity | 94.9% |
| Action | 96.3% |
| Confidence in expected band | 94.9% |
| **All four** | **83.8%** |

Tickets where at least one run fell outside the expected sets:

| Ticket | Agreement | Modal result | Expected |
|---|---|---|---|
| `T-2004` | 25.0% | billing / P2 / escalate | billing / P3 or P4 / escalate |
| `T-1004` | 37.5% | technical / P3 / auto_reply | technical / P2 or P3 / escalate |
| `T-2011` | 37.5% | account_access / P1 / escalate | account_access or technical / P1 or P2 / escalate |
| `T-2005` | 50.0% | other / P2 / escalate | billing or technical / P2 or P3 / escalate |
| `T-2007` | 87.5% | technical / P1 / escalate | technical / P1 or P2 / escalate |
| `T-2009` | 87.5% | technical / P2 / escalate | technical / P2 or P3 / escalate |

## Validation layer

These tickets are rejected by the agent's input schema before any API call, so they are deterministic by construction and cannot drift. They are **excluded from every statistic above** — counting them as perfectly stable would inflate apparent stability with runs that never reached the model.

| Ticket | Runs | Outcome | Detail |
|---|---|---|---|
| `T-1006` | 8 | Rejected pre-API on every run | Rejected by agent input schema before any API call — body: ticket body cannot be empty |

## How to read this

- **Test set size.** 17 tickets is enough to demonstrate a method and to surface drift where it is large. It is not enough to estimate drift rates precisely, and the correlation in particular rests on 17 paired observations.
- **Run count.** At 8 runs per ticket, the finest drift rate distinguishable from zero is one flip in 8 runs. A ticket reported at 0% drift may still be unstable at a rate below this resolution.
- **95% CI is the Wilson score interval**, not the normal approximation — the normal approximation is unreliable near 0% and 100%, which is where most rates in this report fall. A ticket at 0% observed drift over 8 runs has a 95% CI upper bound of 32.4%: consistent with "never drifts" and with a real but rare failure mode this run count cannot distinguish between. Wider intervals mean the run count could not buy more precision, not that the finding is weaker.
- **Sampling parameters.** The agent does not set `temperature`, so these runs use the API default. The harness measures the agent exactly as shipped and deliberately does not modify it; the observed variance is the variance a real deployment of this agent would have.
- **Expected labels are judgment.** The accuracy section measures agreement with a written rubric, not correctness against ground truth. Consistency measurements do not depend on those labels at all, which is why they are reported first.
- **Mock data.** Customer and knowledge-base lookups are backed by local JSON fixtures in the agent repo, not a real CRM. Drift attributable to live data changing is out of scope here.

