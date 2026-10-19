import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { rosterWarnings, suggestSlugs, validateRoster } from '../scripts/validate-roster';
import type { GoPricing } from '../scripts/scrape-go';
import type { RosterEntry } from '../src/types';

const pricing = JSON.parse(
  readFileSync(new URL('../data/go-pricing.json', import.meta.url), 'utf8'),
) as GoPricing;

function entry(goId: string, over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    goId,
    display: goId,
    aaSlug: goId,
    aaVariant: null,
    tier: 'standard',
    priceRow: 'Kimi K3',
    ...over,
  };
}

describe('validateRoster (fatal errors only)', () => {
  it('accepts a consistent roster', () => {
    expect(validateRoster([entry('kimi-k3')], ['kimi-k3'])).toEqual([]);
  });

  it('reports a duplicate go id', () => {
    expect(validateRoster([entry('kimi-k3'), entry('kimi-k3')], [])).toContainEqual(
      expect.stringContaining('duplicate'),
    );
  });

  it('reports an aaSlug absent from the AA snapshot', () => {
    expect(validateRoster([entry('kimi-k3', { aaSlug: 'nope' })], ['kimi-k3'])).toContainEqual(
      expect.stringContaining('nope'),
    );
  });

  it('reports an unpriced entry that has a priceRow', () => {
    expect(
      validateRoster([entry('kimi-k3', { tier: 'unpriced', priceRow: 'Kimi K3', aaSlug: null })], []),
    ).toContainEqual(expect.stringContaining('unpriced'));
  });

  it('reports a standard entry with no priceRow', () => {
    expect(validateRoster([entry('kimi-k3', { priceRow: null })], [])).toContainEqual(
      expect.stringContaining('priceRow'),
    );
  });

  it('tolerates an empty AA snapshot so the build works before the key exists', () => {
    expect(validateRoster([entry('kimi-k3')], [])).toEqual([]);
  });

  it('tolerates a null aaSlug', () => {
    expect(validateRoster([entry('kimi-k3', { aaSlug: null })], [])).toEqual([]);
  });
});

describe('suggestSlugs', () => {
  it('offers the real slug when the guess is wrong', () => {
    const close = suggestSlugs('glm-5-2', ['glm-5-2-max', 'glm-5-3', 'kimi-k3']);
    expect(close[0]).toBe('glm-5-2-max');
  });

  it('prefers an exact match', () => {
    expect(suggestSlugs('kimi-k3', ['kimi-k2-7-code', 'kimi-k3'])[0]).toBe('kimi-k3');
  });

  it('never throws on an empty candidate list', () => {
    expect(suggestSlugs('anything', [])).toEqual([]);
  });
});

const committedRoster = parseYaml(
  readFileSync(new URL('../data/roster.yaml', import.meta.url), 'utf8'),
) as RosterEntry[];

describe('rosterWarnings (churn, never fatal)', () => {
  it('warns about a priced model with no roster entry', () => {
    const warnings = rosterWarnings([], pricing);
    expect(warnings).toContainEqual(expect.stringContaining('GLM-5.3-Flash'));
  });

  it('warns when a pricing row vanishes, rather than failing the deploy', () => {
    const warnings = rosterWarnings([entry('kimi-k3', { priceRow: 'Nope' })], pricing);
    expect(warnings).toContainEqual(expect.stringContaining('Nope'));
  });

  it('stays quiet on a consistent roster', () => {
    expect(rosterWarnings(committedRoster, pricing)).toEqual([]);
  });
});

describe('the committed roster', () => {
  const roster = parseYaml(
    readFileSync(new URL('../data/roster.yaml', import.meta.url), 'utf8'),
  ) as RosterEntry[];

  it('covers every model in the published pricing table', () => {
    expect(roster).toHaveLength(29);
  });

  it('has no duplicates', () => {
    const ids = roster.map((r) => r.goId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every standard priceRow against the live pricing table', () => {
    for (const row of roster) {
      if (row.tier !== 'standard' && row.tier !== 'free') continue;
      expect(pricing.rows[row.priceRow!], `${row.goId} -> ${row.priceRow}`).toBeDefined();
    }
  });

  it('has no unpriced entries: unpriced means not offered on Go', () => {
    expect(roster.filter((r) => r.tier === 'unpriced')).toHaveLength(0);
  });

  it('marks exactly three models as free', () => {
    expect(roster.filter((r) => r.tier === 'free').map((r) => r.goId).sort()).toEqual([
      'beam-free',
      'longcat-2.5-preview-free',
      'minimax-m3.1-flash-free',
    ]);
  });
});
