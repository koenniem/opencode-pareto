import { describe, expect, it } from 'vitest';
import { paretoFrontier, toFrontierInputs } from '../src/frontier';
import { DEFAULT_MIX } from '../src/compute';
import type { DatasetModel, IndexKey } from '../src/types';

const IDX: IndexKey = 'artificial_analysis_intelligence_index';

function model(over: Partial<DatasetModel>): DatasetModel {
  return {
    goId: 'm',
    display: 'M',
    aaSlug: 'm',
    aaName: 'M',
    tier: 'standard',
    priceRow: 'M',
    promoLabel: null,
    prices: { input: 1, output: 4, cachedRead: 0.1, cachedWrite: null },
    allowances: { go: 60, 'go-plus': 180 },
    scores: { [IDX]: 50 },
    ...over,
  };
}

describe('paretoFrontier', () => {
  it('drops a point that is dearer and no better', () => {
    expect(
      paretoFrontier([
        { id: 'a', cost: 1, score: 10 },
        { id: 'b', cost: 2, score: 10 },
      ]),
    ).toEqual(['a']);
  });

  it('keeps a point that trades cost for score', () => {
    expect(
      paretoFrontier([
        { id: 'a', cost: 1, score: 10 },
        { id: 'b', cost: 2, score: 11 },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('drops a point that is dearer and worse', () => {
    expect(
      paretoFrontier([
        { id: 'a', cost: 1, score: 10 },
        { id: 'b', cost: 2, score: 9 },
      ]),
    ).toEqual(['a']);
  });

  it('keeps only the best score when costs tie', () => {
    expect(
      paretoFrontier([
        { id: 'lo', cost: 1, score: 5 },
        { id: 'hi', cost: 1, score: 9 },
      ]),
    ).toEqual(['hi']);
  });

  it('returns a single point unchanged', () => {
    expect(paretoFrontier([{ id: 'a', cost: 1, score: 10 }])).toEqual(['a']);
  });

  it('returns empty for no points', () => {
    expect(paretoFrontier([])).toEqual([]);
  });

  it('returns ids sorted by cost ascending', () => {
    expect(
      paretoFrontier([
        { id: 'c', cost: 3, score: 30 },
        { id: 'a', cost: 1, score: 10 },
        { id: 'b', cost: 2, score: 20 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('toFrontierInputs', () => {
  it('buckets unlimited allowance as free', () => {
    const { buckets, inputs } = toFrontierInputs(
      [model({ goId: 'f', allowances: { go: 'unlimited', 'go-plus': 'unlimited' } })],
      'go',
      IDX,
      DEFAULT_MIX,
      10,
    );
    expect(buckets.f).toBe('free');
    expect(inputs).toHaveLength(0);
  });

  it('buckets a null allowance as unpriced', () => {
    const { buckets } = toFrontierInputs(
      [model({ goId: 'u', allowances: { go: null, 'go-plus': null } })],
      'go',
      IDX,
      DEFAULT_MIX,
      10,
    );
    expect(buckets.u).toBe('unpriced');
  });

  it('buckets a null cache price as incomplete', () => {
    const { buckets, inputs } = toFrontierInputs(
      [model({ prices: { input: 1, output: 4, cachedRead: null, cachedWrite: null } })],
      'go',
      IDX,
      DEFAULT_MIX,
      10,
    );
    expect(buckets.m).toBe('incomplete');
    expect(inputs).toHaveLength(0);
  });

  it('buckets a null score as unscored', () => {
    const { buckets, inputs } = toFrontierInputs(
      [model({ scores: { [IDX]: null } })],
      'go',
      IDX,
      DEFAULT_MIX,
      10,
    );
    expect(buckets.m).toBe('unscored');
    expect(inputs).toHaveLength(0);
  });

  it('buckets a model with no scores at all as unscored', () => {
    const { buckets } = toFrontierInputs([model({ scores: {} })], 'go', IDX, DEFAULT_MIX, 10);
    expect(buckets.m).toBe('unscored');
  });

  it('buckets one valid model as plotted', () => {
    const { buckets, inputs } = toFrontierInputs([model({})], 'go', IDX, DEFAULT_MIX, 10);
    expect(buckets.m).toBe('plotted');
    expect(inputs).toEqual([{ id: 'm', cost: expect.any(Number), score: 50 }]);
  });

  it('uses the requested plan allowance', () => {
    const m = model({ allowances: { go: 60, 'go-plus': 180 } });
    const go = toFrontierInputs([m], 'go', IDX, DEFAULT_MIX, 10).inputs[0];
    const plus = toFrontierInputs([m], 'go-plus', IDX, DEFAULT_MIX, 40).inputs[0];
    // Go: 60/10 = 6x. Go Plus: 180/40 = 4.5x. The allowance grows less than
    // the subscription, so this model is dearer per token on Go Plus.
    expect(plus.cost).toBeCloseTo(go.cost * (6 / 4.5), 10);
  });

  it('reproduces the multiplier difference between plans', () => {
    const m = model({ allowances: { go: 15, 'go-plus': 120 } });
    const go = toFrontierInputs([m], 'go', IDX, DEFAULT_MIX, 10).inputs[0];
    const plus = toFrontierInputs([m], 'go-plus', IDX, DEFAULT_MIX, 40).inputs[0];
    expect(plus.cost).toBeCloseTo(go.cost / 2, 10);
  });
});
