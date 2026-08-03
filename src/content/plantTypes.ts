/**
 * Generating technologies.
 *
 * Read the caveat in `schema.ts`: these are representative values from published ranges,
 * chosen so the trade-offs behave like the real ones. Every technology here is the right
 * answer to *some* situation and the wrong answer to others, and that is a consequence of
 * the numbers rather than a design intent layered on top of them. `tests/neutrality.test.ts`
 * checks that claim mechanically.
 */

import { sourced, type Sourced } from './schema'
import type { FuelId } from './fuels'

export type PlantTypeId =
  | 'coal'
  | 'lignite'
  | 'ccgt'
  | 'ocgt'
  | 'nuclear'
  | 'hydro'
  | 'pumped'
  | 'wind'
  | 'solar'
  | 'battery'
  | 'gas_chp'

export type PlantCategory = 'thermal' | 'nuclear' | 'hydro' | 'wind' | 'solar' | 'storage'

/** What the plant's output depends on in the weather model. */
export type WeatherDependence = 'none' | 'wind' | 'solar' | 'riverflow'

/**
 * How the plant rejects waste heat. This decides how badly it derates in a heatwave —
 * water-cooled thermal plants lose output exactly when a heatwave has driven demand up,
 * which is one of the more instructive coincidences in the real grid.
 */
export type CoolingType = 'none' | 'water' | 'air'

/** Electricity/heat coupling for cogeneration. Used from the heat milestone onward. */
export interface ChpSpec {
  /** `extraction` trades heat against power; `backpressure` fixes their ratio. */
  mode: 'extraction' | 'backpressure'
  /** Max heat output. */
  heatCapacityMwth: Sourced<number>
  /** MW of electricity lost per MW of heat extracted (extraction units). */
  powerLossPerHeat: Sourced<number>
  /** MW of electricity per MW of heat (backpressure units). */
  powerPerHeat: Sourced<number>
}

export interface StorageSpec {
  /** Usable energy capacity. */
  energyMwh: Sourced<number>
  /** Round-trip efficiency. */
  roundTripEfficiency: Sourced<number>
}

export interface PlantTypeDef {
  id: PlantTypeId
  nameKey: string
  category: PlantCategory
  fuel: FuelId

  /** Typical unit size built in one go. */
  capacityMw: Sourced<number>
  capexPerKw: Sourced<number>
  fixedOpexPerKwYear: Sourced<number>
  /** Non-fuel variable cost. */
  varOpexPerMwh: Sourced<number>
  /** Net electrical efficiency, fuel thermal energy to electricity. */
  efficiency: Sourced<number>

  /** Fraction of rated capacity the unit can change per hour. */
  rampRatePerHour: Sourced<number>
  /** Lowest stable output as a fraction of capacity, while running. */
  minLoadFraction: Sourced<number>

  buildTimeMonths: Sourced<number>
  designLifeYears: Sourced<number>

  /** Cost to shut down and dismantle, per kW of capacity. */
  decommissionCostPerKw: Sourced<number>
  /** How long dismantling takes. */
  decommissionYears: Sourced<number>
  /** Further years before the site can be reused. */
  remediationYears: Sourced<number>
  /** Scrap and material value recovered at end of life, per kW. */
  recyclingRecoveryPerKw: Sourced<number>

  /** Relative efficiency lost per year of operation. */
  annualEfficiencyDecay: Sourced<number>
  /** Baseline probability of being unavailable at any moment, when new. */
  forcedOutageRate: Sourced<number>

  weatherDependence: WeatherDependence
  cooling: CoolingType

  chp: ChpSpec | null
  storage: StorageSpec | null
}

/** Reference year for the cost figures below. */
const Y = 2023

export const PLANT_TYPES: Record<PlantTypeId, PlantTypeDef> = {
  coal: {
    id: 'coal',
    nameKey: 'plant.coal',
    category: 'thermal',
    fuel: 'coal',
    capacityMw: sourced(500, 'MW', 'engineering-standard', Y, 'Typical hard-coal steam unit'),
    capexPerKw: sourced(1900, 'EUR/kW', 'iea-projected-costs', 2020),
    fixedOpexPerKwYear: sourced(55, 'EUR/kW/yr', 'eia-electricity', 2022),
    varOpexPerMwh: sourced(4, 'EUR/MWh', 'eia-electricity', 2022),
    efficiency: sourced(0.4, 'fraction', 'iea-projected-costs', 2020, 'Subcritical to supercritical: 0.36-0.45'),
    rampRatePerHour: sourced(0.4, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0.35, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(48, 'months', 'iea-projected-costs', 2020),
    designLifeYears: sourced(45, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(200, 'EUR/kW', 'eia-electricity', 2022, 'Includes ash pond and site cleanup'),
    decommissionYears: sourced(4, 'years', 'engineering-standard', Y),
    remediationYears: sourced(6, 'years', 'engineering-standard', Y, 'Ash and contaminated ground'),
    recyclingRecoveryPerKw: sourced(25, 'EUR/kW', 'engineering-standard', Y, 'Steel and copper scrap'),
    annualEfficiencyDecay: sourced(0.002, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.08, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    chp: null,
    storage: null,
  },

  lignite: {
    id: 'lignite',
    nameKey: 'plant.lignite',
    category: 'thermal',
    fuel: 'lignite',
    capacityMw: sourced(600, 'MW', 'engineering-standard', Y),
    capexPerKw: sourced(2100, 'EUR/kW', 'iea-projected-costs', 2020, 'Higher than hard coal: wet, low-grade fuel'),
    fixedOpexPerKwYear: sourced(65, 'EUR/kW/yr', 'eia-electricity', 2022),
    varOpexPerMwh: sourced(4, 'EUR/MWh', 'eia-electricity', 2022),
    efficiency: sourced(0.36, 'fraction', 'iea-projected-costs', 2020),
    rampRatePerHour: sourced(0.3, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0.5, 'fraction', 'engineering-standard', Y, 'Inflexible; a real operating problem'),
    buildTimeMonths: sourced(54, 'months', 'iea-projected-costs', 2020),
    designLifeYears: sourced(45, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(250, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(4, 'years', 'engineering-standard', Y),
    remediationYears: sourced(8, 'years', 'engineering-standard', Y, 'Mine and spoil restoration'),
    recyclingRecoveryPerKw: sourced(25, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.002, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.09, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    chp: null,
    storage: null,
  },

  ccgt: {
    id: 'ccgt',
    nameKey: 'plant.ccgt',
    category: 'thermal',
    fuel: 'gas',
    capacityMw: sourced(450, 'MW', 'engineering-standard', Y, 'Single-shaft combined cycle'),
    capexPerKw: sourced(900, 'EUR/kW', 'iea-projected-costs', 2020),
    fixedOpexPerKwYear: sourced(25, 'EUR/kW/yr', 'eia-electricity', 2022),
    varOpexPerMwh: sourced(2, 'EUR/MWh', 'eia-electricity', 2022),
    efficiency: sourced(0.58, 'fraction', 'iea-projected-costs', 2020, 'Best modern units reach 0.62'),
    rampRatePerHour: sourced(0.7, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0.3, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(30, 'months', 'iea-projected-costs', 2020),
    designLifeYears: sourced(30, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(60, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(2, 'years', 'engineering-standard', Y),
    remediationYears: sourced(1, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(20, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0015, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.05, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    chp: null,
    storage: null,
  },

  ocgt: {
    id: 'ocgt',
    nameKey: 'plant.ocgt',
    category: 'thermal',
    fuel: 'gas',
    capacityMw: sourced(150, 'MW', 'engineering-standard', Y, 'Open-cycle peaker'),
    capexPerKw: sourced(550, 'EUR/kW', 'iea-projected-costs', 2020),
    fixedOpexPerKwYear: sourced(15, 'EUR/kW/yr', 'eia-electricity', 2022),
    varOpexPerMwh: sourced(3, 'EUR/MWh', 'eia-electricity', 2022),
    efficiency: sourced(0.38, 'fraction', 'iea-projected-costs', 2020, 'Cheap to build, expensive to run'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y, 'Full output within minutes'),
    minLoadFraction: sourced(0.1, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(18, 'months', 'iea-projected-costs', 2020),
    designLifeYears: sourced(25, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(40, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(1, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(15, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0015, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.04, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'air',
    chp: null,
    storage: null,
  },

  nuclear: {
    id: 'nuclear',
    nameKey: 'plant.nuclear',
    category: 'nuclear',
    fuel: 'uranium',
    capacityMw: sourced(1000, 'MW', 'engineering-standard', Y, 'Large PWR unit'),
    capexPerKw: sourced(6000, 'EUR/kW', 'iea-projected-costs', 2020, 'Recent Western builds have exceeded this considerably'),
    fixedOpexPerKwYear: sourced(130, 'EUR/kW/yr', 'iea-projected-costs', 2020),
    varOpexPerMwh: sourced(9, 'EUR/MWh', 'iea-projected-costs', 2020, 'Includes waste fund contributions'),
    efficiency: sourced(0.33, 'fraction', 'engineering-standard', Y, 'Low steam temperature limits it'),
    rampRatePerHour: sourced(0.05, 'fraction/h', 'engineering-standard', Y, 'Technically capable of more; rarely done'),
    minLoadFraction: sourced(0.6, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(96, 'months', 'iea-projected-costs', 2020),
    designLifeYears: sourced(60, 'years', 'engineering-standard', Y, 'With mid-life refurbishment'),
    decommissionCostPerKw: sourced(900, 'EUR/kW', 'iea-projected-costs', 2020, 'Estimates vary widely and tend to rise'),
    decommissionYears: sourced(10, 'years', 'engineering-standard', Y),
    remediationYears: sourced(20, 'years', 'engineering-standard', Y, 'Long site release timescale'),
    recyclingRecoveryPerKw: sourced(10, 'EUR/kW', 'engineering-standard', Y, 'Little of it can be sold'),
    annualEfficiencyDecay: sourced(0.001, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.04, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    chp: null,
    storage: null,
  },

  hydro: {
    id: 'hydro',
    nameKey: 'plant.hydro',
    category: 'hydro',
    fuel: 'none',
    capacityMw: sourced(80, 'MW', 'engineering-standard', Y, 'Run-of-river station'),
    capexPerKw: sourced(3200, 'EUR/kW', 'irena-costs', 2022, 'Extremely site-dependent'),
    fixedOpexPerKwYear: sourced(30, 'EUR/kW/yr', 'irena-costs', 2022),
    varOpexPerMwh: sourced(1, 'EUR/MWh', 'irena-costs', 2022),
    efficiency: sourced(0.9, 'fraction', 'engineering-standard', Y, 'Turbine-generator efficiency'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(60, 'months', 'irena-costs', 2022),
    designLifeYears: sourced(80, 'years', 'engineering-standard', Y, 'Civil works outlast everything else'),
    decommissionCostPerKw: sourced(100, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(3, 'years', 'engineering-standard', Y),
    remediationYears: sourced(2, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(20, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0005, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.02, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'riverflow',
    cooling: 'none',
    chp: null,
    storage: null,
  },

  pumped: {
    id: 'pumped',
    nameKey: 'plant.pumped',
    category: 'storage',
    fuel: 'none',
    capacityMw: sourced(300, 'MW', 'engineering-standard', Y),
    capexPerKw: sourced(1800, 'EUR/kW', 'irena-costs', 2022),
    fixedOpexPerKwYear: sourced(20, 'EUR/kW/yr', 'irena-costs', 2022),
    varOpexPerMwh: sourced(1, 'EUR/MWh', 'irena-costs', 2022),
    efficiency: sourced(0.9, 'fraction', 'engineering-standard', Y),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(72, 'months', 'irena-costs', 2022),
    designLifeYears: sourced(80, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(100, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(3, 'years', 'engineering-standard', Y),
    remediationYears: sourced(2, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(20, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0005, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.02, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'none',
    chp: null,
    storage: {
      energyMwh: sourced(1800, 'MWh', 'engineering-standard', Y, 'About 6 hours at rated power'),
      roundTripEfficiency: sourced(0.78, 'fraction', 'irena-costs', 2022),
    },
  },

  wind: {
    id: 'wind',
    nameKey: 'plant.wind',
    category: 'wind',
    fuel: 'none',
    capacityMw: sourced(50, 'MW', 'irena-costs', 2022, 'Onshore farm'),
    capexPerKw: sourced(1400, 'EUR/kW', 'irena-costs', 2022),
    fixedOpexPerKwYear: sourced(40, 'EUR/kW/yr', 'irena-costs', 2022),
    varOpexPerMwh: sourced(1, 'EUR/MWh', 'irena-costs', 2022),
    efficiency: sourced(1, 'fraction', 'game-design', Y, 'No fuel; the wind curve does the work'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(18, 'months', 'irena-costs', 2022),
    designLifeYears: sourced(25, 'years', 'irena-costs', 2022),
    decommissionCostPerKw: sourced(60, 'EUR/kW', 'irena-costs', 2022),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(1, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(15, 'EUR/kW', 'engineering-standard', Y, 'Blades are the hard part to recycle'),
    annualEfficiencyDecay: sourced(0.003, 'fraction', 'irena-costs', 2022, 'Output degrades with wear'),
    forcedOutageRate: sourced(0.03, 'fraction', 'irena-costs', 2022),
    weatherDependence: 'wind',
    cooling: 'none',
    chp: null,
    storage: null,
  },

  solar: {
    id: 'solar',
    nameKey: 'plant.solar',
    category: 'solar',
    fuel: 'none',
    capacityMw: sourced(50, 'MW', 'irena-costs', 2022, 'Utility-scale farm'),
    capexPerKw: sourced(700, 'EUR/kW', 'irena-costs', 2022, 'Has fallen roughly tenfold since 2010'),
    fixedOpexPerKwYear: sourced(15, 'EUR/kW/yr', 'irena-costs', 2022),
    varOpexPerMwh: sourced(0.5, 'EUR/MWh', 'irena-costs', 2022),
    efficiency: sourced(1, 'fraction', 'game-design', Y, 'No fuel; irradiance does the work'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(12, 'months', 'irena-costs', 2022),
    designLifeYears: sourced(30, 'years', 'irena-costs', 2022),
    decommissionCostPerKw: sourced(30, 'EUR/kW', 'irena-costs', 2022),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(1, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(10, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.005, 'fraction', 'irena-costs', 2022, 'Panel degradation, about 0.5%/yr'),
    forcedOutageRate: sourced(0.02, 'fraction', 'irena-costs', 2022),
    weatherDependence: 'solar',
    cooling: 'none',
    chp: null,
    storage: null,
  },

  battery: {
    id: 'battery',
    nameKey: 'plant.battery',
    category: 'storage',
    fuel: 'none',
    capacityMw: sourced(50, 'MW', 'nrel-atb', 2023),
    capexPerKw: sourced(900, 'EUR/kW', 'nrel-atb', 2023, 'For a 2-hour system; falling fast'),
    fixedOpexPerKwYear: sourced(20, 'EUR/kW/yr', 'nrel-atb', 2023),
    varOpexPerMwh: sourced(1.5, 'EUR/MWh', 'nrel-atb', 2023),
    efficiency: sourced(1, 'fraction', 'game-design', Y, 'Round-trip loss is in the storage spec'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y, 'Effectively instant'),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(9, 'months', 'nrel-atb', 2023),
    designLifeYears: sourced(15, 'years', 'nrel-atb', 2023, 'Cycle life, not calendar life, usually binds'),
    decommissionCostPerKw: sourced(20, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(0, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(45, 'EUR/kW', 'engineering-standard', Y, 'Lithium, nickel and cobalt are worth recovering'),
    annualEfficiencyDecay: sourced(0.02, 'fraction', 'nrel-atb', 2023, 'Capacity fade'),
    forcedOutageRate: sourced(0.02, 'fraction', 'nrel-atb', 2023),
    weatherDependence: 'none',
    cooling: 'none',
    chp: null,
    storage: {
      energyMwh: sourced(100, 'MWh', 'nrel-atb', 2023, '2 hours at rated power'),
      roundTripEfficiency: sourced(0.88, 'fraction', 'nrel-atb', 2023),
    },
  },

  gas_chp: {
    id: 'gas_chp',
    nameKey: 'plant.gas_chp',
    category: 'thermal',
    fuel: 'gas',
    capacityMw: sourced(120, 'MW', 'euro-chp-practice', 2021, 'District heating cogeneration unit'),
    capexPerKw: sourced(1300, 'EUR/kW', 'euro-chp-practice', 2021, 'Higher than plain CCGT: heat extraction equipment'),
    fixedOpexPerKwYear: sourced(35, 'EUR/kW/yr', 'euro-chp-practice', 2021),
    varOpexPerMwh: sourced(3, 'EUR/MWh', 'euro-chp-practice', 2021),
    efficiency: sourced(0.4, 'fraction', 'euro-chp-practice', 2021, 'Electrical only; total fuel use is far better'),
    rampRatePerHour: sourced(0.6, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0.3, 'fraction', 'engineering-standard', Y),
    buildTimeMonths: sourced(30, 'months', 'euro-chp-practice', 2021),
    designLifeYears: sourced(35, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(70, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(2, 'years', 'engineering-standard', Y),
    remediationYears: sourced(1, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(20, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0015, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.05, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    chp: {
      mode: 'extraction',
      heatCapacityMwth: sourced(150, 'MW', 'euro-chp-practice', 2021),
      powerLossPerHeat: sourced(0.18, 'fraction', 'euro-chp-practice', 2021, 'Typical cv factor 0.15-0.25'),
      powerPerHeat: sourced(0.55, 'fraction', 'euro-chp-practice', 2021, 'Only used by backpressure units'),
    },
    storage: null,
  },
}

export const PLANT_TYPE_IDS = Object.keys(PLANT_TYPES) as PlantTypeId[]
