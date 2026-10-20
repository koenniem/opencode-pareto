import { effectiveCostPerTask, multiplier } from './compute';
import { formatCostPerTask } from './chart';
import type { Dataset, DatasetModel, IndexKey, ModelVariant, Plan } from './types';

export interface TableOptions {
  plan: Plan;
  index: IndexKey;
}

export interface TableCell {
  text: string;
  /** Rendered as `<th scope="row">` instead of `<td>`. */
  rowHeader?: boolean;
  /** Sort key. Numbers sort numerically; missing or null sorts last. */
  value?: number | null;
}

export interface TableModel {
  caption: string;
  head: string[];
  rows: TableCell[][];
}

export interface SortState {
  column: number;
  direction: 'asc' | 'desc';
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function allowanceMultiplier(model: DatasetModel, plan: Plan, planPrice: number): number | null {
  const allowance = model.allowances?.[plan];
  if (allowance === 'unlimited') return Number.POSITIVE_INFINITY;
  return multiplier(allowance ?? null, planPrice);
}

function multiplierCell(model: DatasetModel, plan: Plan, planPrice: number): string {
  const m = allowanceMultiplier(model, plan, planPrice);
  if (m === null) return '—';
  return Number.isFinite(m) ? `${m.toFixed(1)}×` : '∞';
}

function primaryVariant(model: DatasetModel): ModelVariant | undefined {
  if (model.variants.length === 0) return undefined;
  return (
    model.variants.find((variant) => variant.aaSlug === model.defaultVariant) ??
    model.variants[model.variants.length - 1]
  );
}

function aaCost(model: DatasetModel): number | null {
  const primary = primaryVariant(model);
  return primary ? primary.listCostPerTask : model.listCostPerTask;
}

function adjustedCost(model: DatasetModel): number | null {
  const primary = primaryVariant(model);
  return primary ? primary.costPerTask : model.costPerTask;
}

function goCost(model: DatasetModel, plan: Plan, planPrice: number): number | null {
  const allowance = model.allowances?.[plan] ?? null;
  if (allowance === null || allowance === 'unlimited' || !model.prices) return null;
  return effectiveCostPerTask(adjustedCost(model), allowance, planPrice);
}

function aaCostCell(model: DatasetModel): string {
  const cost = aaCost(model);
  return cost === null ? 'no AA cost' : formatCostPerTask(cost);
}

function goCostCell(model: DatasetModel, plan: Plan, planPrice: number): string {
  const allowance = model.allowances?.[plan] ?? null;
  if (allowance === 'unlimited') return 'free (unlimited allowance)';
  if (allowance === null || !model.prices) return 'no published price';
  const cost = goCost(model, plan, planPrice);
  return cost === null ? 'no AA cost' : formatCostPerTask(cost);
}

function noteCell(model: DatasetModel): string {
  if (model.promoLabel) return model.promoLabel;
  if (model.tier === 'unpriced') return 'served, not priced by OpenCode';
  if (adjustedCost(model) === null) return 'no AA cost';

  const primary = primaryVariant(model);
  if (primary?.priceFactorApproximate) return 'price estimate';
  const factor = primary?.priceFactor;
  if (factor !== null && factor !== undefined && Math.abs(factor - 1) > 1e-9) {
    return 'price-adjusted';
  }
  return '';
}

function scoreOf(model: DatasetModel, index: IndexKey): number | null {
  const score = model.scores[index];
  return score === null || score === undefined ? null : score;
}

/** The primary configuration's human effort label. */
function effortCell(model: DatasetModel): string {
  if (model.variants.length === 0) return '—';
  const primary =
    model.variants.find((variant) => variant.aaSlug === model.defaultVariant) ??
    model.variants[model.variants.length - 1];
  // "Default" is true but noisy for the many single-configuration models;
  // the column is for real effort choices.
  return primary.effort === 'Default' ? '—' : primary.effort;
}

/**
 * The dataset as plain cells, carrying a numeric sort key alongside the text.
 *
 * Both the build-time HTML and the client-side DOM render from this, so the two
 * cannot drift and only one place decides what a value *says*.
 */
export function tableModel(dataset: Dataset, opts: TableOptions): TableModel {
  const planPrice = dataset.plans[opts.plan].price;

  const rows = dataset.models.map<TableCell[]>((model) => {
    const score = scoreOf(model, opts.index);
    return [
      { text: model.display, rowHeader: true },
      { text: effortCell(model) },
      {
        text: multiplierCell(model, opts.plan, planPrice),
        value: allowanceMultiplier(model, opts.plan, planPrice),
      },
      { text: aaCostCell(model), value: aaCost(model) },
      { text: goCostCell(model, opts.plan, planPrice), value: goCost(model, opts.plan, planPrice) },
      { text: score === null ? 'not scored' : score.toFixed(1), value: score },
      { text: noteCell(model) },
    ];
  });

  return {
    caption: `Every model on OpenCode Go, with Artificial Analysis's weighted cost per Intelligence Index task. AA $/task is AA's list-price cost; Go $/task applies OpenCode's price basis and the plan's usage multiplier. Score and effort show each model's primary configuration.`,
    head: ['Model', 'Effort', 'Usage ×', 'AA $/task', 'Go $/task', 'Score', 'Notes'],
    rows,
  };
}

/**
 * Sort rows by one column. Missing values always sort last, in both
 * directions — an unpriceable model at the top of a price sort would read as
 * the cheapest one.
 */
export function sortRows(rows: TableCell[][], sort: SortState | null): TableCell[][] {
  if (!sort) return rows;
  const sign = sort.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = a[sort.column];
    const right = b[sort.column];
    const lv = left?.value;
    const rv = right?.value;

    const lMissing = lv === null || lv === undefined;
    const rMissing = rv === null || rv === undefined;

    if (lMissing && rMissing) return 0;
    if (lMissing) return 1;
    if (rMissing) return -1;

    if (typeof lv === 'number' && typeof rv === 'number') return sign * (lv - rv);
    return sign * String(left.text).localeCompare(String(right.text));
  });
}

/**
 * Serialize the table to HTML for build-time injection into `index.html`.
 *
 * Default order, no sort controls: this is the no-JavaScript fallback, so it
 * has to be complete and static. Every interpolated value passes through `esc`.
 */
export function renderTableHtml(dataset: Dataset, opts: TableOptions): string {
  const model = tableModel(dataset, opts);
  const head = model.head.map((label) => `<th scope="col">${esc(label)}</th>`).join('');
  const body = model.rows
    .map((cells) => {
      const rendered = cells
        .map((cell) =>
          cell.rowHeader
            ? `<th scope="row">${esc(cell.text)}</th>`
            : `<td>${esc(cell.text)}</td>`,
        )
        .join('');
      return `<tr>${rendered}</tr>`;
    })
    .join('');
  return `<table class="data-table"><caption>${esc(model.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Render the table with clickable sortable headers, using DOM construction so
 * no dataset value can ever be interpreted as markup.
 */
export function mountTable(
  host: HTMLElement,
  dataset: Dataset,
  opts: TableOptions,
  sort: SortState | null,
  onSort: (next: SortState | null) => void,
): void {
  const model = tableModel(dataset, opts);
  const rows = sortRows(model.rows, sort);

  const table = document.createElement('table');
  table.className = 'data-table';

  const caption = document.createElement('caption');
  caption.textContent = model.caption;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  model.head.forEach((label, column) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.setAttribute(
      'aria-sort',
      sort?.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none',
    );

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      const nextDirection: 'asc' | 'desc' =
        sort?.column === column && sort.direction === 'asc' ? 'desc' : 'asc';
      onSort({ column, direction: nextDirection });
    });

    if (sort?.column === column) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = sort.direction === 'asc' ? '▲' : '▼';
      button.appendChild(arrow);
    }

    th.appendChild(button);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const cells of rows) {
    const tr = document.createElement('tr');
    for (const cell of cells) {
      const el = document.createElement(cell.rowHeader ? 'th' : 'td');
      if (cell.rowHeader) el.scope = 'row';
      el.textContent = cell.text;
      tr.appendChild(el);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  host.replaceChildren(table);
}
