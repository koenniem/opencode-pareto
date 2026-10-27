# OpenCode Pareto

Which model gives the most capability per dollar on the **OpenCode Go**
subscription.

Artificial Analysis publishes the weighted cost of completing one Intelligence
Index task for every model. That is a better unit for Go than a blended token
price: a task's cost reflects how many input, cached and output tokens the model
actually burns, including reasoning. DeepSeek can be cheap per token and
expensive per task; a high-effort model can be cheap per token and expensive per
task. This site takes AA's cost per task, translates it to OpenCode's token
prices, applies the plan's per-model usage multiplier, and draws the Pareto
frontier through the result.

Live: `https://<owner>.github.io/opencode-pareto/`

## How the cost is calculated

```text
aa cost/task       = AA's weighted cost for one Intelligence Index task, at AA prices
adjusted cost/task = aa cost/task × (OpenCode price ÷ AA price)   [when the bases differ]
Go cost/task       = adjusted cost/task ÷ (monthly allowance ÷ subscription price)
```

The last step is a **usage multiplier**: a $60 allowance on a $10 plan means six
times the list-price usage, so each task costs one sixth as much. On the $10 Go
plan:

| Model | AA cost/task | Allowance | Usage × | Go cost/task |
| --- | --- | --- | --- | --- |
| GPT-6 Luna (Max) | $0.068 | $15 | 1.5× | $0.045 |
| Kimi K3 (Max) | $2.00 | $15 | 1.5× | $1.33 |
| GLM-5.3 (Max) | $2.01 | $15 | 1.5× | $1.34 |
| DeepSeek V4.1 Flash 1017 (Max) | $0.262 | $80 | 8× | $0.016 |
| Muse Spark 1.3 Contributor (Max) | $1.60 (adjusted) | $60 | 6× | $0.0058 (estimate) |

The point is the spread: GPT-6 Luna costs about 30× less per task than GLM-5.3
Max, even though the two token price sheets look closer. That reshuffling is the
reason this chart exists.

**Go cost per task assumes you spend the whole monthly allowance on that one
model.** Allowances do not pool across models: unused GLM-5.3 allowance cannot
pay for Kimi K3.

### Price-basis adjustment

AA's cost per task is calculated at AA's own token prices. OpenCode's prices
usually match. Where they are proportional, the conversion is exact: Gemini 4
Argon Contributor is 2× AA, DeepSeek off-peak is 0.5×. Where only one component
differs, the free AA API omits the token counts needed for an exact conversion,
so the site scales by the cache-heavy mix used for agentic coding:

```text
input 1.14%   cached read 98.50%   output 0.36%
```

Those rows are labelled **price estimate** in the table and inspector. A Pro AA
key, which exposes token counts, would make the conversion exact. The mix is no
longer a site control: the chart's cost comes from AA's measured tokens, not
from a user-chosen blend.

### Reading the chart

- **Colour = lab.** Every dot is coloured by who built the model, with the
  legend under the chart. The chart names the frontier and the highest-priority
  points (roughly twenty in the default view and ten in the all-efforts view),
  never overlaps them, and leaves the rest to hover and the table.
- **Log or linear.** The cost axis starts logarithmic because the costs span
  three orders of magnitude. The Log/Linear toggle above the chart switches to a
  true zero-based dollar axis; linear shows the money distances, log keeps the
  cheap end readable.
- **The upper-left arrow.** An arrow and “Better value” label mark the preferred
  direction: cheaper and more capable. It is a direction cue, not a threshold or
  a shaded quadrant.
- **Hover a lab.** Hover or focus a legend item to dim every other lab. That
  lab's dots, ladders and labels stay at full opacity; leave or blur to restore.
- **The band.** A strict frontier says Muse Spark 1.3 Contributor dominates
  everything, which is true but leaves nothing to choose between. The band
  flags models within N score points of the best available at their cost or
  cheaper, so there is a shortlist instead of a single answer. The corridor is
  filled with a dashed lower edge rather than implied by opacity; N is a range
  slider and the count next to it says how many models it admits.
- **Effort levels.** Artificial Analysis scores many models at several thinking
  settings. The default chart shows one point per model at its primary setting.
  **All effort levels** draws each model's rungs as connected, diagonal steps:
  higher effort costs more per task and usually scores higher. Lower rungs are
  smaller, and the tooltip names the effort. The cost already includes the extra
  reasoning tokens, so the rungs do not share a price.
- **The tooltip.** Hovering or focusing a point shows its Go cost per task, AA
  cost per task, score, usage multiplier and tasks per allowance. The inspector
  below keeps the full calculation plus the effort ladder for models that have
  one.
- **Light and dark.** The palette is warm-monochrome so the fourteen lab hues
  are the only colour in the chart; switching theme re-tints surfaces, not data.
  The choice follows the OS until you pick one, is stored locally, and is
  applied before first paint so there is no white flash. A test asserts every
  text and point colour clears WCAG AA against its surface in both themes.
- **The table sorts.** Every column header is a button; values sort numerically
  with unpriceable models always last. It shows AA $/task, Go $/task and the
  usage multiplier alongside the score.

### What is not modelled

- **The 5-hour window.** Go caps you at 20% of the monthly allowance per 5
  hours. Monthly only, by choice.
- **Model roles.** No worker/orchestrator tags; read the curve.
- **Throughput or latency.** Scores only.
- **Your own token mix.** AA's measured cost already includes the task's token
  usage. The cache-heavy mix is used only to convert AA's price basis to
  OpenCode's when the two are not proportional.

## Data

| File | What it is |
| --- | --- |
| `data/roster.yaml` | The join. One hand-reviewed entry per Go model, carrying its AA slug and optional effort ladder. |
| `data/go-pricing.json` | Allowances and token prices, scraped from the Go docs and committed for review. |
| `data/aa-snapshot.json` | Artificial Analysis Free-tier response for the configurations the roster names, trimmed to what the site plots. Includes scores, cost per task and AA's token pricing. |
| `data/dataset.json` | Generated join. Consumed by the site. Each effort rung carries its AA and OpenCode-basis cost per task. |

Scores and costs come from
`https://artificialanalysis.ai/api/v2/language/models/free`, which returns the
Intelligence, Coding and Agentic indices plus the six capability indices,
`artificial_analysis_intelligence_index_cost.cost_per_task.total_cost`, and
input/output/cache pricing. The free tier omits token counts and blended
pricing; those are Pro-only. A refresh uses a handful of paginated requests.

### Adding the API key

The key never reaches the browser. The fetch script uses it (in CI or locally)
to write the snapshot the static site reads.

```bash
gh secret set AA_API_KEY --repo <owner>/opencode-pareto
```

Then trigger the workflow (`gh workflow run deploy.yml`) or wait for the daily
cron. Until then the site builds with no scores or costs and says so.

For local work, put the key in `.env` (already gitignored) and `npm run fetch:aa`
will load it:

```bash
# .env
AA_API_KEY=...
```

`AA_API_KEY=... npm run fetch:aa` still works for a one-off. Never expose the
key through a `VITE_` variable; that would ship it to the browser.

### Refreshing data locally

```bash
npm ci
npm run scrape:go          # drift check against the committed pricing
npm run scrape:go -- --write   # accept the drift after reviewing it
npm run fetch:aa           # uses .env when present
npm run validate:roster
npm run data:build
```

`data/aa-full.json` is the untrimmed response, gitignored for size and
licensing; only the configurations the roster plots are committed.

`npm run scrape:go` exits non-zero when OpenCode changes a price or allowance.
That is intended: the committed file is the reviewed source of truth, so a
price change lands as a visible diff rather than a silent re-pricing.

The scheduled workflow has no human to review that diff, so it runs
`scrape:go -- --write` and lets the commit be the diff. Because nothing is
reviewing the numbers, `--write` refuses a scrape that drops more than a
quarter of the rows: that is a broken parse, not a re-price. If OpenCode really
did retire that much of the catalogue at once, `--write --force` overrides it.

### What counts as "on Go"

Only models in OpenCode's **published Go pricing table** count. The inference
endpoint at `/inference/go/v1/models` is a superset — it lists legacy and
infrastructure models that a Go subscription cannot actually use, so it is not
used as a source of truth and those models are deliberately absent from the
roster.

### When OpenCode adds a model

A new priced row appears in CI as a warning: `priced model missing from the
roster, not shown: <name>`. Add an entry to `data/roster.yaml` with the AA slug,
then run `npm run data:build`.

If AA has never scored the model, set `aaSlug: null` and it appears in the
"priced but not scored" list rather than on the chart. If AA scores a *different*
model (for example `Qwen3.8-Flash-Next` is not `Qwen3.8 Flash`), leave it null —
attaching another model's score is worse than showing no score.

### When a model gains effort levels

AA publishes each thinking setting as its own model row. Name the rungs in the
roster, lowest thinking first, and include the primary `aaSlug`:

```yaml
efforts:
  - aaSlug: kimi-k3-low
    label: Low
  - aaSlug: kimi-k3
    label: Max
```

`npm run validate:roster` fails if a rung is missing from the snapshot, a label
is repeated, or the ladder omits its default. Each rung carries its own AA cost
per task; a rung with no published cost is skipped rather than estimated. Only
thinking settings belong here: `qwen3-8-max` 0803/0902 are release snapshots,
not effort levels, so they are not a ladder.

DeepSeek V4.1 Flash is mapped to AA's `deepseek-v4-1-flash-1017` (Max), not the
older 0813 row. AA has no 1017 Non-reasoning sibling, so it is a single-rung
model; do not attach the older release's Non-reasoning score.

## Development

```bash
npm install
npm run data:build   # required before dev/build; the table is injected at build time
npm run dev
npm test
```

Stack: Vite, TypeScript, hand-rolled SVG. No runtime dependencies — the chart
is a scatter plus a staircase, which does not justify a charting library.

The chart geometry is built as a pure description (`src/chart.ts`), so it is
unit-tested without a DOM.

## Attribution

Scores and costs: [Source: Artificial Analysis
(artificialanalysis.ai)](https://artificialanalysis.ai). Scores are reproduced
unaltered. Go costs are this project's own calculation and are not endorsed by
Artificial Analysis.

Prices: [OpenCode Go documentation](https://opencode.ai/docs/go/).

Not affiliated with OpenCode or Artificial Analysis.
