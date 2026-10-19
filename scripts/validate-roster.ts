import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { RosterEntry } from '../src/types';
import type { GoPricing } from './scrape-go';

const GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models';

/**
 * Every problem with the roster, in the order found. An empty array is clean.
 *
 * The roster is the only place Go's vocabulary and Artificial Analysis's meet,
 * so a mismatch is always a human decision, never something to paper over. The
 * AA slug list is allowed to be empty: the site must build before the API key
 * exists, and the first CI run after the key is added is the real gate.
 */
export function validateRoster(
  roster: RosterEntry[],
  goIds: string[],
  pricing: GoPricing,
  aaSlugs: string[],
): string[] {
  const problems: string[] = [];
  const goIdSet = new Set(goIds);
  const aaSlugSet = new Set(aaSlugs);
  const seen = new Set<string>();

  for (const entry of roster) {
    if (seen.has(entry.goId)) problems.push(`duplicate roster entry: ${entry.goId}`);
    seen.add(entry.goId);
  }

  for (const goId of goIds) {
    if (!seen.has(goId)) problems.push(`Go model has no roster entry: ${goId}`);
  }

  for (const entry of roster) {
    if (!goIdSet.has(entry.goId)) {
      problems.push(`roster entry no longer served by Go: ${entry.goId}`);
    }

    if (entry.tier === 'unpriced') {
      if (entry.priceRow !== null) {
        problems.push(`unpriced entry must have priceRow: null: ${entry.goId} -> ${entry.priceRow}`);
      }
      if (entry.aaSlug !== null && aaSlugSet.size > 0) {
        problems.push(`unpriced entry should not claim an AA model: ${entry.goId}`);
      }
      continue;
    }

    if (entry.priceRow === null) {
      problems.push(`entry needs a priceRow: ${entry.goId}`);
    } else if (!(entry.priceRow in pricing.rows)) {
      problems.push(`priceRow not in go-pricing.json: ${entry.goId} -> ${entry.priceRow}`);
    }

    if (entry.aaSlug !== null && aaSlugSet.size > 0 && !aaSlugSet.has(entry.aaSlug)) {
      problems.push(`aaSlug not in the AA snapshot: ${entry.goId} -> ${entry.aaSlug}`);
    }
    if (entry.aaSlug === '' ) {
      problems.push(`aaSlug must be null rather than empty: ${entry.goId}`);
    }
  }

  return problems;
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

async function fetchGoIds(): Promise<string[]> {
  const response = await fetch(GO_MODELS_URL);
  if (!response.ok) throw new Error(`Go models endpoint failed: ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id: string }> };
  if (!body.data) throw new Error('Go models endpoint returned no data array');
  return body.data.map((m) => m.id);
}

async function main(): Promise<void> {
  const problems = validateRoster(
    loadRoster(),
    await fetchGoIds(),
    loadPricing(),
    loadAASlugs(),
  );

  if (problems.length === 0) {
    console.log('Roster is consistent.');
    return;
  }
  console.error(`Roster has ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('validate-roster.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
