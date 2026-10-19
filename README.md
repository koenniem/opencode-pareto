# OpenCode Pareto

Which model gives the most capability per dollar on the **OpenCode Go**
subscription.

Artificial Analysis charts quality against list API price. That answer is wrong
for Go, because Go sells **monthly dollar allowances** rather than tokens, and
the allowance is different for every model. This site applies that per-model
multiplier and draws the Pareto frontier through the result.

Live: `https://<owner>.github.io/opencode-pareto/`

## How the price is calculated

```text
multiplier(model) = monthly allowance ÷ subscription price
effective price   = blended list price ÷ multiplier
```

Both plans publish the same token prices; only the allowance differs. On the
$10 Go plan:

| Model | Allowance | Multiplier | Effective price |
| --- | --- | --- | --- |
| GLM-5.2 | $60 | 6.0× | $0.048 / 1M |
| Kimi K3 | $15 | 1.5× | $0.256 / 1M |

GLM-5.2 is not merely cheaper than Kimi K3 — the plan discounts it four times
harder. That reshuffling is the reason this chart exists.

**Effective price assumes you spend the whole monthly allowance on that one
model.** Allowances do not pool across models: unused GLM-5.2 allowance cannot
pay for Kimi K3.

### Token mix

Blended price needs a token mix. The default is the median of OpenCode's own
published per-request profiles:

```text
input 1.14%   cached read 98.50%   output 0.36%
```

That is extremely cache-heavy, and deliberately so: agentic coding re-reads a
large context every turn. It reproduces OpenCode's published
requests-per-month figures to within 1%, which is the test that pins it.

The mix is adjustable on the site. Changing it moves the frontier — models with
cheap cache reads (`MiMo-V2.6-Flash` at $0.0028/1M) gain a lot, models with
expensive cache (`GLM-5.2` at $0.26/1M) lose a lot.

### Reading the chart

- **Colour = lab.** Every dot is coloured by who built the model, with the
  legend under the chart. Names are placed on the chart itself and never
  overlap: a name with nowhere to go is dropped rather than stacked, and its
  tooltip still has it.
- **The band.** A strict frontier says Muse Spark 1.3 Contributor dominates
  everything, which is true but leaves nothing to choose between. The band
  flags models within N score points of the best available at their price or
  cheaper, so there is a shortlist instead of a single answer. N is adjustable
  and shown next to the control — a band you cannot see is a band that flatters
  bad value.
- **The table sorts.** Every column header is a button; values sort numerically
  with unpriceable models always last.

### What is not modelled

- **The 5-hour window.** Go caps you at 20% of the monthly allowance per 5
  hours. Monthly only, by choice.
- **Model roles.** No worker/orchestrator tags; read the curve.
- **Throughput or latency.** Scores only.

## Data

| File | What it is |
| --- | --- |
| `data/roster.yaml` | The join. One hand-reviewed entry per Go model, carrying its AA slug. |
| `data/go-pricing.json` | Allowances and token prices, scraped from the Go docs and committed for review. |
| `data/aa-snapshot.json` | Artificial Analysis Free-tier response, verbatim. Absent until the first fetch. |
| `data/dataset.json` | Generated join. Consumed by the site. |

Scores come from
`https://artificialanalysis.ai/api/v2/language/models/free`, which returns the
Intelligence, Coding and Agentic indices plus the six capability indices. The
Free tier is sufficient; 100 requests/day against our two.

### Adding the API key

The key never reaches the browser. It is used only by CI, which commits a
snapshot the static site reads.

```bash
gh secret set AA_API_KEY --repo <owner>/opencode-pareto
```

Then trigger the workflow (`gh workflow run deploy.yml`) or wait for the daily
cron. Until then the site builds with no scores and says so.

### Refreshing data locally

```bash
npm ci
npm run scrape:go          # drift check against the committed pricing
npm run scrape:go -- --write   # accept the drift after reviewing it
AA_API_KEY=... npm run fetch:aa
npm run validate:roster
npm run data:build
```

`npm run scrape:go` exits non-zero when OpenCode changes a price or allowance.
That is intended: the committed file is the reviewed source of truth, so a
price change lands as a visible diff rather than a silent re-pricing.

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

Scores: [Source: Artificial Analysis
(artificialanalysis.ai)](https://artificialanalysis.ai). Scores are reproduced
unaltered. Effective prices are this project's own calculation and are not
endorsed by Artificial Analysis.

Prices: [OpenCode Go documentation](https://opencode.ai/docs/go/).

Not affiliated with OpenCode or Artificial Analysis.
