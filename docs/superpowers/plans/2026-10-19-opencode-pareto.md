# OpenCode Pareto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static site that plots OpenCode Go's per-model effective price against Artificial Analysis capability scores and draws the Pareto frontier.

**Architecture:** Build-time pipeline (Node scripts) turns three sources + one hand-curated roster into a single committed `data/dataset.json`. The site is a Vite page with zero runtime dependencies that loads that JSON and renders a hand-rolled SVG scatter. No backend, no API key in the browser.

**Tech Stack:** TypeScript, Vite, Vitest, `tsx`, `yaml`. No runtime dependencies. GitHub Pages via Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-opencode-pareto-design.md`

## Global Constraints

- All monetary values in USD.
- `package.json` `dependencies` must stay empty. Build-time devDependencies only.
- The site must build and render with no `AA_API_KEY` present. Missing AA data yields an explicit empty state, never fake scores.
- AA scores are never altered. Every rendering carries "Source: Artificial Analysis (artificialanalysis.ai)".
- Vite `base` is `/opencode-pareto/`.
- Node 22 or newer. TypeScript `strict: true`.
- Null means "not measured". It is never coerced to `0`.
- Default mix constant is exactly `{ input: 0.0114, cached: 0.985, output: 0.0036, cacheWrite: 0 }`.

## Review Focus

1. A model with a null `cachedRead` price — must fail closed into the `incomplete` bucket, never priced at 0. At 98.5% cache weight this is a two-orders-of-magnitude error.
2. A model whose selected index is null — must land in `unscored`, never plotted at y=0.
3. Zero or one plottable model — the chart must render an explanatory empty state, not NaN coordinates or a collapsed axis.
4. A model with `unlimited` allowance — must land in `free`, never divide by `Infinity` or produce `Infinity`/`NaN` cost.
5. Every model unpriced or unscored at once — the page must still render the table and the explanation.

---

### Task 1: Scaffold, types, and price maths

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- Create: `src/types.ts`
- Create: `src/compute.ts`
- Test: `tests/compute.test.ts`

**Interfaces:**
- Produces (all shared types live in `src/types.ts`, defined here and used by every later task):
  - `type Plan = 'go' | 'go-plus'`
  - `type IndexKey` — union of the nine AA index field names
  - `interface Mix { input: number; cached: number; output: number; cacheWrite: number }`
  - `interface Prices { input: number; output: number; cachedRead: number | null; cachedWrite: number | null }`
  - `type Allowance = number | 'unlimited' | null`
  - `interface Allowances { go: Allowance; 'go-plus': Allowance }`
  - `interface RosterEntry { goId: string; display: string; aaSlug: string | null; aaVariant: string | null; tier: 'standard' | 'free' | 'unpriced' | 'incomplete'; priceRow: string | null; notes?: string }`
  - `interface DatasetModel { goId: string; display: string; aaSlug: string | null; aaName: string | null; tier: RosterEntry['tier']; priceRow: string | null; promoLabel: string | null; prices: Prices | null; allowances: Allowances | null; scores: Partial<Record<IndexKey, number | null>> }`
  - `interface Dataset { generatedAt: string; aaFetchedAt: string | null; intelligenceIndexVersion: string | null; plans: Record<Plan, { label: string; price: number }>; models: DatasetModel[] }`
  - `const DEFAULT_MIX: Mix`
  - `function normalizeMix(mix: Mix): Mix`
  - `function blendedPrice(prices: Prices, mix: Mix): number | null`
  - `function multiplier(allowance: Allowance, planPrice: number): number | null`
  - `function effectivePrice(prices: Prices, allowance: Allowance, planPrice: number, mix: Mix): number | null`

- [ ] **Step 1: Scaffold the project**

`package.json` scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `scrape:go`, `fetch:aa`, `data:build`.

devDependencies: `typescript`, `vite`, `vitest`, `tsx`, `yaml`. Leave `dependencies` as `{}`.

`vite.config.ts` sets `base: '/opencode-pareto/'`. `tsconfig.json` sets `strict: true`, `moduleResolution: "bundler"`, `target: "ES2022"`, `noEmit: true`.

`.gitignore`: `node_modules/`, `dist/`, `.env.local`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/compute.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIX, blendedPrice, effectivePrice, multiplier, normalizeMix } from '../src/compute';

const GLM52 = { input: 1.40, output: 4.40, cachedRead: 0.26, cachedWrite: null };
const KIMI_K3 = { input: 3.00, output: 15.00, cachedRead: 0.30, cachedWrite: null };

describe('blendedPrice', () => {
  it('weights input, cached read and output by the mix', () => {
    expect(blendedPrice(GLM52, DEFAULT_MIX)).toBeCloseTo(0.2879, 6);
    expect(blendedPrice(KIMI_K3, DEFAULT_MIX)).toBeCloseTo(0.3837, 6);
  });
  it('fails closed when a weighted component has no price', () => {
    expect(blendedPrice({ ...KIMI_K3, cachedRead: null }, DEFAULT_MIX)).toBeNull();
  });
  it('ignores a missing price whose weight is zero', () => {
    expect(blendedPrice({ ...KIMI_K3, cachedWrite: null }, DEFAULT_MIX)).not.toBeNull();
  });
});
```

```ts
describe('multiplier', () => {
  it('divides allowance by subscription price', () => {
    expect(multiplier(60, 10)).toBe(6);
    expect(multiplier(15, 10)).toBe(1.5);
    expect(multiplier(180, 40)).toBe(4.5);
  });
  it('returns null for unlimited or absent allowance', () => {
    expect(multiplier('unlimited', 10)).toBeNull();
    expect(multiplier(null, 10)).toBeNull();
  });
});

describe('effectivePrice', () => {
  it('divides blended list price by the multiplier', () => {
    expect(effectivePrice(GLM52, 60, 10, DEFAULT_MIX)).toBeCloseTo(0.0479833, 6);
    expect(effectivePrice(KIMI_K3, 15, 10, DEFAULT_MIX)).toBeCloseTo(0.2558, 6);
  });
  it('returns null instead of Infinity for unlimited allowance', () => {
    expect(effectivePrice(KIMI_K3, 'unlimited', 10, DEFAULT_MIX)).toBeNull();
  });
});

describe('normalizeMix', () => {
  it('scales components so they sum to one', () => {
    const out = normalizeMix({ input: 1, cached: 8, output: 1, cacheWrite: 0 });
    expect(out.input).toBeCloseTo(0.1);
    expect(out.cached).toBeCloseTo(0.8);
    expect(out.output).toBeCloseTo(0.1);
  });
});
```

And the regression test that pins the default mix to OpenCode's own published
assumptions. Commit `tests/fixtures/go-token-profiles.json` containing the 24
per-request token profiles from the Go docs, shaped
`[{ "model": "Kimi K3", "input": 1050, "cached": 76500, "output": 300 }]`.

```ts
import profiles from './fixtures/go-token-profiles.json';

it('DEFAULT_MIX is the median of OpenCode\'s published token profiles', () => {
  const share = (k: 'input' | 'cached' | 'output', p: typeof profiles[0]) =>
    p[k] / (p.input + p.cached + p.output);
  const median = (k: 'input' | 'cached' | 'output') => {
    const xs = profiles.map(p => share(k, p)).sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)];
  };
  expect(DEFAULT_MIX.input).toBeCloseTo(median('input'), 4);
  expect(DEFAULT_MIX.cached).toBeCloseTo(median('cached'), 4);
  expect(DEFAULT_MIX.output).toBeCloseTo(median('output'), 4);
});

it('reproduces OpenCode\'s published requests per month', () => {
  const perMonth = (p: typeof profiles[0], prices: Prices, allowance: number) => {
    const perRequest =
      (p.input * prices.input + p.cached * prices.cachedRead! + p.output * prices.output) / 1e6;
    return allowance / perRequest;
  };
  const within1pct = (computed: number, published: number) =>
    expect(Math.abs(computed - published) / published).toBeLessThan(0.01);

  within1pct(perMonth({ model: 'GLM-5.3-Flash', input: 1000, cached: 55000, output: 200 },
    { input: 0.15, output: 0.50, cachedRead: 0.03, cachedWrite: null }, 60), 31580);
  within1pct(perMonth({ model: 'Kimi K3', input: 1050, cached: 76500, output: 300 },
    { input: 3.00, output: 15.00, cachedRead: 0.30, cachedWrite: null }, 15), 490);
  within1pct(perMonth({ model: 'MiniMax M3', input: 510, cached: 56000, output: 190 },
    { input: 0.30, output: 1.20, cachedRead: 0.06, cachedWrite: null }, 60), 16000);
  within1pct(perMonth({ model: 'LongCat-2.0', input: 920, cached: 88900, output: 200 },
    { input: 0.30, output: 1.20, cachedRead: 0.006, cachedWrite: null }, 60), 57200);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- tests/compute.test.ts`
Expected: FAIL — cannot resolve `../src/compute`.

- [ ] **Step 4: Implement `src/types.ts` and `src/compute.ts`**

`blendedPrice` sums `mix.x * price` over the four components, skipping any component whose price is `null` **only when its mix weight is zero**; otherwise returns `null`. `effectivePrice` returns `null` when `blendedPrice` is null or `multiplier` is null.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tests/compute.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold project and price maths"
```

---

### Task 2: Frontier computation and buckets

**Files:**
- Create: `src/frontier.ts`
- Test: `tests/frontier.test.ts`

**Interfaces:**
- Consumes: `IndexKey`, `Plan`, `Mix`, `Allowances`, `Prices` from Task 1.
- Produces:
  - `type Bucket = 'plotted' | 'free' | 'unpriced' | 'incomplete' | 'unscored'`
  - `interface FrontierInput { id: string; cost: number; score: number }`
  - `function paretoFrontier(points: FrontierInput[]): string[]` — ids on the non-dominated set, sorted by cost ascending
  - `function toFrontierInputs(models: DatasetModel[], plan: Plan, index: IndexKey, mix: Mix, planPrice: number): { inputs: FrontierInput[]; buckets: Record<string, Bucket> }`

- [ ] **Step 1: Write the failing tests**

```ts
import { paretoFrontier } from '../src/frontier';

it('drops a point that is dearer and no better', () => {
  expect(paretoFrontier([
    { id: 'a', cost: 1, score: 10 },
    { id: 'b', cost: 2, score: 10 },
  ])).toEqual(['a']);
});

it('keeps a point that trades cost for score', () => {
  expect(paretoFrontier([
    { id: 'a', cost: 1, score: 10 },
    { id: 'b', cost: 2, score: 11 },
  ])).toEqual(['a', 'b']);
});

it('drops a point that is dearer and worse', () => {
  expect(paretoFrontier([
    { id: 'a', cost: 1, score: 10 },
    { id: 'b', cost: 2, score: 9 },
  ])).toEqual(['a']);
});

it('keeps only the best score when costs tie', () => {
  expect(paretoFrontier([
    { id: 'lo', cost: 1, score: 5 },
    { id: 'hi', cost: 1, score: 9 },
  ])).toEqual(['hi']);
});

it('returns a single point unchanged', () => {
  expect(paretoFrontier([{ id: 'a', cost: 1, score: 10 }])).toEqual(['a']);
});

it('returns empty for no points', () => {
  expect(paretoFrontier([])).toEqual([]);
});
```

Bucket tests:

```ts
it('buckets unlimited allowance as free', () => { /* allowance 'unlimited' → 'free' */ });
it('buckets a null score as unscored', () => { /* score null → 'unscored' */ });
it('buckets a null cache price as incomplete', () => { /* prices.cachedRead null → 'incomplete' */ });
it('buckets a null allowance as unpriced', () => { /* allowance null → 'unpriced' */ });
it('buckets one valid model as plotted', () => { /* → 'plotted' */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/frontier.test.ts`
Expected: FAIL — cannot resolve `../src/frontier`.

- [ ] **Step 3: Implement `src/frontier.ts`**

Sort a copy by `cost` ascending then `score` descending. Sweep, keeping a point when `score > bestScoreSoFar`. `toFrontierInputs` classifies every model into exactly one bucket, in this precedence order: `free` (allowance is `'unlimited'`) → `unpriced` (allowance `null`) → `incomplete` (`effectivePrice` returned null while allowance was numeric) → `unscored` (selected index has no value) → `plotted`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/frontier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pareto frontier and model buckets"
```

---

### Task 3: Go pricing data and docs scraper

**Files:**
- Create: `scripts/scrape-go.ts`
- Create: `data/go-pricing.json` (generated once, then hand-reviewed and committed)
- Create: `tests/fixtures/go-docs.html` (committed snapshot of `https://opencode.ai/docs/go/`)
- Test: `tests/scrape-go.test.ts`

**Interfaces:**
- Produces:
  - `interface GoPricingRow { input: number; output: number; cachedRead: number | null; cachedWrite: number | null; allowance: Allowances; promo: { label: string; baseAllowance: Allowances } | null; note?: string }`
  - `interface GoPricing { source: string; scrapedAt: string; rows: Record<string, GoPricingRow> }`
  - `function parseGoDocs(html: string): GoPricing`
  - `function diffPricing(committed: GoPricing, scraped: GoPricing): string[]` — human-readable differences, empty when identical

- [ ] **Step 1: Capture the fixture**

Save the live page to `tests/fixtures/go-docs.html`:

```bash
curl -sL https://opencode.ai/docs/go/ -o tests/fixtures/go-docs.html
```

- [ ] **Step 2: Write the failing tests**

```ts
import { readFileSync } from 'node:fs';
import { diffPricing, parseGoDocs } from '../scripts/scrape-go';

const html = readFileSync(new URL('./fixtures/go-docs.html', import.meta.url), 'utf8');

it('parses 36 priced rows covering 29 distinct models', () => {
  const { rows } = parseGoDocs(html);
  expect(Object.keys(rows)).toHaveLength(36);
  const distinct = new Set(Object.keys(rows).map(n => n.replace(/ \((≤|>) .*?\)$/, '')));
  expect(distinct.size).toBe(29);
});

it('parses token prices for GLM-5.2', () => {
  const row = parseGoDocs(html).rows['GLM-5.2'];
  expect(row.input).toBe(1.4);
  expect(row.output).toBe(4.4);
  expect(row.cachedRead).toBe(0.26);
  expect(row.cachedWrite).toBeNull();
  expect(row.allowance.go).toBe(60);
  expect(row.allowance['go-plus']).toBe(180);
});

it('reads the live value of a promotional allowance, not the struck-through one', () => {
  const row = parseGoDocs(html).rows['Step 5 Preview'];
  expect(row.allowance.go).toBe(60);
  expect(row.promo?.baseAllowance.go).toBe(15);
});

it('marks unlimited-allowance models', () => {
  const row = parseGoDocs(html).rows['LongCat 2.5 Preview Free'];
  expect(row.allowance.go).toBe('unlimited');
  expect(row.input).toBe(0);
});

it('throws rather than returning a partial table', () => {
  expect(() => parseGoDocs('<html><body>nope</body></html>')).toThrow();
});

it('reports no differences against itself', () => {
  const p = parseGoDocs(html);
  expect(diffPricing(p, p)).toEqual([]);
});

it('reports a changed allowance', () => {
  const p = parseGoDocs(html);
  const q = structuredClone(p);
  (q.rows['Kimi K3'].allowance as { go: number }).go = 99;
  expect(diffPricing(p, q)).toContainEqual(expect.stringContaining('Kimi K3'));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- tests/scrape-go.test.ts`
Expected: FAIL — cannot resolve `../scripts/scrape-go`.

- [ ] **Step 4: Implement `scripts/scrape-go.ts`**

Extract `<table>` blocks whose header cells are exactly `Model | Input | Output | Cached Read | Cached Write | Monthly limit`. Exactly two must match; the first is Go, the second Go Plus. Throw unless exactly two match and each yields 29 rows.

Per row: `cachedWrite` of `-` is `null`; `Free` is `0`. Decode HTML entities
before comparing (`&gt;` → `>`, `&amp;` → `&`; the context-tier names contain a
literal `≤`, which must survive decoding intact). For the monthly-limit cell,
remove `<del>…</del>`, then read "Unlimited" or the remaining `$N`. When a
`<del>` was present, record its value as `baseAllowance` and the `<small>` text
as `promo.label`.

Also export `main()` that fetches the live page, compares against `data/go-pricing.json`, prints the diff, and exits non-zero on any difference. Running with `--write` overwrites the file instead.

- [ ] **Step 5: Generate the data file**

Run: `npx tsx scripts/scrape-go.ts --write`
Then open `data/go-pricing.json` and confirm: 36 rows, `LongCat 2.5 Preview Free` and `Beam Free` unlimited, `Step 5 Preview` and `Gemini 4 Argon Contributor` carrying promos, and all eight context/peak tier pairs present.

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- tests/scrape-go.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scrape Go pricing with drift detection"
```

---

### Task 4: The Roster and its validation

**Files:**
- Create: `data/roster.yaml`
- Create: `scripts/validate-roster.ts`
- Test: `tests/validate-roster.test.ts`

**Interfaces:**
- Produces:
  - `interface RosterEntry { goId: string; display: string; aaSlug: string | null; aaVariant: string | null; tier: 'standard' | 'free' | 'unpriced' | 'incomplete'; priceRow: string | null; notes?: string }`
  - `function validateRoster(roster: RosterEntry[], goIds: string[], pricing: GoPricing, aaSlugs: string[]): string[]` — every problem, empty when clean

- [ ] **Step 1: Write the roster**

One entry per Go model ID. `priceRow` is the exact display name from `data/go-pricing.json`, or `null` for unpriced models. `aaSlug` is the AA slug or `null` when AA has no counterpart. Populate from `https://opencode.ai/inference/go/v1/models` (37 ids) cross-referenced with `data/go-pricing.json` (29 rows).

The eight known-unpriced ids (`glm-5.1`, `grok-4.6`, `kimi-k2.6`, `minimax-m2.5`, `minimax-m2.7`, `omen-alpha`, `qwen3.6-plus`, `qwen3.7-max`) get `tier: unpriced`, `priceRow: null`, `aaSlug: null`.

`LongCat 2.5 Preview Free` and `Beam Free` get `tier: free`.

Context-tiered models pick the lower-priced row and name it in `priceRow`, e.g. `qwen3.7-plus → "Qwen3.7 Plus (≤ 256K tokens)"`, `grok-4.7 → "Grok 4.7 (≤ 200K tokens)"`. DeepSeek uses the off-peak row.

- [ ] **Step 2: Write the failing tests**

```ts
it('accepts a consistent roster', () => { /* → [] */ });
it('reports a Go id with no roster entry', () => {
  expect(validateRoster([], ['kimi-k3'], pricing, [])).toContainEqual(expect.stringContaining('kimi-k3'));
});
it('reports a roster entry whose Go id no longer exists', () => {
  expect(validateRoster([entry('gone')], [], pricing, [])).toContainEqual(expect.stringContaining('gone'));
});
it('reports a priceRow absent from go-pricing.json', () => {
  expect(validateRoster([entry('kimi-k3', { priceRow: 'Nope' })], ['kimi-k3'], pricing, [])).toContainEqual(expect.stringContaining('Nope'));
});
it('reports an aaSlug absent from the AA snapshot', () => {
  expect(validateRoster([entry('kimi-k3', { aaSlug: 'nope' })], ['kimi-k3'], pricing, ['kimi-k3'])).toContainEqual(expect.stringContaining('nope'));
});
it('reports an unpriced entry that has a priceRow', () => {
  expect(validateRoster([entry('kimi-k3', { tier: 'unpriced', priceRow: 'Kimi K3' })], ['kimi-k3'], pricing, [])).toContainEqual(expect.stringContaining('unpriced'));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- tests/validate-roster.test.ts`
Expected: FAIL — cannot resolve `../scripts/validate-roster`.

- [ ] **Step 4: Implement `scripts/validate-roster.ts`**

Return every problem rather than the first. Its `main()` loads the roster, fetches the Go model list, loads `data/go-pricing.json` and `data/aa-snapshot.json` (an empty slug list is tolerated so the build works before the AA key exists), then prints all problems and exits non-zero if any.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tests/validate-roster.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: curated Go-to-AA roster with hard validation"
```

---

### Task 5: Artificial Analysis fetch and snapshot

**Files:**
- Create: `scripts/fetch-aa.ts`
- Create: `tests/fixtures/aa-free.sample.json`
- Test: `tests/fetch-aa.test.ts`

**Interfaces:**
- Produces:
  - `interface AASnapshot { fetchedAt: string; intelligenceIndexVersion: string | null; models: AAModel[] }`
  - `interface AAModel { slug: string; name: string; scores: Partial<Record<IndexKey, number | null>> }`
  - `function parseAAResponse(body: unknown): AASnapshot`
  - `function fetchAA(apiKey: string): Promise<AASnapshot>`

- [ ] **Step 1: Capture a fixture**

Save a real Free-tier response to `tests/fixtures/aa-free.sample.json`. Shape is Appendix A of the spec. If no key exists yet, hand-build it from that appendix with three models, clearly named `fixture-…`, and note in the file that it is synthetic.

- [ ] **Step 2: Write the failing tests**

```ts
it('reads scores and slug from the response', () => {
  const snap = parseAAResponse(fixture);
  expect(snap.models[0].slug).toBe('gpt-oss-20b');
  expect(snap.models[0].scores.artificial_analysis_intelligence_index).toBe(24.5);
});
it('keeps null scores as null, never zero', () => {
  expect(parseAAResponse(withNullScore).models[0].scores.artificial_analysis_coding_index).toBeNull();
});
it('captures the index version', () => {
  expect(parseAAResponse(fixture).intelligenceIndexVersion).toBe('4.1');
});
it('follows pagination while has_more is true', () => { /* two pages → 2 models */ });
it('throws on a malformed body', () => {
  expect(() => parseAAResponse({ data: 'nope' })).toThrow();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- tests/fetch-aa.test.ts`
Expected: FAIL — cannot resolve `../scripts/fetch-aa`.

- [ ] **Step 4: Implement `scripts/fetch-aa.ts`**

`GET https://artificialanalysis.ai/api/v2/language/models/free` with `x-api-key`, `page_size=200`, following `pagination.has_more`. Its `main()` writes `data/aa-snapshot.json` and exits `0` with a printed warning when `AA_API_KEY` is unset — it must not fail the build.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tests/fetch-aa.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: fetch AA free-tier snapshot"
```

---

### Task 6: Build the dataset

**Files:**
- Create: `scripts/build-dataset.ts`
- Test: `tests/build-dataset.test.ts`

**Interfaces:**
- Consumes: `RosterEntry`, `Dataset`, `DatasetModel` from Task 1; `GoPricing` from Task 3; `AASnapshot` from Task 5; `validateRoster` from Task 4.
- Produces:
  - `function buildDataset(roster: RosterEntry[], pricing: GoPricing, snapshot: AASnapshot | null): Dataset`

- [ ] **Step 1: Write the failing tests**

```ts
it('joins roster, pricing and scores by id', () => {
  const m = buildDataset(roster, pricing, snapshot).models.find(x => x.goId === 'kimi-k3')!;
  expect(m.prices!.input).toBe(3);
  expect(m.allowances!.go).toBe(15);
  expect(m.scores.artificial_analysis_intelligence_index).toBe(47);
});
it('keeps unpriced models with null prices', () => {
  expect(...models.find(x => x.goId === 'glm-5.1')!.prices).toBeNull();
});
it('keeps unscored models with empty scores', () => {
  expect(...models.find(x => x.goId === 'space-bunny')!.scores).toEqual({});
});
it('records plan prices of 10 and 40', () => {
  expect(ds.plans.go.price).toBe(10);
  expect(ds.plans['go-plus'].price).toBe(40);
});
it('is deterministic apart from timestamps', () => { /* build twice, compare minus generatedAt */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/build-dataset.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/build-dataset.ts`**

Reads `data/roster.yaml`, `data/go-pricing.json`, `data/aa-snapshot.json` (absent is fine), validates via Task 4, and writes `data/dataset.json`. Missing AA file → every `scores` is `{}` and `aaFetchedAt` is `null`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/build-dataset.test.ts && npm run data:build`
Expected: PASS, and `data/dataset.json` exists with 37 models.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: build joined dataset"
```

---

### Task 7: Chart scene

**Files:**
- Create: `src/scales.ts`
- Create: `src/chart.ts`
- Test: `tests/chart.test.ts`

**Interfaces:**
- Produces:
  - `function logScale(domain: [number, number], range: [number, number]): (v: number) => number`
  - `function linearScale(domain: [number, number], range: [number, number]): (v: number) => number`
  - `function logTicks(min: number, max: number): number[]`
  - `function formatPrice(v: number): string` — `$0.001`, `$0.048`, `$1.20`
  - `type Shape = { kind: 'circle'; cx: number; cy: number; r: number; cls: string } | { kind: 'path'; d: string; cls: string } | { kind: 'text'; x: number; y: number; text: string; cls: string }`
  - `interface Scene { width: number; height: number; shapes: Shape[]; empty: string | null }`
  - `function buildScene(points: ChartPoint[], opts: SceneOptions): Scene`

- [ ] **Step 1: Write the failing tests**

```ts
const pts = [
  { id: 'a', label: 'A', cost: 0.001, score: 40, frontier: false },
  { id: 'b', label: 'B', cost: 0.01,  score: 50, frontier: true },
];

it('builds one circle per point', () => {
  expect(buildScene(pts, OPTS).shapes.filter(s => s.kind === 'circle')).toHaveLength(2);
});
it('maps cost logarithmically', () => {
  const scene = buildScene(pts, OPTS);
  const [a, b] = scene.shapes.filter(s => s.kind === 'circle') as Extract<Shape, {kind:'circle'}>[];
  expect(b.cx).toBeGreaterThan(a.cx);
});
it('draws a frontier path only when at least two points are on it', () => {
  expect(buildScene([pts[1]], OPTS).shapes.filter(s => s.kind === 'path')).toHaveLength(0);
});
it('returns an empty state instead of NaN for no points', () => {
  const scene = buildScene([], OPTS);
  expect(scene.empty).toBeTruthy();
  expect(scene.shapes.some(s => s.kind === 'circle')).toBe(false);
});
it('returns an empty state for a single point', () => {
  expect(buildScene([pts[1]], OPTS).empty).toBeTruthy();
});
it('emits decade ticks inside the domain', () => {
  expect(logTicks(0.0005, 0.4)).toEqual([0.001, 0.01, 0.1]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/chart.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/scales.ts` and `src/chart.ts`**

`buildScene` returns a pure description — no DOM. Y domain is fixed `[0, 100]`. X domain is `[minCost/2, maxCost*2]`, clamped to positive values. The frontier path is a monotone step: horizontal from each frontier point's x to the next frontier point's x, vertical at each point. `empty` is set when fewer than two plottable points exist.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/chart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: chart scene builder"
```

---

### Task 8: Page, controls, table, styles

**Files:**
- Create: `index.html`, `src/main.ts`, `src/render.ts`, `src/table.ts`, `src/style.css`
- Modify: `vite.config.ts`
- Test: `tests/table.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `buildScene`, `toFrontierInputs`, `paretoFrontier`, `formatPrice`.
- Produces:
  - `function renderTableHtml(dataset: Dataset, opts: { plan: Plan; index: IndexKey; mix: Mix }): string` — complete `<table>` markup, pure string, no DOM
  - `function render(state: UiState): void`

- [ ] **Step 1: Write the failing table test**

```ts
it('renders one row per model', () => {
  expect((renderTableHtml(ds, OPTS).match(/<tr/g) ?? []).length).toBe(38); // 1 header + 37 models
});
it('prints the effective price for a priced model', () => {
  expect(renderTableHtml(ds, OPTS)).toContain('GLM-5.2');
});
it('marks unpriced models instead of rendering a zero', () => {
  const html = renderTableHtml(ds, OPTS);
  expect(html).toContain('no published price');
});
it('escapes HTML in model names', () => { /* name with < → &lt; */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/table.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/table.ts`**

Columns: model, effective $/1M, score, multiplier, list blended price, tier. Unpriced and unscored models print words, never `0`, `NaN`, or `—` without explanation. Escape every interpolated string.

- [ ] **Step 4: Inject the table at build time**

The table must exist in `index.html` before any JavaScript runs. Add a Vite plugin in `vite.config.ts`:

```ts
export function injectTable(): Plugin {
  return {
    name: 'inject-dataset-table',
    transformIndexHtml(html) {
      const dataset: Dataset = JSON.parse(readFileSync('data/dataset.json', 'utf8'));
      return html.replace('<!--DATASET_TABLE-->', renderTableHtml(dataset, DEFAULT_UI));
    },
  };
}
```

Put `<!--DATASET_TABLE-->` in `index.html` where the table belongs. Build fails when `data/dataset.json` is missing — that is correct; run `npm run data:build` first.

- [ ] **Step 5: Build the page**

Layout top to bottom: title + plan toggle; index selector; SVG chart; free rail; "no published price" list; details card for the hovered/focused point; the injected table; footer with AA attribution and snapshot timestamps.

Section headings and the frontier explanation are plain text. The AA credit line reads exactly `Source: Artificial Analysis (artificialanalysis.ai)` and links to `https://artificialanalysis.ai`.

- [ ] **Step 6: Implement `main.ts`**

Fetch `data/dataset.json` (base-path aware via `import.meta.env.BASE_URL`). Compute buckets with `DEFAULT_MIX`, build the scene, draw it. The mix control has three number inputs in percent and a "reset" button; changing them recomputes everything without refetching. The plan toggle and index selector likewise recompute only.

Points are `<g tabindex="0">` so the chart is keyboard-navigable; focusing a point updates the details card and `aria-label`s the circle. The injected table is not re-rendered by JS — it is the no-JS fallback and the aria alternative.

- [ ] **Step 7: Style**

Light background, system font stack, accent colour for frontier points and the frontier line, muted grey for dominated points. Points on the frontier are labelled; dominated points are not. Empty states are styled text, not blank space.

- [ ] **Step 8: Verify manually**

Run: `npm run data:build && npm run dev`
Expected: page renders; toggling plan changes x positions; switching index changes buckets and shows the unscored list; setting cached to 1 and input/output to 0 still renders; the table lists all 37 models.

- [ ] **Step 9: Verify the no-JS path**

Run: `npm run build && npx vite preview --base /opencode-pareto/`, then disable JavaScript in the browser.
Expected: the table is present and complete, and a `<noscript>` note explains that the chart needs scripts.

- [ ] **Step 10: Verify the no-data path**

Temporarily rename `data/aa-snapshot.json`, rebuild, load.
Expected: chart shows the "no scores yet" empty state, table still renders, no NaN in the console.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: page, controls, table and styles"
```

---

### Task 9: CI and Pages deployment

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write the workflow**

One workflow, triggers `push` to `main`, `schedule` (daily 06:00 UTC) and `workflow_dispatch`. Permissions: `contents: write`, `pages: write`, `id-token: write`. Steps:

1. Checkout, setup Node 22, `npm ci`.
2. If scheduled or manual: `npm run scrape:go` (drift check), `npm run fetch:aa` (uses `secrets.AA_API_KEY`, tolerates absence), `npm run data:build`, then commit and push `data/` if it changed.
3. `npm run test`.
4. `npm run build`, upload artifact, deploy to Pages.

The data commit happens **in the same workflow** as the deploy — a `GITHUB_TOKEN` push does not trigger another workflow run, so a separate deploy workflow would never fire.

- [ ] **Step 2: Verify the YAML parses**

Run: `npx --yes yaml-lint .github/workflows/deploy.yml` (or `python -c "import sys,yaml;yaml.safe_load(open(sys.argv[1]))" .github/workflows/deploy.yml`)
Expected: no error.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "ci: build, refresh data and deploy to Pages"
gh repo create opencode-pareto --public --source=. --remote=origin --push
gh api -X POST repos/:owner/opencode-pareto/pages -f build_type=workflow
```

Expected: the first run fails loudly on roster mismatches if the AA key is absent — that is correct behaviour, not a defect.

- [ ] **Step 4: Confirm the live page**

Open `https://koenniem.github.io/opencode-pareto/`.
Expected: page loads with the committed dataset; no 404 on `data/dataset.json`; the base path is correct.

---

### Task 10: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README**

What the site answers, how the multiplier works (with the GLM-5.2 vs Kimi K3 example), how to add `AA_API_KEY`, how to refresh data, the roster's purpose and how to update it when OpenCode adds a model, and the AA attribution statement.

- [ ] **Step 2: Run the full suite**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 3: Verify the frontier by hand**

Pick three consecutive frontier models from the rendered page. Confirm each is cheaper than the next and has a strictly higher score, and that the model immediately below the line in price is dominated by one of them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: readme and data-refresh instructions"
```
