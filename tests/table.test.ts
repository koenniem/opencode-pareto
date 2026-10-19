import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderTableHtml } from '../src/table';
import { DEFAULT_MIX } from '../src/compute';
import type { Dataset, IndexKey } from '../src/types';

const dataset = JSON.parse(
  readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'),
) as Dataset;

const OPTS = {
  plan: 'go' as const,
  index: 'artificial_analysis_intelligence_index' as IndexKey,
  mix: DEFAULT_MIX,
};

describe('renderTableHtml', () => {
  it('renders one header row plus one row per model', () => {
    const rows = renderTableHtml(dataset, OPTS).match(/<tr/g) ?? [];
    expect(rows).toHaveLength(1 + dataset.models.length);
  });

  it('lists every model, including the unpriced ones', () => {
    const html = renderTableHtml(dataset, OPTS);
    expect(html).toContain('GLM-5.2');
    expect(html).toContain('GLM-5.1');
  });

  it('marks unpriced models instead of rendering a zero', () => {
    const html = renderTableHtml(dataset, OPTS);
    expect(html).toContain('no published price');
    expect(html).not.toMatch(/<td>\$0\.0000<\/td>/);
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

  it('shows the multiplier for a priced model', () => {
    expect(renderTableHtml(dataset, OPTS)).toMatch(/6\.0×|6×/);
  });
});
