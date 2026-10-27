import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffPricing, implausibleDrift, parseGoDocs } from '../scripts/scrape-go';

const html = readFileSync(new URL('./fixtures/go-docs.html', import.meta.url), 'utf8');

describe('parseGoDocs', () => {
  it('parses 36 priced rows covering 29 distinct models', () => {
    const { rows } = parseGoDocs(html);
    expect(Object.keys(rows)).toHaveLength(36);
    const distinct = new Set(Object.keys(rows).map((n) => n.replace(/\s*\([^)]*\)$/, '')));
    expect(distinct.size).toBe(29);
  });

  it('parses token prices for GLM-5.2', () => {
    const row = parseGoDocs(html).rows['GLM-5.2'];
    expect(row.input).toBe(1.4);
    expect(row.output).toBe(4.4);
    expect(row.cachedRead).toBe(0.26);
    expect(row.cachedWrite).toBeNull();
    expect(row.allowance.go).toBe(60);
    expect(row.allowance['go-plus']).toBe(180);
  });

  it('reads the plan allowances from their own tables', () => {
    const rows = parseGoDocs(html).rows;
    expect(rows['Kimi K3'].allowance.go).toBe(15);
    expect(rows['Kimi K3'].allowance['go-plus']).toBe(60);
  });

  it('reads the live value of a promotional allowance, not the struck-through one', () => {
    const row = parseGoDocs(html).rows['Step 5 Preview'];
    expect(row.allowance.go).toBe(60);
    expect(row.promo?.baseAllowance.go).toBe(15);
  });

  it('marks unlimited-allowance models', () => {
    const row = parseGoDocs(html).rows['LongCat 2.5 Preview Free'];
    expect(row.allowance.go).toBe('unlimited');
    expect(row.input).toBe(0);
  });

  it('decodes the context-tier names', () => {
    const rows = parseGoDocs(html).rows;
    expect(rows['Qwen3.7 Plus (≤ 256K tokens)']).toBeDefined();
    expect(rows['Qwen3.7 Plus (> 256K tokens)']).toBeDefined();
    expect(rows['Grok 4.7 (≤ 200K tokens)']).toBeDefined();
  });

  it('throws rather than returning a partial table', () => {
    expect(() => parseGoDocs('<html><body>nope</body></html>')).toThrow();
  });

  it('reports no differences against itself', () => {
    const p = parseGoDocs(html);
    expect(diffPricing(p, p)).toEqual([]);
  });

  it('reports a changed allowance', () => {
    const p = parseGoDocs(html);
    const q = structuredClone(p);
    (q.rows['Kimi K3'].allowance as { go: number }).go = 99;
    expect(diffPricing(p, q)).toContainEqual(expect.stringContaining('Kimi K3'));
  });

  it('reports a model that appeared', () => {
    const p = parseGoDocs(html);
    const q = structuredClone(p);
    q.rows['Brand New Model'] = structuredClone(q.rows['Kimi K3']);
    expect(diffPricing(p, q)).toContainEqual(expect.stringContaining('Brand New Model'));
  });

  it('reports a model that disappeared', () => {
    const p = parseGoDocs(html);
    const q = structuredClone(p);
    delete q.rows['Kimi K3'];
    expect(diffPricing(p, q)).toContainEqual(expect.stringContaining('Kimi K3'));
  });
});

describe('implausibleDrift', () => {
  const committed = parseGoDocs(html);

  it('allows ordinary churn: a model added, one dropped, a price changed', () => {
    const scraped = structuredClone(committed);
    delete scraped.rows['Kimi K3'];
    scraped.rows['Brand New Model'] = structuredClone(scraped.rows['GLM-5.2']);
    scraped.rows['GLM-5.2'].input = 2.1;
    expect(implausibleDrift(committed, scraped)).toEqual([]);
  });

  it('refuses a scrape that lost a quarter of the table', () => {
    const scraped = structuredClone(committed);
    for (const name of Object.keys(scraped.rows).slice(0, 12)) delete scraped.rows[name];
    expect(implausibleDrift(committed, scraped)).toHaveLength(1);
    expect(implausibleDrift(committed, scraped)[0]).toContain('12 of 36');
  });

  it('has nothing to compare against without a committed file', () => {
    expect(implausibleDrift(null, committed)).toEqual([]);
  });
});
