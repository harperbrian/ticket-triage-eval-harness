import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  correlateWithPermutation,
  interpret,
  pearson,
  rankAverage,
  spearman,
} from "../src/correlate.js";

describe("rankAverage", () => {
  it("ranks distinct values 1..n in value order", () => {
    assert.deepEqual(rankAverage([30, 10, 20]), [3, 1, 2]);
  });

  it("assigns tied values their shared mean rank", () => {
    // Values 2,2 occupy ranks 2 and 3, so both take 2.5.
    assert.deepEqual(rankAverage([1, 2, 2, 3]), [1, 2.5, 2.5, 4]);
  });

  it("collapses an all-tied input to a single shared rank", () => {
    assert.deepEqual(rankAverage([5, 5, 5, 5]), [2.5, 2.5, 2.5, 2.5]);
  });
});

describe("pearson", () => {
  it("returns 1 for a perfect positive linear relationship", () => {
    assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  });

  it("returns null when a variable has no variance", () => {
    // Undefined, not zero — the distinction matters for how the report words it.
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  });
});

describe("spearman", () => {
  it("matches a hand-computed case", () => {
    // x ranks [1,2,3,4,5], y ranks [1,3,2,5,4]; sum d^2 = 4.
    // No ties, so the shortcut applies: rho = 1 - 6(4)/(5*24) = 0.8
    const rho = spearman([10, 20, 30, 40, 50], [1, 3, 2, 5, 4]);
    assert.ok(rho !== null);
    assert.ok(Math.abs(rho - 0.8) < 1e-12, `expected 0.8, got ${rho}`);
  });

  it("returns -1 for a perfectly inverted ordering", () => {
    assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  });

  it("handles ties without the 6*sum(d^2) shortcut", () => {
    // The shortcut is invalid with ties; the rank-Pearson path must still work.
    const rho = spearman([1, 2, 2, 3, 4], [1, 2, 3, 3, 5]);
    assert.ok(rho !== null && rho > 0.8 && rho < 1);
  });

  it("returns null below three observations", () => {
    assert.equal(spearman([1, 2], [2, 1]), null);
  });
});

describe("correlateWithPermutation", () => {
  it("is deterministic across calls with the same seed", () => {
    const x = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    const y = [1.0, 0.9, 0.9, 0.7, 0.6, 0.5, 0.2];
    const a = correlateWithPermutation(x, y, 2000);
    const b = correlateWithPermutation(x, y, 2000);
    assert.equal(a.rho, b.rho);
    assert.equal(a.p_value, b.p_value);
  });

  it("finds a small p-value for a strong relationship", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = correlateWithPermutation(x, y, 5000);
    assert.equal(r.rho, 1);
    assert.ok(r.p_value !== null && r.p_value < 0.01);
  });

  it("never reports p = 0, which a finite permutation count cannot establish", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = correlateWithPermutation(x, x, 1000);
    assert.ok(r.p_value !== null && r.p_value > 0);
  });

  it("reports undefined rather than weak when consistency has no variance", () => {
    // Every ticket perfectly stable — a real possible outcome of a sweep.
    const confidence = [0.9, 0.8, 0.7, 0.6, 0.5];
    const consistency = [1, 1, 1, 1, 1];
    const r = correlateWithPermutation(confidence, consistency);
    assert.equal(r.rho, null);
    assert.equal(r.p_value, null);
    assert.match(r.undefined_reason ?? "", /no variance/i);
  });

  it("explains too-few-observations separately from no-variance", () => {
    const r = correlateWithPermutation([1, 2], [1, 2]);
    assert.equal(r.rho, null);
    assert.match(r.undefined_reason ?? "", /too few/i);
  });
});

describe("interpret", () => {
  it("describes a non-significant result as inconclusive, not as absence of effect", () => {
    const text = interpret({ rho: 0.15, n: 17, p_value: 0.55, trials: 20000 });
    assert.match(text, /does not reach conventional significance/);
    assert.match(text, /inconclusive result, not evidence that no relationship exists/);
  });

  it("hedges even when significant, given the sample size", () => {
    const text = interpret({ rho: 0.72, n: 17, p_value: 0.001, trials: 20000 });
    assert.match(text, /indicative, not settled/);
  });

  it("surfaces the undefined reason rather than inventing a number", () => {
    const text = interpret({
      rho: null,
      n: 5,
      p_value: null,
      trials: 0,
      undefined_reason: "One of the two variables has no variance across tickets.",
    });
    assert.match(text, /no variance/);
  });
});
