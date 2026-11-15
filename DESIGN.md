# Health Policy Simulator — Design Document

**Purpose:** A web-based simulator for *Introduction to Health Policy in the United States* that lets students design policy packages and watch cost, quality, and access outcomes unfold over a 10–20 year horizon. The central pedagogical goal is that Iron Triangle trade-offs **emerge from economic mechanisms** — they are never hard-coded.

**Status:** Design v0.9 (November 2026) — the engine (households, insurers, providers, employers, government incl. VA/NHS direct provision), the no-build web frontend, and all three classroom modes are built, validated by 89 tests that run every scenario on several seeds. November 2026 revisions: the **reform timeline** (§2a), the **care gap**, **supply that follows demand**, **profit-driven mergers**, **wage pass-through** (§3.2, §3.3), **independent random draws per household**, a **calibration-target table** (§8), **multi-run ranges** on the dashboard, **per-chart explanations**, **challenges** and the **comparison view** (§5, §6). Remaining work is in §9; anything specified but not built is marked *(not built)*.

---

## 1. Design principles

1. **Emergent trade-offs.** No rule anywhere says "subsidies raise costs." Subsidies change household choices; choices change the risk pool and utilization; utilization meets provider capacity; prices or queues respond. The trade-off is a *consequence*, and the simulator can show the causal chain.
2. **Explainability is the product.** Every outcome supports a "why?" drill-down: a narrative explanation chain backed by inspectable state (risk pool composition, provider HHI, queue lengths, budget ledger). Modules emit structured explanation events every simulated year.
3. **Stylized but directionally right.** Baseline calibrated to a round-number 2024-ish US: ~92% coverage, ESI as the dominant source of coverage, and health spending of ~17.5% of GDP at the start of a run. The targets, their reference figures and the one known miss are tabulated in §8. Behavioral parameters from canonical literature (see §8). Framed explicitly as a teaching model, not a forecast.
4. **Zero infrastructure.** Pure client-side static site. Seeded RNG for reproducibility. Policy packages and scenarios encoded in shareable URLs. No accounts, no server, nothing to maintain mid-semester.

---

## 2. Model overview

Agent-based microsimulation of ~10,000 synthetic households, advancing in **annual time steps**, interacting with structural models of four sectors:

```
                    ┌─────────────┐
                    │ GOVERNMENT  │  subsidies · public insurance · public provision
                    │  (stylized) │  financed by taxation w/ marginal cost of funds
                    └──────┬──────┘
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ┌───────────┐     ┌───────────┐     ┌────────────┐
  │ EMPLOYERS │────▶│ INSURERS  │◀───▶│ PROVIDERS  │
  │ offer/    │ ESI │ premiums, │price│ hospitals +│
  │ generosity│     │ rating,   │nego.│ physicians │
  └─────┬─────┘     │ risk pool │     │ capacity,  │
        │           └─────┬─────┘     │ entry/exit │
        ▼                 ▼           └─────┬──────┘
  ┌─────────────────────────────────────────▼──────┐
  │ HOUSEHOLDS (~10k agents)                       │
  │ insurance take-up · utilization · health stock │
  └────────────────────────────────────────────────┘
```

Annual sequence: (1) government sets policy parameters → (2) insurers price plans on lagged claims → (3) employers decide offers/generosity → (4) households choose coverage → (5) health shocks realize; households demand care → (6) provider market clears (prices and/or queues) → (7) health stocks update; entry/exit decisions made → (8) outcomes and explanations recorded.

### 2a. Reform timeline (`src/engine/reform.ts`)

A reform does not start from a blank slate: it lands on a system that already has premiums, provider capacity and coverage shaped by current law. Each run therefore has two policies and a calendar.

- **Burn-in.** Years 0 to `reformYear − 1` run under `priorPolicy` (current law). The dashboard default is `reformYear = 4`; the counterfactual "no reform" run uses the same seed, so the two runs are identical until the reform year.
- **Reform.** From `reformYear` the reform policy applies. Capacity, premiums and coverage are whatever current law left behind, so a coverage expansion meets capacity built for the old demand. This is what produces transition effects such as the wait-time jump in the year single payer begins.
- **Phase-in** (`phaseInYears = N`, default 0). Numeric dials (mandate penalty, payment rates, eligibility lines, antitrust stringency, direct-provision capacity when it is already in use) move linearly, with progress `min(1, (year − reformYear + 1) / (N + 1))`. On/off changes cannot be half-applied, so they flip when the phase-in completes, in year `reformYear + N`: the boolean switches, a price cap or tax-exclusion cap going from absent to present (or the reverse), and direct provision going from none to some.
- **Reporting.** Each `YearResult` carries the `policy` in force that year and `reformProgress`. The engine emits a `reform-begins` event listing what changed ("single payer: off → on; public payment rate: 0.6 → 0.9") and a `reform-complete` event when a phase-in ends.
- **Steady-state mode.** A config with no `priorPolicy` applies its policy from year 0 with the system already adapted to it. The older mechanism tests (death spiral, consolidation, RAND) use this mode; the dashboard never does.

---

## 3. Module specifications

### 3.1 Households
- **Heterogeneity:** income, age, latent health risk (drawn from a skewed distribution — the 5%-of-people-drive-50%-of-spend fact), risk aversion.
- **Coverage choice:** each year a household takes the option with the lowest certainty-equivalent cost among those available: ESI (if offered), individual market plans, public program (if eligible), uninsured. Mandate penalties and subsidies enter the calculation directly.
- **Take-up frictions (added with the calibration table, §8):** signing up for coverage on your own carries an **enrollment hassle**, a persistent household trait in dollar terms: `150 + 10,000 × draw³ × exp(−cash income ÷ 30,000)`. Most households find it minor and a minority find it prohibitive, and it is heaviest at low incomes (forms, renewals, churn, not knowing you qualify). Public coverage carries all of it, individual-market plans 30% of it, employer coverage none. Going uninsured also costs more the more a household has to lose: 2% of cash income above $40,000 is added to the cost of being uninsured (assets at risk; coverage as a normal good). Together these produce the real pattern in which some people eligible for free coverage stay uninsured and high-income households rarely do.
- **Utilization:** care demand responds to out-of-pocket price with elasticity ≈ −0.2 (RAND HIE). Some demand is discretionary (price-sensitive, lower marginal health value), some urgent (inelastic).
- **Health stock (Grossman-style):** care consumption improves health with diminishing returns; forgone/delayed care (uninsurance, queues) depreciates the stock. Today's underinsurance worsens tomorrow's risk pool — the delayed quality cost.
- **Emergent phenomena:** *adverse selection* when rating is restricted without take-up pressure (healthy exit → premiums spiral); *moral hazard* via the utilization elasticity.
- **Health stock definition:** each household carries a stylized health-capital index in [0.2, 1.0] (a Grossman-style stock, *not* life expectancy). It rises when delivered care meets the household's need (recovery toward 1), and falls with age-related depreciation and with the household's *care gap* (the share of its needed care it did not receive: forgone to cost-sharing or uninsurance, rationed when demand exceeds capacity, or lost to long waits). "Population health" on the dashboard is the population mean.
- **Care gap (the access measure):** `health.careGap` is the population mean of that share, a continuous quantity. It replaced an earlier "unmet-need rate" that counted households above a threshold and so jumped from 15% to 66% to 100% as capacity tightened. Baseline care gap is about 4.5–5%.

### 3.1a Innovation (dynamic technological progress)
- **Emergent index** (starts at 1.0), *not* a lever. Captures medical technology / treatment effectiveness accumulating over time. Funded by the **commercial system's revenue and provider margins** — a well-funded, profitable system develops new treatments — with a **public/spillover R&D floor** (NIH, global science; intensity never drops below 0.30×) so progress never fully stops.
- **R&D intensity** = commercial spend per capita × (1 + margin bonus), measured against a baseline reference (baseline ≈ 1.0×). The index grows ~2%/yr × intensity.
- **Feedback to health:** higher innovation raises the health return on care (recovery scales with the index) and slows age-related decline (depreciation shrinks as the index rises). At index 1.0 this reduces to the static dynamics.
- **The teaching payoff — a *dynamic* fourth dimension to the Iron Triangle:** squeezing prices (all-payer caps, low single-payer/NHS rates, all-public delivery) starves the commercial R&D pool → innovation stalls near the floor → slower long-run health gains. The expensive, profitable US system's redeeming feature is that it funds innovation. Within a 15-year window universal-coverage systems still post *high current health* (coverage dominates), so the trade-off shows up most clearly in the **innovation index itself** (future health potential) — deliberately US-centric and speculative, as requested.

### 3.2 Employers
- Firms heterogeneous in size (→ admin load, ~30/30/40% of workers small/medium/large) and wage level (→ tax rate); plus an idiosyncratic offer-propensity shock so the extensive margin is smooth, not a per-size cliff. Workers sort into firms by income.
- **Two distinct margins, deliberately separated** (this is the heart of the employer model):
  - **Extensive (whether to offer):** a firm offers when the worker value it delivers — the **recruitment value** of employer coverage (the dollar advantage of group coverage over self-purchase: pooling + the employer curating/stabilizing the plan) net of the firm's admin load, plus the **tax subsidy**, plus the idiosyncratic shock — beats the **per-worker fixed cost** of running a plan (high for tiny firms). Because the recruitment value is positive for *every* firm size, employees genuinely gain from ESI and a non-offering firm must pay higher wages to recruit — so the offer margin is **sticky**: medium and large firms keep offering with or without the tax break. Small firms, which can't spread the fixed cost, are the tax-sensitive margin.
  - **Intensive (which tier):** the firm picks the tier maximizing the worker's net surplus (value − premium + tax shield). The tax exclusion makes generosity cheap, so it is the lever on plan richness.
- **Take-up vs. incidence (the second key separation):** at *take-up*, the worker sees only the employee share (small, salient), so take-up is high. The employer's share is not a gift: the firm recovers it through **lower cash wages** (compensating differentials). Each household has a fixed total compensation (`income`) and a yearly `cashIncome` = compensation − wage offset. The offset is the firm's expected contribution per worker (its contribution per enrollee × the share of offered workers who enrolled last year) and applies to every worker at an offering firm whether or not they enroll, which is why enrolling costs the worker only the employee share. Cash wages cannot fall below a wage floor (`minCashWage`, $15k); whatever the firm cannot shift counts against offering, so the lowest-wage jobs are less likely to come with coverage. Eligibility and affordability rules see **cash** income, as MAGI does: Medicaid eligibility, the subsidy schedule, the ESI affordability test, and the uninsured out-of-pocket limit. Consequences: rising premiums lower take-home pay; some low-wage workers at offering firms qualify for Medicaid and take it instead; under single payer the offset returns to wages. *Limitation: the taxes that finance public coverage are not deducted from household pay (they appear only in the government ledger), so household pay is not comparable between privately and publicly financed systems.* The full premium is excluded from income+payroll tax, so the exclusion is a large **government tax expenditure** carried in the fiscal ledger (same marginal cost of public funds as direct outlays).
- **ACA firewall + affordability:** an ESI offer forfeits exchange-subsidy eligibility *only if* the employee share is below ~9.85% of income (unaffordable offers leave the worker subsidy-eligible) — so an employer mandate doesn't perversely push low-wage workers off subsidized coverage.
- **Known limitation (v1):** the intensive (generosity) response to the tax exclusion is *modest* in the current calibration, because workers value gold-level coverage enough that gold is near-efficient even without the subsidy — so repeal mainly drops small-firm *offers* rather than shrinking plans. A stronger "tax → over-insurance → skinnier plans" channel would require either lower risk aversion (making silver the efficient plan) or an explicit moral-hazard deadweight penalty on generous plans. Flagged as an instructor-facing modeling choice.
- *Deferred to v2:* subsidy↔ESI crowd-out, explicit firm-level risk pools, and the over-insurance/intensive-margin channel above.

### 3.3 Providers (hospitals + physicians)
- **Capacity:** finite annual service capacity per sector.
- **Commercial prices:** Nash-bargaining flavor — provider markup over cost scales with market concentration (HHI) and insurer counter-leverage.
- **Mergers are profit-driven.** Each year a sector proposes a merger with probability `1 − exp(−2.4 × gain)`, where *gain* is the proportional revenue increase the merger would bring: the commercial price rise from one fewer competitor (zero where a price cap already binds) × the share of revenue that commercial payers provide. A 6-firm hospital market under current law proposes about one year in four; an 18-firm physician market about one year in twelve; a market that has consolidated to 4 firms proposes more often, because each further merger is worth more. A distressed sector (margin under 5%) pursues any available gain three times as urgently. Under single payer or a binding all-payer cap the gain is zero and providers stop merging: the model has no merger efficiencies, so a merger that cannot raise prices has no modeled motive. **Antitrust stringency** is the probability a proposed merger is blocked. A merger removes one firm; the firm count has a floor of 3. The two random draws per sector-year come from a separate random stream, so the merger process never perturbs household draws.
- **Public prices:** administered (set by students as % of cost or % of commercial).
- **Supply follows demand, with lags and gates:** providers plan for expected demand (a moving average of realized demand) at the 85% target utilization. Each year they start enough new capacity to replace what retires (hospitals 2% a year, physicians 3%) and to close 75% of the gap between planned and existing-plus-committed capacity. It arrives after the sector's lag: **3 years** for hospitals (construction), **7 years** for physicians (training). Two policy gates sit on this. **Certificate of Need** refuses a share of new hospital capacity equal to the lever (replacement is exempt), so at 100% hospitals cannot grow. **Residency slots** cap how many new physicians can start training each year at 4.5% of the baseline workforce × the lever: at 1.0× the workforce can grow about 1.5% a year at most; below about 0.67× retirements outrun entrants and it shrinks. Providers invest only if it pays: fully at a blended margin of 5% or more, scaling down to nothing at zero, where they stop even replacing what retires.
- **Entry and exit:** margins above 16% additionally pull in new *firms* (which re-fragments a consolidated market), arriving with the same lags. Negative margins close capacity immediately, down to a floor of 55% of baseline. Aggressive price caps bite in year 4, not year 1.
- **What this produces:** a coverage expansion opens a queue; hospitals build their way out in about five years, physicians take a decade or more unless residency slots are raised, and neither recovers if payment rates leave no margin. *Limitations: provider costs have no fixed component, so excess capacity does not lower margins and a high-margin market can carry idle capacity indefinitely; a dormant private sector (all-public delivery) is frozen, not wound down.*
- **Dormant sectors:** when no care flows through the private sector (all delivery public), the sector is marked inactive: no entry, exit or mergers, and its wait and price series are reported as absent, not as stale values.
- **Prices paid:** each sector reports `avgPricePaid`, revenue collected divided by care delivered across all payers. This is what the dashboard charts, because the posted commercial price is meaningless once no one pays it (single payer).
- **Queues:** when demand > effective capacity, a wait-time queue forms (M/M/c flavor, simplified). Waits reduce realized access and degrade health stock. This makes "single payer at low rates" produce rationing-by-waiting rather than a free lunch — the US-vs-NHS access contrast, teachable in one chart.

### 3.4 Insurers
- Price next year's premiums on **lagged claims** + administrative load (the lag is what makes selection spirals dynamic and watchable).
- Rating rules as policy levers: full underwriting ↔ community rating; risk adjustment. *(Not built: MLR floors and benefit mandates / minimum actuarial value.)*
- Individual and group markets pooled separately.

### 3.5 Government (stylized) — all three instruments implemented
1. **Subsidies** — sliding-scale (ARPA-style) premium subsidies by income; mandate penalty as a companion lever.
2. **Public insurance** — Medicaid-style eligibility threshold and administered payment rates to *private* providers; single-payer toggle ("Medicare-for-all" = the limiting case, public insurance + private delivery = **Canada**).
3. **Direct provision (VA/NHS-style)** — the government operates its own **delivery capacity** (`publicProvisionLevel`, sized as a multiple of baseline total demand), serving public-program enrollees and the **uninsured** (and everyone under single-payer = **NHS**). Care is free at the point of use, funded from the budget at an operating cost per unit (~0.80× commercial, stylized), with its **own queue** when capacity is short. Key emergent contrasts:
   - *Safety-net clinics* (low level, baseline insurance): the uninsured gain real access — unmet need and uncompensated care fall, population health rises — without changing their insurance status; it also relieves private demand/waits. Coverage ≠ access, resolved on the *provision* side.
   - *Single-payer + private delivery (Canada)* vs *single-payer + public delivery (NHS)*: NHS delivers care at lower unit cost (lower NHE share) but requires a large public budget; Canada buys all care from private providers at administered rates.
   - *Underfunded public delivery*: universal coverage on paper but capacity < demand → rationing and long queues (and a spiral: queues → worse health → more demand). The classic NHS-underfunding critique.

**Financing:** every public dollar — subsidies, public-insurance claims, **direct-provision operating costs**, and the ESI tax expenditure — costs **~$1.30** (marginal cost of public funds / deadweight loss), itemized in the budget ledger. Students see the full fiscal cost of "just have the government pay" or "just have the government run it."

---

## 4. Policy levers (student-facing panel)

| Category | Levers |
|---|---|
| Timing | year the reform begins (1–10, default 4), phase-in length (0–6 years) |
| Insurance rules | community rating on/off, risk adjustment on/off, individual mandate penalty |
| Subsidies | premium subsidies on/off, income cutoff (the "cliff") |
| Public programs | eligibility threshold, payment rates (% of commercial), single-payer toggle, **government direct-provision capacity (VA/NHS)** |
| Employer market | employer mandate, tax exclusion cap ($0 = repeal) |
| Provider market | all-payer price cap, antitrust stringency (merger review), Certificate of Need, residency slots / scope of practice |
| Financing | (derived) required tax revenue + deadweight loss, displayed not chosen |

Phase-in applies to the whole package, not lever by lever (§2a). *Not built:* benefit mandates (minimum actuarial value), MLR floors, cost-sharing subsidies, an adjustable subsidy generosity schedule, and per-lever phase-in schedules.

---

## 5. Outcomes dashboard

What the dashboard shows today:

- **Tiles (final year, each with its change against the no-reform runs):** insured rate, health spending (% of GDP), population health, care gap, innovation index, government social cost (scaled to a US-sized population). Each number is the mean of five runs; a second line gives the lowest and highest run, and a change whose sign differs between runs is marked "could be luck" and left uncolored.
- **Several runs, not one.** Every package is run five times on consecutive seeds, in background workers (the first result shows in about half a second, the rest shortly after). Lines are means; shaded bands are the range across runs. Because each household keeps the same luck under every policy (§7), each reform run has an exact no-reform twin, and differences are computed twin by twin.
- **Coverage:** coverage mix over time (ESI / individual / public / uninsured); uninsured rate within each income third over time.
- **Cost:** health spending as % of GDP against the no-reform path; private premiums, with the cash wages given up to pay the employer's share; prices paid to private providers (all payers, with a provider-cost reference line); government cost over time, itemized (subsidies, public insurance, direct provision, ESI tax break, deadweight loss).
- **Quality:** population health index; innovation index against the no-reform path.
- **Access:** wait times by sector (hospital, physician, public system); private provider capacity relative to year 0; care gap.
- **Employer market:** offer rate and average generosity over time.
- **Iron Triangle:** the package against the no-reform run on affordability, quality and access, for a selected year (a year bar with a slider and Play button steps through the run). A companion chart plots the three scores in every year, dashed for no reform. Access is `1 − care gap / 0.25`, clamped to [0, 1].
- **Reform marker:** every time-series chart carries a dashed line at the reform year and a shaded band over any phase-in.
- **Absent quantities:** a series stops where the thing it measures stops existing (private premiums and employer plan generosity under single payer, private-sector waits and prices when delivery is all public); nothing is carried forward from the last year it existed. The employer offer rate is the exception that is drawn at zero under single payer, because zero is its true value.

**"Why?" panel, two ways in:** *by year* — a year slider lists that year's narrative events by module (policy, coverage, insurer, provider, employer, market, government), e.g. *"The reform takes effect this year. What changes — single payer: off → on; public payment rate: 0.6 → 0.9."* *By chart* — each chart has a **Why?** button that opens the explanation for that outcome: the mechanism in two or three sentences, where the lead series stood before the reform and at the end and when it moved most, and every event of the kinds that drive that chart, across all years (click a year to show it in the Iron Triangle). Events come from run 1, since the year in which a chance event such as a merger falls differs between runs. Dollar figures in narratives are scaled to a US-sized population so they match the tiles.

*Not built:* take-up by health status, per-capita spending and out-of-pocket burden, provider HHI / margin / utilization charts (these appear only in events), CSV export.

---

## 6. Classroom modes (all client-side)

All three are built. Everything travels in the URL: a package link carries the levers, the timing, the seed and any challenge; a comparison link carries a list of package links.

1. **Solo sandbox** — default; free experimentation, instant runs.
2. **Structured assignments (challenges)** — "Write a challenge" opens a form: a title and up to six targets, each a headline measure (the six tiles, plus the longest wait and the uninsured rate in the low-income third), "at least" or "at most", and a number. The instructor sets the levers to the starting point students should begin from and sends the share link. Students see a banner listing each target, where they stand, and whether it is met; they hand in their own share link. Targets are judged in the final year on the mean of the five runs, so anyone opening the link sees the same verdict. Links are validated on opening: a malformed or hand-edited challenge is dropped.
3. **Team comparison** — "Compare packages" takes one share link per line (optionally `Name | link`, up to 12) and shows the packages side by side: an overlaid Iron Triangle, a table of the eight headline measures with the best value in each column highlighted, and each measure over time with one line per package and a dashed no-reform line. If any link carries a challenge, every package is judged against the first one found, and a package whose own link carries a different challenge is flagged — which is how an instructor checks submissions. "Open" loads a package into the simulator; "Copy comparison link" saves the whole list.

---

## 7. Technical architecture

- **Engine:** TypeScript, pure functions, zero dependencies. 10k agents × 20 years runs in well under a second. **Randomness comes from three independent sources**, so nothing a policy does can reshuffle anyone's luck: a seeded stream (mulberry32) builds the population and each year's new entrants; every household's health shock and choice noise is *looked up* by a hash of (seed, household, year, purpose) instead of pulled off a shared sequence; and the provider market has its own stream with a fixed number of draws a year. Two policies on the same seed therefore face the same people with the same luck (common random numbers), which roughly halves the noise in a reform-versus-no-reform comparison.
- **Zero-dependency toolchain (chosen because the project lives on Google Drive, which can't handle `node_modules`):** the whole stack is dependency-free. Node 24 runs the TypeScript engine natively; `node --test` is the test runner; `tsc` runs via `npx` from the C: cache. The **frontend is a no-build static app**: `tsc` (with `rewriteRelativeImportExtensions`) compiles `src/engine` + `src/web` to plain browser ES modules in `web/dist/`, and the browser loads them directly — no bundler, no `node_modules`, fully offline, deployable as static files anywhere.
- **Frontend:** vanilla TypeScript + DOM, **hand-rolled SVG charts** (line with optional range bands, stacked-area, dollar stacked-area, Iron Triangle radar, single or overlaid) — no React, no charting library. Policy panel (left, sticky: scenario menu, timing controls, levers) ⇄ live dashboard (6 tiles; 12 charts, see §5) ⇄ "Why?" panel. Simulations run in a small pool of **Web Workers** (`src/web/worker.ts`, `runs.ts`), five runs per package, with the no-reform runs computed once per seed; if workers are unavailable the page falls back to the main thread. Modules: `app.ts` (simulator view), `compare.ts` (comparison view), `challenge.ts`, `metrics.ts` (the headline measures, shared by tiles, challenges and the comparison table), `charts.ts`, `levers.ts` (lever specs and link encoding).
- **State sharing:** policy package, reform year, phase-in, seed and any challenge serialized (diff-from-default → UTF-8 → base64) into the URL hash; a comparison is `#cmp.` plus a list of names and package links. Decoding validates the type of every field and falls back to the default for anything malformed. No backend ever.
- **Run it:** `npm run build` then `npm run serve` (a ~30-line zero-dep Node static server at `scripts/serve.ts`) → http://localhost:5173/. Or `npm run dev` (build + serve).
- **Hosting:** static site — `web/` is the deployable root (GitHub Pages / Netlify / a USB stick / the LMS).
- **Testing:** 89 automated tests. Every scenario in §8 runs on three seeds (five for the merger and wage tests, eight for calibration), so no threshold is fitted to one draw; the calibration targets are enforced as bands on multi-seed means; the dashboard's plain logic (links, challenges, the comparison list, summaries across runs) is unit-tested; rendering is checked in a browser.
- **Version control:** the folder is a git repository (`web/dist/` and logs ignored).

---

## 8. Calibration & validation targets (stylized)

Calibration targets (`src/engine/calibration.ts`; enforced by `tests/calibration.test.ts`). Each is the average of the first five years of a current-law run, over several seeds. References are round figures for the US around 2023, for adults where available, since the model simulates ages 26–64.

| Target | Reference | Band | Model (20 seeds) | Status |
|---|---|---|---|---|
| Insured | 90% | 88–93% | 92.6% | met |
| Employer coverage | 65% | 60–70% | 69.4% | met (high end) |
| Public coverage (Medicaid-style) | 15% | 12–19% | 12.5% | met (low end) |
| Individual market | 9% | 6–12% | 10.7% | met |
| Workers offered employer coverage | 80% | 72–88% | 82.0% | met |
| Uninsured rate, low-income third ÷ high-income third | 4× | 2.5–9× | 4.2× (about 11% vs 3%) | met |
| Health spending, share of GDP | 17.6% | 16.7–18.3% | 17.5% | met by construction (display scale) |
| Individual-market silver premium | $7,000 | $6,000–8,500 | $7,770 | met |
| Employer premium, single coverage | $8,700 | $7,800–9,600 | $6,600 | **known miss** |
| ESI tax exclusion, national | $320B | $250–420B | $418B | met (top of band) |
| Hospital utilization | 85% | 80–90% | 85% | met by construction |

What the table changed when it was first run (November 2026):
- **The income gradient in uninsurance was backwards.** Low-income households were *less* likely to be uninsured than high-income ones (ratio 0.66; 5% against 8%), because public coverage and subsidies were free of friction and nothing made coverage worth more to those with more to lose. Two mechanisms were added (§3.1): an enrollment hassle that falls with income, and a cost of being uninsured that rises with income. The gradient is now about 11% / 9% / 3% for the low / middle / high thirds.
- **Health spending** is brought to 17.5% of GDP at the start of a run by the display scale (`nheDisplayScale` 1.95). This is a calibration constant, not a demographic estimate. Spending then drifts up to about 18–19% by year 19 under current law, as slow provider consolidation raises prices.
- **Employer premiums are about a quarter too low**, because the model's medical costs per adult are about 75% of the real figure. This is recorded as a known miss, not tuned away: fixing it means raising `baseAnnualCost` and re-tuning coverage, after which the display scale could fall toward its demographic value.

Stylized baseline in other respects: individual-market premium ≈ $7k/yr single; see the Phase notes below.

Notable Phase-1 calibration decisions (all in `src/engine/params.ts`):
- Expected cost includes a flat **accident-risk component** independent of health status — without it, the healthiest fifth of the population rationally declines even near-free coverage and baseline uninsurance triples.
- Households value **forgone care** at 1.2× its cost when choosing coverage (being uninsured is a health loss, not just a financial gamble).
- Risk aversion is deliberately high relative to textbook expected-utility values — it stands in for loss aversion and default-following in real take-up behavior.
- Baseline subsidies use the **ARPA schedule** (0% of income below 1.5×FPL ramping to 8.5%, no income cliff); students can re-impose the 4×FPL cliff and watch middle-income coverage drop.
- **Risk adjustment** across tiers is a policy lever; without it, tier-level selection makes the market sawtooth even with subsidies.
- The sim models nonelderly adults; the displayed NHE/GDP is scaled (×1.95, a calibration constant) so that a current-law run starts at the familiar ~17.5%.

Notable Phase-2 (provider market) calibration decisions:
- Care quantity (from the Phase-1 demand machinery) is now priced: each sector posts a **commercial price index** = (HHI/HHI₀)^0.7 × (utilization/target)^0.5 ÷ insurer leverage, capped by any all-payer rate setting. Public payers get an administered price (default 0.6× commercial). Provider **marginal cost is 0.85**, so public coverage and uncompensated (uninsured) care drag provider margins — high uninsurance squeezes providers, a realistic linkage.
- **Mergers** are proposed for the revenue they would bring (§3.3); antitrust stringency is the probability a proposal is blocked. Under current law (stringency 0.8) a run sees 0 to 4 approved mergers in 20 years (mean about 2), and the average hospital commercial price index drifts up to about 1.15 by year 19: slow, creeping consolidation.
- **Entry is the counter-force, but a weak one**: margins above 16% draw new firms after the sector's lag. Because each further merger is worth more in a concentrated market, lax antitrust (0.3) now produces sustained consolidation, not the overshoot-and-revert of earlier versions: on average the hospital HHI reaches about 2,800 and the commercial price index about 1.45 by year 19, against about 2,000 and 1.15 under current law.
- **Queues**: utilization >1 rations delivery to capacity; waits rise convexly (≈ base·ρ²/(1.4−ρ)) and erode access/health. This is why single-payer-at-low-rates and below-cost price caps produce *coverage without access* — everyone insured, no one seen.
- Capacity floor is 55% of baseline (providers are partly fixed assets); below-cost payment can't make the system vanish, only ration severely.

Qualitative validation scenarios (must reproduce, as tests). Scenarios 1–9 are tested in steady-state mode (policy from year 0, §2a); the numbers quoted for them are steady-state results on seed 42. Scenarios 10–13 are tested in reform mode.
1. ✅ **RAND HIE:** moving from free care to high cost-sharing cuts utilization ~25–30% with modest average health effects (larger for low-income sick).
2. ✅ **Death spiral:** community rating + no mandate + no subsidies → individual market unravels within ~5 years (NY pre-ACA pattern).
3. ✅ **ACA-style package:** subsidies + community rating + risk adjustment → coverage gains concentrated among low-income; market stabilized; real fiscal cost.
4. ✅ **Consolidation:** lax antitrust → more mergers, higher concentration, materially higher commercial prices and NHE; strict antitrust keeps prices near baseline; fat margins draw entry.
5. ✅ **Price caps below cost:** short-run savings, then capacity exit and waits climbing from ~2 to 50+ weeks — high coverage, a care gap far above baseline.
6. ✅ **Single payer:** at adequate rates (0.9), universal coverage with modest waits and a large tax/deadweight cost; at low rates (0.7), universal coverage but queue rationing. (In reform mode even adequate rates produce a queue, because capacity was built for pre-reform demand: see scenario 13.)

Notable Phase-3 (employer market) calibration decisions:
- ESI offer/take-up split keeps the **employee share** (~$1.9k per enrollee after tax) as the salient take-up cost, while the employer's share comes out of cash wages (~$3.3k per worker at an offering firm) — the "ESI isn't free" lesson without suppressing take-up.
- The extensive margin is driven by a **recruitment value** (`esiRecruitmentValue = 0.42 × claims`) set above every firm's admin load, so ESI carries positive non-tax value for all sizes → most firms offer regardless of the subsidy. A **per-worker fixed offering cost** (small $2.3k / medium $0.4k / large $0.06k) is what keeps the smallest firms out, plus an idiosyncratic firm shock (σ≈$1.3k) to smooth the margin. *This replaced an earlier formulation whose break-even relied entirely on the tax subsidy for all but the largest firms, so repeal implausibly collapsed ESI to ~19% (see §3.2 history).*
- A **very-low-income tax bracket** (4% under $28k) gives low-wage workers a small subsidy, reinforcing the size/wage offer gradient.
- Baseline lands at ESI ≈ 69%, offer rate ≈ 82% (small ~47%, medium ~91%, large ~99%), avg AV ≈ gold, public ≈ 12.5%, individual ≈ 11%, insured ≈ 93% — a stylized US for adults 26–64 (see the calibration table above).

Employer-market validation scenarios (Phase 3, passing as of June 13):
7. ✅ **Tax-exclusion repeal:** ESI shrinks *modestly* (~69% → ~58%) and at the **extensive margin** — small-firm offers fall (47%→16%) while medium (91%→79%) and large (99%→93%) firms mostly keep offering (recruitment value); generosity barely moves (avg AV 82→80). Displaced workers shift to the individual market; tax expenditure → 0. ESI remains the largest source. (See §3.2 "known limitation" on why the intensive/generosity response is small.)
8. ✅ **Tax-exclusion cap ($5k, Cadillac-style):** coverage and offers nearly stable (ESI 69%→66%), generosity trimmed (avg AV 82→80), tax expenditure cut ~30% — the targeted "trim generous plans, raise revenue" result.
9. ✅ **Employer mandate:** offer rate → 100%; ESI rises (69%→75%) and overall coverage is broadly stable (the affordability exemption protects low-wage workers' subsidies); somewhat more low-wage workers end up on public coverage, because the wage offset lowers their cash income.

Government direct-provision scenarios (VA/NHS; stylized & out-of-sample for the US; tested in reform mode, reform in year 5):
10. ✅ **Safety-net clinics:** uninsured/Medicaid gain access via public delivery → the care gap roughly halves (≈ 5% → ≈ 2%), uncompensated care falls, health rises, private waits ease — at a budget cost; insurance status unchanged.
11. ✅ **NHS vs Canada:** both reach universal coverage; NHS (public delivery) runs at lower unit cost (lower NHE) but a large public budget; Canada (private delivery) buys care at administered rates. Well-funded NHS (capacity 1.35×) runs at about 90% utilization with ~3-week waits; the private sectors go dormant.
12. ✅ **Underfunded NHS** (capacity 0.95×): universal coverage but capacity < demand → utilization near 130%, waits of 20+ weeks rising to the one-year cap, a care gap above 50% within five years, falling health (a queue→health→demand spiral).

Why the capacity levels changed: care that is free at the point of use raises demand, so capacity equal to *today's* demand (1.0×) is over-subscribed once everyone is covered. The presets were 1.15× and 0.75× when the policy applied from year 0; with a burn-in, 1.15× ran at 105% utilization, so "well funded" is now 1.35× and "underfunded" 0.95×.

Reform-transition scenario (new in v0.7):
13. ✅ **Reforms land on an existing system.** Years before the reform are identical to the no-reform run. Single payer at adequate rates pushes hospital utilization from about 0.84 to 0.97 and waits from about 2 to 4 weeks in the reform year. With a phase-in, dials move gradually and switches flip at completion; a phased mandate raises coverage step by step. Every output is finite for every preset in both modes.

Supply, merger and wage scenarios (new in v0.8; reform mode with the reform in year 5, three to five seeds each):
14. ✅ **Queues clear where supply can respond.** Under current law utilization stays near the 85% target. After single payer at adequate rates, hospital utilization returns from 0.97 to about 0.87 within five years; physician utilization is still 0.98 five years on and comes down to about 0.89 only by year 19 (training lag plus the residency-slot ceiling).
15. ✅ **The supply levers bind.** Residency slots at 2.0× bring physician utilization to 0.85 by year 15 (0.91 at 1.0×), with no effect before the 7-year lag. A full Certificate of Need freeze holds hospital utilization near 1.0 indefinitely. Cutting residency slots to 0.5× under current law shrinks the physician workforce from year 12 on. Paying below cost stops investment and the queue never clears.
16. ✅ **Mergers follow the money.** The merger gain is larger in more concentrated markets and zero under administered or capped prices; no merger is proposed under single payer or a binding cap, whatever the antitrust setting; lax antitrust yields more mergers and higher prices; the antitrust lever changes nothing in a market with no mergers.
17. ✅ **Wage pass-through.** Workers at offering firms are paid less in cash by the firm's expected contribution, never below the wage floor; the offset disappears under single payer; when consolidation raises prices and premiums, take-home pay falls.

---

## 9. Build roadmap (the Target column is the original June 2026 plan)

| Phase | Content | Target |
|---|---|---|
| 1. Engine core | ✅ **DONE (June 12)** — households + insurer pricing + government subsidies/public insurance; selection & moral hazard validated by 18 automated tests | early July |
| 2. Provider market | ✅ **DONE (June 13)** — two-sector (hospital/physician) bargaining & HHI pricing, endogenous mergers vs. antitrust, lagged entry/exit, queues & wait times; scenarios 4–6 validated (11 more tests, 29 total) | mid July |
| 3. Employer market | ✅ **DONE (June 13)** — endogenous offer & generosity decisions, group pooling edge, full wage incidence, ESI tax expenditure, ACA firewall/affordability; tax-exclusion & employer-mandate levers; scenarios 7–9 validated (6 more tests, 35 total) | late July |
| 4. Frontend | ✅ **DONE (June 13)** — no-build static app: policy panel (all levers + scenario presets), live dashboard (tiles + hand-rolled SVG charts), Iron Triangle radar, "Why?" drill-down, shareable-URL state. Verified rendering + interactivity in-browser. | mid August |
| 4a. Review fixes | ✅ **DONE (Nov 15)** — reform timeline with burn-in and phase-in; care gap; dormant sectors, prices paid, national-scale narrative dollars and other honest readings; git, README; 52 tests | — |
| 4b. Supply, mergers, wages | ✅ **DONE (Nov 15)** — demand-following supply behind the Certificate of Need and residency-slot gates; profit-driven mergers on their own random stream; wage pass-through of employer premiums; capacity chart and wage line on the dashboard; 68 tests | — |
| 4c. Noise | ✅ **DONE (Nov 15)** — per-household random draws (common random numbers across policies); five runs per package in background workers; ranges on tiles and charts | — |
| 4d. Calibration | ✅ **DONE (Nov 15)** — calibration-target table enforced on multi-seed means; health spending rescaled to start at 17.5%; take-up recalibrated so uninsurance falls with income; every scenario test on three or more seeds | — |
| 4e. Explanations | ✅ **DONE (Nov 15)** — a "Why?" on each chart: mechanism, summary of the move, and the events behind it across all years | — |
| 5. Classroom modes | ✅ **DONE (Nov 15)** — challenges (targets carried in the share link, judged on the mean of five runs) and the comparison view (up to 12 packages; overlaid Iron Triangle, table, paths over time) | — |
| 6. Playtesting | instructor + TA shakedown with real assignments; student-facing wording; parameter tuning | before classroom use |
| 7. Cost recalibration | raise medical costs per adult to the real level (fixes the employer-premium miss), re-tune coverage, lower the display scale | open |
| 8. Who pays | allocate taxes to households so take-home pay and total burden are comparable across systems; a burden-by-income chart | open |

---

## 10. Resolved design decisions (June 2026)

- **Plan tiers:** four stylized tiers — Bronze / Silver / Gold / Platinum, actuarial values 60 / 70 / 80 / 90%, with tier-specific OOP maximums. No continuous generosity.
- **Consolidation:** endogenous from v1 — providers under margin pressure propose mergers; antitrust stringency lever governs blocking probability.
- **Labor market:** wages-only incidence of ESI costs (compensating differentials), applied to cash wages down to a wage floor. No employment/hours margin; job lock deferred to v2.
- **Geography:** single national market in v1; stylized urban/rural regions deferred.
- **Export:** still open — run export as CSV/report for student writeups (lean yes, cheap to add late).
