import { effectivePrice } from './compute';
import type { DatasetModel, IndexKey, Mix, Plan } from './types';

export type Bucket = 'plotted' | 'free' | 'unpriced' | 'incomplete' | 'unscored';

export interface FrontierInput {
  id: string;
  cost: number;
  score: number;
}

/**
 * Non-dominated set: no other point is cheaper-or-equal and better-or-equal.
 * Equal costs keep only the best score. Returned cheapest first.
 */
export function paretoFrontier(points: FrontierInput[]): string[] {
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
 * Split every model into exactly one bucket and return the plottable ones.
 *
 * Precedence: free -> unpriced -> incomplete -> unscored -> plotted. A model
 * lands in the first bucket that applies, so a free model that also lacks a
 * score is reported as free rather than disappearing.
 */
export function toFrontierInputs(
  models: DatasetModel[],
  plan: Plan,
  index: IndexKey,
  mix: Mix,
  planPrice: number,
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

    const score = model.scores[index];
    if (score === null || score === undefined || !Number.isFinite(score)) {
      buckets[model.goId] = 'unscored';
      continue;
    }

    buckets[model.goId] = 'plotted';
    inputs.push({ id: model.goId, cost, score });
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
): { inputs: FrontierInput[]; buckets: Record<string, Bucket>; frontier: string[] } {
  const { inputs, buckets } = toFrontierInputs(models, plan, index, mix, planPrice);
  return { inputs, buckets, frontier: paretoFrontier(inputs) };
}
