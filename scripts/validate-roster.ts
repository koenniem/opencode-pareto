import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { RosterEntry } from '../src/types';
import type { GoPricing } from './scrape-go';

const GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models';

/**
 * Errors that must stop the build.
 *
 * These are the roster authoring mistakes that would put a wrong number on the
 * chart: a duplicate id, a tier that contradicts its own priceRow, or an AA
 * slug that does not exist. The AA slug list may be empty — the site has to
 * build before the API key exists.
 */
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
      errors.push(`aaSlug not in the AA snapshot: ${entry.goId} -> ${entry.aaSlug}`);
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
export function rosterWarnings(
  roster: RosterEntry[],
  goIds: string[],
  pricing: GoPricing,
): string[] {
  const warnings: string[] = [];
  const goIdSet = new Set(goIds);
  const seen = new Set(roster.map((entry) => entry.goId));

  for (const goId of goIds) {
    if (!seen.has(goId)) {
      warnings.push(`Go serves a model with no roster entry, excluding it: ${goId}`);
    }
  }

  for (const entry of roster) {
    if (!goIdSet.has(entry.goId)) {
      warnings.push(`roster entry no longer served by Go, ignoring it: ${entry.goId}`);
    }
    if (
      entry.tier !== 'unpriced' &&
      entry.priceRow !== null &&
      !(entry.priceRow in pricing.rows)
    ) {
      warnings.push(
        `pricing row vanished, showing as unpriced: ${entry.goId} -> ${entry.priceRow}`,
      );
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

async function fetchGoIds(): Promise<string[]> {
  const response = await fetch(GO_MODELS_URL);
  if (!response.ok) throw new Error(`Go models endpoint failed: ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id: string }> };
  if (!body.data) throw new Error('Go models endpoint returned no data array');
  return body.data.map((m) => m.id);
}

async function main(): Promise<void> {
  const roster = loadRoster();
  const pricing = loadPricing();
  const goIds = await fetchGoIds();

  for (const warning of rosterWarnings(roster, goIds, pricing)) {
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
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
