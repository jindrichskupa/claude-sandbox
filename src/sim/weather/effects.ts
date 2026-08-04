/**
 * Turning weather into parameter modifiers.
 *
 * Everything here follows the rule from the design notes: non-linear curves are *not*
 * expressed as modifiers. The wind power curve is a curve, so it consumes wind speed and
 * emits a single resulting availability figure. What travels through the modifier chain is
 * always the outcome, tagged with the reason, so the player can be shown why.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { Layer, Op, Param, type Modifier } from '../params/types'
import type { PlantAsset, CityAsset } from '../assets/types'
import { isDispatchable } from '../assets/types'
import type { Weather } from './weather'

export const WEATHER_SOURCE = 'weather'

/** Typical hourly shape of electricity demand, normalised so the mean is 1. */
const DAILY_PROFILE = [
  0.72, 0.68, 0.66, 0.65, 0.67, 0.74, 0.87, 1.0, 1.08, 1.09, 1.08, 1.07, 1.06, 1.05, 1.04, 1.06,
  1.12, 1.22, 1.28, 1.24, 1.14, 1.02, 0.9, 0.79,
]

/** Wind turbine power curve. Cut-in, rated and cut-out speeds for a typical onshore machine. */
const CUT_IN_MS = 3
const RATED_MS = 12
const CUT_OUT_MS = 25

export function windPowerFraction(windMs: number): number {
  if (windMs < CUT_IN_MS || windMs >= CUT_OUT_MS) return 0
  if (windMs >= RATED_MS) return 1
  // Power in the wind goes with the cube of speed, which is why a modest lull is so costly.
  const num = windMs ** 3 - CUT_IN_MS ** 3
  const den = RATED_MS ** 3 - CUT_IN_MS ** 3
  return Math.max(0, Math.min(1, num / den))
}

/**
 * Photovoltaic output. Panels lose roughly 0.4% of their output per degree of cell
 * temperature above 25 C, and cells run far hotter than the air around them — so the
 * sunniest hours of a heatwave are not the most productive ones.
 */
export function solarPowerFraction(irradiance: number, ambientC: number): number {
  if (irradiance <= 0) return 0
  const cellTempC = ambientC + 25 * irradiance
  const derate = 1 - 0.004 * Math.max(0, cellTempC - 25)
  return Math.max(0, Math.min(1, irradiance * derate))
}

/**
 * Thermal plant derating.
 *
 * Water-cooled steam plants reject heat to a river; when the river is warm and low they
 * cannot reject as much, and output falls. Air-cooled gas turbines lose output to hot air
 * directly, and rather faster. Both effects peak exactly when a heatwave has pushed demand
 * to its annual maximum.
 */
export function thermalDerate(cooling: 'none' | 'water' | 'air', tempC: number, riverFlowIndex: number): number {
  if (cooling === 'none') return 0
  if (cooling === 'air') {
    return -0.006 * Math.max(0, tempC - 15)
  }
  const heatPenalty = -0.005 * Math.max(0, tempC - 24)
  const droughtPenalty = riverFlowIndex < 0.75 ? -0.45 * (0.75 - riverFlowIndex) : 0
  return heatPenalty + droughtPenalty
}

/**
 * Run-of-river turbines are sized well above the mean flow so they can use the high-flow
 * season, which is why a plant rated at 80 MW spends much of the year well below it. This
 * ratio is what turns a flow index into an output fraction.
 */
export const HYDRO_DESIGN_FLOW_RATIO = 2.0

export function hydroPowerFraction(riverFlowIndex: number): number {
  return Math.max(0, Math.min(1, riverFlowIndex / HYDRO_DESIGN_FLOW_RATIO))
}

/**
 * Demand response to temperature, the U-shaped curve every system operator knows: heating
 * load below about 15 C, cooling load above about 22 C, and a comfortable trough between.
 */
export function temperatureDemandFactor(tempC: number): number {
  const heating = tempC < 15 ? 0.022 * (15 - tempC) : 0
  const cooling = tempC > 22 ? 0.028 * (tempC - 22) : 0
  return heating + cooling
}

/** District heating demand, which is almost purely a function of how cold it is. */
export function heatDemandFactor(tempC: number): number {
  if (tempC >= 17) return 0.08 // Hot water only.
  return Math.min(1.6, 0.08 + 0.055 * (17 - tempC))
}

export interface WeatherEntries {
  targetId: string
  mod: Modifier
}

/**
 * Build the whole weather contribution for this tick.
 *
 * `siteWindFactor` scales the regional wind speed to what a particular site actually sees.
 * Terrain belongs to the world, so it is passed in rather than reached for from here.
 */
export function weatherModifiers(
  weather: Weather,
  plants: PlantAsset[],
  cities: CityAsset[],
  hour: number,
  siteWindFactor: (plant: PlantAsset) => number = () => 1,
): WeatherEntries[] {
  const out: WeatherEntries[] = []
  const tempRounded = Math.round(weather.tempC * 10) / 10

  for (const plant of plants) {
    if (!isDispatchable(plant)) continue
    const type = PLANT_TYPES[plant.typeId]

    switch (type.weatherDependence) {
      case 'wind': {
        const siteWind = weather.windMs * siteWindFactor(plant)
        const f = windPowerFraction(siteWind)
        out.push({
          targetId: plant.id,
          mod: {
            layer: Layer.Weather,
            param: Param.Availability,
            op: Op.MulFactor,
            value: f,
            sourceKind: 'weather',
            sourceId: WEATHER_SOURCE,
            reasonKey: 'reason.windSpeed',
            reasonParams: { wind: Math.round(siteWind * 10) / 10 },
          },
        })
        break
      }
      case 'solar': {
        const f = solarPowerFraction(weather.irradiance, weather.tempC)
        out.push({
          targetId: plant.id,
          mod: {
            layer: Layer.Weather,
            param: Param.Availability,
            op: Op.MulFactor,
            value: f,
            sourceKind: 'weather',
            sourceId: WEATHER_SOURCE,
            reasonKey: 'reason.irradiance',
            reasonParams: { irradiance: Math.round(weather.irradiance * 100) },
          },
        })
        break
      }
      case 'riverflow': {
        const f = hydroPowerFraction(weather.riverFlowIndex)
        out.push({
          targetId: plant.id,
          mod: {
            layer: Layer.Weather,
            param: Param.Availability,
            op: Op.MulFactor,
            value: f,
            sourceKind: 'weather',
            sourceId: WEATHER_SOURCE,
            reasonKey: 'reason.riverFlow',
            reasonParams: { flow: Math.round(weather.riverFlowIndex * 100) },
          },
        })
        break
      }
      case 'none':
        break
    }

    const derate = thermalDerate(type.cooling, weather.tempC, weather.riverFlowIndex)
    if (derate < 0) {
      out.push({
        targetId: plant.id,
        mod: {
          layer: Layer.Weather,
          param: Param.Availability,
          op: Op.AddFrac,
          value: derate,
          sourceKind: 'weather',
          sourceId: WEATHER_SOURCE,
          reasonKey: type.cooling === 'air' ? 'reason.hotAir' : 'reason.coolingWater',
          reasonParams: { temp: tempRounded },
        },
      })
    }
  }

  const profile = DAILY_PROFILE[hour] ?? 1
  for (const city of cities) {
    out.push({
      targetId: city.id,
      mod: {
        layer: Layer.Weather,
        param: Param.DemandMw,
        op: Op.MulFactor,
        value: profile,
        sourceKind: 'weather',
        sourceId: WEATHER_SOURCE,
        reasonKey: 'reason.timeOfDay',
        reasonParams: { hour },
      },
    })
    const tempFactor = temperatureDemandFactor(weather.tempC)
    if (tempFactor > 0) {
      out.push({
        targetId: city.id,
        mod: {
          layer: Layer.Weather,
          param: Param.DemandMw,
          op: Op.AddFrac,
          value: tempFactor,
          sourceKind: 'weather',
          sourceId: WEATHER_SOURCE,
          reasonKey: weather.tempC < 15 ? 'reason.heatingLoad' : 'reason.coolingLoad',
          reasonParams: { temp: tempRounded },
        },
      })
    }
    out.push({
      targetId: city.id,
      mod: {
        layer: Layer.Weather,
        param: Param.HeatDemandMw,
        op: Op.MulFactor,
        value: heatDemandFactor(weather.tempC),
        sourceKind: 'weather',
        sourceId: WEATHER_SOURCE,
        reasonKey: 'reason.heatingLoad',
        reasonParams: { temp: tempRounded },
      },
    })
  }

  return out
}
