/**
 * Weather.
 *
 * The whole struct is generated and stored from the first version, including variables no
 * milestone consumes yet, so that later systems are pure additions and an old save replays
 * identically.
 *
 * The interesting property of this model is not any single variable but the correlations
 * between them. A hot, still, dry summer week simultaneously raises demand for cooling,
 * removes the wind, lowers the rivers, and derates every water-cooled thermal plant on the
 * system. That is a single meteorological cause producing four separate operational
 * problems, and it is the sort of thing that makes a grid genuinely hard to run.
 */

import { TICKS_PER_YEAR, yearFraction } from '../core/time'
import { smoothNoise, type RandomSource } from '../core/rng'

export interface Weather {
  /** Ambient air temperature. */
  tempC: number
  /** Wind speed at hub height. */
  windMs: number
  /** Cloud cover, 0 = clear. */
  cloudFrac: number
  /** Clear-sky-adjusted solar irradiance as a fraction of peak. */
  irradiance: number
  /** Rainfall in this hour. */
  precipMm: number
  /** Accumulated snow, released during the spring melt. */
  snowpackMm: number
  /** River flow relative to the annual average. Drives hydro and cooling water. */
  riverFlowIndex: number
  /** Icing risk on lines, 0..1. */
  icing: number
  /** Storm intensity, 0..1. */
  stormIndex: number
}

export interface ClimateDef {
  /** Mean annual temperature. */
  meanTempC: number
  /** Half the difference between summer and winter means. */
  seasonalTempAmplitude: number
  /** Half the difference between afternoon and pre-dawn. */
  dailyTempAmplitude: number
  /** Mean wind speed. */
  meanWindMs: number
  /** Latitude effect on day length, 0..1 where higher means more seasonal contrast. */
  seasonality: number
  /** Mean annual rainfall in mm, spread over the year. */
  annualPrecipMm: number
}

export const TEMPERATE_CLIMATE: ClimateDef = {
  meanTempC: 9,
  seasonalTempAmplitude: 11,
  dailyTempAmplitude: 4.5,
  meanWindMs: 6.5,
  seasonality: 0.8,
  annualPrecipMm: 650,
}

/**
 * Generates the weather for a tick. Stateless apart from the snowpack, which genuinely has
 * to accumulate; it is carried in `prevSnowpack` rather than hidden in the generator so the
 * whole thing stays a pure function of the world state.
 */
export class WeatherModel {
  private readonly tempStream
  private readonly windStream
  private readonly cloudStream
  private readonly precipStream
  private readonly stormStream

  constructor(
    rng: RandomSource,
    private readonly climate: ClimateDef = TEMPERATE_CLIMATE,
  ) {
    this.tempStream = rng.streamFor('weather:temp')
    this.windStream = rng.streamFor('weather:wind')
    this.cloudStream = rng.streamFor('weather:cloud')
    this.precipStream = rng.streamFor('weather:precip')
    this.stormStream = rng.streamFor('weather:storm')
  }

  generate(tick: number, prevSnowpackMm: number): Weather {
    const yf = yearFraction(tick)
    const hour = ((tick % 24) + 24) % 24

    // Seasonal cycle, coldest in early January.
    const seasonal = -Math.cos(2 * Math.PI * yf) * this.climate.seasonalTempAmplitude
    // Daily cycle, warmest mid-afternoon.
    const daily = -Math.cos((2 * Math.PI * (hour - 3)) / 24) * this.climate.dailyTempAmplitude
    // Weather systems drifting through on a multi-day timescale, plus hourly jitter.
    const synoptic = (smoothNoise(this.tempStream, tick, 72) - 0.5) * 16
    const jitter = (smoothNoise(this.tempStream, tick, 6, 7) - 0.5) * 2
    const tempC = this.climate.meanTempC + seasonal + daily + synoptic + jitter

    // Wind is windier in winter and strongly autocorrelated over days. A lull that lasts a
    // week in January is the classic stress case for a wind-heavy system.
    const windSeasonal = 1 + 0.25 * -Math.cos(2 * Math.PI * yf)
    const windNoise = smoothNoise(this.windStream, tick, 48)
    const windGust = smoothNoise(this.windStream, tick, 8, 3)
    const windMs = Math.max(0, this.climate.meanWindMs * windSeasonal * (0.25 + 1.6 * windNoise) + windGust * 2)

    const cloudFrac = Math.min(1, Math.max(0, smoothNoise(this.cloudStream, tick, 30) * 1.3 - 0.1))

    // Solar geometry: day length and peak elevation both vary with the season.
    const dayLength = 12 + this.climate.seasonality * 4.5 * -Math.cos(2 * Math.PI * yf)
    const sunrise = 12 - dayLength / 2
    const sunset = 12 + dayLength / 2
    let clearSky = 0
    if (hour >= sunrise && hour <= sunset) {
      clearSky = Math.sin((Math.PI * (hour - sunrise)) / Math.max(0.1, dayLength))
      const seasonalElevation = 0.55 + 0.45 * -Math.cos(2 * Math.PI * yf)
      clearSky *= seasonalElevation
    }
    const irradiance = Math.max(0, clearSky * (1 - 0.75 * cloudFrac))

    // Rain follows cloud, with most of it falling in a few wet hours.
    const wetness = smoothNoise(this.precipStream, tick, 18)
    const hourlyMean = this.climate.annualPrecipMm / TICKS_PER_YEAR
    const precipMm = cloudFrac > 0.55 && wetness > 0.6 ? hourlyMean * 24 * (wetness - 0.6) * 2.5 : 0

    // Below freezing, precipitation accumulates instead of running off; it melts back later.
    let snowpackMm = prevSnowpackMm
    let melt = 0
    if (tempC <= 0) {
      snowpackMm += precipMm
    } else {
      melt = Math.min(snowpackMm, tempC * 0.35)
      snowpackMm -= melt
    }

    // River flow responds to rain and melt over weeks, so a dry spring shows up in summer.
    const baseFlow = smoothNoise(this.precipStream, tick, 24 * 21, 11)
    const seasonalFlow = 1 + 0.35 * Math.sin(2 * Math.PI * (yf - 0.15))
    const riverFlowIndex = Math.max(
      0.15,
      (0.55 + 0.9 * baseFlow) * seasonalFlow + melt * 0.02 + precipMm * 0.01,
    )

    const storm = smoothNoise(this.stormStream, tick, 36)
    const stormIndex = windMs > 18 ? Math.min(1, (windMs - 18) / 12) * (0.5 + 0.5 * storm) : 0
    const icing = tempC < 1 && tempC > -8 && precipMm > 0.2 ? Math.min(1, precipMm / 3) : 0

    return {
      tempC,
      windMs,
      cloudFrac,
      irradiance,
      precipMm,
      snowpackMm,
      riverFlowIndex,
      icing,
      stormIndex,
    }
  }
}
