import type { Allowance, Mix, Prices } from './types';

/**
 * Default token mix: the median share of OpenCode's own published per-request
 * token profiles. Cache-heavy by nature, and aggressively so — agentic coding
 * re-reads a large context every turn.
 *
 * Pinned by a regression test against those published profiles; see
 * `tests/compute.test.ts`.
 */
export const DEFAULT_MIX: Mix = {
  input: 0.0114,
  cached: 0.985,
  output: 0.0036,
  cacheWrite: 0,
};

/** Scale a mix so its components sum to one. A zero mix stays zero. */
export function normalizeMix(mix: Mix): Mix {
  const total = mix.input + mix.cached + mix.output + mix.cacheWrite;
  if (total === 0) return { input: 0, cached: 0, output: 0, cacheWrite: 0 };
  return {
    input: mix.input / total,
    cached: mix.cached / total,
    output: mix.output / total,
    cacheWrite: mix.cacheWrite / total,
  };
}

/**
 * Blended price per 1M tokens.
 *
 * Returns `null` when a component carrying non-zero weight has no published
 * price. Substituting a fallback would move the point by orders of magnitude
 * at realistic cache weights, so this fails closed instead.
 */
export function blendedPrice(prices: Prices, mix: Mix): number | null {
  const weights: Array<[number, number | null]> = [
    [mix.input, prices.input],
    [mix.cached, prices.cachedRead],
    [mix.output, prices.output],
    [mix.cacheWrite, prices.cachedWrite],
  ];

  const totalWeight = weights.reduce((sum, [weight]) => sum + weight, 0);
  // A mix with no weight prices nothing. Returning 0 here would render a real
  // model as free, which is the exact class of error this project exists to
  // avoid.
  if (totalWeight === 0) return null;

  let total = 0;
  for (const [weight, price] of weights) {
    if (weight === 0) continue;
    if (price === null || !Number.isFinite(price)) return null;
    total += weight * price;
  }
  return total / totalWeight;
}

/** Allowance in dollars divided by the monthly subscription price. */
export function multiplier(allowance: Allowance, planPrice: number): number | null {
  if (allowance === 'unlimited' || allowance === null) return null;
  if (!Number.isFinite(allowance) || allowance <= 0) return null;
  if (!Number.isFinite(planPrice) || planPrice <= 0) return null;
  return allowance / planPrice;
}

/**
 * What a model costs per 1M blended tokens once the plan multiplies it.
 * `null` when the model cannot be priced (free, unpriced, or missing a price).
 */
export function effectivePrice(
  prices: Prices,
  allowance: Allowance,
  planPrice: number,
  mix: Mix,
): number | null {
  const m = multiplier(allowance, planPrice);
  if (m === null) return null;
  const blended = blendedPrice(prices, mix);
  if (blended === null) return null;
  return blended / m;
}
