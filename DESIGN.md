# Health Policy Simulator — Design Document

**Purpose:** A web-based simulator for *Introduction to Health Policy in the United States* that lets students design policy packages and watch cost, quality, and access outcomes unfold over a 10–20 year horizon. The central pedagogical goal is that Iron Triangle trade-offs **emerge from economic mechanisms** — they are never hard-coded.

**Status:** Design v0.7 (November 2026) — Phases 1–4 complete: full engine (households, insurers, providers, employers, government incl. VA/NHS direct provision) and a working no-build web frontend (policy panel, live dashboard, Iron Triangle, drill-downs, shareable links), validated by 52 tests. The November 2026 revision added the **reform timeline** (§2a: every run starts under current law and the reform takes effect in a chosen year, with optional phase-in), replaced the unmet-need rate with a continuous **care gap**, and fixed a set of misleading on-screen readings. Remaining work is listed in §9; sections below mark anything specified but not built as *(not built)*.

---

## 1. Design principles

1. **Emergent trade-offs.** No rule anywhere says "subsidies raise costs." Subsidies change household choices; choices change the risk pool and utilization; utilization meets provider capacity; prices or queues respond. The trade-off is a *consequence*, and the simulator can show the causal chain.
2. **Explainability is the product.** Every outcome supports a "why?" drill-down: a narrative explanation chain backed by inspectable state (risk pool composition, provider HHI, queue lengths, budget ledger). Modules emit structured explanation events every simulated year.
3. **Stylized but directionally right.** Baseline calibrated to a round-number 2024-ish US: ~92% coverage, ESI as the dominant source of coverage, and health spending targeted at ~17.5% of GDP (the model currently lands at 15–17.5% depending on the seed; see §8). Behavioral parameters from canonical literature (see §8). Framed explicitly as a teaching model, not a forecast.
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
- **Coverage choice:** expected-utility comparison across available options: ESI (if offered), individual market plans, public program (if eligible), uninsured. Mandate penalties and subsidies enter the calculation directly.
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
- **Take-up vs. incidence (the second key separation):** at *take-up*, the worker sees only the employee share (small, salient), so take-up is high — but the *full* premium is borne through wages (compensating differentials), reported as `wageIncidencePerEnrollee`. ESI is not free; the only true gift is the tax subsidy. *Limitation: the incidence is reported but not applied — household income is not reduced by it, so it has no effect on choices or on any outcome.* The full premium is excluded from income+payroll tax, so the exclusion is a large **government tax expenditure** carried in the fiscal ledger (same marginal cost of public funds as direct outlays).
- **ACA firewall + affordability:** an ESI offer forfeits exchange-subsidy eligibility *only if* the employee share is below ~9.85% of income (unaffordable offers leave the worker subsidy-eligible) — so an employer mandate doesn't perversely push low-wage workers off subsidized coverage.
- **Known limitation (v1):** the intensive (generosity) response to the tax exclusion is *modest* in the current calibration, because workers value gold-level coverage enough that gold is near-efficient even without the subsidy — so repeal mainly drops small-firm *offers* rather than shrinking plans. A stronger "tax → over-insurance → skinnier plans" channel would require either lower risk aversion (making silver the efficient plan) or an explicit moral-hazard deadweight penalty on generous plans. Flagged as an instructor-facing modeling choice.
- *Deferred to v2:* subsidy↔ESI crowd-out, explicit firm-level risk pools, and the over-insurance/intensive-margin channel above.

### 3.3 Providers (hospitals + physicians)
- **Capacity:** finite annual service capacity per sector.
- **Commercial prices:** Nash-bargaining flavor — provider markup over cost scales with market concentration (HHI) and insurer counter-leverage. **Consolidation is endogenous:** providers under sustained margin pressure propose mergers to regain bargaining leverage; mergers raise HHI and commercial prices consistent with the merger literature (~10–40% effects). Antitrust stringency (a policy lever) determines the probability a proposed merger is blocked.
- **Public prices:** administered (set by students as % of cost or % of commercial).
- **Entry/exit with lags:** sustained high margins induce entry — physicians arrive with a ~7-year training lag (residency-slot policy lever), hospital capacity with a ~3-year construction lag (Certificate of Need lever). Sustained negative margins → capacity exit. Aggressive price caps bite in year 4, not year 1. *Limitation: supply responds only to profit. Entry needs sustained high margins, which administered prices never produce, so a queue opened by a coverage expansion persists; and because entry rarely triggers, the Certificate of Need and residency-slot levers change nothing when the other levers are at current law. Demand-driven and policy-driven supply growth is the next engine task (§9).*
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

- **Tiles (final year, each with its change against the no-reform run):** insured rate, health spending (% of GDP), population health, care gap, innovation index, government social cost (scaled to a US-sized population).
- **Coverage:** coverage mix over time (ESI / individual / public / uninsured); uninsured rate by income tercile in the final year.
- **Cost:** health spending as % of GDP against the no-reform path; private premiums; prices paid to private providers (all payers, with a provider-cost reference line); government cost over time, itemized (subsidies, public insurance, direct provision, ESI tax break, deadweight loss).
- **Quality:** population health index; innovation index against the no-reform path.
- **Access:** wait times by sector (hospital, physician, public system); care gap.
- **Employer market:** offer rate and average generosity over time.
- **Iron Triangle:** the package against the no-reform run on affordability, quality and access. Access is `1 − care gap / 0.25`, clamped to [0, 1].
- **Reform marker:** every time-series chart carries a dashed line at the reform year and a shaded band over any phase-in.
- **Absent quantities:** a series stops where the thing it measures stops existing (private premiums and employer plan generosity under single payer, private-sector waits and prices when delivery is all public); nothing is carried forward from the last year it existed. The employer offer rate is the exception that is drawn at zero under single payer, because zero is its true value.

**"Why?" drill-down:** a year slider lists that year's narrative events by module (policy, coverage, insurer, provider, market, government), e.g. *"The reform takes effect this year. What changes — single payer: off → on; public payment rate: 0.6 → 0.9."* Dollar figures in narratives are scaled to a US-sized population so they match the tiles.

*Not built:* take-up by health status, per-capita spending and out-of-pocket burden, provider HHI / margin / utilization charts (these appear only in drill-down events), overlaying several packages, and chart-to-explanation links (the drill-down is by year, not by chart).

---

## 6. Classroom modes (all client-side)

Only the solo sandbox exists today. Modes 2 and 3 are planned (§9); share links already carry everything they need (levers, timing, seed).

1. **Solo sandbox** — default; free experimentation, instant runs.
2. **Structured assignments** *(not built)* — instructor authors a *challenge*: starting scenario + success criteria (e.g., "≥95% coverage, ≤18% of GDP, median wait <3 weeks"). Encoded in a URL; students submit their result link; results are deterministic given seed + policy, so submissions are verifiable.
3. **Team competition** *(not built)* — comparison screen loads multiple result links side-by-side on the Iron Triangle chart for in-class presentation.

---

## 7. Technical architecture

- **Engine:** TypeScript, pure functions, zero dependencies; seeded PRNG (mulberry32). 10k agents × 20 years runs in well under a second. One RNG stream drives everything, so a policy change that alters the number of draws shifts every later draw; separate streams per module are planned (§9).
- **Zero-dependency toolchain (chosen because the project lives on Google Drive, which can't handle `node_modules`):** the whole stack is dependency-free. Node 24 runs the TypeScript engine natively; `node --test` is the test runner; `tsc` runs via `npx` from the C: cache. The **frontend is a no-build static app**: `tsc` (with `rewriteRelativeImportExtensions`) compiles `src/engine` + `src/web` to plain browser ES modules in `web/dist/`, and the browser loads them directly — no bundler, no `node_modules`, fully offline, deployable as static files anywhere.
- **Frontend:** vanilla TypeScript + DOM, **hand-rolled SVG charts** (line, stacked-area, dollar stacked-area, categorical bar, Iron Triangle radar) — no React, no charting library. Policy panel (left, sticky: scenario menu, timing controls, levers) ⇄ live dashboard (6 tiles with hover tooltips; 10 charts, see §5) ⇄ "Why?" drill-down (per-year narrative events). Each change runs the reform once (8k agents × 20 years); the no-reform counterfactual is computed once at load. Slider input is debounced.
- **State sharing:** policy package, reform year, phase-in and seed serialized (diff-from-default → base64) into the URL hash; "Copy share link" button. Decoding validates the type of every field and falls back to the default for anything malformed. No backend ever.
- **Run it:** `npm run build` then `npm run serve` (a ~30-line zero-dep Node static server at `scripts/serve.ts`) → http://localhost:5173/. Or `npm run dev` (build + serve).
- **Hosting:** static site — `web/` is the deployable root (GitHub Pages / Netlify / a USB stick / the LMS).
- **Testing:** the validation scenarios in §8 run as automated regression tests — the model's qualitative behavior is pinned (52 tests). Most scenario tests still run a single seed (42); the reform tests check three seeds. Multi-seed tests against a calibration-target table are planned (§9).
- **Version control:** the folder is a git repository (`web/dist/` and logs ignored).

---

## 8. Calibration & validation targets (stylized)

Baseline targets (~2024 US): coverage ≈ 92%; NHE ≈ 17.5% of GDP; individual-market premium ≈ $7k/yr single. What the model produces: coverage ≈ 92%; ESI ≈ 68% of the modeled nonelderly-adult population (see Phase 3 below); **NHE between about 15.3% and 17.6% of GDP depending on the seed**, so the spending target is met only loosely and needs recalibration.

Notable Phase-1 calibration decisions (all in `src/engine/params.ts`):
- Expected cost includes a flat **accident-risk component** independent of health status — without it, the healthiest fifth of the population rationally declines even near-free coverage and baseline uninsurance triples.
- Households value **forgone care** at 1.2× its cost when choosing coverage (being uninsured is a health loss, not just a financial gamble).
- Risk aversion is deliberately high relative to textbook expected-utility values — it stands in for loss aversion and default-following in real take-up behavior.
- Baseline subsidies use the **ARPA schedule** (0% of income below 1.5×FPL ramping to 8.5%, no income cliff); students can re-impose the 4×FPL cliff and watch middle-income coverage drop.
- **Risk adjustment** across tiers is a policy lever; without it, tier-level selection makes the market sawtooth even with subsidies.
- The sim models nonelderly adults; displayed NHE/GDP is extrapolated to the full population (×1.75, documented) so the headline matches the familiar ~17.5%.

Notable Phase-2 (provider market) calibration decisions:
- Care quantity (from the Phase-1 demand machinery) is now priced: each sector posts a **commercial price index** = (HHI/HHI₀)^0.7 × (utilization/target)^0.5 ÷ insurer leverage, capped by any all-payer rate setting. Public payers get an administered price (default 0.6× commercial). Provider **marginal cost is 0.85**, so public coverage and uncompensated (uninsured) care drag provider margins — high uninsurance squeezes providers, a realistic linkage.
- **Mergers are both opportunistic and distress-driven.** Firms propose a merger with a base annual propensity (they always want market power) and always under margin distress; **antitrust stringency is the probability the merger is blocked** — that lever is the model's main brake on consolidation. Baseline antitrust 0.8 roughly holds the line; lax (0.3) lets HHI and prices climb.
- **Entry is the self-correcting counter-force**: fat post-merger margins draw new capacity, which arrives after the sector's lag (hospital 3y construction, physician 7y training — the residency-slots and Certificate-of-Need levers scale these) and re-fragments the market. Consolidation therefore overshoots then partially mean-reverts.
- **Queues**: utilization >1 rations delivery to capacity; waits rise convexly (≈ base·ρ²/(1.4−ρ)) and erode access/health. This is why single-payer-at-low-rates and below-cost price caps produce *coverage without access* — everyone insured, no one seen.
- Capacity floor is 55% of baseline (providers are partly fixed assets); below-cost payment can't make the system vanish, only ration severely.

Qualitative validation scenarios (must reproduce, as tests). Scenarios 1–9 are tested in steady-state mode (policy from year 0, §2a); the numbers quoted for them are steady-state results on seed 42. Scenarios 10–13 are tested in reform mode.
1. ✅ **RAND HIE:** moving from free care to high cost-sharing cuts utilization ~25–30% with modest average health effects (larger for low-income sick).
2. ✅ **Death spiral:** community rating + no mandate + no subsidies → individual market unravels within ~5 years (NY pre-ACA pattern).
3. ✅ **ACA-style package:** subsidies + community rating + risk adjustment → coverage gains concentrated among low-income; market stabilized; real fiscal cost.
4. ✅ **Consolidation:** lax antitrust → hospital HHI 1667→3300+, commercial prices +60% peak, higher NHE; strict antitrust keeps prices near baseline; entry eventually responds.
5. ✅ **Price caps below cost:** short-run savings, then capacity exit and waits climbing from ~2 to 50+ weeks — high coverage, a care gap far above baseline.
6. ✅ **Single payer:** at adequate rates (0.9), universal coverage with modest waits and a large tax/deadweight cost; at low rates (0.7), universal coverage but queue rationing. (In reform mode even adequate rates produce a queue, because capacity was built for pre-reform demand: see scenario 13.)

Notable Phase-3 (employer market) calibration decisions:
- ESI offer/take-up split keeps the **employee share** as the salient take-up cost while reporting **full wage incidence** (~$2k/enrollee) — the "ESI isn't free" lesson without suppressing take-up.
- The extensive margin is driven by a **recruitment value** (`esiRecruitmentValue = 0.42 × claims`) set above every firm's admin load, so ESI carries positive non-tax value for all sizes → most firms offer regardless of the subsidy. A **per-worker fixed offering cost** (small $2.3k / medium $0.4k / large $0.06k) is what keeps the smallest firms out, plus an idiosyncratic firm shock (σ≈$1.3k) to smooth the margin. *This replaced an earlier formulation whose break-even relied entirely on the tax subsidy for all but the largest firms, so repeal implausibly collapsed ESI to ~19% (see §3.2 history).*
- A **very-low-income tax bracket** (4% under $28k) gives low-wage workers a small subsidy, reinforcing the size/wage offer gradient.
- Baseline lands at ESI ≈ 68%, offer rate ≈ 88% (small ~54%, medium ~98%, large ~100%), avg AV ≈ gold, insured ≈ 92%, uninsured ≈ 8% — matching the stylized nonelderly-adult US.

Employer-market validation scenarios (Phase 3, passing as of June 13):
7. ✅ **Tax-exclusion repeal:** ESI shrinks *modestly* (~68% → ~57%) and at the **extensive margin** — small-firm offers fall (54%→19%) while medium/large keep offering (recruitment value); generosity barely moves. Displaced workers shift to the individual market; tax expenditure → 0. ESI remains the largest source. (See §3.2 "known limitation" on why the intensive/generosity response is small.)
8. ✅ **Tax-exclusion cap ($5k, Cadillac-style):** coverage and offers stable, generosity trimmed (avg AV 82→80), tax expenditure cut ~32% — the targeted "trim generous plans, raise revenue" result.
9. ✅ **Employer mandate:** offer rate → ~100%; coverage broadly stable (affordability exemption protects low-wage workers' subsidies); wage incidence rises.

Government direct-provision scenarios (VA/NHS; stylized & out-of-sample for the US; tested in reform mode, reform in year 5):
10. ✅ **Safety-net clinics:** uninsured/Medicaid gain access via public delivery → the care gap roughly halves (≈ 5% → ≈ 2%), uncompensated care falls, health rises, private waits ease — at a budget cost; insurance status unchanged.
11. ✅ **NHS vs Canada:** both reach universal coverage; NHS (public delivery) runs at lower unit cost (lower NHE) but a large public budget; Canada (private delivery) buys care at administered rates. Well-funded NHS (capacity 1.35×) runs at about 90% utilization with ~3-week waits; the private sectors go dormant.
12. ✅ **Underfunded NHS** (capacity 0.95×): universal coverage but capacity < demand → utilization near 130%, waits of 20+ weeks rising to the one-year cap, a care gap above 50% within five years, falling health (a queue→health→demand spiral).

Why the capacity levels changed: care that is free at the point of use raises demand, so capacity equal to *today's* demand (1.0×) is over-subscribed once everyone is covered. The presets were 1.15× and 0.75× when the policy applied from year 0; with a burn-in, 1.15× ran at 105% utilization, so "well funded" is now 1.35× and "underfunded" 0.95×.

Reform-transition scenario (new in v0.7):
13. ✅ **Reforms land on an existing system.** Years before the reform are identical to the no-reform run. Single payer at adequate rates pushes hospital utilization from about 0.89 to 1.03 and waits from about 3 to 5 weeks in the reform year (checked on seeds 1, 7 and 42), and the queue then persists (see the supply limitation in §3.3). With a phase-in, dials move gradually and switches flip at completion; a phased mandate raises coverage step by step. Every output is finite for every preset in both modes.

---

## 9. Build roadmap (the Target column is the original June 2026 plan)

| Phase | Content | Target |
|---|---|---|
| 1. Engine core | ✅ **DONE (June 12)** — households + insurer pricing + government subsidies/public insurance; selection & moral hazard validated by 18 automated tests | early July |
| 2. Provider market | ✅ **DONE (June 13)** — two-sector (hospital/physician) bargaining & HHI pricing, endogenous mergers vs. antitrust, lagged entry/exit, queues & wait times; scenarios 4–6 validated (11 more tests, 29 total) | mid July |
| 3. Employer market | ✅ **DONE (June 13)** — endogenous offer & generosity decisions, group pooling edge, full wage incidence, ESI tax expenditure, ACA firewall/affordability; tax-exclusion & employer-mandate levers; scenarios 7–9 validated (6 more tests, 35 total) | late July |
| 4. Frontend | ✅ **DONE (June 13)** — no-build static app: policy panel (all levers + scenario presets), live dashboard (tiles + hand-rolled SVG charts), Iron Triangle radar, "Why?" drill-down, shareable-URL state. Verified rendering + interactivity in-browser. | mid August |
| 4a. Review fixes | ✅ **DONE (Nov 15)** — reform timeline with burn-in and phase-in; care gap; dormant sectors, prices paid, national-scale narrative dollars and other honest readings; git, README; 52 tests | — |
| 4b. Supply and wages | Supply growth that follows demand, gated by residency slots and Certificate of Need (so those levers do something and queues can resolve); apply ESI wage incidence to household income | next |
| 4c. Noise | Separate RNG streams per module; run several seeds and show a range on tiles and charts | next |
| 4d. Calibration | Multi-seed tests against a calibration-target table; recalibrate health spending to ~17.5% of GDP | next |
| 4e. Explanations | Link each chart to its explanation chain | next |
| 5. Classroom modes | challenges (assignment links with success criteria), comparison view | after 4b–4e |
| 6. Playtesting | instructor + TA shakedown; parameter tuning; student-facing copy | before classroom use |

---

## 10. Resolved design decisions (June 2026)

- **Plan tiers:** four stylized tiers — Bronze / Silver / Gold / Platinum, actuarial values 60 / 70 / 80 / 90%, with tier-specific OOP maximums. No continuous generosity.
- **Consolidation:** endogenous from v1 — providers under margin pressure propose mergers; antitrust stringency lever governs blocking probability.
- **Labor market:** wages-only incidence of ESI costs (compensating differentials). No employment/hours margin; job lock deferred to v2.
- **Geography:** single national market in v1; stylized urban/rural regions deferred.
- **Export:** still open — run export as CSV/report for student writeups (lean yes, cheap to add late).
