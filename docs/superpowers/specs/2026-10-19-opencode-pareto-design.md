# OpenCode Pareto — Design

Date: 2026-10-19
Status: awaiting approval

## Intent

Artificial Analysis charts quality against **list API price**. That answer is
wrong for anyone on the OpenCode Go subscription, because Go sells **monthly
dollar allowances** rather than tokens. A $10 plan buys a $60 allowance on
GLM-5.2 but only a $15 allowance on Kimi K3. The discount is **per model**, not
per plan, and it reshuffles the ranking enough that AA's chart cannot answer
the question.

OpenCode Pareto answers one question: **which model gives the most capability
per dollar under OpenCode Go?**

The user's stated decision loop: pick a performance level they need, look at
models at or near the Pareto frontier, take the cheapest one that clears the
bar. The site is a single scatter plot with a frontier line. That is the whole
product.

## Goals

- One page, one scatter: x = effective cost under Go, y = capability score,
  with the Pareto frontier drawn through it.
- Correct per-model multiplier, not a single plan-wide discount.
- Plan toggle (Go $10 / Go Plus $40), because allowances do not scale
  proportionally and the frontier ordering genuinely changes between plans.
- Default y-axis Intelligence Index, toggle to Coding Index, extensible to
  further AA indices later.
- Attribution to Artificial Analysis visible on the chart.
- Static hosting on GitHub Pages. No backend, no key in the browser.

## Non-Goals

- No time series, no performance-over-time. Snapshot only.
- No provider-level latency/throughput comparison. (Could come later; AA
  Commercial tier required.)
- No accounts, no saved state, no sharing.
- No model-role taxonomy (worker vs orchestrator). Explicitly declined: the
  chart is read by eye.
- No 5-hour-window modelling. Monthly allowance only.
- No recommendation engine or "best model" verdict. The frontier is the answer.

## Anti-Goals

These would make the site a failure even if it technically works:

- A chart that quietly misprices a model because a name join guessed wrong.
- A frontier that is drawn through free models and therefore tells the user
  nothing.
- A default token mix that misrepresents how Go is actually used, producing a
  frontier that looks authoritative and is wrong.
- Publishing AA data in a way that misrepresents their scores (their §3
  prohibits altering values while implying AA origin).

## Decisions already made (by the user)

| Decision | Choice |
| --- | --- |
| AA licensing | Publish with attribution now (§2.3(b) chart sharing, §5.1 attribution). User accepts residual §2.5 risk. |
| Cost axis | Effective $/1M blended tokens, log scale |
| Score axis | Intelligence Index default, toggle to Coding Index, more later |
| Roles | None — plain scatter |
| Free models | Effective price $0 → excluded from frontier, shown in a labelled rail |
| Token mix | One global mix, applied to every model, adjustable in UI |
| Multiplier | `allowance ÷ subscription` as a discount |
| Plans | Go and Go Plus, toggle |
| Repo | Public. GitHub Pages on a free account. |
| Default mix | 98.45% cached read, as derived |
| AA key | Not available yet. Build against fixtures; first CI run validates the roster. |

## The maths

### Effective price

```text
multiplier(m)  = allowance(m) / subscription(plan)
effective(m)   = list_blended(m) / multiplier(m)
               = list_blended(m) * subscription(plan) / allowance(m)
```

Where `list_blended(m)` is the model's Go token prices combined with the global
token mix:

```text
list_blended(m) = mix.in * price_in(m)
                + mix.cached * price_cached(m)
                + mix.out * price_out(m)
                + mix.cache_write * price_cache_write(m)
```

All prices per 1M tokens. `mix` components sum to 1.

### Default token mix

Derived from OpenCode's own published per-request token estimates (the 24
models in their docs that carry token counts), taking the median share:

```text
in 1.14%   cached 98.45%   out 0.36%   cache_write 0%
```

Rationale: this is *their* assumed usage pattern, so it is the least
editorial choice available. Validation: applying this mix reproduces their
published request-per-month figures (GLM-5.3-Flash → 31,579 computed vs 31,580
published; Kimi K3 → 490 vs 490).

This mix is aggressively cache-heavy and will surprise people. The UI must say
so, and the mix must be adjustable — a 1:1 blend moves the frontier a lot.

### Pareto frontier

A model `a` dominates `b` when `effective(a) <= effective(b)` **and**
`score(a) >= score(b)`, with at least one strict. The frontier is the
non-dominated set, sorted by effective price ascending, drawn as a monotone
step/line.

Free models (`allowance = Unlimited`) have `effective = 0` and are **excluded
from the frontier computation entirely**, then rendered separately.

### Context-tiered prices

Several models have tiered pricing by context length (Grok 4.7 at 200K, GPT 6
Luna and GPT 5.6 Luna at 272K, Claude Haiku 5.5 at 100K, Qwen3.7 Plus at 256K)
and DeepSeek has peak/off-peak pricing. Rule: **use the lower/off-peak tier**,
because it is the price the majority of requests pay. The Roster records which
tier was chosen and the tooltip states it.

## Data

### Sources

| Source | Access | Cadence |
|---|---|---|
| `https://artificialanalysis.ai/api/v2/language/models/free` | `x-api-key` header, Free tier | daily |
| `https://opencode.ai/docs/go/` | public HTML | daily, with drift detection |
| `https://opencode.ai/inference/go/v1/models` | public, no auth | daily, presence check only |

AA Free tier provides: Intelligence / Coding / Agentic indices, six capability
indices, input/output/cache-hit/cache-write prices, median performance. That is
sufficient. Pro is not required.

### Committed artifacts

```text
data/
  roster.yaml          # hand-curated Go ↔ AA mapping (the join)
  go-pricing.json      # Go allowances + token prices, both plans (curated)
  aa-snapshot.json     # raw AA response, verbatim, with fetch timestamp
  dataset.json         # built join output consumed by the site
```

`aa-snapshot.json` is stored verbatim and never edited by hand. `dataset.json`
is generated. Both are committed by CI so every data change is a reviewable
diff, and so the site builds with no key present.

### The Roster

The name join is the highest-risk part of this project. AA lists variants
(`GLM-5.3 (Max)`, `Kimi K3 (Max)`, `Qwen3.8 Max (0902)`); Go lists base model
IDs plus context tiers; AA slugs are not derivable from Go IDs. String matching
will produce silent, confident errors.

`data/roster.yaml` is a hand-reviewed file. One entry per Go model:

```yaml
- go_id: kimi-k3
  display: Kimi K3
  aa_slug: kimi-k3                 # null = no AA counterpart
  aa_variant: max                  # which AA variant to score, documented
  tier: standard                   # standard | free | unpriced
  notes: "AA scores the Max variant"
```text

Build-time rules, all hard failures:

- Every `go_id` returned by the Go models endpoint has a roster entry.
- Every non-null `aa_slug` resolves to a model in the AA snapshot.
- Every `aa_variant` is one of a documented closed set.
- An entry with `tier: unpriced` must have no pricing data, and vice versa.

Consequence: when OpenCode adds or removes a model, **CI fails** and a human
updates the roster. That is the intended behaviour. A silent drop is the thing
we are buying insurance against.

### Known data gaps

Eight models are served by Go but absent from its published pricing table:
`glm-5.1`, `grok-4.6`, `kimi-k2.6`, `minimax-m2.5`, `minimax-m2.7`,
`omen-alpha`, `qwen3.6-plus`, `qwen3.7-max`.

They are marked `tier: unpriced` and rendered in a collapsed "no published
price" list. They are **not** silently omitted, and they never enter the
frontier.

## Architecture

Static site, no backend, no runtime API calls.

```text
GitHub Actions (daily cron + manual)
  ├─ fetch AA /language/models/free     (secret: AA_API_KEY)
  ├─ fetch opencode.ai/inference/go/v1/models
  ├─ scrape opencode.ai/docs/go         → drift check vs go-pricing.json
  ├─ validate roster against both sides
  ├─ build dataset.json
  └─ commit data/ → triggers Pages deploy

GitHub Pages
  └─ static bundle + data/dataset.json
```

**Key handling.** `AA_API_KEY` lives only in GitHub Actions repository secrets.
It is never bundled, never in the browser, never in the repo. The site works
with the committed snapshot and needs no key at all. Local development uses the
committed snapshot by default; a developer can supply their own key in
`.env.local` (gitignored) to refresh it.

**Drift detection.** The Go pricing scrape is fragile by nature. Rather than
trusting a parse, CI compares the scraped table against the committed
`go-pricing.json` and fails on any difference, emitting a diff. A human updates
the curated file. No silent re-pricing.

## Stack

Vite + TypeScript + hand-rolled SVG. No chart library, no framework.

Reasoning: the chart is a scatter with a frontier line and maybe 30 points. A
charting library would add a dependency, a bundle, and a styling fight for less
control than ~300 lines of SVG. Zero runtime dependencies means the site cannot
rot.

Pages deploy via the standard `actions/deploy-pages` workflow from a build
artifact (not a `gh-pages` branch).

## UI

Single page, single chart.

```text
┌──────────────────────────────────────────────────────────┐
│  OpenCode Pareto                      [Go $10] [Go+ $40] │
│                                                          │
│  Capability                                              │
│  ▲        Intelligence ▾                                 │
│  │                          ╭─────● GLM-5.2              │
│  │                    ╭─────╯                             │
│  │              ╭─────╯   ● Kimi K3                      │
│  │        ╭─────╯                                        │
│  │   ╭────╯  ● MiMo-V2.6-Pro                             │
│  │ ╭─╯                                                   │
│  └─┴──────────────────────────────────────────►          │
│     Effective $/1M blended tokens (log)                  │
│                                                          │
│  Free (unlimited allowance):  ● LongCat 2.5  ● Beam Free │
│  No published price:          glm-5.1, grok-4.6, …       │
│                                                          │
│  Mix: in 1.14% · cached 98.45% · out 0.36%  [adjust]     │
│  Source: Artificial Analysis (artificialanalysis.ai)     │
└──────────────────────────────────────────────────────────┘
```

Elements:

- **Plan toggle** — Go / Go Plus. Recomputes everything.
- **Score selector** — Intelligence (default), Coding. Data model supports
  adding the six capability indices without structural change.
- **Scatter** — one dot per priced model, log x-axis. Hover/focus shows a
  tooltip: model, score, effective price, multiplier, list price, which
  context tier and peak/off-peak assumption was used, and the AA variant
  scored.
- **Frontier line** — drawn through non-dominated models only.
- **Free rail** — free models, visually separated, clearly marked as not on
  the frontier.
- **Unpriced list** — collapsed, plain text.
- **Mix control** — editable in/out/cached proportions with the default
  restored by one click.
- **Attribution** — AA logo on the chart plus "Source: Artificial Analysis
  (artificialanalysis.ai)" with hyperlink, per their §5.1.
- **Data freshness** — snapshot timestamp visible.

Accessibility: keyboard-navigable points, values available as text (not
colour- or hover-only), sufficient contrast, `<table>` fallback of the same
data for screen readers and for anyone who wants the numbers.

## Constraints

- Everything must be computable at build time from committed files. No runtime
  fetches.
- The site must render correctly with zero JavaScript failures — i.e. the data
  table is server-rendered in the HTML, not injected only by JS.
- No dependency that requires a paid tier to keep working.
- All monetary values in USD.

## Left to the builder

- Exact SVG layout, tick selection, colour palette, responsive behaviour.
- Whether the mix control is a slider, number inputs, or a preset dropdown.
- Tooltip interaction (hover vs click vs focus) on touch devices.
- Test framework choice and coverage targets.
- Repo scaffolding specifics, CI workflow YAML.
- How the Go docs page is parsed (regex vs HTML parser) — so long as drift
  detection fails loudly.
- Whether `dataset.json` is fetched at runtime or inlined at build. Inlining is
  smaller and avoids a request; fetching keeps HTML lean.

## Risks

| Risk | Mitigation |
|---|---|
| AA §2.5 anti-competitive clause could be read to cover this | Accepted by user. Attribution per §5.1. Keep scores unaltered (§3). |
| AA Free tier could change or be withdrawn | Snapshot is committed; site keeps working. Fetch layer is a single module. |
| Go docs HTML changes break the scrape | Drift detection fails CI loudly; curated file is the source of truth. |
| Roster silently mismatches a variant | Hard build failure on unknown slug/variant; roster is reviewed. |
| Cache-heavy default mix misleads | Stated in UI, adjustable, one-click restore to default. |
| Free API rate limit (100/day) | We use 2 requests/day. |

## Appendix: Free-tier response shape (verified)

From `GET /api/v2/openapi`, `LLMModelsFreeResponse`. This is the actual
contract; no discovery spike needed.

```json
{
  "tier": "free",
  "intelligence_index_version": "4.1",
  "pagination": { "page": 1, "page_size": 200, "total_pages": 2, "has_more": true },
  "data": [{
    "id": "36f73aaf-...",
    "name": "gpt-oss-20B (high)",
    "slug": "gpt-oss-20b",
    "release_date": "2025-08-05",
    "model_creator": { "id": "...", "name": "OpenAI" },
    "evaluations": {
      "artificial_analysis_intelligence_index": 24.5,
      "artificial_analysis_coding_index": 18.5,
      "artificial_analysis_agentic_index": 27.6,
      "artificial_analysis_finance_and_accounting_index": 7.3,
      "artificial_analysis_strategy_and_ops_index": 4.8,
      "artificial_analysis_legal_index": 7.3,
      "artificial_analysis_healthcare_and_medical_index": 6.6,
      "artificial_analysis_engineering_index": 11.7,
      "artificial_analysis_economics_index": 11.3
    },
    "artificial_analysis_intelligence_index_cost": {
      "total_cost": 20.69,
      "cost_per_task": { "total_cost": 0.1678 }
    },
    "pricing": {
      "price_1m_input_tokens": 0.06,
      "price_1m_output_tokens": 0.2,
      "price_1m_cache_hit_tokens": 0.015,
      "price_1m_cache_write_tokens": 0.075
    },
    "performance": {
      "median_output_tokens_per_second": 296.47,
      "median_time_to_first_token_seconds": 0.65,
      "median_time_to_first_answer_token_seconds": 7.4,
      "median_end_to_end_response_time_seconds": 9.09
    }
  }]
}
```

Notes for the builder:

- `slug` is the AA identifier. `name` carries the variant suffix (`(high)`, and
  in practice `(Max)`, `(Xhigh)`, dated suffixes). **The roster matches on
  `slug`; `aa_variant` disambiguates only when AA publishes several rows for
  one slug.**
- `null` in AA's data means "not measured". It must never be coerced to 0.
- `intelligence_index_version` is captured into the snapshot and displayed;
  scores are not comparable across versions.
- `pricing` uses AA's list prices. These are **not** what the chart uses for
  the x-axis (Go publishes its own per-model token prices, and the allowance is
  metered at those). AA's `pricing` is only used to show the list-price
  reference in the tooltip.

## Settled by the builder (not user decisions)

These came back from a build-readiness review. Resolved as follows:

**Plan availability is uniform.** Both plans price the same 29 models with
identical token prices; only the allowance column differs. The plan toggle is
pure recomputation, not a change of point set. Validation is per-plan only in
that both allowance columns must exist.

**Partial pricing fails closed.** If a model lacks a price for any component
carrying non-zero weight in the current mix, it moves to the `incomplete`
bucket and is excluded from the frontier. There is no substitution, no
fallback to input price, no zero. With the default mix at 98.45% cached read, a
missing cache price would otherwise move a point by two orders of magnitude —
exactly the anti-goal. `tier: incomplete` is the third roster state alongside
`free` and `unpriced`.

**`tier` naming conflict resolved.** The roster's `tier` field means *pricing
completeness* (`standard | free | unpriced | incomplete`). The context-tier
choice (e.g. `qwen3.7-plus ≤256K`) becomes a separate `price_row` field naming
the exact row lifted from Go's table.

**A fourth UI bucket exists: "priced but unscored".** Models with a price but
no value for the *selected* index. Excluded from the frontier; listed with the
reason. Frontier is computed per selected index, not once.

**No-JS scope is the table only.** One canonical state is baked into the HTML
(Go, Intelligence Index, default mix). Toggles are progressive enhancement. No
SSG prerender of the SVG, no second render path.

**The default mix is a hardcoded constant with regression tests.** It is not
recomputed in CI — that would need a second, more fragile scrape. Instead the
published request-per-month counts for a handful of models are encoded as
tests: if someone changes the constant or the blend maths, those counts stop
reproducing and the test fails.

**Repo is public.** GitHub Pages on a free account. Consequence, accepted: the
committed AA snapshot is publicly downloadable, which sits closer to
§2.4 (bulk data) than §2.3(b) (sharing a chart). The deployed `dataset.json` is
publicly fetchable regardless, because the browser has to fetch it. Committing
the snapshot buys reviewable data diffs, which is worth more than the marginal
exposure.

**The AA key does not exist yet.** This changes the build order, not the
design. It means:

1. Development runs against a hand-built fixture of the AA Free response,
   shaped exactly per the appendix. The fixture is committed.
2. The fetch step is written, but its first real validation happens on the
   first CI run after the key is added.
3. Because the roster is the highest-risk component and cannot be verified
   without a live response, **the first CI run is a gate, not a formality.**
   The workflow must fail loudly and print every unmatched slug, every
   unmatched Go model, and every roster entry that resolved to nothing. A
   green run with warnings is not acceptable.

Adding the key is one command, performed by the user:

```text
gh secret set AA_API_KEY --repo <owner>/opencode-pareto
```

## Repo and deployment

- Public repo `<owner>/opencode-pareto`. `gh` is already authenticated as
  `koenniem` on this machine; no remote is configured yet.
- GitHub Pages served from a build artifact via `actions/deploy-pages`, not a
  `gh-pages` branch.
- Vite `base` must be set to `/opencode-pareto/` for a project-page URL.
- Deploy workflow: `push` to `main` plus the daily data cron. The cron job
  commits; that commit triggers deploy, avoiding a recursive trigger.

## Open question, deferred

The 5-hour window (20% of monthly allowance per 5 hours) can bind before the
monthly allowance does for heavy users. Explicitly out of scope for v1. If it
turns out to matter, the fix is a third axis or a second frontier, not a
rewrite.
