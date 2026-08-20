# Classification Reliability Report

Measures run-to-run classification drift in the [Support Ticket Triage Agent](https://github.com/harperbrian/ticket-triage-agent): the same ticket submitted repeatedly, and how often the answer changes.

## Run configuration

| Field | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Agent commit | `07c1f50ea4` |
| Tickets measured | 17 |
| Total runs | 222 |
| Failed runs | 86 (38.7%) |
| Source | `runs/claude-sonnet-4-6.jsonl` |
| Generated | 2026-08-20T02:23:11.975Z |

## Headline

**6 of 17 tickets changed their answer between runs.** Mean drift across all measured tickets is 12.5%. The least stable is **T-2008** at 62.5% (feature_request ×5, account_access ×3 / P2 ×6, P3 ×2 / escalate ×8).

**1 ticket(s) flipped the auto-reply / escalate decision between identical runs.** This is the operationally consequential form of drift: the difference between a customer receiving an automated response and a human reading the ticket, decided by nothing the customer did differently.

## Per-ticket drift

`Drift` is the fraction of scored runs that disagreed with the ticket's most common (category / severity / action) triple. 0% means every run agreed.

| Ticket | Axis | Runs | Modal result | Drift | Action flip | Confidence (mean ± sd) | Failed |
|---|---|---|---|---|---|---|---|
| `T-2008` | clear_cut | 8 | account_access / P2 / escalate | 62.5% | 0.0% | 0.67 ± 0.10 |  |
| `T-2005` | ambiguous | 8 | other / P2 / escalate | 50.0% | 0.0% | 0.72 ± 0.05 |  |
| `T-1004` | unknown_customer | 8 | technical / P3 / auto_reply | 37.5% | 37.5% | 0.61 ± 0.08 |  |
| `T-1003` | ambiguous | 8 | technical / P2 / escalate | 25.0% | 0.0% | 0.28 ± 0.04 |  |
| `T-2004` | edge_case | 8 | billing / P2 / escalate | 25.0% | 0.0% | 0.86 ± 0.02 |  |
| `T-2009` | edge_case | 8 | technical / P2 / escalate | 12.5% | 0.0% | 0.83 ± 0.02 |  |
| `T-1001` | ambiguous | 8 | account_access / P3 / auto_reply | 0.0% | 0.0% | 0.79 ± 0.05 |  |
| `T-1002` | clear_cut | 8 | billing / P2 / escalate | 0.0% | 0.0% | 0.88 ± 0.00 |  |
| `T-1005` | clear_cut | 8 | technical / P1 / escalate | 0.0% | 0.0% | 0.95 ± 0.01 |  |
| `T-1007` | clear_cut | 8 | technical / P3 / auto_reply | 0.0% | 0.0% | 0.78 ± 0.02 |  |
| `T-2001` | clear_cut | 8 | feature_request / P4 / escalate | 0.0% | 0.0% | 0.95 ± 0.01 |  |
| `T-2002` | clear_cut | 8 | other / P3 / escalate | 0.0% | 0.0% | 0.81 ± 0.04 |  |
| `T-2003` | clear_cut | 8 | technical / P3 / auto_reply | 0.0% | 0.0% | 0.87 ± 0.02 |  |
| `T-2006` | edge_case | 8 | technical / P4 / escalate | 0.0% | 0.0% | 0.82 ± 0.01 |  |
| `T-2007` | unknown_customer | 8 | technical / P1 / escalate | 0.0% | 0.0% | 0.83 ± 0.04 |  |
| `T-2010` | edge_case | 8 | billing / P2 / escalate | 0.0% | 0.0% | 0.74 ± 0.03 |  |
| `T-2011` | unknown_customer | 8 | account_access / P1 / escalate | 0.0% | 0.0% | 0.81 ± 0.03 |  |

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
| ambiguous | 3 | 25.0% | 0.60 |
| unknown_customer | 3 | 12.5% | 0.75 |
| edge_case | 4 | 9.4% | 0.81 |
| clear_cut | 7 | 8.9% | 0.85 |

**By modal category** — which classifications the agent holds most steadily:

| Category | Tickets | Mean drift | Mean confidence |
|---|---|---|---|
| feature_request | 2 | 31.3% | 0.81 |
| other | 2 | 25.0% | 0.76 |
| technical | 8 | 9.4% | 0.75 |
| billing | 3 | 8.3% | 0.83 |
| account_access | 2 | 0.0% | 0.80 |

> Group sizes here are small — several rows rest on one or two tickets — so these comparisons are descriptive of this test set and should not be read as general properties of the categories.

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

Reported separately from consistency, because they are different properties: an agent can be reliably wrong, or unreliably right. Expected labels are **the author's judgment**, not ground truth, and genuinely ambiguous tickets carry a set of acceptable answers rather than one. Read these numbers as agreement with a documented rubric — the reasoning for each is in `testset/cases.json`.

| Field | Agreement |
|---|---|
| Category | 93.4% |
| Severity | 90.4% |
| Action | 96.3% |
| Confidence in expected band | 94.1% |
| **All four** | **77.9%** |

Tickets where at least one run fell outside the expected sets:

| Ticket | Agreement | Modal result | Expected |
|---|---|---|---|
| `T-2008` | 0.0% | account_access / P2 / escalate | account_access / P3 or P4 / escalate |
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
- **Run count.** At roughly 12 runs per ticket, the finest drift rate distinguishable from zero is one flip in 12 runs. A ticket reported at 0% drift may still be unstable at a rate below this resolution.
- **Sampling parameters.** The agent does not set `temperature`, so these runs use the API default. The harness measures the agent exactly as shipped and deliberately does not modify it; the observed variance is the variance a real deployment of this agent would have.
- **Expected labels are judgment.** The accuracy section measures agreement with a written rubric, not correctness against ground truth. Consistency measurements do not depend on those labels at all, which is why they are reported first.
- **Mock data.** Customer and knowledge-base lookups are backed by local JSON fixtures in the agent repo, not a real CRM. Drift attributable to live data changing is out of scope here.

