/**
 * Cities that change size and habits.
 *
 * Two halves that are deliberately kept apart. Population is **state**: it accumulates, it
 * depends on the path the run took, and it is saved on the city. Consumption per head is a
 * **modifier**: it is a property of the year rather than of the town's history, so it is
 * recomputed from the calendar and registered in the parameter chain where the player can see
 * it broken down.
 *
 * That split is the same one the rest of the game makes — learning curves fold into a base value
 * monthly, weather registers as a modifier hourly — and it is what keeps `explain()` on a city's
 * demand honest. Opening the inspector on a town in 2035 should say, in order: the base the
 * scenario gave it, how many more people live there now, what efficiency took off them, what
 * electrification added back, and only then today's temperature. Every one of those is a
 * different argument the player might act on.
 */

import { CITY_TRENDS } from '@content/cityTrends'
import type { CityAsset } from '../assets/types'
import { Layer, Op, Param, type Modifier } from '../params/types'
import type { RandomStream } from '../core/rng'
import { TICKS_PER_YEAR } from '../core/time'

export const GROWTH_SOURCE = 'city-growth'

/**
 * Consumption per head relative to the scenario's first year.
 *
 * Efficiency compounds — it is a rate, applied to whatever is left each year — while
 * electrification is a logistic that saturates. Both are returned as one factor because they
 * genuinely multiply: an electrified household still buys efficient appliances.
 */
export function intensityFactor(year: number, startYear: number): number {
  const years = year - startYear
  const efficiency = Math.pow(1 + CITY_TRENDS.applianceEfficiencyPerYear.value, Math.max(0, years))
  return efficiency * (1 + electrificationUplift(year))
}

/**
 * How much of the eventual electrification uplift has landed by a given year.
 *
 * A logistic rather than a ramp, because the thing being modelled is a stock of vehicles and
 * heating systems being replaced at the end of their lives. The fleet turns over slowly at first
 * whatever the policy, then all at once, then runs out of things left to convert — and a planner
 * who fits a straight line to the first decade of it will be wrong by a factor of several.
 */
export function electrificationUplift(year: number): number {
  const e = CITY_TRENDS.electrification
  const k = Math.log(9) / Math.max(1, e.steepnessYears.value)
  return e.ultimateUplift.value / (1 + Math.exp(-k * (year - e.midpointYear.value)))
}

/**
 * The demand modifiers for every city: how many more people, and what each of them uses.
 *
 * Registered under one source id, so a re-register replaces the lot — the same pattern as
 * weather and government, and for the same reason.
 */
export function growthModifiers(
  cities: CityAsset[],
  year: number,
  startYear: number,
): Array<{ targetId: string; mod: Modifier }> {
  const out: Array<{ targetId: string; mod: Modifier }> = []
  const intensity = intensityFactor(year, startYear)

  for (const city of cities) {
    const people = city.startingPopulation > 0 ? city.population / city.startingPopulation : 1
    // Two `MulFactor` entries rather than two fractions, because these are ratios over decades
    // and adding them would be wrong in the direction that flatters: +40% people and −20% per
    // head is ×1.12, not ×1.20. The same trap the cost trends hit, and the same fix.
    if (Math.abs(people - 1) > 1e-9) {
      out.push({
        targetId: city.id,
        mod: {
          layer: Layer.Growth,
          param: Param.DemandMw,
          op: Op.MulFactor,
          value: people,
          sourceKind: 'growth',
          sourceId: GROWTH_SOURCE,
          reasonKey: 'reason.population',
          reasonParams: { people: Math.round(city.population) },
        },
      })
    }
    if (Math.abs(intensity - 1) > 1e-9) {
      out.push({
        targetId: city.id,
        mod: {
          layer: Layer.Growth,
          param: Param.DemandMw,
          op: Op.MulFactor,
          value: intensity,
          sourceKind: 'growth',
          sourceId: GROWTH_SOURCE,
          reasonKey: 'reason.perHead',
          reasonParams: { pct: Math.round((intensity - 1) * 100) },
        },
      })
    }
    // Heat follows the people but not the appliances: a town with more flats needs more heat,
    // and nothing in the electrification story adds district heat load — a heat pump is a
    // household leaving the network, not joining it. Modelling that departure properly belongs
    // with the heat network's own milestone; ignoring it here is better than guessing at it.
    if (Math.abs(people - 1) > 1e-9 && city.baseHeatDemandMwth > 0) {
      out.push({
        targetId: city.id,
        mod: {
          layer: Layer.Growth,
          param: Param.HeatDemandMw,
          op: Op.MulFactor,
          value: people,
          sourceKind: 'growth',
          sourceId: GROWTH_SOURCE,
          reasonKey: 'reason.population',
          reasonParams: { people: Math.round(city.population) },
        },
      })
    }
  }
  return out
}

/**
 * Move the population on by one month.
 *
 * Growth is annual in the sources and monthly here, so the rate is taken to the power of a
 * twelfth rather than divided by twelve. Over forty years the difference is small; using the
 * wrong one anyway would be the sort of quiet error this codebase has been bitten by before.
 *
 * The reliability term is the one that matters for play. `unservedTicksRecent` is the town's own
 * memory of being in the dark, and a town that has spent a month of hours unserved stops
 * growing. Nothing here punishes the player twice — the money and the objectives are settled
 * elsewhere — but it does mean a neglected region quietly stops being worth serving, which is
 * both true and a genuinely nasty position to find yourself in.
 */
export function stepCityGrowth(cities: CityAsset[], tick: number, stream: RandomStream): void {
  const monthly = Math.pow(1 + CITY_TRENDS.populationGrowthPerYear.value, 1 / 12) - 1
  const spread = CITY_TRENDS.growthSpreadPerYear.value / 12

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i]!
    // Hours unserved in the last month, as a share of the month. Capped at one, because a town
    // that was dark for every hour of the month has made its point.
    const darkShare = Math.min(1, city.unservedTicksRecent / (TICKS_PER_YEAR / 12))
    const penalty = darkShare * CITY_TRENDS.reliabilityGrowthPenalty.value * monthly
    // Keyed by the town's index rather than its name, because the stream takes a number — and
    // by index rather than by nothing, so two towns in the same month draw different luck.
    const luck = (stream.float(tick, i) * 2 - 1) * spread
    city.population = Math.max(1, city.population * (1 + monthly - penalty + luck))
    city.unservedTicksRecent = 0
  }
}
