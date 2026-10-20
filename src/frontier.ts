import { effectivePrice } from './compute';
import type { DatasetModel, EffortSelection, IndexKey, Mix, Plan } from './types';

export type Bucket = 'plotted' | 'free' | 'unpriced' | 'incomplete' | 'unscored';

/** The minimum a Pareto calculation needs. */
export interface CostScorePoint {
  id: string;
  cost: number;
  score: number;
}

/** A chartable point, carrying the model and effort rung it came from. */
export interface FrontierInput extends CostScorePoint {
  modelId: string;
  aaSlug: string;
  effort: string;
  order: number;
  isDefault: boolean;
}

interface VisibleVariant {
  aaSlug: string;
  effort: string;
  order: number;
  scores: DatasetModel['scores'];
}

function defaultSlug(model: DatasetModel): string {
  return model.defaultVariant ?? model.aaSlug ?? model.goId;
}

/**
 * The configurations the chart should draw for one model.
 *
 * `default` is the primary rung used by the table and the default chart. `all`
 * exposes the whole ladder. A model with no attached variants falls back to its
 * primary score map, so a snapshot without effort data still plots.
 */
export function visibleVariants(model: DatasetModel, selection: EffortSelection): VisibleVariant[] {
  if (model.variants.length === 0) {
    return [{ aaSlug: defaultSlug(model), effort: 'Default', order: 0, scores: model.scores }];
  }
  if (selection === 'all') return model.variants;

  const wanted = defaultSlug(model);
  const primary =
    model.variants.find((variant) => variant.aaSlug === wanted) ??
    model.variants[model.variants.length - 1];
  return [primary];
}

/**
 * Non-dominated set: no other point is cheaper-or-equal and better-or-equal.
 * Equal costs keep only the best score. Returned cheapest first.
 */
export function paretoFrontier(points: CostScorePoint[]): string[] {
  const ordered = [...points].sort((a, b) => a.cost - b.cost || b.score - a.score);
  const frontier: string[] = [];
  let best = Number.NEGATIVE_INFINITY;

  for (const point of ordered) {
    if (point.score > best) {
      frontier.push(point.id);
      best = point.score;
    }
  }
  return frontier;
}

/**
 * Split every model into exactly one bucket and return the plottable points.
 *
 * Precedence: free -> unpriced -> incomplete -> unscored -> plotted. A model
 * lands in the first bucket that applies, so a free model that also lacks a
 * score is reported as free rather than disappearing.
 *
 * Every rung of a ladder shares the model's price: effort changes the score,
 * not the published per-token rate. When `all` is requested the points tie on
 * cost, and `paretoFrontier` keeps only the best rung at that price.
 */
export function toFrontierInputs(
  models: DatasetModel[],
  plan: Plan,
  index: IndexKey,
  mix: Mix,
  planPrice: number,
  efforts: EffortSelection = 'default',
): { inputs: FrontierInput[]; buckets: Record<string, Bucket> } {
  const inputs: FrontierInput[] = [];
  const buckets: Record<string, Bucket> = {};

  for (const model of models) {
    const allowance = model.allowances ? model.allowances[plan] : null;

    if (allowance === 'unlimited') {
      buckets[model.goId] = 'free';
      continue;
    }
    if (allowance === null || model.prices === null) {
      buckets[model.goId] = 'unpriced';
      continue;
    }

    const cost = effectivePrice(model.prices, allowance, planPrice, mix);
    if (cost === null || !Number.isFinite(cost) || cost <= 0) {
      buckets[model.goId] = 'incomplete';
      continue;
    }

    const primarySlug = defaultSlug(model);
    let scored = 0;

    for (const variant of visibleVariants(model, efforts)) {
      const score = variant.scores[index];
      if (score === null || score === undefined || !Number.isFinite(score)) continue;

      scored += 1;
      inputs.push({
        id: `${model.goId}::${variant.aaSlug}`,
        modelId: model.goId,
        aaSlug: variant.aaSlug,
        effort: variant.effort,
        order: variant.order,
        isDefault: variant.aaSlug === primarySlug,
        cost,
        score,
      });
    }

    buckets[model.goId] = scored > 0 ? 'plotted' : 'unscored';
  }

  return { inputs, buckets };
}

/** Convenience wrapper: buckets plus the frontier id set for one plan/index. */
export function computeFrontier(
  models: DatasetModel[],
  plan: Plan,
  index: IndexKey,
  mix: Mix,
  planPrice: number,
  efforts: EffortSelection = 'default',
): { inputs: FrontierInput[]; buckets: Record<string, Bucket>; frontier: string[] } {
  const { inputs, buckets } = toFrontierInputs(models, plan, index, mix, planPrice, efforts);
  return { inputs, buckets, frontier: paretoFrontier(inputs) };
}

/**
 * Points close enough to the frontier to be worth considering.
 *
 * A strict frontier is the truth, but when one subsidised model dominates
 * everything it collapses to a couple of points and stops answering "what is
 * good value at the performance I need". A point is near when its score is
 * within `tolerance` of the best score available at its price or cheaper.
 *
 * The tolerance is deliberately caller-supplied and shown in the UI: a band
 * that cannot be seen is a band that flatters bad-value models.
 */
export function nearFrontier(
  points: CostScorePoint[],
  frontierIds: string[],
  tolerance: number,
): Set<string> {
  const byId = new Map(points.map((point) => [point.id, point]));
  const frontier = frontierIds
    .map((id) => byId.get(id))
    .filter((point): point is CostScorePoint => point !== undefined)
    .sort((a, b) => a.cost - b.cost);

  const near = new Set(frontierIds);
  for (const point of points) {
    let bestAtPrice = Number.NEGATIVE_INFINITY;
    for (const candidate of frontier) {
      if (candidate.cost <= point.cost) bestAtPrice = Math.max(bestAtPrice, candidate.score);
    }
    if (bestAtPrice === Number.NEGATIVE_INFINITY) continue;
    if (point.score >= bestAtPrice - Math.max(tolerance, 0)) near.add(point.id);
  }
  return near;
}
