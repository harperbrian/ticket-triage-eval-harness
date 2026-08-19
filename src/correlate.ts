/**
 * Rank-correlation between the model's self-reported confidence and its actual
 * run-to-run consistency.
 *
 * Spearman rather than Pearson because the relationship, if any, need only be
 * monotonic; a permutation test rather than a t-approximation because n here is
 * about 17 and the normal-approximation p-value is not trustworthy at that size.
 */

/** Average ranks, so tied values share a rank. Required for a correct Spearman. */
export function rankAverage(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    // Ranks are 1-based; tied entries all take the mean of the span they cover.
    const meanRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = meanRank;
    i = j + 1;
  }
  return ranks;
}

/** Returns null when either input has zero variance — correlation is undefined. */
export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;

  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i]! - mx;
    const b = y[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }

  const den = Math.sqrt(dx * dy);
  if (den === 0) return null;
  return num / den;
}

/**
 * Spearman's rho. Uses the rank-Pearson formula rather than the 6*sum(d^2)
 * shortcut, which is only valid when there are no ties — and ties are likely
 * here, since drift rates over 8 runs take few distinct values.
 */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  return pearson(rankAverage(x), rankAverage(y));
}

/** Small seeded PRNG so a published p-value is reproducible across re-runs. */
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

export interface CorrelationResult {
  /** null when n < 3 or either variable has no variance. */
  rho: number | null;
  n: number;
  /** Two-sided permutation p-value. null whenever rho is null. */
  p_value: number | null;
  trials: number;
  /** Set when the correlation could not be computed, explaining why. */
  undefined_reason?: string;
}

/**
 * Spearman's rho plus a two-sided permutation p-value.
 *
 * The p-value uses the (count + 1) / (trials + 1) form, which never reports an
 * impossible p = 0 from a finite number of shuffles.
 */
export function correlateWithPermutation(
  x: number[],
  y: number[],
  trials = 20000,
  seed = 20260811,
): CorrelationResult {
  const n = x.length;

  if (n < 3) {
    return {
      rho: null,
      n,
      p_value: null,
      trials: 0,
      undefined_reason: `Only ${n} paired observations — too few to estimate a rank correlation.`,
    };
  }

  const rho = spearman(x, y);
  if (rho === null) {
    return {
      rho: null,
      n,
      p_value: null,
      trials: 0,
      undefined_reason:
        "One of the two variables has no variance across tickets (for example, every ticket " +
        "was perfectly stable), so a correlation is mathematically undefined rather than weak.",
    };
  }

  const rand = mulberry32(seed);
  const shuffled = [...y];
  let atLeastAsExtreme = 0;

  for (let t = 0; t < trials; t++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const permuted = spearman(x, shuffled);
    if (permuted !== null && Math.abs(permuted) >= Math.abs(rho)) atLeastAsExtreme++;
  }

  return {
    rho,
    n,
    p_value: (atLeastAsExtreme + 1) / (trials + 1),
    trials,
  };
}

/**
 * Plain-language reading of a correlation, deliberately conservative.
 *
 * At n≈17 this study cannot support a confident claim in either direction, and
 * the wording is written so an inconclusive result reads as inconclusive rather
 * than as a trend.
 */
export function interpret(result: CorrelationResult): string {
  if (result.rho === null) {
    return result.undefined_reason ?? "Correlation could not be computed.";
  }

  const { rho, p_value, n } = result;
  const strength =
    Math.abs(rho) < 0.2
      ? "essentially no"
      : Math.abs(rho) < 0.4
        ? "a weak"
        : Math.abs(rho) < 0.6
          ? "a moderate"
          : "a strong";
  const direction = rho > 0 ? "positive" : "negative";
  const significant = p_value !== null && p_value < 0.05;

  const claim = significant
    ? `This reaches conventional significance (p = ${p_value!.toFixed(4)}), but with n = ${n} the ` +
      `estimate is imprecise and the effect size should be treated as indicative, not settled.`
    : `This does not reach conventional significance (p = ${p_value === null ? "n/a" : p_value.toFixed(4)}), ` +
      `so the data do not support a claim in either direction. With n = ${n}, a real ` +
      `relationship of moderate size could easily go undetected — this is an inconclusive ` +
      `result, not evidence that no relationship exists.`;

  return (
    `Spearman's rho = ${rho.toFixed(3)} across ${n} tickets, indicating ${strength} ${direction} ` +
    `rank association between mean self-reported confidence and actual run-to-run consistency. ${claim}`
  );
}
