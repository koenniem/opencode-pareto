import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { RosterEntry } from '../src/types';
import type { GoPricing } from './scrape-go';

/**
 * Errors that must stop the build.
 *
 * These are the roster authoring mistakes that would put a wrong number on the
 * chart: a duplicate id, a tier that contradicts its own priceRow, or an AA
 * slug that does not exist. The AA slug list may be empty — the site has to
 * build before the API key exists.
 */
/**
 * Closest AA slugs to `target`, best first.
 *
 * When a guessed slug is wrong, the useful output is the right one, not just
 * a rejection — the person fixing the roster may not have the AA list in front
 * of them.
 */
export function suggestSlugs(target: string, candidates: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = norm(target);

  const scored = candidates.map((slug) => {
    const hay = norm(slug);
    if (hay === needle) return { slug, score: 1000 };

    let prefix = 0;
    while (prefix < hay.length && prefix < needle.length && hay[prefix] === needle[prefix]) {
      prefix += 1;
    }
    const contains = hay.includes(needle) || needle.includes(hay) ? 100 : 0;
    return { slug, score: prefix + contains };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.slug);
}

export function validateRoster(roster: RosterEntry[], aaSlugs: string[]): string[] {
  const errors: string[] = [];
  const aaSlugSet = new Set(aaSlugs);
  const seen = new Set<string>();

  for (const entry of roster) {
    if (seen.has(entry.goId)) errors.push(`duplicate roster entry: ${entry.goId}`);
    seen.add(entry.goId);
  }

  for (const entry of roster) {
    if (entry.tier === 'unpriced') {
      if (entry.priceRow !== null) {
        errors.push(`unpriced entry must have priceRow: null: ${entry.goId} -> ${entry.priceRow}`);
      }
      if (entry.aaSlug !== null && aaSlugSet.size > 0) {
        errors.push(`unpriced entry should not claim an AA model: ${entry.goId}`);
      }
      continue;
    }

    if (entry.priceRow === null) {
      errors.push(`entry needs a priceRow: ${entry.goId}`);
    }

    if (entry.aaSlug === '') {
      errors.push(`aaSlug must be null rather than empty: ${entry.goId}`);
    } else if (entry.aaSlug !== null && aaSlugSet.size > 0 && !aaSlugSet.has(entry.aaSlug)) {
      const close = suggestSlugs(entry.aaSlug, aaSlugs);
      errors.push(
        `aaSlug not in the AA snapshot: ${entry.goId} -> ${entry.aaSlug}` +
          (close.length > 0 ? ` (closest: ${close.join(', ')})` : ''),
      );
    }
  }

  return errors;
}

/**
 * Roster drift, reported but never fatal.
 *
 * OpenCode adds and drops models weekly, and a model leaving the pricing table
 * is not an authoring mistake — it is a model with no published allowance,
 * which the site already knows how to render (as "unpriced"). Failing the whole
 * deploy over that would keep a stale site online, which is worse than showing
 * one fewer point.
 */
export function rosterWarnings(roster: RosterEntry[], pricing: GoPricing): string[] {
  const warnings: string[] = [];
  // Tier rows ("Qwen3.7 Plus (> 256K tokens)") are deliberately unclaimed: the
  // roster points at the cheaper tier. Treat any row sharing a base name with a
  // claimed row as accounted for.
  const base = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const claimedBases = new Set(
    roster.map((entry) => entry.priceRow).filter((row): row is string => Boolean(row)).map(base),
  );

  for (const entry of roster) {
    if (entry.priceRow !== null && !(entry.priceRow in pricing.rows)) {
      warnings.push(`pricing row vanished, showing as unpriced: ${entry.goId} -> ${entry.priceRow}`);
    }
  }

  for (const row of Object.keys(pricing.rows)) {
    if (!claimedBases.has(base(row))) {
      warnings.push(`priced model missing from the roster, not shown: ${row}`);
    }
  }

  return warnings;
}

export function loadRoster(path = 'data/roster.yaml'): RosterEntry[] {
  return parseYaml(readFileSync(path, 'utf8')) as RosterEntry[];
}

export function loadPricing(path = 'data/go-pricing.json'): GoPricing {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoPricing;
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
  }
}

export function loadAASlugs(path = 'data/aa-snapshot.json'): string[] {
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
      models?: Array<{ slug: string }>;
    };
    return (snapshot.models ?? []).map((m) => m.slug);
  } catch {
    return [];
  }
}

function main(): void {
  const roster = loadRoster();
  const pricing = loadPricing();

  for (const warning of rosterWarnings(roster, pricing)) {
    console.warn(`warning: ${warning}`);
  }

  const errors = validateRoster(roster, loadAASlugs());
  if (errors.length === 0) {
    console.log('Roster is consistent.');
    return;
  }
  console.error(`Roster has ${errors.length} error(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('validate-roster.ts')) {
  main();
}
