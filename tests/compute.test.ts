import { describe, expect, it } from 'vitest';
import {
  adjustCostPerTask,
  effectiveCostPerTask,
  multiplier,
  priceAdjustment,
} from '../src/compute';
import type { AAPricing, Prices } from '../src/types';

const KIMI_K3: Prices = { input: 3.0, output: 15.0, cachedRead: 0.3, cachedWrite: null };
const KIMI_AA: AAPricing = { input: 3.0, output: 15.0, cachedRead: 0.3, cachedWrite: null };

describe('multiplier', () => {
  it('divides allowance by subscription price', () => {
    expect(multiplier(60, 10)).toBe(6);
    expect(multiplier(15, 10)).toBe(1.5);
    expect(multiplier(180, 40)).toBe(4.5);
  });

  it('returns null for unlimited or absent allowance', () => {
    expect(multiplier('unlimited', 10)).toBeNull();
    expect(multiplier(null, 10)).toBeNull();
  });
});

describe('priceAdjustment', () => {
  it('leaves matching price vectors unchanged', () => {
    expect(priceAdjustment(KIMI_AA, KIMI_K3)).toEqual({ factor: 1, exact: true });
  });

  it('scales proportional price vectors exactly', () => {
    const aa = { ...KIMI_AA, input: 6, output: 30, cachedRead: 0.6 };
    expect(priceAdjustment(aa, KIMI_K3)).toEqual({ factor: 0.5, exact: true });
  });

  it('uses the supplied mix when only one component differs', () => {
    const aa = { ...KIMI_AA, cachedRead: 0.6 };
    const adjustment = priceAdjustment(aa, KIMI_K3, {
      input: 0,
      cached: 1,
      output: 0,
      cacheWrite: 0,
    });
    expect(adjustment).toEqual({ factor: 0.5, exact: false });
  });

  it('is approximate when a component has a price on only one side', () => {
    const aa = { ...KIMI_AA, cachedWrite: 0.1 };
    const adjustment = priceAdjustment(aa, KIMI_K3);
    expect(adjustment?.exact).toBe(false);
    expect(adjustment?.factor).toBeCloseTo(1, 10);
  });

  it('returns null when either price basis is missing', () => {
    expect(priceAdjustment(null, KIMI_K3)).toBeNull();
    expect(priceAdjustment(KIMI_AA, null)).toBeNull();
  });
});

describe('adjustCostPerTask', () => {
  it('applies the price factor to the list cost', () => {
    const aa = { ...KIMI_AA, input: 6, output: 30, cachedRead: 0.6 };
    expect(adjustCostPerTask(2, aa, KIMI_K3)).toEqual({
      costPerTask: 1,
      priceFactor: 0.5,
      priceFactorApproximate: false,
    });
  });

  it('keeps the AA cost when no price basis is available', () => {
    expect(adjustCostPerTask(2, null, KIMI_K3)).toEqual({
      costPerTask: 2,
      priceFactor: null,
      priceFactorApproximate: false,
    });
  });

  it('returns null when AA has no cost', () => {
    expect(adjustCostPerTask(null, KIMI_AA, KIMI_K3)).toEqual({
      costPerTask: null,
      priceFactor: null,
      priceFactorApproximate: false,
    });
  });
});

describe('effectiveCostPerTask', () => {
  it('divides the adjusted cost by the usage multiplier', () => {
    expect(effectiveCostPerTask(2, 60, 10)).toBeCloseTo(1 / 3, 10);
    expect(effectiveCostPerTask(2, 15, 10)).toBeCloseTo(2 / 1.5, 10);
  });

  it('returns null for free, unpriced or missing costs', () => {
    expect(effectiveCostPerTask(2, 'unlimited', 10)).toBeNull();
    expect(effectiveCostPerTask(2, null, 10)).toBeNull();
    expect(effectiveCostPerTask(null, 60, 10)).toBeNull();
    expect(effectiveCostPerTask(Number.NaN, 60, 10)).toBeNull();
    expect(effectiveCostPerTask(-1, 60, 10)).toBeNull();
  });

  it('keeps a genuinely free cost at zero', () => {
    expect(effectiveCostPerTask(0, 60, 10)).toBe(0);
  });
});
