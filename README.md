# Health Policy Simulator

A teaching simulator for *Introduction to Health Policy in the United States*. Students design a reform, choose the year it starts, and watch cost, quality and access respond over 20 years. The Iron Triangle trade-offs come out of the model's mechanisms (household choices, insurer pricing, provider capacity, employer offers, the public budget); none of them is written in as a rule.

It is a stylized teaching model, not a forecast. The numbers are meant to be directionally right and internally consistent, not to predict what a real bill would do.

## Run it

You need [Node.js](https://nodejs.org) 24 or newer. Nothing else is installed: the project has no dependencies.

```bash
npm run dev
```

Then open http://localhost:5173/. Leave the terminal window open while you use the simulator; closing it stops the site.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Build, then serve at http://localhost:5173/ |
| `npm run build` | Compile `src/` to browser modules in `web/dist/` |
| `npm run serve` | Serve `web/` without rebuilding |
| `npm test` | Run the 52 regression tests (about 10 seconds) |
| `npm run typecheck` | Type-check without building |

To put the simulator online, run `npm run build` and upload the `web/` folder to any static host (GitHub Pages, Netlify, the LMS). There is no server component.

## Using the dashboard

**Scenarios.** The menu at the top of the left panel loads a ready-made reform (death spiral, single payer, NHS-style public delivery, and so on). Moving any lever switches it to "Custom package".

**Timing.** Every run starts under current law. *Reform begins in year* sets when the reform takes effect (default: year 4), so the reform lands on a system that already has its own premiums, provider capacity and coverage. *Phase-in* spreads the reform over several years: dials such as the mandate penalty or public payment rate move gradually, while on/off changes such as single payer take effect when the phase-in completes.

**Tiles.** The six tiles show the final year (year 19) and how it differs from the same year with no reform, using the same random seed.

| Tile | Meaning |
|---|---|
| Insured | Share of households with any coverage |
| Health spending | National health expenditure as a share of GDP |
| Population health | Mean health stock, an index from 0.2 to 1.0 (not life expectancy) |
| Care gap | Average share of needed care that households did not receive, whether skipped for cost, rationed for lack of capacity, or lost to long waits |
| Innovation index | Medical technology, starting at 1.0 and funded by commercial revenue and provider margins |
| Govt. social cost | Government health outlays plus the deadweight loss of raising the revenue, scaled to a US-sized population |

**Iron Triangle over time.** The year bar above the charts (slider and Play button) picks a year. The triangle shows that year against the no-reform run in the same year, and the chart beside it plots the three scores (affordability, quality, access) for every year, with dashed lines for no reform and a cursor at the selected year.

**Charts.** The dashed line marks the reform year and a shaded band marks any phase-in. A line stops where the thing it measures stops existing: private premiums end under single payer, and private-sector wait times end when delivery is all public.

**Why?** The panel under the charts follows the same selected year (it has its own copy of the slider) and lists what happened in it and why: the reform taking effect, coverage shifts, premium changes, mergers, entry and exit, queues, the fiscal ledger.

**Sharing.** "Copy share link" puts the whole package (levers, timing, seed) in the URL. The same link always reproduces the same run.

## What is modeled

- **Households** (8,000 in the browser, 10,000 in tests): income, age, health risk, risk aversion; they choose coverage, use care in response to out-of-pocket prices, and carry a health stock that falls when care is missed.
- **Insurers**: premiums set on last year's claims, so adverse-selection spirals play out over several years; community rating, risk adjustment.
- **Employers**: whether to offer coverage (recruitment value and the tax subsidy against a per-worker fixed cost) and how generous a plan to offer.
- **Providers**: hospitals and physicians, prices that rise with concentration, mergers checked by antitrust, entry and exit with lags, and queues when demand exceeds capacity.
- **Government**: premium subsidies, public insurance, single payer, and VA/NHS-style direct provision, with every public dollar costing about $1.30 once the cost of taxation is counted.

[DESIGN.md](DESIGN.md) has the full specification, the calibration choices, and the validation scenarios.

## Known limitations

These matter when interpreting results in class.

- **Supply responds only to profit.** New provider capacity enters only after sustained high margins. Under single payer the queue that opens in the reform year therefore persists, because administered prices never create the margins that would draw entry.
- **Certificate of Need and residency slots rarely matter.** They scale entry, and entry seldom triggers. With the other levers at current law, moving these two changes nothing at all.
- **Wage incidence is reported, not applied.** The model reports how much of the ESI premium workers bear through wages, but does not reduce their take-home income.
- **Baseline health spending runs low.** It comes out between about 15% and 17.5% of GDP depending on the seed, against a real figure near 17.5%.
- **Employer plan generosity barely responds to the tax exclusion.** Repeal mostly reduces small-firm offers and leaves plan richness nearly unchanged.
- **One seed, one draw.** A run is a single random draw. Small differences between two packages can be noise; the dashboard does not yet show a range across seeds.
- **Scope.** Nonelderly adults, a single national market, no drug sector, no Medicare.

## Project layout

```
src/engine/   the model (no dependencies, runs in Node and the browser)
  simulate.ts   the annual loop
  reform.ts     reform timing and phase-in
  params.ts     every calibration number, with comments
src/web/      the dashboard (plain TypeScript, hand-drawn SVG charts)
tests/        regression tests pinning the model's qualitative behavior
scripts/      serve.ts (static server) and exploration scripts
web/          index.html plus the compiled dist/ folder (the deployable site)
DESIGN.md     specification, calibration, validation scenarios, roadmap
```

To explore from the command line, run a script directly, for example `node scripts/explore.ts`.

## A note on where this folder lives

The project sits on Google Drive, which cannot hold a `node_modules` folder reliably. That is why there are no dependencies: Node runs the TypeScript directly, and the TypeScript compiler is fetched by `npx` into a cache on the local disk the first time you build.
