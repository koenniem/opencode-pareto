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
  notes?: string;
}

export interface DatasetModel {
  goId: string;
  display: string;
  aaSlug: string | null;
  aaName: string | null;
  tier: RosterTier;
  priceRow: string | null;
  promoLabel: string | null;
  prices: Prices | null;
  allowances: Allowances | null;
  scores: Partial<Record<IndexKey, number | null>>;
}

export interface Dataset {
  generatedAt: string;
  aaFetchedAt: string | null;
  intelligenceIndexVersion: string | null;
  plans: Record<Plan, { label: string; price: number }>;
  models: DatasetModel[];
}
