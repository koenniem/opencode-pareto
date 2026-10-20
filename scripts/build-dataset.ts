import { readFileSync, writeFileSync } from 'node:fs';
import type { AAModel, AASnapshot } from './fetch-aa';
import type { GoPricing } from './scrape-go';
import { loadAASlugs, loadPricing, loadRoster, validateRoster } from './validate-roster';
import type { Dataset, DatasetModel, ModelVariant, RosterEntry, IndexKey } from '../src/types';
import { labOf } from '../src/labs';

const PLAN_PRICES = { go: 10, 'go-plus': 40 } as const;

function copyScores(aa: AAModel | undefined): Partial<Record<IndexKey, number | null>> {
  const scores: Partial<Record<IndexKey, number | null>> = {};
  if (!aa) return scores;
  for (const [key, value] of Object.entries(aa.scores)) scores[key as IndexKey] = value;
  return scores;
}

/**
 * Resolve the roster's effort ladder against the AA snapshot.
 *
 * A rung AA did not return is skipped rather than invented; validation runs
 * first in the build and reports the missing slug. If the roster forgot its
 * own default rung, append it so the primary point is never lost.
 */
function buildVariants(
  entry: RosterEntry,
  aa: AAModel | undefined,
  bySlug: Map<string, AAModel>,
): ModelVariant[] {
  if (!aa) return [];

  const variants: ModelVariant[] = [];
  const seen = new Set<string>();

  for (const rung of entry.efforts ?? []) {
    const found = bySlug.get(rung.aaSlug);
    if (!found || seen.has(found.slug)) continue;
    seen.add(found.slug);
    variants.push({
      aaSlug: found.slug,
      aaName: found.name,
      effort: rung.label,
      order: variants.length,
      scores: copyScores(found),
    });
  }

  if (!seen.has(aa.slug)) {
    variants.push({
      aaSlug: aa.slug,
      aaName: aa.name,
      effort: entry.aaVariant ?? aa.variant ?? 'Default',
      order: variants.length,
      scores: copyScores(aa),
    });
  }

  return variants;
}

/**
 * Join the roster, the Go pricing table and the AA snapshot into the single
 * file the site reads.
 *
 * `snapshot` may be null: the site must build before the API key exists. When
 * it is, every model carries empty scores and lands in the `unscored` bucket
 * at render time, which is honest — better than inventing measurements.
 */
export function buildDataset(
  roster: RosterEntry[],
  pricing: GoPricing,
  snapshot: AASnapshot | null,
): Dataset {
  const bySlug = new Map((snapshot?.models ?? []).map((m) => [m.slug, m]));

  const models: DatasetModel[] = roster.map((entry) => {
    const priceRow = entry.priceRow ? pricing.rows[entry.priceRow] : undefined;
    const aa = entry.aaSlug ? bySlug.get(entry.aaSlug) : undefined;

    // The roster names the AA configuration it means ("Max", "0902", …). If AA
    // scores a different one, the score is not the one we claim to plot, so the
    // build stops rather than silently attaching the wrong number.
    if (aa && entry.aaVariant !== null) {
      const declared = entry.aaVariant.trim().toLowerCase();
      const actual = (aa.variant ?? '').trim().toLowerCase();
      if (declared !== actual) {
        throw new Error(
          `Variant mismatch for ${entry.display} (${entry.goId}): roster declares "${entry.aaVariant}", ` +
            `Artificial Analysis returned ${aa.variant === null ? 'no variant' : `"${aa.variant}"`}. ` +
            `Update data/roster.yaml.`,
        );
      }
    }

    const scores = copyScores(aa);
    const variants = buildVariants(entry, aa, bySlug);

    return {
      goId: entry.goId,
      display: entry.display,
      lab: labOf(entry.goId),
      aaSlug: entry.aaSlug,
      aaName: aa?.name ?? null,
      tier: entry.tier,
      priceRow: entry.priceRow,
      promoLabel: priceRow?.promo?.label ?? null,
      prices:
        priceRow && entry.tier !== 'unpriced'
          ? {
              input: priceRow.input,
              output: priceRow.output,
              cachedRead: priceRow.cachedRead,
              cachedWrite: priceRow.cachedWrite,
            }
          : null,
      allowances: priceRow && entry.tier !== 'unpriced' ? { ...priceRow.allowance } : null,
      scores,
      variants,
      defaultVariant: aa?.slug ?? null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    aaFetchedAt: snapshot?.fetchedAt ?? null,
    intelligenceIndexVersion: snapshot?.intelligenceIndexVersion ?? null,
    plans: {
      go: { label: 'Go', price: PLAN_PRICES.go },
      'go-plus': { label: 'Go Plus', price: PLAN_PRICES['go-plus'] },
    },
    models,
  };
}

function main(): void {
  const roster = loadRoster();
  const pricing = loadPricing();

  const problems = validateRoster(roster, loadAASlugs());
  if (problems.length > 0) {
    console.error('Refusing to build with an inconsistent roster:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  let snapshot: AASnapshot | null = null;
  try {
    snapshot = JSON.parse(readFileSync('data/aa-snapshot.json', 'utf8')) as AASnapshot;
  } catch {
    console.warn('No data/aa-snapshot.json — building without scores.');
  }

  const dataset = buildDataset(roster, pricing, snapshot);
  writeFileSync('data/dataset.json', `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Wrote ${dataset.models.length} models to data/dataset.json`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('build-dataset.ts')) {
  main();
}
