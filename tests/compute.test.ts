import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIX,
  blendedPrice,
  effectivePrice,
  multiplier,
  normalizeMix,
} from '../src/compute';
import type { Prices } from '../src/types';

const GLM52: Prices = { input: 1.4, output: 4.4, cachedRead: 0.26, cachedWrite: null };
const KIMI_K3: Prices = { input: 3.0, output: 15.0, cachedRead: 0.3, cachedWrite: null };

describe('blendedPrice', () => {
  it('weights input, cached read and output by the mix', () => {
    expect(blendedPrice(GLM52, DEFAULT_MIX)).toBeCloseTo(0.2879, 6);
    expect(blendedPrice(KIMI_K3, DEFAULT_MIX)).toBeCloseTo(0.3837, 6);
  });

  it('fails closed when a weighted component has no price', () => {
    expect(blendedPrice({ ...KIMI_K3, cachedRead: null }, DEFAULT_MIX)).toBeNull();
  });

  it('ignores a missing price whose weight is zero', () => {
    expect(blendedPrice({ ...KIMI_K3, cachedWrite: null }, DEFAULT_MIX)).not.toBeNull();
  });
});

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

describe('effectivePrice', () => {
  it('divides blended list price by the multiplier', () => {
    expect(effectivePrice(GLM52, 60, 10, DEFAULT_MIX)).toBeCloseTo(0.0479833, 6);
    expect(effectivePrice(KIMI_K3, 15, 10, DEFAULT_MIX)).toBeCloseTo(0.2558, 6);
  });

  it('returns null instead of Infinity for unlimited allowance', () => {
    expect(effectivePrice(KIMI_K3, 'unlimited', 10, DEFAULT_MIX)).toBeNull();
  });

  it('returns null when there is no allowance', () => {
    expect(effectivePrice(KIMI_K3, null, 10, DEFAULT_MIX)).toBeNull();
  });
});

describe('normalizeMix', () => {
  it('scales components so they sum to one', () => {
    const out = normalizeMix({ input: 1, cached: 8, output: 1, cacheWrite: 0 });
    expect(out.input).toBeCloseTo(0.1);
    expect(out.cached).toBeCloseTo(0.8);
    expect(out.output).toBeCloseTo(0.1);
  });

  it('leaves an already-normalized mix alone', () => {
    expect(normalizeMix(DEFAULT_MIX)).toEqual(DEFAULT_MIX);
  });

  it('returns zeros for an all-zero mix rather than dividing by zero', () => {
    expect(normalizeMix({ input: 0, cached: 0, output: 0, cacheWrite: 0 })).toEqual({
      input: 0,
      cached: 0,
      output: 0,
      cacheWrite: 0,
    });
  });
});
