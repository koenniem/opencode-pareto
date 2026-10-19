import { blendedPrice, effectivePrice, multiplier } from './compute';
import { formatPrice } from './chart';
import type { Dataset, DatasetModel, IndexKey, Mix, Plan } from './types';

export interface TableOptions {
  plan: Plan;
  index: IndexKey;
  mix: Mix;
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

function listBlended(model: DatasetModel, mix: Mix): number | null {
  if (!model.prices) return null;
  return blendedPrice(model.prices, mix);
}

function listPriceCell(model: DatasetModel, mix: Mix): string {
  if (!model.prices) return 'no published price';
  const blended = listBlended(model, mix);
  return blended === null ? 'incomplete price' : `${formatPrice(blended)}/1M`;
}

function effectiveCost(model: DatasetModel, opts: TableOptions, planPrice: number): number | null {
  const allowance = model.allowances?.[opts.plan] ?? null;
  if (allowance === null || allowance === 'unlimited' || !model.prices) return null;
  return effectivePrice(model.prices, allowance, planPrice, opts.mix);
}

function effectiveCell(model: DatasetModel, opts: TableOptions, planPrice: number): string {
  const allowance = model.allowances?.[opts.plan] ?? null;
  if (allowance === 'unlimited') return 'free (unlimited allowance)';
  const cost = effectiveCost(model, opts, planPrice);
  if (cost === null) return allowance === null || !model.prices ? 'no published price' : 'incomplete price';
  return `${formatPrice(cost)}/1M`;
}

function scoreOf(model: DatasetModel, index: IndexKey): number | null {
  const score = model.scores[index];
  return score === null || score === undefined ? null : score;
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
      { text: multiplierCell(model, opts.plan, planPrice), value: allowanceMultiplier(model, opts.plan, planPrice) },
      { text: listPriceCell(model, opts.mix), value: listBlended(model, opts.mix) },
      { text: effectiveCell(model, opts, planPrice), value: effectiveCost(model, opts, planPrice) },
      { text: score === null ? 'not scored' : score.toFixed(1), value: score },
      {
        text:
          model.promoLabel ??
          (model.tier === 'unpriced' ? 'served, not priced by OpenCode' : ''),
      },
    ];
  });

  return {
    caption: `Every model on OpenCode Go, priced on the ${dataset.plans[opts.plan].label} plan at the current token mix.`,
    head: ['Model', 'Multiplier', 'List $/1M', 'Effective $/1M', 'Score', 'Notes'],
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
