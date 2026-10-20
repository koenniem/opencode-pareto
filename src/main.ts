import datasetJson from '../data/dataset.json';
import { effectiveCostPerTask, multiplier } from './compute';
import {
  buildScene,
  formatCostPerTask,
  type ChartPoint,
  type CostScale,
  type Scene,
} from './chart';
import { computeFrontier, nearFrontier, type Bucket, type FrontierInput } from './frontier';
import { LAB_NAMES, labOf } from './labs';
import { paintScene } from './render';
import { mountTable, type SortState } from './table';
import { wireThemeToggle } from './theme';
import type {
  Dataset,
  DatasetModel,
  EffortSelection,
  IndexKey,
  ModelVariant,
  Plan,
} from './types';

// SAFETY: data/dataset.json is produced by scripts/build-dataset.ts from the
// roster, the scraped Go pricing table and the AA snapshot. Its shape is
// asserted in tests/build-dataset.test.ts; TypeScript cannot check JSON imports
// against the narrowed union types (IndexKey, Plan) used here.
const dataset = datasetJson as unknown as Dataset;

interface UiState {
  plan: Plan;
  index: IndexKey;
  scale: CostScale;
  tolerance: number;
  efforts: EffortSelection;
  sort: SortState | null;
  /** Lab currently highlighted from the legend, or null. */
  labFocus: string | null;
  /** Chart point id (`goId::aaSlug`) currently shown in the inspector. */
  selected: string | null;
}

const state: UiState = {
  plan: 'go',
  index: 'artificial_analysis_intelligence_index',
  scale: 'log',
  tolerance: 2,
  efforts: 'default',
  sort: null,
  labFocus: null,
  selected: null,
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

interface PointContext {
  model: DatasetModel;
  variant: ModelVariant | undefined;
  input: FrontierInput;
}

const modelById = new Map<string, DatasetModel>(dataset.models.map((model) => [model.goId, model]));
const contexts = new Map<string, PointContext>();

let chartPoints: ChartPoint[] = [];
let lastScene: Scene | null = null;
let lastWidth = 0;
let lastTableKey = '';

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

/** Score of a specific rung, falling back to the model's primary score. */
function scoreFor(model: DatasetModel, variant: ModelVariant | undefined): number | null {
  const score = variant?.scores[state.index] ?? model.scores[state.index];
  return score === null || score === undefined ? null : score;
}

/** Primary score, used by the bucket rails. */
function modelScore(model: DatasetModel): number | null {
  const score = model.scores[state.index];
  return score === null || score === undefined ? null : score;
}

function allowanceText(allowance: number | 'unlimited' | null): string {
  if (allowance === 'unlimited') return 'unlimited';
  if (allowance === null) return 'no published price';
  return `$${allowance}/month`;
}

function renderDetails(id: string | null): void {
  const host = document.getElementById('details');
  if (!host) return;

  const context = id ? contexts.get(id) : undefined;
  if (!context) {
    host.replaceChildren(
      el(
        'p',
        'Hover, focus or click a point to see its effort, cost per task and allowance.',
        'note',
      ),
    );
    return;
  }

  const { model, variant, input } = context;
  const planPrice = dataset.plans[state.plan].price;
  const allowance = model.allowances?.[state.plan] ?? null;
  const m = multiplier(allowance, planPrice);
  const primary =
    model.variants.find((rung) => rung.aaSlug === model.defaultVariant) ??
    model.variants[model.variants.length - 1];
  const selected = variant ?? primary;
  const aaCost = selected ? selected.listCostPerTask : model.listCostPerTask;
  const adjusted = selected ? selected.costPerTask : model.costPerTask;
  const effective = effectiveCostPerTask(adjusted, allowance, planPrice);
  const tasks =
    adjusted !== null && typeof allowance === 'number' && adjusted > 0
      ? allowance / adjusted
      : null;
  const score = scoreFor(model, variant);
  const factor = selected?.priceFactor ?? null;
  const priceNote = selected?.priceFactorApproximate
    ? 'OpenCode price basis estimated with the cache-heavy mix.'
    : factor !== null && Math.abs(factor - 1) > 1e-9
      ? 'Cost scaled to OpenCode’s token prices.'
      : '';

  const frag = document.createDocumentFragment();
  const h2 = el('h2');
  h2.append(
    el('span', model.display),
    el('span', variant?.effort ?? input.effort, 'effort-badge'),
  );
  frag.append(h2);
  frag.append(
    el(
      'p',
      variant?.aaName ?? model.aaName ?? 'No Artificial Analysis counterpart',
      'detail-sub',
    ),
  );

  const dl = el('dl', undefined, 'detail-grid');
  const pairs: Array<[string, string, boolean?]> = [
    ['Lab', LAB_NAMES[labOf(model.goId)]],
    ['Effort', variant?.effort ?? input.effort],
    [
      'Score',
      score === null
        ? 'not scored on this index'
        : `${score.toFixed(1)} (${INDEX_LABELS[state.index]})`,
    ],
    ['Allowance', allowanceText(allowance)],
    [
      'Usage multiplier',
      m === null ? '—' : `${m.toFixed(2)}× (${dataset.plans[state.plan].label} at $${planPrice})`,
    ],
    [
      'AA cost/task',
      aaCost === null ? 'no AA cost' : `${formatCostPerTask(aaCost)} at AA prices`,
    ],
    ['Go cost/task', effective === null ? '—' : formatCostPerTask(effective), true],
    [
      'Tasks/allowance',
      tasks === null ? '—' : `~${Math.round(tasks).toLocaleString('en-US')}`,
    ],
  ];
  for (const [term, value, strong] of pairs) {
    const dt = el('dt', term);
    const dd = el('dd', value);
    if (strong) dd.className = 'strong';
    dl.append(dt, dd);
  }
  frag.append(dl);

  frag.append(el('p', `Pricing row: ${model.priceRow ?? 'none'}`, 'note'));
  if (model.promoLabel) frag.append(el('p', `Promotional: ${model.promoLabel}`, 'note'));
  if (priceNote) frag.append(el('p', priceNote, 'note'));

  if (model.variants.length > 1) {
    const ladder = el('div', undefined, 'effort-ladder');
    ladder.append(el('h3', 'Effort ladder'));
    const list = el('ol', undefined, 'effort-list');

    for (const rung of model.variants) {
      const rungScore = rung.scores[state.index];
      const li = el(
        'li',
        undefined,
        `effort-item${rung.aaSlug === variant?.aaSlug ? ' is-current' : ''}`,
      );
      li.append(el('span', rung.effort, 'effort-name'));

      const track = el('span', undefined, 'effort-track');
      const fill = el('span', undefined, 'effort-fill');
      const width =
        rungScore === null || rungScore === undefined
          ? 0
          : Math.max(2, Math.min(100, Math.round(rungScore)));
      fill.style.width = `${width}%`;
      track.append(fill);

      const rungCost = effectiveCostPerTask(rung.costPerTask, allowance, planPrice);
      li.append(
        track,
        el(
          'span',
          rungScore === null || rungScore === undefined ? '—' : rungScore.toFixed(1),
          'effort-score',
        ),
        el('span', rungCost === null ? '—' : formatCostPerTask(rungCost), 'effort-cost'),
      );
      list.append(li);
    }

    ladder.append(list);
    if (state.efforts === 'default') {
      ladder.append(
        el('p', 'Turn on “All effort levels” to draw this ladder on the chart.', 'note'),
      );
    }
    frag.append(ladder);
  }

  host.replaceChildren(frag);
}

function showTooltip(circle: SVGCircleElement, id: string): void {
  const context = contexts.get(id);
  const scene = lastScene;
  const svg = document.getElementById('chart') as SVGSVGElement | null;
  const tooltip = document.getElementById('chart-tooltip');
  const card = svg?.parentElement;
  if (!context || !scene || !svg || !tooltip || !card) return;

  const { model, variant, input } = context;
  const score = scoreFor(model, variant);
  const allowance = model.allowances?.[state.plan] ?? null;
  const m = multiplier(allowance, dataset.plans[state.plan].price);
  const adjusted = variant ? variant.costPerTask : model.costPerTask;
  const aaCost = variant ? variant.listCostPerTask : model.listCostPerTask;
  const tasks =
    adjusted !== null && typeof allowance === 'number' && adjusted > 0
      ? allowance / adjusted
      : null;

  const title = el('p', undefined, 'tt-title');
  title.append(
    el('span', model.display),
    el('span', variant?.effort ?? input.effort, 'effort-badge'),
  );

  const dl = el('dl', undefined, 'tt-grid');
  const rows: Array<[string, string]> = [
    ['Go $/task', formatCostPerTask(input.cost)],
    ['AA $/task', aaCost === null ? '—' : formatCostPerTask(aaCost)],
    ['Score', score === null ? '—' : score.toFixed(1)],
    [
      'Usage ×',
      m === null ? (allowance === 'unlimited' ? 'unlimited' : '—') : `${m.toFixed(1)}×`,
    ],
    ['Tasks', tasks === null ? '—' : `~${Math.round(tasks).toLocaleString('en-US')}`],
  ];
  for (const [term, value] of rows) {
    dl.append(el('dt', term), el('dd', value));
  }

  const children: HTMLElement[] = [
    title,
    el('p', variant?.aaName ?? model.aaName ?? 'No Artificial Analysis counterpart', 'tt-sub'),
    dl,
  ];
  const notes: string[] = [];
  if (model.variants.length > 1) {
    notes.push('Effort raises the score and burns more tokens; cost per task includes that.');
  }
  if (variant?.priceFactorApproximate) notes.push('OpenCode price basis estimated.');
  for (const note of notes) children.push(el('p', note, 'tt-note'));

  tooltip.replaceChildren(...children);
  tooltip.hidden = false;

  const svgRect = svg.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cx = Number(circle.getAttribute('cx') ?? 0);
  const cy = Number(circle.getAttribute('cy') ?? 0);
  const x = svgRect.left - cardRect.left + (cx / scene.width) * svgRect.width;
  const y = svgRect.top - cardRect.top + (cy / scene.height) * svgRect.height;

  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let left = x + 14;
  if (left + tw > card.clientWidth - 10) left = x - tw - 14;
  left = Math.max(10, Math.min(left, card.clientWidth - tw - 10));
  let top = y - th - 14;
  if (top < 10) top = y + 16;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip(): void {
  const tooltip = document.getElementById('chart-tooltip');
  if (tooltip) tooltip.hidden = true;
}

function attachPointInteractions(svg: SVGSVGElement): void {
  svg.onmouseleave = hideTooltip;

  svg.querySelectorAll<SVGCircleElement>('circle[data-id]').forEach((circle) => {
    const id = circle.dataset.id ?? '';
    const activate = () => {
      state.selected = id;
      renderDetails(id);
      showTooltip(circle, id);
    };

    circle.addEventListener('mouseenter', activate);
    circle.addEventListener('focus', activate);
    circle.addEventListener('click', activate);
    circle.addEventListener('mouseleave', hideTooltip);
    circle.addEventListener('blur', hideTooltip);
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideTooltip();
        circle.blur();
      }
    });
  });
}

function chartWidth(svg: SVGSVGElement): number {
  const card = svg.parentElement;
  if (!card) return 900;
  const styles = getComputedStyle(card);
  const available =
    card.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  return Math.max(320, Math.round(available));
}

function paintChart(): void {
  const svg = document.getElementById('chart') as SVGSVGElement | null;
  const empty = document.getElementById('chart-empty');
  if (!svg || !empty) return;

  const width = chartWidth(svg);
  const height = Math.round(Math.min(540, Math.max(340, width * 0.52)));
  const scene = buildScene(chartPoints, {
    width,
    height,
    xLabel: `Go cost per task · ${state.scale} scale`,
    yLabel: INDEX_LABELS[state.index],
    scale: state.scale,
    tolerance: state.tolerance,
    maxLabels: state.efforts === 'all' ? 16 : 20,
  });

  lastScene = scene;
  paintScene(svg, scene);
  empty.hidden = scene.empty === null;
  if (scene.empty) empty.textContent = scene.empty;

  attachPointInteractions(svg);
  setLabFocus(state.labFocus);
}

function renderStats(frontier: string[]): void {
  const models = document.getElementById('stat-models');
  if (models) models.textContent = String(dataset.models.length);

  const frontierModels = new Set(
    frontier
      .map((id) => contexts.get(id)?.model.goId)
      .filter((id): id is string => id !== undefined),
  );
  const statFrontier = document.getElementById('stat-frontier');
  if (statFrontier) statFrontier.textContent = String(frontierModels.size);
}

function setLabFocus(lab: string | null): void {
  state.labFocus = lab;
  const svg = document.getElementById('chart') as SVGSVGElement | null;
  if (!svg) return;
  svg.classList.toggle('has-lab-focus', lab !== null);
  svg.querySelectorAll<SVGElement>('.point, .point-label, .leader, .ladder').forEach((node) => {
    const active = lab !== null && node.classList.contains(`lab-${lab}`);
    node.classList.toggle('is-lab-active', active);
  });
}

function renderLegend(labs: string[]): void {
  const host = document.getElementById('legend');
  if (!host) return;

  const frag = document.createDocumentFragment();
  for (const lab of labs) {
    const name = LAB_NAMES[lab as keyof typeof LAB_NAMES] ?? lab;
    const item = el('li', undefined, 'legend-item');
    item.dataset.lab = lab;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Highlight ${name} models`);
    const swatch = el('span', undefined, `legend-swatch lab-${lab}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, el('span', name));

    const activate = () => {
      item.classList.add('is-active');
      setLabFocus(lab);
    };
    const deactivate = () => {
      item.classList.remove('is-active');
      setLabFocus(null);
    };
    item.addEventListener('mouseenter', activate);
    item.addEventListener('mouseleave', deactivate);
    item.addEventListener('focus', activate);
    item.addEventListener('blur', deactivate);
    if (state.labFocus === lab) item.classList.add('is-active');
    frag.append(item);
  }
  host.replaceChildren(frag);
}

function renderBucket(id: string, names: Bucket[], buckets: Record<string, Bucket>): void {
  const host = document.getElementById(id);
  if (!host) return;

  const models = dataset.models.filter((model) => names.includes(buckets[model.goId]));
  if (models.length === 0) {
    host.replaceChildren(el('li', 'none', 'muted'));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const model of models) {
    const score = modelScore(model);
    frag.append(el('li', score === null ? model.display : `${model.display} — ${score.toFixed(1)}`));
  }
  host.replaceChildren(frag);
}

function updateBandCount(inputs: FrontierInput[], nearSet: Set<string>): void {
  const host = document.getElementById('band-count');
  if (!host) return;

  const nearModels = new Set(
    [...nearSet]
      .map((id) => contexts.get(id)?.model.goId)
      .filter((id): id is string => id !== undefined),
  );
  const plottedModels = new Set(inputs.map((input) => input.modelId));
  const tolerance = state.tolerance.toFixed(1);
  host.textContent =
    nearModels.size === 0
      ? 'No model is inside the band.'
      : `${nearModels.size} of ${plottedModels.size} models within ±${tolerance} points of the best at their price.`;
}

function render(): void {
  const planPrice = dataset.plans[state.plan].price;
  const { inputs, buckets, frontier } = computeFrontier(
    dataset.models,
    state.plan,
    state.index,
    planPrice,
    state.efforts,
  );

  const frontierSet = new Set(frontier);
  const nearSet = nearFrontier(inputs, frontier, state.tolerance);

  contexts.clear();
  chartPoints = [];
  for (const input of inputs) {
    const model = modelById.get(input.modelId);
    if (!model) continue;
    const variant = model.variants.find((rung) => rung.aaSlug === input.aaSlug);
    contexts.set(input.id, { model, variant, input });
    chartPoints.push({
      id: input.id,
      label: model.display,
      cost: input.cost,
      score: input.score,
      frontier: frontierSet.has(input.id),
      near: !frontierSet.has(input.id) && nearSet.has(input.id),
      lab: model.lab,
      group: model.goId,
      effort: input.effort,
      effortOrder: input.order,
      isDefault: input.isDefault,
    });
  }

  // Keep the inspector meaningful across plan/index/effort changes. On first
  // load, show the best frontier model rather than an empty panel.
  if (!state.selected || !contexts.has(state.selected)) {
    const top = frontier
      .map((id) => contexts.get(id))
      .filter((context): context is PointContext => context !== undefined)
      .sort((a, b) => b.input.score - a.input.score)[0];
    state.selected = top?.input.id ?? null;
  }

  paintChart();
  renderDetails(state.selected);
  renderStats(frontier);
  renderLegend([...new Set(chartPoints.map((point) => point.lab ?? 'other'))].sort());
  renderBucket('bucket-free', ['free'], buckets);
  renderBucket('bucket-unscored', ['unscored'], buckets);
  updateBandCount(inputs, nearSet);

  const tableHost = document.getElementById('table-host');
  const tableKey = [
    state.plan,
    state.index,
    state.sort?.column ?? '',
    state.sort?.direction ?? '',
  ].join('|');

  if (tableHost && tableKey !== lastTableKey) {
    lastTableKey = tableKey;
    mountTable(tableHost, dataset, state, state.sort, (next) => {
      state.sort = next;
      render();
    });
  }
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

  const efforts = document.getElementById('show-efforts') as HTMLInputElement | null;
  efforts?.addEventListener('change', () => {
    state.efforts = efforts.checked ? 'all' : 'default';
    state.selected = null;
    render();
  });

  const scaleButtons = document.querySelectorAll<HTMLButtonElement>('[data-scale]');
  scaleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.scale = button.dataset.scale === 'linear' ? 'linear' : 'log';
      scaleButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      render();
    });
  });

  const tolerance = document.getElementById('tolerance') as HTMLInputElement | null;
  const toleranceValue = document.getElementById('tolerance-value');

  const applyTolerance = () => {
    const raw = tolerance ? Number(tolerance.value) : state.tolerance;
    state.tolerance = Number.isFinite(raw) ? Math.max(0, Math.min(20, raw)) : 0;
    if (toleranceValue) toleranceValue.textContent = `±${state.tolerance}`;
    render();
  };

  if (tolerance) {
    tolerance.value = String(state.tolerance);
    tolerance.addEventListener('input', applyTolerance);
    tolerance.addEventListener('change', applyTolerance);
  }
  if (toleranceValue) toleranceValue.textContent = `±${state.tolerance}`;
}

function setupResize(): void {
  const svg = document.getElementById('chart');
  const card = svg?.parentElement;
  if (!card || typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', () => paintChart());
    return;
  }

  let frame = 0;
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paintChart();
    });
  });
  observer.observe(card);
}

function renderFreshness(): void {
  const fetched = dataset.aaFetchedAt
    ? new Date(dataset.aaFetchedAt).toISOString().slice(0, 10)
    : 'never';
  const version = dataset.intelligenceIndexVersion ?? 'unknown';

  const footer = document.getElementById('freshness');
  if (footer) footer.textContent = `Scores and costs fetched ${fetched}; index version ${version}.`;

  const stat = document.getElementById('stat-freshness');
  if (stat) {
    stat.textContent = fetched;
    stat.title = `Artificial Analysis Intelligence Index version ${version}`;
  }
}

wireControls();
wireThemeToggle(document.getElementById('theme-toggle') as HTMLButtonElement | null);
setupResize();
render();
renderFreshness();
