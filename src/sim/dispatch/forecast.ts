/**
 * Looking ahead.
 *
 * Weather here is a pure function of the tick, so the simulation can genuinely see the
 * future rather than guessing at it. That is a slightly unusual luxury and it is worth being
 * explicit about how it is used: the forecast is deliberately *imperfect*. A real operator
 * has a day-ahead forecast with real error in it, and storage that plays a perfect crystal
 * ball would be both unrealistic and unbeatable.
 *
 * So the forecast estimates residual load — demand minus whatever the weather-driven
 * generation will supply — and ranks the coming hours by how tight the system will be. It
 * does not run the dispatch solver ahead, which would be exact and far too expensive.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { hydroPowerFraction, solarPowerFraction, temperatureDemandFactor, windPowerFraction } from '../weather/effects'
import type { WeatherModel } from '../weather/weather'
import { isDispatchable, type CityAsset, type PlantAsset } from '../assets/types'
import { Param } from '../params/types'
import type { Params } from '../params/Params'

/** Typical hourly shape of electricity demand, normalised so the mean is 1. */
const DAILY_PROFILE = [
  0.72, 0.68, 0.66, 0.65, 0.67, 0.74, 0.87, 1.0, 1.08, 1.09, 1.08, 1.07, 1.06, 1.05, 1.04, 1.06,
  1.12, 1.22, 1.28, 1.24, 1.14, 1.02, 0.9, 0.79,
]

export interface ForecastHour {
  tick: number
  /** Expected demand from cities. */
  demandMw: number
  /** Expected output from weather-driven plant, which the system gets whether it wants it or not. */
  mustRunRenewableMw: number
  /**
   * Demand left for dispatchable plant to cover. This is what actually decides how expensive
   * an hour will be, and it is the number storage should be planning against.
   */
  residualLoadMw: number
}

export interface ForecastInput {
  weatherModel: WeatherModel
  plants: PlantAsset[]
  cities: CityAsset[]
  params: Params
  /** Tick to forecast from, exclusive. */
  fromTick: number
  /** Snowpack at `fromTick`, since it is the one part of the weather that accumulates. */
  snowpackMm: number
  hours: number
  /** Wind exposure of a plant's site, 0.65..1.35. */
  siteWindFactor: (plant: PlantAsset) => number
}

/**
 * Project residual load over the next `hours`.
 *
 * Costs O(hours × plants), so at 36 hours and a few hundred plants it is a few thousand
 * operations — cheap enough to redo every tick, and far cheaper than any scheme that tried
 * to keep an incremental forecast up to date.
 */
export function forecastResidualLoad(input: ForecastInput): ForecastHour[] {
  const { weatherModel, plants, cities, params, fromTick, hours, siteWindFactor } = input

  let baseDemand = 0
  for (const city of cities) baseDemand += params.base(city.id, Param.DemandMw)

  const weatherPlants = plants.filter(
    (p) => isDispatchable(p) && PLANT_TYPES[p.typeId].weatherDependence !== 'none',
  )

  const out: ForecastHour[] = []
  let snowpack = input.snowpackMm

  for (let i = 1; i <= hours; i++) {
    const tick = fromTick + i
    const weather = weatherModel.generate(tick, snowpack)
    snowpack = weather.snowpackMm

    const hour = ((tick % 24) + 24) % 24
    const profile = DAILY_PROFILE[hour] ?? 1
    const demandMw = baseDemand * profile * (1 + temperatureDemandFactor(weather.tempC))

    let mustRunRenewableMw = 0
    for (const plant of weatherPlants) {
      const capacity = params.base(plant.id, Param.CapacityMw)
      switch (PLANT_TYPES[plant.typeId].weatherDependence) {
        case 'wind':
          mustRunRenewableMw += capacity * windPowerFraction(weather.windMs * siteWindFactor(plant))
          break
        case 'solar':
          mustRunRenewableMw += capacity * solarPowerFraction(weather.irradiance, weather.tempC)
          break
        case 'riverflow':
          mustRunRenewableMw += capacity * hydroPowerFraction(weather.riverFlowIndex)
          break
        case 'none':
          break
      }
    }

    out.push({
      tick,
      demandMw,
      mustRunRenewableMw,
      residualLoadMw: Math.max(0, demandMw - mustRunRenewableMw),
    })
  }

  return out
}

/**
 * Where each forecast hour sits in the coming period, from 0 (the slackest hour, when power
 * will be cheapest) to 1 (the tightest). Storage plans against this rather than against a
 * price, because a price forecast would need the whole dispatch solved ahead.
 */
export function rankHours(forecast: ForecastHour[]): Map<number, number> {
  const ranks = new Map<number, number>()
  if (forecast.length === 0) return ranks

  const sorted = [...forecast].sort((a, b) => a.residualLoadMw - b.residualLoadMw)
  const last = Math.max(1, sorted.length - 1)
  sorted.forEach((h, i) => ranks.set(h.tick, i / last))
  return ranks
}

/** The tightest hour in the forecast, and how tight. Used to hold storage back for a peak. */
export function peakOf(forecast: ForecastHour[]): { tick: number; residualLoadMw: number } | null {
  if (forecast.length === 0) return null
  let best = forecast[0]!
  for (const h of forecast) if (h.residualLoadMw > best.residualLoadMw) best = h
  return { tick: best.tick, residualLoadMw: best.residualLoadMw }
}
