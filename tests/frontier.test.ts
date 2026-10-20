import { describe, expect, it } from 'vitest';
import { nearFrontier, paretoFrontier, toFrontierInputs } from '../src/frontier';
import { DEFAULT_MIX } from '../src/compute';
import type { DatasetModel, IndexKey } from '../src/types';

const IDX: IndexKey = 'artificial_analysis_intelligence_index';

function model(over: Partial<DatasetModel>): DatasetModel {
  return {
    goId: 'm',
    display: 'M',
    lab: 'other',
    aaSlug: 'm',
    aaName: 'M',
    tier: 'standard',
    priceRow: 'M',
    promoLabel: null,
    prices: { input: 1, output: 4, cachedRead: 0.1, cachedWrite: null },
    allowances: { go: 60, 'go-plus': 180 },
    scores: { [IDX]: 50 },
    variants: [],
    defaultVariant: null,
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
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: 'm::m', cost: expect.any(Number), score: 50 });
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

describe('effort variants', () => {
  const ladder = model({
    goId: 'ladder',
    variants: [
      {
        aaSlug: 'ladder-low',
        aaName: 'Ladder (Low)',
        effort: 'Low',
        order: 0,
        scores: { [IDX]: 30 },
      },
      {
        aaSlug: 'ladder',
        aaName: 'Ladder (Max)',
        effort: 'Max',
        order: 1,
        scores: { [IDX]: 50 },
      },
    ],
    defaultVariant: 'ladder',
  });

  it('uses only the default rung by default', () => {
    const { inputs } = toFrontierInputs([ladder], 'go', IDX, DEFAULT_MIX, 10);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      modelId: 'ladder',
      effort: 'Max',
      score: 50,
      isDefault: true,
    });
  });

  it('includes every scored rung when all efforts are requested', () => {
    const { inputs } = toFrontierInputs([ladder], 'go', IDX, DEFAULT_MIX, 10, 'all');
    expect(inputs.map((i) => i.effort)).toEqual(['Low', 'Max']);
    expect(inputs.every((i) => i.modelId === 'ladder')).toBe(true);
    expect(new Set(inputs.map((i) => i.id)).size).toBe(2);
  });

  it('keeps only the better rung on a shared-price frontier', () => {
    const { inputs } = toFrontierInputs([ladder], 'go', IDX, DEFAULT_MIX, 10, 'all');
    expect(paretoFrontier(inputs)).toEqual([inputs.find((i) => i.effort === 'Max')!.id]);
  });

  it('skips a rung with no score on the selected index', () => {
    const sparse = model({
      goId: 'sparse',
      variants: [
        {
          aaSlug: 'sparse-low',
          aaName: 'Sparse (Low)',
          effort: 'Low',
          order: 0,
          scores: { [IDX]: null },
        },
        {
          aaSlug: 'sparse',
          aaName: 'Sparse (Max)',
          effort: 'Max',
          order: 1,
          scores: { [IDX]: 40 },
        },
      ],
      defaultVariant: 'sparse',
    });
    expect(
      toFrontierInputs([sparse], 'go', IDX, DEFAULT_MIX, 10, 'all').inputs.map((i) => i.effort),
    ).toEqual(['Max']);
  });

  it('buckets a model as unscored when every visible rung is null', () => {
    const blank = model({
      goId: 'blank',
      scores: { [IDX]: null },
      variants: [
        {
          aaSlug: 'blank-low',
          aaName: 'Blank (Low)',
          effort: 'Low',
          order: 0,
          scores: { [IDX]: null },
        },
      ],
      defaultVariant: 'blank-low',
    });
    expect(toFrontierInputs([blank], 'go', IDX, DEFAULT_MIX, 10, 'all').buckets.blank).toBe(
      'unscored',
    );
  });

  it('falls back to the model score when no variants were attached', () => {
    const legacy = model({ goId: 'legacy', aaSlug: 'legacy', defaultVariant: null });
    const { inputs } = toFrontierInputs([legacy], 'go', IDX, DEFAULT_MIX, 10, 'all');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: 'legacy::legacy', score: 50, isDefault: true });
  });
});

describe('nearFrontier', () => {
  const points = [
    { id: 'cheap', cost: 1, score: 50 },
    { id: 'best', cost: 10, score: 52 },
    { id: 'close', cost: 20, score: 51 },
    { id: 'far', cost: 30, score: 40 },
  ];
  const frontier = paretoFrontier(points);

  it('includes the frontier itself', () => {
    const near = nearFrontier(points, frontier, 0);
    expect([...near].sort()).toEqual(frontier.slice().sort());
  });

  it('includes a dominated model within the tolerance of the best score at its price', () => {
    expect(nearFrontier(points, frontier, 2).has('close')).toBe(true);
  });

  it('excludes a dominated model beyond the tolerance', () => {
    expect(nearFrontier(points, frontier, 2).has('far')).toBe(false);
  });

  it('admits more models as the tolerance grows', () => {
    expect(nearFrontier(points, frontier, 12).has('far')).toBe(true);
  });

  it('treats an equal-score dearer model as near', () => {
    const tied = [
      { id: 'a', cost: 1, score: 10 },
      { id: 'b', cost: 9, score: 10 },
    ];
    expect(nearFrontier(tied, paretoFrontier(tied), 0).has('b')).toBe(true);
  });

  it('never drops a frontier point', () => {
    for (const tol of [0, 1, 5]) {
      for (const id of frontier) expect(nearFrontier(points, frontier, tol).has(id)).toBe(true);
    }
  });
});
