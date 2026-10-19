import datasetJson from '../data/dataset.json';
import { DEFAULT_MIX, blendedPrice, effectivePrice, multiplier, normalizeMix } from './compute';
import { buildScene, formatPrice, type ChartPoint } from './chart';
import { computeFrontier, nearFrontier, type Bucket } from './frontier';
import { LAB_NAMES, labOf } from './labs';
import { paintScene } from './render';
import { mountTable, type SortState } from './table';
import { wireThemeToggle } from './theme';
import type { Dataset, DatasetModel, IndexKey, Mix, Plan } from './types';

// SAFETY: data/dataset.json is produced by scripts/build-dataset.ts from the
// roster, the scraped Go pricing table and the AA snapshot. Its shape is
// asserted in tests/build-dataset.test.ts; TypeScript cannot check JSON imports
// against the narrowed union types (IndexKey, Plan) used here.
const dataset = datasetJson as unknown as Dataset;

interface UiState {
  plan: Plan;
  index: IndexKey;
  mix: Mix;
  tolerance: number;
  sort: SortState | null;
}

const state: UiState = {
  plan: 'go',
  index: 'artificial_analysis_intelligence_index',
  mix: { ...DEFAULT_MIX },
  tolerance: 2,
  sort: null,
};

const INDEX_LABELS: Record<IndexKey, string> = {
  artificial_analysis_intelligence_index: 'Intelligence Index',
  artificial_analysis_coding_index: 'Coding Index',
  artificial_analysis_agentic_index: 'Agentic Index',
  artificial_analysis_finance_and_accounting_index: 'Finance & Accounting',
  artificial_analysis_strategy_and_ops_index: 'Strategy & Ops',
  artificial_analysis_legal_index: 'Legal',
  artificial_analysis_healthcare_and_medical_index: 'Healthcare & Medical',
  artificial_analysis_engineering_index: 'Engineering',
  artificial_analysis_economics_index: 'Economics',
};

function byId(id: string): DatasetModel | undefined {
  return dataset.models.find((m) => m.goId === id);
}

function scoreOf(model: DatasetModel): number | null {
  const score = model.scores[state.index];
  return score === null || score === undefined ? null : score;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderDetails(goId: string): void {
  const host = document.getElementById('details');
  const model = byId(goId);
  if (!host || !model) return;

  const planPrice = dataset.plans[state.plan].price;
  const allowance = model.allowances?.[state.plan] ?? null;
  const m = multiplier(allowance, planPrice);
  const listBlended = model.prices ? blendedPrice(model.prices, state.mix) : null;
  const effective =
    model.prices && allowance !== null
      ? effectivePrice(model.prices, allowance, planPrice, state.mix)
      : null;
  const score = scoreOf(model);

  const frag = document.createDocumentFragment();
  frag.append(el('h2', model.display));

  const dl = el('dl', undefined, 'detail-grid');
  const pairs: Array<[string, string, boolean?]> = [
    ['Lab', LAB_NAMES[labOf(model.goId)]],
    [
      'Score',
      `${score === null ? 'not scored on this index' : score.toFixed(1)} (${INDEX_LABELS[state.index]})`,
    ],
    [
      'Allowance',
      allowance === 'unlimited'
        ? 'unlimited'
        : allowance === null
          ? 'no published price'
          : `$${allowance}/month`,
    ],
    [
      'Multiplier',
      m === null ? '—' : `${m.toFixed(2)}× (${dataset.plans[state.plan].label} at $${planPrice})`,
    ],
    ['List blended', listBlended === null ? 'incomplete price' : `${formatPrice(listBlended)}/1M`],
    ['Effective', effective === null ? '—' : `${formatPrice(effective)}/1M`, true],
  ];
  for (const [term, value, strong] of pairs) {
    const dt = el('dt', term);
    const dd = el('dd', value);
    if (strong) dd.className = 'strong';
    dl.append(dt, dd);
  }
  frag.append(dl);

  if (model.aaName) frag.append(el('p', `Artificial Analysis model: ${model.aaName}`, 'note'));
  if (model.priceRow) frag.append(el('p', `Pricing row: ${model.priceRow}`, 'note'));
  if (model.promoLabel) frag.append(el('p', `Promotional: ${model.promoLabel}`, 'note'));

  host.replaceChildren(frag);
}

function renderBucket(id: string, names: Bucket[], buckets: Record<string, Bucket>): void {
  const host = document.getElementById(id);
  if (!host) return;

  const models = dataset.models.filter((m) => names.includes(buckets[m.goId]));
  if (models.length === 0) {
    host.replaceChildren(el('li', 'none', 'muted'));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const model of models) {
    const score = scoreOf(model);
    frag.append(el('li', score === null ? model.display : `${model.display} — ${score.toFixed(1)}`));
  }
  host.replaceChildren(frag);
}

function renderLegend(labs: string[]): void {
  const host = document.getElementById('legend');
  if (!host) return;
  const frag = document.createDocumentFragment();
  for (const lab of labs) {
    const item = el('li', undefined, 'legend-item');
    const swatch = el('span', undefined, `legend-swatch lab-${lab}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, el('span', LAB_NAMES[lab as keyof typeof LAB_NAMES] ?? lab));
    frag.append(item);
  }
  host.replaceChildren(frag);
}

function render(): void {
  const planPrice = dataset.plans[state.plan].price;
  const { inputs, buckets, frontier } = computeFrontier(
    dataset.models,
    state.plan,
    state.index,
    state.mix,
    planPrice,
  );

  const frontierSet = new Set(frontier);
  const nearSet = nearFrontier(inputs, frontier, state.tolerance);

  const points: ChartPoint[] = inputs.map((input) => {
    const model = byId(input.id);
    return {
      id: input.id,
      label: model?.display ?? input.id,
      cost: input.cost,
      score: input.score,
      frontier: frontierSet.has(input.id),
      near: !frontierSet.has(input.id) && nearSet.has(input.id),
      lab: model?.lab ?? 'other',
    };
  });

  const svg = document.getElementById('chart') as SVGSVGElement | null;
  const empty = document.getElementById('chart-empty');
  if (!svg || !empty) return;

  const scene = buildScene(points, {
    width: 900,
    height: 460,
    xLabel: 'Effective $ per 1M blended tokens (log scale)',
    yLabel: INDEX_LABELS[state.index],
  });

  paintScene(svg, scene);
  empty.hidden = scene.empty === null;
  if (scene.empty) empty.textContent = scene.empty;

  renderLegend([...new Set(points.map((p) => p.lab ?? 'other'))].sort());

  renderBucket('bucket-free', ['free'], buckets);
  renderBucket('bucket-unscored', ['unscored'], buckets);

  const tableHost = document.getElementById('table-host');
  if (tableHost) {
    mountTable(tableHost, dataset, state, state.sort, (next) => {
      state.sort = next;
      render();
    });
  }

  svg.querySelectorAll<SVGCircleElement>('circle[data-id]').forEach((circle) => {
    const id = circle.dataset.id ?? '';
    circle.addEventListener('focus', () => renderDetails(id));
    circle.addEventListener('click', () => renderDetails(id));
    circle.addEventListener('mouseenter', () => renderDetails(id));
  });
}

function percentToShare(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed / 100;
}

function wireControls(): void {
  const plan = document.getElementById('plan') as HTMLSelectElement | null;
  const index = document.getElementById('index') as HTMLSelectElement | null;

  plan?.addEventListener('change', () => {
    state.plan = plan.value as Plan;
    render();
  });
  index?.addEventListener('change', () => {
    state.index = index.value as IndexKey;
    render();
  });

  const fields = [
    ['mix-input', 'input'],
    ['mix-cached', 'cached'],
    ['mix-output', 'output'],
  ] as const;

  for (const [elementId, key] of fields) {
    const field = document.getElementById(elementId) as HTMLInputElement | null;
    if (field) field.value = (DEFAULT_MIX[key] * 100).toFixed(2);
    field?.addEventListener('input', () => {
      state.mix = normalizeMix({
        input: key === 'input' ? percentToShare(field.value) : state.mix.input,
        cached: key === 'cached' ? percentToShare(field.value) : state.mix.cached,
        output: key === 'output' ? percentToShare(field.value) : state.mix.output,
        cacheWrite: 0,
      });
      render();
    });
  }

  const reset = document.getElementById('mix-reset');
  reset?.addEventListener('click', () => {
    state.mix = { ...DEFAULT_MIX };
    for (const [elementId, key] of fields) {
      const field = document.getElementById(elementId) as HTMLInputElement | null;
      if (field) field.value = (DEFAULT_MIX[key] * 100).toFixed(2);
    }
    render();
  });

  const tolerance = document.getElementById('tolerance') as HTMLInputElement | null;
  const toleranceOut = document.getElementById('tolerance-value');
  if (tolerance) {
    state.tolerance = Number(tolerance.value);
    tolerance.addEventListener('input', () => {
      const value = Number(tolerance.value);
      state.tolerance = Number.isFinite(value) ? Math.max(0, value) : 0;
      if (toleranceOut) toleranceOut.textContent = state.tolerance.toFixed(1);
      render();
    });
  }
  if (toleranceOut) toleranceOut.textContent = state.tolerance.toFixed(1);
}

function renderFreshness(): void {
  const host = document.getElementById('freshness');
  if (!host) return;
  const fetched = dataset.aaFetchedAt
    ? new Date(dataset.aaFetchedAt).toISOString().slice(0, 10)
    : 'never';
  host.textContent = `Scores fetched ${fetched}; index version ${dataset.intelligenceIndexVersion ?? 'unknown'}.`;
}

wireControls();
wireThemeToggle(document.getElementById('theme-toggle') as HTMLButtonElement | null);
render();
renderFreshness();
