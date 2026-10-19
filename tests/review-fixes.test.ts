/**
 * Regression tests for the findings raised in the adversarial review.
 *
 * One test per Important finding, written before the fix, so the fix has a
 * proof that the finding was real and is now gone.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MIX, blendedPrice, effectivePrice } from '../src/compute';
import { buildDataset } from '../scripts/build-dataset';
import { parseAAResponse, type AASnapshot } from '../scripts/fetch-aa';
import { parseGoDocs, type GoPricing } from '../scripts/scrape-go';
import type { Prices, RosterEntry } from '../src/types';

const roster = parseYaml(
  readFileSync(new URL('../data/roster.yaml', import.meta.url), 'utf8'),
) as RosterEntry[];
const pricing = JSON.parse(
  readFileSync(new URL('../data/go-pricing.json', import.meta.url), 'utf8'),
) as GoPricing;
const docsHtml = readFileSync(new URL('./fixtures/go-docs.html', import.meta.url), 'utf8');

// --- Finding 1: AA variant selection is ignored -----------------------------

describe('AA variant selection', () => {
  const snapshot: AASnapshot = {
    fetchedAt: '2026-10-19T00:00:00.000Z',
    intelligenceIndexVersion: '4.3',
    models: [
      {
        slug: 'kimi-k3',
        name: 'Kimi K3 (High)',
        variant: 'High',
        scores: { artificial_analysis_intelligence_index: 40 },
      },
    ],
  };

  it('fails when AA scores a different variant than the roster declares', () => {
    // The roster says Kimi K3 is scored as Max.
    expect(() => buildDataset(roster, pricing, snapshot)).toThrow(/Kimi K3|kimi-k3/);
  });

  it('accepts a matching variant regardless of case', () => {
    const matching: AASnapshot = {
      ...snapshot,
      models: [{ ...snapshot.models[0], name: 'Kimi K3 (MAX)', variant: 'MAX' }],
    };
    expect(() => buildDataset(roster, pricing, matching)).not.toThrow();
  });

  it('does not constrain entries that declare no variant', () => {
    const noVariant = roster.map((r) =>
      r.goId === 'kimi-k3' ? { ...r, aaVariant: null } : r,
    );
    expect(() => buildDataset(noVariant, pricing, snapshot)).not.toThrow();
  });

  it('parses the variant suffix out of the AA display name', () => {
    const parsed = parseAAResponse({
      data: [
        { slug: 'x', name: 'Model X (Max)', evaluations: {} },
        { slug: 'y', name: 'Model Y', evaluations: {} },
      ],
    });
    expect(parsed.models[0].variant).toBe('Max');
    expect(parsed.models[1].variant).toBeNull();
  });
});

// --- Finding 2: an all-zero mix prices models at zero -----------------------

describe('all-zero mix', () => {
  const zero = { input: 0, cached: 0, output: 0, cacheWrite: 0 };
  const prices: Prices = { input: 1.4, output: 4.4, cachedRead: 0.26, cachedWrite: null };

  it('refuses to price rather than returning zero', () => {
    expect(blendedPrice(prices, zero)).toBeNull();
  });

  it('propagates the refusal to the effective price', () => {
    expect(effectivePrice(prices, 60, 10, zero)).toBeNull();
  });
});

// --- Finding 3: empty or malformed AA data silently erases scores -----------

describe('AA snapshot integrity', () => {
  it('rejects an empty model list rather than writing a scoreless snapshot', () => {
    expect(() =>
      parseAAResponse({ data: [], pagination: { has_more: false } }),
    ).toThrow(/empty|no models/i);
  });

  it('still accepts a genuinely populated response', () => {
    const parsed = parseAAResponse({
      data: [{ slug: 'x', name: 'X', evaluations: {} }],
    });
    expect(parsed.models).toHaveLength(1);
  });
});

// --- Finding 4: unreadable required prices become zero ----------------------

describe('unreadable required prices', () => {
  it('throws instead of treating an unparseable input price as free', () => {
    const broken = docsHtml.replace('<td>GLM-5.3</td><td>$1.40</td>', '<td>GLM-5.3</td><td>n/a</td>');
    expect(broken).not.toBe(docsHtml);
    expect(() => parseGoDocs(broken)).toThrow(/GLM-5.3|price/i);
  });

  it('still accepts the literal Free as zero', () => {
    expect(parseGoDocs(docsHtml).rows['Beam Free'].input).toBe(0);
  });
});

// --- Finding 9: the displayed default mix is not the mix used --------------

describe('default mix display', () => {
  it('states a percentage that matches the constant used for pricing', () => {
    expect(DEFAULT_MIX.cached).toBeCloseTo(0.985, 6);
    expect((DEFAULT_MIX.cached * 100).toFixed(2)).toBe('98.50');
  });
});
