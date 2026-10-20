/** Subscription plans offered by OpenCode Go. */
export type Plan = 'go' | 'go-plus';

/** The Artificial Analysis index fields exposed by the Free tier. */
export type IndexKey =
  | 'artificial_analysis_intelligence_index'
  | 'artificial_analysis_coding_index'
  | 'artificial_analysis_agentic_index'
  | 'artificial_analysis_finance_and_accounting_index'
  | 'artificial_analysis_strategy_and_ops_index'
  | 'artificial_analysis_legal_index'
  | 'artificial_analysis_healthcare_and_medical_index'
  | 'artificial_analysis_engineering_index'
  | 'artificial_analysis_economics_index';

export const INDEX_KEYS: readonly IndexKey[] = [
  'artificial_analysis_intelligence_index',
  'artificial_analysis_coding_index',
  'artificial_analysis_agentic_index',
  'artificial_analysis_finance_and_accounting_index',
  'artificial_analysis_strategy_and_ops_index',
  'artificial_analysis_legal_index',
  'artificial_analysis_healthcare_and_medical_index',
  'artificial_analysis_engineering_index',
  'artificial_analysis_economics_index',
] as const;

/** Relative token weights. Components are not required to sum to 1. */
export interface Mix {
  input: number;
  cached: number;
  output: number;
  cacheWrite: number;
}

/** Per-1M-token prices. `null` means the provider publishes no such price. */
export interface Prices {
  input: number;
  output: number;
  cachedRead: number | null;
  cachedWrite: number | null;
}

/** `unlimited` is a free model; `null` means no published price. */
export type Allowance = number | 'unlimited' | null;

export interface Allowances {
  go: Allowance;
  'go-plus': Allowance;
}

/** Pricing completeness of a Go model. */
export type RosterTier = 'standard' | 'free' | 'unpriced' | 'incomplete';

/** Which thinking modes the chart may draw. */
export type EffortSelection = 'default' | 'all';

/**
 * One rung of a model's hand-reviewed effort ladder.
 *
 * Artificial Analysis publishes effort levels as separate models with their
 * own slugs and scores. The roster names the rungs it wants, lowest thinking
 * first; nothing is inferred from the trailing parenthesis.
 */
export interface RosterEffort {
  aaSlug: string;
  label: string;
}

/**
 * A hand-reviewed row mapping one Go model to its Artificial Analysis
 * counterpart. This file is the only place the two vocabularies meet.
 */
export interface RosterEntry {
  goId: string;
  display: string;
  aaSlug: string | null;
  aaVariant: string | null;
  tier: RosterTier;
  /** Exact display name of the row in `data/go-pricing.json`, or null. */
  priceRow: string | null;
  /**
   * Optional ladder of AA configurations, lowest thinking first. When absent
   * the default configuration is the only variant. The default `aaSlug` must
   * appear here, so the primary point is always part of its own ladder.
   */
  efforts?: RosterEffort[];
  notes?: string;
}

/** One scored Artificial Analysis configuration of a Go model. */
export interface ModelVariant {
  aaSlug: string;
  aaName: string;
  /** Human label from the roster, e.g. "Low", "Max", "Non-reasoning". */
  effort: string;
  /** Position in the roster ladder; 0 is the least thinking. */
  order: number;
  scores: Partial<Record<IndexKey, number | null>>;
}

export interface DatasetModel {
  goId: string;
  display: string;
  /** Lab that built the model, for chart colour. */
  lab: string;
  aaSlug: string | null;
  aaName: string | null;
  tier: RosterTier;
  priceRow: string | null;
  promoLabel: string | null;
  prices: Prices | null;
  allowances: Allowances | null;
  /** Scores of the default configuration. Kept as the primary view. */
  scores: Partial<Record<IndexKey, number | null>>;
  /**
   * Every scored configuration the roster names, lowest thinking first. Empty
   * when Artificial Analysis has no counterpart. `scores` is always the
   * `defaultVariant` rung.
   */
  variants: ModelVariant[];
  /** AA slug of the primary configuration, or null. */
  defaultVariant: string | null;
}

export interface Dataset {
  generatedAt: string;
  aaFetchedAt: string | null;
  intelligenceIndexVersion: string | null;
  plans: Record<Plan, { label: string; price: number }>;
  models: DatasetModel[];
}
