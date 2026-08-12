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
  | 'offshore_wind'
  | 'solar'
  | 'battery'
  | 'gas_chp'
  | 'coal_chp'
  | 'heat_boiler'
  | 'heat_accumulator'

export type PlantCategory = 'thermal' | 'nuclear' | 'hydro' | 'wind' | 'solar' | 'storage' | 'heat'

/** What the plant's output depends on in the weather model. */
export type WeatherDependence = 'none' | 'wind' | 'solar' | 'riverflow'

/**
 * How the plant rejects waste heat. This decides how badly it derates in a heatwave —
 * water-cooled thermal plants lose output exactly when a heatwave has driven demand up,
 * which is one of the more instructive coincidences in the real grid.
 */
export type CoolingType = 'none' | 'water' | 'air'

/**
 * Electricity/heat coupling for cogeneration.
 *
 * A cogeneration unit is not a power station with a heat exchanger bolted on; the two outputs
 * come out of the same steam and are bound together. Two couplings cover almost every real
 * machine, and they behave completely differently to operate:
 *
 *   **Extraction.** Steam is bled from the turbine before it has finished expanding. Every
 *   megawatt of heat taken costs `powerLossPerHeat` megawatts of electricity, but the unit can
 *   still run on electricity alone. It is a normal generator with a ceiling that drops as the
 *   heat load rises.
 *
 *       Pel_max = Pel_rated · availability − cv · Q
 *
 *   **Backpressure.** The turbine exhausts straight into the heat network, so the steam that
 *   makes the electricity is the same steam that heats the town. Power and heat are locked in
 *   a fixed ratio and neither can be chosen independently:
 *
 *       Pel = cm · Q
 *
 *   That is the interesting one, and the reason it is in this game. A backpressure unit
 *   serving a cold city is a *fixed injection* the electrical dispatch cannot decline — it
 *   generates because people need to be warm, whatever the market price is doing. Real systems
 *   with large cogeneration fleets clear at strange prices on cold nights for exactly this
 *   reason, and no amount of merit-order reasoning makes it go away.
 *
 * Neither coupling touches the flow solver, because both reduce to bounds on one arc. Solving
 * heat and electricity together as a single optimisation would be theoretically better by a
 * percent or two and would destroy the network structure that makes nodal prices fall out for
 * free. Heat-led sequencing is also how these plants are really run.
 */
export interface ChpSpec {
  /** `extraction` trades heat against power; `backpressure` fixes their ratio. */
  mode: 'extraction' | 'backpressure'
  /** Max heat output. */
  heatCapacityMwth: Sourced<number>
  /** MW of electricity lost per MW of heat extracted (extraction units). */
  powerLossPerHeat: Sourced<number>
  /** MW of electricity per MW of heat (backpressure units). */
  powerPerHeat: Sourced<number>
  /**
   * Total fuel-to-useful-energy efficiency, electricity and heat together. Far higher than the
   * electrical efficiency alone, and the entire economic case for cogeneration: the heat would
   * otherwise go up a cooling tower.
   */
  totalEfficiency: Sourced<number>
}

/**
 * A plant that makes heat and no electricity.
 *
 * These are cheap, and that matters. A peak boiler costs a small fraction of a cogeneration
 * unit per kilowatt and covers the coldest few hundred hours a year, which is precisely the
 * load nobody wants to size expensive plant for. A heat accumulator is a large insulated tank
 * of hot water — nearly free compared with a battery of comparable energy, because water in a
 * tank is not lithium in a rack — and it is the real reason cogeneration fleets have any
 * flexibility at all: it lets the unit make heat when electricity is worth money and store it
 * for when the town needs it.
 *
 * For these types the electrical fields are inert and `capacityMw` carries the *thermal*
 * rating, with the units on each figure saying so. `isDispatchable` excludes them from the
 * electrical merit order, so they cannot leak into the power system by accident.
 */
export interface HeatOnlySpec {
  kind: 'boiler' | 'accumulator'
  /** Fuel to heat, for boilers. Round-trip charge-to-discharge, for accumulators. */
  thermalEfficiency: Sourced<number>
  /** Usable stored heat. Accumulators only. */
  storageMwhth: Sourced<number> | null
  /** Fraction of stored heat lost per hour through the insulation. Accumulators only. */
  standingLossPerHour: Sourced<number> | null
}

export interface StorageSpec {
  /** Usable energy capacity. */
  energyMwh: Sourced<number>
  /** Round-trip efficiency. */
  roundTripEfficiency: Sourced<number>
  /**
   * Equivalent full cycles the store can deliver before it is worn out, or null for
   * technologies whose life is not measured that way.
   *
   * This is the constraint that actually binds a battery. A lithium system rated for fifteen
   * calendar years but only a few thousand cycles is finished in eight if it is worked hard,
   * and that trade-off — cycle it aggressively for revenue, or gently for longevity — is the
   * decision the player is really making. Pumped storage has no equivalent: water and steel
   * do not care how many times they have been moved.
   */
  cycleLife: Sourced<number> | null
  /** Fraction of capacity lost over the whole cycle life. */
  capacityFadeOverLife: Sourced<number> | null
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
  /**
   * What one stop-and-restart costs, per MW of capacity.
   *
   * Fuel burnt getting back to temperature, and the thermal fatigue a large machine suffers being
   * cycled — which is charged against its life whether or not anyone accounts for it that hour. It
   * is why a unit at its technical minimum will sell below its own running cost rather than come
   * off: the cycle costs more than the hour does.
   *
   * That behaviour is what this exists for. Before it, a unit's minimum was offered into the
   * dispatch at *zero*, on the reasoning that the fuel was being burnt anyway. Two things followed,
   * and both were wrong. The price collapsed to nothing in any hour a minimum was marginal —
   * 575 hours a year, with lignite and coal running, which is the market saying electricity is
   * free while somebody is buying the coal. And because that zero was the cheapest energy in the
   * system, it was always taken, so no unit ever came off: minima alone covered demand in half
   * the hours of the year, and the merit order had exactly two rungs.
   *
   * Highest for the large thermal machines, which are the ones cycling genuinely damages, and
   * near nothing for a gas turbine, which is built to start.
   */
  startCostPerMw: Sourced<number>

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

  /**
   * First year the technology can be built at all.
   *
   * A caveat worth stating: the cost figures above are held at their reference year, so a
   * technology built in 2005 costs what it cost in the source year rather than what it cost
   * in 2005. Making cost move with time is the learning-curve work, and until that lands this
   * field at least prevents the obvious absurdities — grid batteries in 1995, say.
   */
  availableFromYear: Sourced<number>

  /**
   * Mid-life refurbishment: strip the machine back, replace what has worn, and put it back
   * into service. Costs a fraction of building new and buys a fraction of a new life, which
   * is what makes it a genuine third option rather than a cheaper rebuild.
   */
  refurbishCostFraction: Sourced<number>
  /** Extra design life bought, as a fraction of the original. */
  refurbishLifeExtension: Sourced<number>
  refurbishMonths: Sourced<number>
  /**
   * Efficiency gained by fitting current technology to an old machine. Steam plant gains
   * little; anything with a gas turbine in it gains a great deal, because the turbines
   * themselves improved so much.
   */
  refurbishEfficiencyGain: Sourced<number>
  /** Capacity gained by uprating, as a fraction. */
  refurbishCapacityGain: Sourced<number>

  chp: ChpSpec | null
  storage: StorageSpec | null
  heatOnly: HeatOnlySpec | null
}

/** Whether this technology makes heat and no electricity. */
export function isHeatOnlyType(id: PlantTypeId): boolean {
  return PLANT_TYPES[id].heatOnly !== null
}

/** Whether this technology can put heat into a district heating network. */
export function isHeatSourceType(id: PlantTypeId): boolean {
  const type = PLANT_TYPES[id]
  return type.chp !== null || type.heatOnly !== null
}

/** Rated heat output, whatever kind of heat plant it is. Zero for everything else. */
export function heatCapacityOf(id: PlantTypeId): number {
  const type = PLANT_TYPES[id]
  if (type.chp) return type.chp.heatCapacityMwth.value
  if (type.heatOnly) return type.capacityMw.value
  return 0
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
    startCostPerMw: sourced(55, 'EUR/MW', 'engineering-standard', Y, 'Hot start of a large coal unit, including the fatigue it charges to the machine'),
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
    availableFromYear: sourced(1900, 'count', 'engineering-standard', 2023, 'Mature long before the game begins'),
    refurbishCostFraction: sourced(0.35, 'fraction', 'engineering-standard', 2023, 'Boiler and turbine overhaul; steam plant gains little efficiency'),
    refurbishLifeExtension: sourced(0.5, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(24, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.03, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.02, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(70, 'EUR/MW', 'engineering-standard', Y, 'A lignite boiler is the least willing thing on the system to be cycled'),
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
    availableFromYear: sourced(1900, 'count', 'engineering-standard', 2023, 'Mature long before the game begins'),
    refurbishCostFraction: sourced(0.35, 'fraction', 'engineering-standard', 2023, 'As hard coal'),
    refurbishLifeExtension: sourced(0.5, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(24, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.03, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.02, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(35, 'EUR/MW', 'engineering-standard', Y, 'Two shafts and a steam cycle to bring back up'),
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
    availableFromYear: sourced(1985, 'count', 'engineering-standard', 2023, 'Combined cycle became the default choice in the late 1980s'),
    refurbishCostFraction: sourced(0.28, 'fraction', 'engineering-standard', 2023, 'A modern gas turbine in an old shell is a large gain'),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(14, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.06, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.08, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(6, 'EUR/MW', 'engineering-standard', Y, 'Built to start; that is the whole point of the machine'),
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
    availableFromYear: sourced(1960, 'count', 'engineering-standard', 2023, 'Mature'),
    refurbishCostFraction: sourced(0.25, 'fraction', 'engineering-standard', 2023, 'Turbine replacement'),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(9, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.06, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.08, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(180, 'EUR/MW', 'engineering-standard', Y, 'Xenon poisoning makes a restart a matter of days, not hours'),
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
    availableFromYear: sourced(1970, 'count', 'engineering-standard', 2023, 'Commercial fleet build-out'),
    refurbishCostFraction: sourced(0.45, 'fraction', 'engineering-standard', 2023, 'Long-term operation programme; steam generators and controls'),
    refurbishLifeExtension: sourced(0.4, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(36, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.02, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.05, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(1, 'EUR/MW', 'engineering-standard', Y, 'A gate and a governor'),
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
    availableFromYear: sourced(1900, 'count', 'engineering-standard', 2023, 'The oldest of them all'),
    refurbishCostFraction: sourced(0.2, 'fraction', 'engineering-standard', 2023, 'Civil works outlive several sets of machinery'),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(18, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.04, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.1, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(1, 'EUR/MW', 'engineering-standard', Y, 'A gate and a governor'),
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
    availableFromYear: sourced(1960, 'count', 'engineering-standard', 2023, 'Widely built from the 1960s'),
    refurbishCostFraction: sourced(0.2, 'fraction', 'engineering-standard', 2023, 'As hydro'),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(18, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.04, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.1, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: {
      energyMwh: sourced(1800, 'MWh', 'engineering-standard', Y, 'About 6 hours at rated power'),
      roundTripEfficiency: sourced(0.78, 'fraction', 'irena-costs', 2022),
      // Pumping water uphill does not wear the mountain out.
      cycleLife: null,
      capacityFadeOverLife: null,
    },
    heatOnly: null,
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
    startCostPerMw: sourced(0, 'EUR/MW', 'engineering-standard', Y, 'Nothing is burnt and nothing is heated'),
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
    availableFromYear: sourced(1995, 'count', 'engineering-standard', 2023, 'Utility-scale onshore wind became commercially routine in the mid 1990s'),
    refurbishCostFraction: sourced(0.55, 'fraction', 'engineering-standard', 2023, 'Repowering: new machines on existing foundations and grid connection'),
    refurbishLifeExtension: sourced(0.7, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(8, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.05, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.25, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
  },

  /**
   * Offshore wind.
   *
   * Not a bigger onshore farm: a different investment with a different shape. Roughly twice the
   * capital per kilowatt and twice the fixed cost, because everything has to be put there by
   * ship and everything that goes wrong has to be reached by ship — which is also why it is the
   * least reliable machine on the list, since a fault in February waits for a weather window.
   * Decommissioning costs several times what a turbine on land does, for the same reason.
   *
   * What it buys is the resource. Over open water there is nothing to slow the wind down, and
   * because power goes with the cube of speed, a site with no roughness upwind of it is worth
   * far more than the difference in wind speed suggests. That advantage is entirely locational —
   * it comes from `windSiteFactor` at the site, not from anything in this table — which is
   * exactly why the siting rule below it is what makes this technology interesting.
   */
  offshore_wind: {
    id: 'offshore_wind',
    nameKey: 'plant.offshore_wind',
    category: 'wind',
    fuel: 'none',
    capacityMw: sourced(120, 'MW', 'irena-costs', 2022, 'Offshore farms are built large; the vessels and cables do not scale down'),
    capexPerKw: sourced(2900, 'EUR/kW', 'irena-costs', 2022, 'Global weighted average; foundations, array cable and export cable included'),
    fixedOpexPerKwYear: sourced(85, 'EUR/kW/yr', 'irena-costs', 2022, 'Crew transfer vessels and marine access'),
    varOpexPerMwh: sourced(1, 'EUR/MWh', 'irena-costs', 2022),
    efficiency: sourced(1, 'fraction', 'game-design', Y, 'No fuel; the wind curve does the work'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    startCostPerMw: sourced(0, 'EUR/MW', 'engineering-standard', Y, 'Nothing is burnt and nothing is heated'),
    buildTimeMonths: sourced(36, 'months', 'irena-costs', 2022, 'Consent, cable route and a build season that closes in winter'),
    designLifeYears: sourced(27, 'years', 'irena-costs', 2022),
    decommissionCostPerKw: sourced(220, 'EUR/kW', 'engineering-standard', 2023, 'Jack-up vessels again, and the foundations have to come out'),
    decommissionYears: sourced(2, 'years', 'engineering-standard', 2023),
    remediationYears: sourced(1, 'years', 'engineering-standard', 2023),
    recyclingRecoveryPerKw: sourced(25, 'EUR/kW', 'engineering-standard', 2023, 'More steel to recover than onshore, and the same unrecyclable blades'),
    annualEfficiencyDecay: sourced(0.004, 'fraction', 'irena-costs', 2022, 'Salt and cavitation are harder on a blade than dust'),
    forcedOutageRate: sourced(0.06, 'fraction', 'engineering-standard', 2023, 'Not that it breaks more often, but that repairs wait for the sea'),
    weatherDependence: 'wind',
    cooling: 'none',
    availableFromYear: sourced(2002, 'count', 'engineering-standard', 2023, 'Horns Rev I, the first farm at utility scale'),
    refurbishCostFraction: sourced(0.6, 'fraction', 'engineering-standard', 2023, 'Repowering; the foundations and the export cable are the parts worth keeping'),
    refurbishLifeExtension: sourced(0.65, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(14, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.05, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.3, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(0, 'EUR/MW', 'engineering-standard', Y, 'Nothing is burnt and nothing is heated'),
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
    availableFromYear: sourced(2008, 'count', 'engineering-standard', 2023, 'Utility-scale photovoltaics only became affordable in the late 2000s'),
    refurbishCostFraction: sourced(0.4, 'fraction', 'engineering-standard', 2023, 'New panels on existing mounting and connection'),
    refurbishLifeExtension: sourced(0.8, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(6, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.02, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.3, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: null,
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
    startCostPerMw: sourced(0, 'EUR/MW', 'engineering-standard', Y, 'Nothing is burnt and nothing is heated'),
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
    availableFromYear: sourced(2015, 'count', 'engineering-standard', 2023, 'Grid-scale lithium storage'),
    refurbishCostFraction: sourced(0.6, 'fraction', 'engineering-standard', 2023, 'Cell replacement; effectively a new store in an existing building'),
    refurbishLifeExtension: sourced(1.0, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(6, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.0, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.0, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: {
      energyMwh: sourced(100, 'MWh', 'nrel-atb', 2023, '2 hours at rated power'),
      roundTripEfficiency: sourced(0.88, 'fraction', 'nrel-atb', 2023),
      cycleLife: sourced(5000, 'count', 'nrel-atb', 2023, 'Equivalent full cycles to end of warranty'),
      capacityFadeOverLife: sourced(0.2, 'fraction', 'nrel-atb', 2023, 'Typical warranty floor is 80% of new'),
    },
    heatOnly: null,
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
    startCostPerMw: sourced(30, 'EUR/MW', 'engineering-standard', Y, 'A cogeneration set is cycled around the heat load, not the market'),
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
    availableFromYear: sourced(1980, 'count', 'engineering-standard', 2023, 'Mature'),
    refurbishCostFraction: sourced(0.28, 'fraction', 'engineering-standard', 2023, 'As combined cycle'),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(16, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.05, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.06, 'fraction', 'engineering-standard', 2023),
    chp: {
      mode: 'extraction',
      heatCapacityMwth: sourced(150, 'MWth', 'euro-chp-practice', 2021),
      powerLossPerHeat: sourced(0.18, 'fraction', 'euro-chp-practice', 2021, 'Typical cv factor 0.15-0.25'),
      powerPerHeat: sourced(0.55, 'fraction', 'euro-chp-practice', 2021, 'Only used by backpressure units'),
      totalEfficiency: sourced(0.85, 'fraction', 'euro-chp-practice', 2021, 'Electricity plus useful heat'),
    },
    storage: null,
    heatOnly: null,
  },

  /**
   * The inherited district heating plant: an old coal unit exhausting straight into the town's
   * heat mains.
   *
   * Backpressure is what makes it awkward and what makes it worth having in the game. It cannot
   * choose to make less electricity while still heating the town, and it cannot choose to heat
   * the town without making electricity. On the coldest evening of the year it is a 100 MW
   * injection the dispatch has no say over; in April it is nearly idle whatever the market
   * would pay. Every real system with a large cogeneration fleet has this problem, and the only
   * ways out of it are an accumulator, a boiler, or a different machine.
   */
  coal_chp: {
    id: 'coal_chp',
    nameKey: 'plant.coal_chp',
    category: 'thermal',
    fuel: 'coal',
    capacityMw: sourced(110, 'MW', 'euro-chp-practice', 2021, 'Backpressure set matched to a town heat load'),
    capexPerKw: sourced(2200, 'EUR/kW', 'euro-chp-practice', 2021, 'Per electrical kW; the heat side is most of the plant'),
    fixedOpexPerKwYear: sourced(75, 'EUR/kW/yr', 'euro-chp-practice', 2021),
    varOpexPerMwh: sourced(5, 'EUR/MWh', 'euro-chp-practice', 2021),
    efficiency: sourced(0.29, 'fraction', 'euro-chp-practice', 2021, 'Electrical only; low because the steam is not fully expanded'),
    rampRatePerHour: sourced(0.3, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0.4, 'fraction', 'engineering-standard', Y),
    startCostPerMw: sourced(60, 'EUR/MW', 'engineering-standard', Y, 'A coal boiler, with a town on the other end of it'),
    buildTimeMonths: sourced(42, 'months', 'euro-chp-practice', 2021),
    designLifeYears: sourced(45, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(210, 'EUR/kW', 'engineering-standard', Y),
    decommissionYears: sourced(4, 'years', 'engineering-standard', Y),
    remediationYears: sourced(5, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(25, 'EUR/kW', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.002, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.08, 'fraction', 'entsoe-factsheet', 2022),
    weatherDependence: 'none',
    cooling: 'water',
    availableFromYear: sourced(1950, 'count', 'engineering-standard', 2023, 'The classic municipal heating plant'),
    refurbishCostFraction: sourced(0.35, 'fraction', 'engineering-standard', 2023),
    refurbishLifeExtension: sourced(0.5, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(22, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.03, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.02, 'fraction', 'engineering-standard', 2023),
    chp: {
      mode: 'backpressure',
      heatCapacityMwth: sourced(245, 'MWth', 'euro-chp-practice', 2021),
      powerLossPerHeat: sourced(0.18, 'fraction', 'euro-chp-practice', 2021, 'Only used by extraction units'),
      powerPerHeat: sourced(0.45, 'fraction', 'euro-chp-practice', 2021, 'Typical cm factor for a coal backpressure set'),
      totalEfficiency: sourced(0.82, 'fraction', 'euro-chp-practice', 2021),
    },
    storage: null,
    heatOnly: null,
  },

  heat_boiler: {
    id: 'heat_boiler',
    nameKey: 'plant.heat_boiler',
    category: 'heat',
    fuel: 'gas',
    capacityMw: sourced(100, 'MWth', 'euro-chp-practice', 2021, 'Thermal rating; this plant makes no electricity'),
    capexPerKw: sourced(90, 'EUR/kWth', 'euro-chp-practice', 2021, 'A fraction of any generating plant per kW'),
    fixedOpexPerKwYear: sourced(3, 'EUR/kWth/yr', 'euro-chp-practice', 2021),
    varOpexPerMwh: sourced(1.5, 'EUR/MWh_th', 'euro-chp-practice', 2021),
    efficiency: sourced(0.92, 'fraction', 'euro-chp-practice', 2021, 'Fuel to heat'),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y, 'Minutes from cold'),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    startCostPerMw: sourced(2, 'EUR/MW', 'engineering-standard', Y, 'A burner and a fan'),
    buildTimeMonths: sourced(10, 'months', 'euro-chp-practice', 2021),
    designLifeYears: sourced(30, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(8, 'EUR/kWth', 'engineering-standard', Y),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(0, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(4, 'EUR/kWth', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.001, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.02, 'fraction', 'euro-chp-practice', 2021),
    weatherDependence: 'none',
    cooling: 'none',
    availableFromYear: sourced(1900, 'count', 'engineering-standard', 2023),
    refurbishCostFraction: sourced(0.3, 'fraction', 'engineering-standard', 2023),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(4, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.03, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.0, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: {
      kind: 'boiler',
      thermalEfficiency: sourced(0.92, 'fraction', 'euro-chp-practice', 2021),
      storageMwhth: null,
      standingLossPerHour: null,
    },
  },

  heat_accumulator: {
    id: 'heat_accumulator',
    nameKey: 'plant.heat_accumulator',
    category: 'heat',
    fuel: 'none',
    capacityMw: sourced(120, 'MWth', 'euro-chp-practice', 2021, 'Charge and discharge rating'),
    capexPerKw: sourced(35, 'EUR/kWth', 'euro-chp-practice', 2021, 'A tank of hot water is not a battery, and the price says so'),
    fixedOpexPerKwYear: sourced(1, 'EUR/kWth/yr', 'euro-chp-practice', 2021),
    varOpexPerMwh: sourced(0.2, 'EUR/MWh_th', 'euro-chp-practice', 2021),
    efficiency: sourced(0.98, 'fraction', 'euro-chp-practice', 2021),
    rampRatePerHour: sourced(1, 'fraction/h', 'engineering-standard', Y),
    minLoadFraction: sourced(0, 'fraction', 'engineering-standard', Y),
    startCostPerMw: sourced(0, 'EUR/MW', 'engineering-standard', Y, 'A tank of hot water'),
    buildTimeMonths: sourced(12, 'months', 'euro-chp-practice', 2021),
    designLifeYears: sourced(40, 'years', 'engineering-standard', Y),
    decommissionCostPerKw: sourced(5, 'EUR/kWth', 'engineering-standard', Y),
    decommissionYears: sourced(1, 'years', 'engineering-standard', Y),
    remediationYears: sourced(0, 'years', 'engineering-standard', Y),
    recyclingRecoveryPerKw: sourced(3, 'EUR/kWth', 'engineering-standard', Y),
    annualEfficiencyDecay: sourced(0.0005, 'fraction', 'engineering-standard', Y),
    forcedOutageRate: sourced(0.01, 'fraction', 'engineering-standard', Y),
    weatherDependence: 'none',
    cooling: 'none',
    availableFromYear: sourced(1970, 'count', 'engineering-standard', 2023),
    refurbishCostFraction: sourced(0.25, 'fraction', 'engineering-standard', 2023),
    refurbishLifeExtension: sourced(0.6, 'fraction', 'engineering-standard', 2023),
    refurbishMonths: sourced(4, 'months', 'engineering-standard', 2023),
    refurbishEfficiencyGain: sourced(0.0, 'fraction', 'engineering-standard', 2023),
    refurbishCapacityGain: sourced(0.0, 'fraction', 'engineering-standard', 2023),
    chp: null,
    storage: null,
    heatOnly: {
      kind: 'accumulator',
      thermalEfficiency: sourced(0.97, 'fraction', 'euro-chp-practice', 2021, 'Charge and discharge losses are small'),
      storageMwhth: sourced(1400, 'MWh_th', 'euro-chp-practice', 2021, 'Around twelve hours at rated output'),
      standingLossPerHour: sourced(0.002, 'fraction', 'euro-chp-practice', 2021, 'Tank cools slowly; a day of storage is realistic'),
    },
  },
}

export const PLANT_TYPE_IDS = Object.keys(PLANT_TYPES) as PlantTypeId[]

/**
 * Which band of the generation mix a technology belongs in.
 *
 * The category for everything except a thermal plant, where it is the *fuel*. Lumping lignite,
 * hard coal and gas together under "thermal" was the chart's largest omission: those three are the
 * whole of the decision the opening scenario is about, they have wildly different carbon and
 * marginal cost, and the player was watching one brown band that could not tell them whether the
 * lignite had come off or not. Nuclear stays its own band rather than becoming "uranium", because
 * that is how everyone reads a dispatch stack.
 */
export function mixBand(typeId: PlantTypeId): string {
  const type = PLANT_TYPES[typeId]
  return type.category === 'thermal' ? type.fuel : type.category
}

/** Bands the mix chart stacks, bottom to top: baseload low, weather-driven above it. */
export const MIX_BANDS = ['nuclear', 'lignite', 'coal', 'biomass', 'gas', 'hydro', 'wind', 'solar', 'storage']
