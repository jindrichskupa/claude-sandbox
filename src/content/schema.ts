/**
 * Content schema.
 *
 * The neutrality guarantee of this game is, at bottom, a claim about where its numbers came
 * from. So every number that feeds the simulation is wrapped in `Sourced<T>` and carries the
 * publication it came from. A test in `tests/content.test.ts` walks the whole content tree
 * and fails on any bare number, which is what turns "we promise not to put a thumb on the
 * scale" into something the build actually enforces.
 */

export interface Sourced<T> {
  value: T
  /** Physical unit, for display and for sanity checks. */
  unit: Unit
  /** Publication the figure is drawn from. See `SOURCES`. */
  source: SourceId
  /** Year the figure refers to, so ageing data is visible rather than silent. */
  sourceYear: number
  /** Optional note, e.g. which variant of a technology the figure describes. */
  note?: string
}

export type Unit =
  | 'MW'
  | 'MWh'
  /** Thermal megawatts. Distinguished from electrical MW because confusing them is the
   *  classic cogeneration mistake, and a unit field that cannot tell them apart invites it. */
  | 'MWth'
  | 'MWh_th'
  | 'EUR'
  | 'EUR/kW'
  | 'EUR/kWth'
  | 'EUR/kW/yr'
  | 'EUR/kWth/yr'
  | 'EUR/MWh'
  /** Per megawatt of installed capacity, for a one-off such as a start. */
  | 'EUR/MW'
  | 'EUR/MWh_th'
  | 'EUR/t'
  | 't/MWh_th'
  | 'fraction'
  | 'fraction/h'
  | 'fraction/yr'
  | 'kW'
  | 'kW/person'
  | 'kWh/kW/yr'
  | 'years'
  | 'months'
  | 'hours'
  | 'km'
  | 'kV'
  | 'ohm/km'
  | 'degC'
  | 'm/s'
  | 'count'

/**
 * The publications the content draws on. These are real, publicly available references.
 *
 * A caveat worth stating plainly: the figures in this game are *representative values*
 * chosen from the broad ranges these publications report. Real costs vary enormously by
 * country, site, year and financing. They are accurate enough that the trade-offs between
 * technologies behave like the real ones, and they are not precise enough to plan an actual
 * power station with. Where a range is wide, the note field says so.
 */
export const SOURCES = {
  'iea-weo': 'IEA, World Energy Outlook (cost and fuel price assumptions)',
  'iea-projected-costs': 'IEA/NEA, Projected Costs of Generating Electricity',
  'lazard-lcoe': 'Lazard, Levelized Cost of Energy Analysis',
  'nrel-atb': 'NREL, Annual Technology Baseline',
  'ipcc-ar5-a3': 'IPCC AR5 Working Group III, Annex III (lifecycle emission factors)',
  'eia-electricity': 'US EIA, Electric Power Annual / Capital Cost Estimates',
  'entsoe-factsheet': 'ENTSO-E, statistical factsheets and transmission data',
  'irena-costs': 'IRENA, Renewable Power Generation Costs',
  'euro-chp-practice': 'Euroheat & Power / IEA DHC, district heating and CHP practice',
  'eu-energy-policy': 'European energy policy practice: EU ETS settlement prices, national support schemes, 2022 windfall levies',
  'eurostat': 'Eurostat, European energy balances, household consumption and demographic statistics',
  'iea-efficiency': 'IEA, Energy Efficiency market reports (per-capita electricity intensity trends)',
  'iea-electrification': 'IEA, roadmaps for the electrification of transport and heat',
  'pvgis': 'European Commission JRC, Photovoltaic Geographical Information System (yield and roof potential)',
  'engineering-standard': 'Standard power engineering reference values (textbook level)',
  'game-design': 'Game design choice — not a physical or economic measurement',
} as const

export type SourceId = keyof typeof SOURCES

/** Build a sourced value. */
export function sourced<T>(
  value: T,
  unit: Unit,
  source: SourceId,
  sourceYear: number,
  note?: string,
): Sourced<T> {
  return note === undefined ? { value, unit, source, sourceYear } : { value, unit, source, sourceYear, note }
}

/** Read the bare number out of a sourced value. */
export function v(s: Sourced<number>): number {
  return s.value
}

/** Structural check used by the content test. */
export function isSourced(x: unknown): x is Sourced<unknown> {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    'value' in o &&
    typeof o.unit === 'string' &&
    typeof o.source === 'string' &&
    typeof o.sourceYear === 'number' &&
    o.source in SOURCES
  )
}
