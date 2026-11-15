/**
 * The headline measures, defined once: the tiles, challenge criteria and the
 * comparison table all read from this list. Every reading is in the units it
 * is displayed in (percent, weeks, trillions of dollars).
 */
import { PARAMS } from "../engine/index.ts";
import type { YearResult } from "../engine/index.ts";

export interface Metric {
  key: string;
  label: string;
  /** Unit shown next to a number someone types (challenge targets). */
  unit: string;
  read(y: YearResult): number;
  fmt(v: number): string;
  /** A change, without its sign: "6.8 pp". */
  fmtDelta(d: number): string;
  better: "higher" | "lower";
  /** Changes smaller than this are not colored good or bad. */
  epsilon: number;
  help: string;
}

const households = (y: YearResult): number => y.coverage.esi + y.coverage.individual + y.coverage.public + y.coverage.uninsured;

/** Sample dollars to national dollars (the 170 million US adults aged 26–64), in trillions. */
const nationalTrillions = (y: YearResult, sampleDollars: number): number =>
  (sampleDollars * PARAMS.displayPopulation) / households(y) / 1e12;

const money = (trillions: number): string =>
  Math.abs(trillions) >= 1 ? `$${trillions.toFixed(2)}T` : `$${Math.round(trillions * 1000)}B`;

export const METRICS: Metric[] = [
  {
    key: "insured",
    label: "Insured",
    unit: "%",
    read: (y) => y.insuredRate * 100,
    fmt: (v) => `${v.toFixed(1)}%`,
    fmtDelta: (d) => `${d.toFixed(1)} pp`,
    better: "higher",
    epsilon: 0.2,
    help: "Share of households with any insurance (employer, individual, or public). With public direct provision, uninsured households can still get care.",
  },
  {
    key: "nhe",
    label: "Health spending",
    unit: "% of GDP",
    read: (y) => y.spending.nheShareOfGdp * 100,
    fmt: (v) => `${v.toFixed(1)}%`,
    fmtDelta: (d) => `${d.toFixed(1)} pp of GDP`,
    better: "lower",
    epsilon: 0.2,
    help: "National health expenditure as a share of GDP: medical spending plus insurer and administrative load, scaled so that current law starts near the real 17.5%.",
  },
  {
    key: "health",
    label: "Population health",
    unit: "(index, 0.2–1.0)",
    read: (y) => y.health.meanHealthStock,
    fmt: (v) => v.toFixed(3),
    fmtDelta: (d) => d.toFixed(3),
    better: "higher",
    epsilon: 0.002,
    help: "Average health stock across households (0.2–1.0). It rises with adequate care and falls with age and with care needed but not received; innovation raises the health return on care. A stylized index, not life expectancy.",
  },
  {
    key: "careGap",
    label: "Care gap",
    unit: "%",
    read: (y) => y.health.careGap * 100,
    fmt: (v) => `${v.toFixed(1)}%`,
    fmtDelta: (d) => `${d.toFixed(1)} pp`,
    better: "lower",
    epsilon: 0.2,
    help: "Average share of needed care that households did not receive: skipped because of cost-sharing or being uninsured, rationed when demand exceeds capacity, or lost to long waits.",
  },
  {
    key: "innovation",
    label: "Innovation index",
    unit: "(index, starts at 1.0)",
    read: (y) => y.innovation.index,
    fmt: (v) => v.toFixed(2),
    fmtDelta: (d) => d.toFixed(2),
    better: "higher",
    epsilon: 0.01,
    help: "Medical-technology index (starts at 1.0), funded by commercial revenue and provider margins, with a public and spillover floor. Higher innovation raises the health return on care over time.",
  },
  {
    key: "govCost",
    label: "Govt. social cost",
    unit: "$ trillion a year",
    read: (y) => nationalTrillions(y, y.government.totalSocialCost),
    fmt: money,
    fmtDelta: (d) => money(d),
    better: "lower",
    epsilon: 0.02,
    help: "Annual government health outlays (subsidies, public insurance, direct provision, the ESI tax break) plus the deadweight loss of raising that revenue. Scaled to the 170 million US adults aged 26–64, the people the model simulates; it leaves out children and Medicare.",
  },
  {
    key: "longestWait",
    label: "Longest wait",
    unit: "weeks",
    read: (y) =>
      Math.max(
        y.providers.hospital.active ? y.providers.hospital.waitWeeks : 0,
        y.providers.physician.active ? y.providers.physician.waitWeeks : 0,
        y.publicProvision?.waitWeeks ?? 0,
      ),
    fmt: (v) => `${v.toFixed(1)} wk`,
    fmtDelta: (d) => `${d.toFixed(1)} wk`,
    better: "lower",
    epsilon: 0.3,
    help: "The longest average wait among the delivery systems in use (hospitals, physicians, the public system).",
  },
  {
    key: "uninsuredLow",
    label: "Uninsured, low-income third",
    unit: "%",
    read: (y) => y.uninsuredRateByIncome.low * 100,
    fmt: (v) => `${v.toFixed(1)}%`,
    fmtDelta: (d) => `${d.toFixed(1)} pp`,
    better: "lower",
    epsilon: 0.3,
    help: "Uninsured rate among the lowest-income third of households.",
  },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
/** The six measures shown as tiles. */
export const TILE_METRICS = METRICS.slice(0, 6);
