import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildDataset } from '../scripts/build-dataset';
import type { GoPricing } from '../scripts/scrape-go';
import type { AASnapshot } from '../scripts/fetch-aa';
import type { RosterEntry } from '../src/types';

const roster = parseYaml(
  readFileSync(new URL('../data/roster.yaml', import.meta.url), 'utf8'),
) as RosterEntry[];
const pricing = JSON.parse(
  readFileSync(new URL('../data/go-pricing.json', import.meta.url), 'utf8'),
) as GoPricing;

const snapshot: AASnapshot = {
  fetchedAt: '2026-10-19T00:00:00.000Z',
  intelligenceIndexVersion: '4.3',
  models: [
    {
      slug: 'kimi-k3',
      name: 'Kimi K3 (Max)',
      variant: 'Max',
      scores: {
        artificial_analysis_intelligence_index: 47,
        artificial_analysis_coding_index: 44,
      },
    },
    {
      slug: 'kimi-k3-low',
      name: 'Kimi K3 (Low)',
      variant: 'Low',
      scores: {
        artificial_analysis_intelligence_index: 38,
        artificial_analysis_coding_index: 35,
      },
    },
    {
      slug: 'glm-5-3',
      name: 'GLM-5.3 (Max)',
      variant: 'Max',
      scores: {
        artificial_analysis_intelligence_index: 45,
        artificial_analysis_coding_index: null,
      },
    },
    {
      slug: 'glm-5-3-low',
      name: 'GLM-5.3 (Low)',
      variant: 'Low',
      scores: {
        artificial_analysis_intelligence_index: 39,
        artificial_analysis_coding_index: null,
      },
    },
  ],
};

const kimiOnly: RosterEntry[] = [
  {
    goId: 'kimi-k3',
    display: 'Kimi K3',
    aaSlug: 'kimi-k3',
    aaVariant: 'Max',
    tier: 'standard',
    priceRow: 'Kimi K3',
  },
];

describe('buildDataset', () => {
  it('joins roster, pricing and scores by id', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'kimi-k3')!;
    expect(m.prices!.input).toBe(3);
    expect(m.allowances!.go).toBe(15);
    expect(m.aaSlug).toBe('kimi-k3');
    expect(m.aaName).toBe('Kimi K3 (Max)');
    expect(m.scores.artificial_analysis_intelligence_index).toBe(47);
  });

  it('keeps unscored models with empty scores', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'hy3')!;
    expect(m.scores).toEqual({});
    expect(m.tier).toBe('standard');
  });

  it('records plan prices of 10 and 40', () => {
    const ds = buildDataset(roster, pricing, snapshot);
    expect(ds.plans.go.price).toBe(10);
    expect(ds.plans['go-plus'].price).toBe(40);
    expect(ds.plans.go.label).toBe('Go');
    expect(ds.plans['go-plus'].label).toBe('Go Plus');
  });

  it('carries both plan allowances through', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'kimi-k3')!;
    expect(m.allowances).toEqual({ go: 15, 'go-plus': 60 });
  });

  it('carries promotional labels', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find(
      (x) => x.goId === 'step-5-preview',
    )!;
    expect(m.promoLabel).toContain('4x');
  });

  it('emits every roster model in order', () => {
    expect(buildDataset(roster, pricing, snapshot).models).toHaveLength(29);
  });

  it('produces an empty-scores dataset when AA data is absent', () => {
    const ds = buildDataset(roster, pricing, null);
    expect(ds.aaFetchedAt).toBeNull();
    expect(ds.intelligenceIndexVersion).toBeNull();
    expect(ds.models.every((m) => Object.keys(m.scores).length === 0)).toBe(true);
    expect(ds.models.every((m) => m.variants.length === 0)).toBe(true);
    expect(ds.models.every((m) => m.defaultVariant === null)).toBe(true);
  });

  it('attaches the declared effort ladder in roster order', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'kimi-k3')!;
    expect(m.variants.map((v) => v.effort)).toEqual(['Low', 'Max']);
    expect(m.variants.map((v) => v.aaSlug)).toEqual(['kimi-k3-low', 'kimi-k3']);
    expect(m.variants.map((v) => v.order)).toEqual([0, 1]);
    expect(m.defaultVariant).toBe('kimi-k3');
  });

  it('keeps the default scores on the default rung, not the last one', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'kimi-k3')!;
    expect(m.scores.artificial_analysis_intelligence_index).toBe(47);
    expect(
      m.variants.find((v) => v.aaSlug === 'kimi-k3')!.scores
        .artificial_analysis_intelligence_index,
    ).toBe(47);
    expect(
      m.variants.find((v) => v.aaSlug === 'kimi-k3-low')!.scores
        .artificial_analysis_intelligence_index,
    ).toBe(38);
  });

  it('stores one variant when the roster declares no ladder', () => {
    const m = buildDataset(kimiOnly, pricing, snapshot).models[0];
    expect(m.variants).toHaveLength(1);
    expect(m.variants[0]).toMatchObject({ aaSlug: 'kimi-k3', effort: 'Max', order: 0 });
    expect(m.defaultVariant).toBe('kimi-k3');
  });

  it('skips a declared rung that Artificial Analysis does not return', () => {
    const noLow = snapshot.models.filter((x) => x.slug !== 'kimi-k3-low');
    const m = buildDataset(kimiOnly, pricing, { ...snapshot, models: noLow }).models[0];
    expect(m.variants.map((v) => v.aaSlug)).toEqual(['kimi-k3']);
  });

  it('puts the default rung back when the ladder omits it', () => {
    const missingDefault: RosterEntry[] = [
      {
        ...kimiOnly[0],
        efforts: [
          { aaSlug: 'kimi-k3-low', label: 'Low' },
          { aaSlug: 'kimi-k3', label: 'Max' },
        ],
      },
    ];
    const onlyLow: RosterEntry[] = [
      {
        ...kimiOnly[0],
        efforts: [{ aaSlug: 'kimi-k3-low', label: 'Low' }],
      },
    ];
    expect(buildDataset(missingDefault, pricing, snapshot).models[0].variants).toHaveLength(2);
    const m = buildDataset(onlyLow, pricing, snapshot).models[0];
    expect(m.variants.map((v) => v.aaSlug)).toEqual(['kimi-k3-low', 'kimi-k3']);
  });

  it('is deterministic apart from generatedAt', () => {
    const a = buildDataset(roster, pricing, snapshot);
    const b = buildDataset(roster, pricing, snapshot);
    expect({ ...a, generatedAt: '' }).toEqual({ ...b, generatedAt: '' });
  });
});
