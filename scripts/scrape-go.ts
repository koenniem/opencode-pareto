import { readFileSync, writeFileSync } from 'node:fs';
import type { Allowances, Allowance } from '../src/types';

export interface GoPricingRow {
  input: number;
  output: number;
  cachedRead: number | null;
  cachedWrite: number | null;
  allowance: Allowances;
  promo: { label: string; baseAllowance: Allowances } | null;
  note?: string;
}

export interface GoPricing {
  source: string;
  scrapedAt: string;
  rows: Record<string, GoPricingRow>;
}

const SOURCE = 'https://opencode.ai/docs/go/';
const REQUIRED_HEADERS = [
  'Model',
  'Input',
  'Output',
  'Cached Read',
  'Cached Write',
  'Monthly limit',
];

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parsePriceCell(raw: string): number | null {
  const text = textOf(raw);
  if (text === '-' || text === '') return null;
  if (/^free$/i.test(text)) return 0;
  const match = /\$([\d.]+)/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

interface ParsedLimit {
  allowance: Allowance;
  promoBase: Allowance;
  promoLabel: string | null;
}

function parseLimitCell(raw: string): ParsedLimit {
  const struck = /<del>(.*?)<\/del>/is.exec(raw);
  const small = /<small>(.*?)<\/small>/is.exec(raw);
  const live = raw.replace(/<del>.*?<\/del>/gis, '');
  const liveText = textOf(live);

  let allowance: Allowance;
  if (/unlimited/i.test(liveText)) {
    allowance = 'unlimited';
  } else {
    const match = /\$([\d.]+)/.exec(liveText);
    if (!match) throw new Error(`Unreadable monthly limit: ${JSON.stringify(raw)}`);
    allowance = Number.parseFloat(match[1]);
  }

  let promoBase: Allowance = null;
  if (struck) {
    const baseText = textOf(struck[1]);
    const match = /\$([\d.]+)/.exec(baseText);
    promoBase = match ? Number.parseFloat(match[1]) : null;
  }

  return {
    allowance,
    promoBase,
    promoLabel: small ? textOf(small[1]) || null : null,
  };
}

function tablesMatching(html: string): string[] {
  const tables = html.match(/<table>.*?<\/table>/gis) ?? [];
  return tables.filter((table) => {
    const headers = [...table.matchAll(/<th[^>]*>(.*?)<\/th>/gis)].map((m) => textOf(m[1]));
    return REQUIRED_HEADERS.every((required, i) => headers[i] === required);
  });
}

function rowsOf(table: string): string[][] {
  return [...table.matchAll(/<tr>(.*?)<\/tr>/gis)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map((c) => c[1]))
    .filter((cells) => cells.length > 0);
}

/**
 * Parse the rendered Go docs pricing tables.
 *
 * Throws unless exactly two pricing tables exist (Go, then Go Plus), each with
 * the same 36 rows. A partial parse is worse than a failed one: the build must
 * stop rather than quietly drop a model.
 */
export function parseGoDocs(html: string): GoPricing {
  const tables = tablesMatching(html);
  if (tables.length !== 2) {
    throw new Error(`Expected 2 Go pricing tables, found ${tables.length}`);
  }

  const [goRows, plusRows] = tables.map(rowsOf);
  const goByName = new Map(goRows.map((cells) => [textOf(cells[0]), cells]));
  const plusByName = new Map(plusRows.map((cells) => [textOf(cells[0]), cells]));

  if (goByName.size !== plusByName.size) {
    throw new Error(
      `Plan tables disagree: Go has ${goByName.size} rows, Go Plus has ${plusByName.size}`,
    );
  }

  const rows: Record<string, GoPricingRow> = {};
  for (const [name, goCells] of goByName) {
    const plusCells = plusByName.get(name);
    if (!plusCells) throw new Error(`"${name}" is priced on Go but not Go Plus`);
    if (goCells.length !== 6 || plusCells.length !== 6) {
      throw new Error(`"${name}" has ${goCells.length}/${plusCells.length} cells, expected 6`);
    }

    const goLimit = parseLimitCell(goCells[5]);
    const plusLimit = parseLimitCell(plusCells[5]);

    rows[name] = {
      input: parsePriceCell(goCells[1]) ?? 0,
      output: parsePriceCell(goCells[2]) ?? 0,
      cachedRead: parsePriceCell(goCells[3]),
      cachedWrite: parsePriceCell(goCells[4]),
      allowance: { go: goLimit.allowance, 'go-plus': plusLimit.allowance },
      promo: goLimit.promoLabel
        ? {
            label: goLimit.promoLabel,
            baseAllowance: { go: goLimit.promoBase, 'go-plus': plusLimit.promoBase },
          }
        : null,
      ...(goLimit.promoLabel ? { note: 'limited time' } : {}),
    };
  }

  if (Object.keys(rows).length === 0) {
    throw new Error('Parsed no pricing rows');
  }

  return { source: SOURCE, scrapedAt: new Date().toISOString(), rows };
}

/** Human-readable differences between a committed file and a fresh scrape. */
export function diffPricing(committed: GoPricing, scraped: GoPricing): string[] {
  const differences: string[] = [];
  const names = new Set([...Object.keys(committed.rows), ...Object.keys(scraped.rows)]);

  for (const name of [...names].sort()) {
    const before = committed.rows[name];
    const after = scraped.rows[name];
    if (!before && after) {
      differences.push(`+ ${name}: new model`);
      continue;
    }
    if (before && !after) {
      differences.push(`- ${name}: model removed`);
      continue;
    }
    if (!before || !after) continue;

    for (const field of ['input', 'output', 'cachedRead', 'cachedWrite'] as const) {
      if (before[field] !== after[field]) {
        differences.push(`${name}: ${field} ${before[field]} -> ${after[field]}`);
      }
    }
    for (const plan of ['go', 'go-plus'] as const) {
      if (before.allowance[plan] !== after.allowance[plan]) {
        differences.push(`${name}: allowance.${plan} ${before.allowance[plan]} -> ${after.allowance[plan]}`);
      }
    }
    if (JSON.stringify(before.promo) !== JSON.stringify(after.promo)) {
      differences.push(`${name}: promo changed`);
    }
  }
  return differences;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const path = 'data/go-pricing.json';
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const scraped = parseGoDocs(await response.text());

  if (write) {
    writeFileSync(path, `${JSON.stringify(scraped, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(scraped.rows).length} rows to ${path}`);
    return;
  }

  let committed: GoPricing;
  try {
    committed = JSON.parse(readFileSync(path, 'utf8')) as GoPricing;
  } catch {
    console.error(`${path} is missing. Run: npm run scrape:go -- --write`);
    process.exit(1);
  }

  const differences = diffPricing(committed, scraped);
  if (differences.length === 0) {
    console.log('Go pricing unchanged.');
    return;
  }
  console.error(`Go pricing changed (${differences.length} difference(s)):`);
  for (const line of differences) console.error(`  ${line}`);
  console.error('\nReview, then run: npm run scrape:go -- --write');
  process.exit(1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scrape-go.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
