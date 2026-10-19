import { writeFileSync } from 'node:fs';
import { INDEX_KEYS, type IndexKey } from '../src/types';

const BASE_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

export interface AAModel {
  slug: string;
  name: string;
  /** The configuration in the trailing parentheses of `name`, if any. */
  variant: string | null;
  scores: Partial<Record<IndexKey, number | null>>;
}

export interface AASnapshot {
  fetchedAt: string;
  intelligenceIndexVersion: string | null;
  models: AAModel[];
}

/** Convert an arbitrary JSON value into a number, null, or null-if-unusable. */
function scoreOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function variantOf(name: string): string | null {
  const match = /\(([^()]+)\)\s*$/.exec(name);
  return match ? match[1].trim() : null;
}

/**
 * Read one page of the Free-tier response.
 *
 * `null` in AA's data means "not measured". It stays `null` all the way to the
 * chart, where it becomes an "unscored" bucket — never a zero, which would
 * plot the model at the bottom of the axis as if it had been measured.
 *
 * An empty model list is rejected: writing it would silently replace good
 * scores with nothing and make the site look like AA has no data.
 */
export function parseAAResponse(body: unknown): AASnapshot {
  if (typeof body !== 'object' || body === null) {
    throw new Error('AA response is not an object');
  }
  const root = body as Record<string, unknown>;
  if (!Array.isArray(root.data)) {
    throw new Error('AA response has no data array');
  }

  const models: AAModel[] = root.data.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`AA model at index ${i} is not an object`);
    }
    const model = raw as Record<string, unknown>;
    if (typeof model.slug !== 'string' || model.slug.length === 0) {
      throw new Error(`AA model at index ${i} has no slug`);
    }

    const evaluations =
      typeof model.evaluations === 'object' && model.evaluations !== null
        ? (model.evaluations as Record<string, unknown>)
        : {};

    const scores: Partial<Record<IndexKey, number | null>> = {};
    for (const key of INDEX_KEYS) scores[key] = scoreOf(evaluations[key]);

    return {
      slug: model.slug,
      name: typeof model.name === 'string' ? model.name : model.slug,
      variant: variantOf(typeof model.name === 'string' ? model.name : ''),
      scores,
    };
  });

  if (models.length === 0) {
    throw new Error('AA response contained no models; refusing to write an empty snapshot');
  }

  const version = root.intelligence_index_version;

  return {
    fetchedAt: new Date().toISOString(),
    intelligenceIndexVersion: typeof version === 'string' ? version : null,
    models,
  };
}

function pageUrl(page: number): string {
  return `${BASE_URL}?page_size=${PAGE_SIZE}&page=${page}`;
}

/**
 * Fetch every page of the Free-tier model list.
 *
 * Free tier allows 100 requests per 24h; this uses one or two.
 */
export async function fetchAA(
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AASnapshot> {
  const models: AAModel[] = [];
  let version: string | null = null;
  let fetchedAt = new Date().toISOString();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(pageUrl(page), {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`AA request failed: ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const parsed = parseAAResponse(body);
    models.push(...parsed.models);
    version ??= parsed.intelligenceIndexVersion;
    fetchedAt = parsed.fetchedAt;

    const pagination = body.pagination as Record<string, unknown> | undefined;
    const hasMore = pagination?.has_more === true;
    if (!hasMore) {
      return { fetchedAt, intelligenceIndexVersion: version, models };
    }
  }

  throw new Error(`AA pagination did not terminate within ${MAX_PAGES} pages`);
}

async function main(): Promise<void> {
  const apiKey = process.env.AA_API_KEY;
  if (!apiKey) {
    console.warn(
      'AA_API_KEY is not set. Keeping the committed snapshot; the site will build without scores.',
    );
    return;
  }

  const snapshot = await fetchAA(apiKey);
  writeFileSync('data/aa-snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Wrote ${snapshot.models.length} AA models (index v${snapshot.intelligenceIndexVersion ?? '?'}) to data/aa-snapshot.json`,
  );
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('fetch-aa.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
