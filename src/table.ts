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
}

export interface TableModel {
  caption: string;
  head: string[];
  rows: TableCell[][];
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

function multiplierCell(model: DatasetModel, plan: Plan, planPrice: number): string {
  const allowance = model.allowances?.[plan];
  if (allowance === 'unlimited') return '∞';
  const m = multiplier(allowance ?? null, planPrice);
  return m === null ? '—' : `${m.toFixed(1)}×`;
}

function listPriceCell(model: DatasetModel, mix: Mix): string {
  if (!model.prices) return 'no published price';
  const blended = blendedPrice(model.prices, mix);
  return blended === null ? 'incomplete price' : `${formatPrice(blended)}/1M`;
}

function effectiveCell(model: DatasetModel, opts: TableOptions, planPrice: number): string {
  const allowance = model.allowances?.[opts.plan] ?? null;
  if (allowance === 'unlimited') return 'free (unlimited allowance)';
  if (allowance === null || !model.prices) return 'no published price';
  const cost = effectivePrice(model.prices, allowance, planPrice, opts.mix);
  if (cost === null) return 'incomplete price';
  return `${formatPrice(cost)}/1M`;
}

function scoreCell(model: DatasetModel, index: IndexKey): string {
  const score = model.scores[index];
  if (score === null || score === undefined) return 'not scored';
  return score.toFixed(1);
}

/**
 * The dataset as plain cell text.
 *
 * Both the build-time HTML and the client-side DOM are rendered from this, so
 * the two cannot drift and only one place decides what a value *says*.
 */
export function tableModel(dataset: Dataset, opts: TableOptions): TableModel {
  const planPrice = dataset.plans[opts.plan].price;

  const rows = dataset.models.map<TableCell[]>((model) => [
    { text: model.display, rowHeader: true },
    { text: multiplierCell(model, opts.plan, planPrice) },
    { text: listPriceCell(model, opts.mix) },
    { text: effectiveCell(model, opts, planPrice) },
    { text: scoreCell(model, opts.index) },
    {
      text:
        model.promoLabel ??
        (model.tier === 'unpriced' ? 'served, not priced by OpenCode' : ''),
    },
  ]);

  return {
    caption: `Every model on OpenCode Go, priced on the ${dataset.plans[opts.plan].label} plan at the current token mix.`,
    head: ['Model', 'Multiplier', 'List $/1M', 'Effective $/1M', 'Score', 'Notes'],
    rows,
  };
}

/**
 * Serialize the table to HTML for build-time injection into `index.html`.
 *
 * Every interpolated value passes through `esc`, and a test proves a hostile
 * model name cannot escape its cell.
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
 * Render the table into a host element using DOM construction.
 *
 * Text goes through `textContent`, so no value from the dataset can be
 * interpreted as markup on the client.
 */
export function mountTable(host: HTMLElement, dataset: Dataset, opts: TableOptions): void {
  const model = tableModel(dataset, opts);

  const table = document.createElement('table');
  table.className = 'data-table';

  const caption = document.createElement('caption');
  caption.textContent = model.caption;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of model.head) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const cells of model.rows) {
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
