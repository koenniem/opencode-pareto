import type { AAPricing, Allowance, Mix, Prices } from './types';

/**
 * The cache-heavy mix used only to translate Artificial Analysis's price basis
 * to OpenCode's when the two price vectors are not proportional. It is not a
 * chart input: the cost per task itself comes from AA's measured token usage.
 *
 * Cache-heavy by nature, and aggressively so — agentic coding re-reads a large
 * context every turn.
 */
export const DEFAULT_MIX: Mix = {
  input: 0.0114,
  cached: 0.985,
  output: 0.0036,
  cacheWrite: 0,
};

/** Allowance in dollars divided by the monthly subscription price. */
export function multiplier(allowance: Allowance, planPrice: number): number | null {
  if (allowance === 'unlimited' || allowance === null) return null;
  if (!Number.isFinite(allowance) || allowance <= 0) return null;
  if (!Number.isFinite(planPrice) || planPrice <= 0) return null;
  return allowance / planPrice;
}

export interface PriceAdjustment {
  factor: number;
  exact: boolean;
}

/**
 * Ratio from Artificial Analysis's price basis to OpenCode's.
 *
 * When every published price moves by the same ratio, the answer is exact
 * regardless of token mix. When they differ, the free AA API withholds token
 * counts, so the ratio is weighted with the cache-heavy mix and marked
 * approximate.
 */
export function priceAdjustment(
  aa: AAPricing | null,
  go: Prices | null,
  mix: Mix = DEFAULT_MIX,
): PriceAdjustment | null {
  if (!aa || !go) return null;

  const entries: Array<{ weight: number; aa: number | null; go: number | null }> = [
    { weight: mix.input, aa: aa.input, go: go.input },
    { weight: mix.cached, aa: aa.cachedRead, go: go.cachedRead },
    { weight: mix.output, aa: aa.output, go: go.output },
    { weight: mix.cacheWrite, aa: aa.cachedWrite, go: go.cachedWrite },
  ];

  const ratios: number[] = [];
  let incomplete = false;
  let weightedGo = 0;
  let weightedAA = 0;
  let weightTotal = 0;

  for (const entry of entries) {
    if (entry.aa === null && entry.go === null) continue;
    if (
      entry.aa === null ||
      entry.go === null ||
      !Number.isFinite(entry.aa) ||
      !Number.isFinite(entry.go) ||
      entry.aa <= 0
    ) {
      incomplete = true;
      continue;
    }
    ratios.push(entry.go / entry.aa);
    weightedGo += entry.weight * entry.go;
    weightedAA += entry.weight * entry.aa;
    weightTotal += entry.weight;
  }

  if (ratios.length === 0) return { factor: 1, exact: !incomplete };

  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const equal = max - min <= 1e-9 * Math.max(1, max);
  if (equal && !incomplete) return { factor: ratios[0], exact: true };

  const factor = weightTotal > 0 && weightedAA > 0 ? weightedGo / weightedAA : ratios[0];
  return { factor, exact: false };
}

export interface AdjustedCost {
  costPerTask: number | null;
  priceFactor: number | null;
  priceFactorApproximate: boolean;
}

/** Translate AA's list cost per task into OpenCode's price basis. */
export function adjustCostPerTask(
  listCostPerTask: number | null,
  aaPricing: AAPricing | null,
  goPrices: Prices | null,
  mix: Mix = DEFAULT_MIX,
): AdjustedCost {
  if (listCostPerTask === null || !Number.isFinite(listCostPerTask) || listCostPerTask < 0) {
    return { costPerTask: null, priceFactor: null, priceFactorApproximate: false };
  }

  const adjustment = priceAdjustment(aaPricing, goPrices, mix);
  if (adjustment === null) {
    return {
      costPerTask: listCostPerTask,
      priceFactor: null,
      priceFactorApproximate: false,
    };
  }

  return {
    costPerTask: listCostPerTask * adjustment.factor,
    priceFactor: adjustment.factor,
    priceFactorApproximate: !adjustment.exact,
  };
}

/**
 * What one task costs on the plan after its usage multiplier: list cost per
 * task divided by allowance / subscription price. The multiplier is a usage
 * multiplier, so a larger allowance makes each task cheaper.
 */
export function effectiveCostPerTask(
  costPerTask: number | null,
  allowance: Allowance,
  planPrice: number,
): number | null {
  if (costPerTask === null || !Number.isFinite(costPerTask) || costPerTask < 0) return null;
  const m = multiplier(allowance, planPrice);
  if (m === null) return null;
  return costPerTask / m;
}
