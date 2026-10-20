import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderTableHtml } from '../src/table';
import type { Dataset, IndexKey } from '../src/types';

const dataset = JSON.parse(
  readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'),
) as Dataset;

const OPTS = {
  plan: 'go' as const,
  index: 'artificial_analysis_intelligence_index' as IndexKey,
};

const IDX = OPTS.index;

const costedDataset: Dataset = {
  generatedAt: '2026-10-20T00:00:00.000Z',
  aaFetchedAt: '2026-10-20T00:00:00.000Z',
  intelligenceIndexVersion: '4.3',
  plans: {
    go: { label: 'Go', price: 10 },
    'go-plus': { label: 'Go Plus', price: 40 },
  },
  models: [
    {
      goId: 'costed',
      display: 'Costed',
      lab: 'other',
      aaSlug: 'costed',
      aaName: 'Costed (Max)',
      tier: 'standard',
      priceRow: 'Costed',
      promoLabel: null,
      prices: { input: 1, output: 4, cachedRead: 0.1, cachedWrite: null },
      allowances: { go: 60, 'go-plus': 180 },
      scores: { [IDX]: 50 },
      listCostPerTask: 2,
      costPerTask: 1,
      variants: [
        {
          aaSlug: 'costed',
          aaName: 'Costed (Max)',
          effort: 'Max',
          order: 0,
          scores: { [IDX]: 50 },
          listCostPerTask: 2,
          costPerTask: 1,
          priceFactor: 0.5,
          priceFactorApproximate: false,
        },
      ],
      defaultVariant: 'costed',
    },
  ],
};

describe('renderTableHtml', () => {
  it('renders one header row plus one row per model', () => {
    const rows = renderTableHtml(dataset, OPTS).match(/<tr/g) ?? [];
    expect(rows).toHaveLength(1 + dataset.models.length);
  });

  it('lists every model in the roster', () => {
    const html = renderTableHtml(dataset, OPTS);
    expect(html).toContain('GLM-5.2');
    expect(html).toContain('Kimi K3');
  });

  it('uses the cost-per-task columns instead of blended token prices', () => {
    const html = renderTableHtml(costedDataset, OPTS);
    expect(html).toContain('Usage ×');
    expect(html).toContain('AA $/task');
    expect(html).toContain('Go $/task');
    expect(html).not.toContain('List $/1M');
    expect(html).not.toContain('Effective $/1M');
  });

  it("shows AA's cost, the Go-plan cost and the usage multiplier", () => {
    const html = renderTableHtml(costedDataset, OPTS);
    expect(html).toContain('<td>6.0×</td><td>$2.00</td><td>$0.167</td>');
    expect(html).toContain('price-adjusted');
  });

  it('marks a non-proportional price conversion as an estimate', () => {
    const estimated: Dataset = structuredClone(costedDataset);
    estimated.models[0].variants[0].priceFactorApproximate = true;
    expect(renderTableHtml(estimated, OPTS)).toContain('price estimate');
  });

  it('says when AA has no cost for the primary configuration', () => {
    const noCost: Dataset = structuredClone(costedDataset);
    noCost.models[0].listCostPerTask = null;
    noCost.models[0].costPerTask = null;
    noCost.models[0].variants = [];
    const html = renderTableHtml(noCost, OPTS);
    expect(html).toContain('no AA cost');
  });

  it('never renders a missing cost as a zero price', () => {
    expect(renderTableHtml(dataset, OPTS)).not.toMatch(/<td>\$0\.0000<\/td>/);
  });

  it('marks free models as free rather than as a price', () => {
    expect(renderTableHtml(dataset, OPTS)).toContain('free');
  });

  it('says when a model has no score for the selected index', () => {
    expect(renderTableHtml(dataset, OPTS)).toContain('not scored');
  });

  it('escapes HTML in text it interpolates', () => {
    const hostile: Dataset = structuredClone(dataset);
    hostile.models[0].display = '<script>alert(1)</script>';
    const html = renderTableHtml(hostile, OPTS);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never emits NaN or Infinity', () => {
    const html = renderTableHtml(dataset, OPTS);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('shows the usage multiplier for a priced model', () => {
    expect(renderTableHtml(dataset, OPTS)).toMatch(/6\.0×|6×/);
  });
});

describe('effort column', () => {
  it('shows the primary configuration label for a model with a ladder', () => {
    expect(renderTableHtml(dataset, OPTS)).toMatch(
      /<th scope="row">Kimi K3<\/th><td>Max<\/td>/,
    );
  });

  it('hides the generic Default label for single-configuration models', () => {
    expect(renderTableHtml(dataset, OPTS)).toMatch(
      /<th scope="row">GLM-5.3-Flash<\/th><td>—<\/td>/,
    );
  });

  it('shows a dash when Artificial Analysis has no counterpart', () => {
    expect(renderTableHtml(dataset, OPTS)).toMatch(
      /<th scope="row">Qwen3.8 Flash<\/th><td>—<\/td>/,
    );
  });
});
