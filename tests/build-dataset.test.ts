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
      slug: 'glm-5-3',
      name: 'GLM-5.3 (Max)',
      variant: 'Max',
      scores: {
        artificial_analysis_intelligence_index: 45,
        artificial_analysis_coding_index: null,
      },
    },
  ],
};

describe('buildDataset', () => {
  it('joins roster, pricing and scores by id', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'kimi-k3')!;
    expect(m.prices!.input).toBe(3);
    expect(m.allowances!.go).toBe(15);
    expect(m.aaSlug).toBe('kimi-k3');
    expect(m.aaName).toBe('Kimi K3 (Max)');
    expect(m.scores.artificial_analysis_intelligence_index).toBe(47);
  });

  it('keeps unpriced models with null prices', () => {
    const m = buildDataset(roster, pricing, snapshot).models.find((x) => x.goId === 'glm-5.1')!;
    expect(m.prices).toBeNull();
    expect(m.allowances).toBeNull();
    expect(m.priceRow).toBeNull();
    expect(m.tier).toBe('unpriced');
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
    expect(buildDataset(roster, pricing, snapshot).models).toHaveLength(38);
  });

  it('produces an empty-scores dataset when AA data is absent', () => {
    const ds = buildDataset(roster, pricing, null);
    expect(ds.aaFetchedAt).toBeNull();
    expect(ds.intelligenceIndexVersion).toBeNull();
    expect(ds.models.every((m) => Object.keys(m.scores).length === 0)).toBe(true);
  });

  it('is deterministic apart from generatedAt', () => {
    const a = buildDataset(roster, pricing, snapshot);
    const b = buildDataset(roster, pricing, snapshot);
    expect({ ...a, generatedAt: '' }).toEqual({ ...b, generatedAt: '' });
  });
});
