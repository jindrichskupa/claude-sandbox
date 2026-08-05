/**
 * One line per year, for the whole run.
 *
 * Every chart in the game shows the last ten days. That is the right window for operating a
 * system — the load curve, the clearing price, the mix this afternoon — and it is the wrong
 * window for every decision the player actually makes, all of which are about decades. A player
 * thirty years into a run has no way to see the shape of what they did: whether emissions fell or
 * merely stopped rising, whether the fleet got cleaner or just smaller, whether the tariff drifted
 * up while they were not looking, or which decade the reliability went wrong in.
 *
 * That gap matters most for the thing the game is supposed to be for. A deliberately-played
 * strategy — all nuclear, all renewables, refurbish everything, replace nothing — is an argument
 * about forty years, and an argument about forty years cannot be read off a ten-day chart. Without
 * this the player finishes a run knowing whether they won and almost nothing about why.
 *
 * ## Cheap, because the numbers already exist
 *
 * Everything here is taken from the ledgers and the fleet at the moment the year closes, which is
 * a few dozen additions once a game year. No accumulator runs in the tick loop, and nothing here
 * is a second source of truth: if a figure disagrees with the monthly accounts, the accounts are
 * right and this is a bug.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { isDispatchable, type PlantAsset } from '../assets/types'
import type { PeriodLedger } from './economy'

/** What one year looked like, in the terms a thirty-year decision is judged on. */
export interface YearRecord {
  year: number
  /** Electrical energy delivered, MWh. */
  energySoldMwh: number
  energyUnservedMwh: number
  heatSoldMwh: number
  co2Tonnes: number
  /** Tonnes per MWh delivered. The single number a decarbonisation brief is about. */
  carbonIntensity: number
  /** Share of demand that went unserved. */
  unservedShare: number
  /** Generation by category over the year, MWh. The mix, as a strategy would describe it. */
  mixMwh: Record<string, number>
  /** Dispatchable capacity in service at the year end, MW. */
  firmCapacityMw: number
  totalCapacityMw: number
  /** Photovoltaics on other people's roofs, MW. Not the player's and not dispatchable. */
  rooftopMw: number
  /** The regulated price, which is both revenue and the reason households leave. */
  tariffPerMwh: number
  profit: number
  cash: number
  debt: number
  /** Who was in office when the year closed. */
  regimeId: string
}

/**
 * Take the year's reading.
 *
 * Called once, from `closeYear`, before the annual ledger is reset — which is why it takes the
 * ledger rather than reading it back later.
 */
export function recordYear(input: {
  year: number
  ledger: PeriodLedger
  yearMix: Record<string, number>
  plants: PlantAsset[]
  capacityOf: (plant: PlantAsset) => number
  rooftopMw: number
  tariffPerMwh: number
  profit: number
  cash: number
  debt: number
  regimeId: string
}): YearRecord {
  const demand = input.ledger.energySoldMwh + input.ledger.energyUnservedMwh

  let firmCapacityMw = 0
  let totalCapacityMw = 0
  for (const plant of input.plants) {
    if (!isDispatchable(plant)) continue
    const mw = input.capacityOf(plant)
    totalCapacityMw += mw
    // Firm means "there when you ask for it". Weather-dependent capacity is real capacity and is
    // not that, and a capacity figure that mixed them would flatter exactly the strategy that
    // most needs watching.
    if (PLANT_TYPES[plant.typeId].weatherDependence === 'none') firmCapacityMw += mw
  }

  return {
    year: input.year,
    energySoldMwh: input.ledger.energySoldMwh,
    energyUnservedMwh: input.ledger.energyUnservedMwh,
    heatSoldMwh: input.ledger.heatSoldMwh,
    co2Tonnes: input.ledger.co2Tonnes,
    carbonIntensity: input.ledger.energySoldMwh > 0 ? input.ledger.co2Tonnes / input.ledger.energySoldMwh : 0,
    unservedShare: demand > 0 ? input.ledger.energyUnservedMwh / demand : 0,
    mixMwh: { ...input.yearMix },
    firmCapacityMw,
    totalCapacityMw,
    rooftopMw: input.rooftopMw,
    tariffPerMwh: input.tariffPerMwh,
    profit: input.profit,
    cash: input.cash,
    debt: input.debt,
    regimeId: input.regimeId,
  }
}

/**
 * The year in which a series turned, if it did.
 *
 * Used by the interface to mark the point a strategy started working or stopped — which is the
 * one annotation that makes a thirty-year chart tell a story rather than just show a shape.
 * Returns null where the series only ever went one way, because a "turning point" on a monotone
 * series is noise dressed as insight.
 */
export function turningPoint(years: YearRecord[], of: (record: YearRecord) => number): number | null {
  if (years.length < 5) return null
  let best: { year: number; swing: number } | null = null
  for (let i = 2; i < years.length - 2; i++) {
    const before = of(years[i - 2]!) - of(years[i]!)
    const after = of(years[i + 2]!) - of(years[i]!)
    // Both neighbours on the same side means this is a local extreme rather than a trend.
    if (Math.sign(before) !== Math.sign(after) || before === 0) continue
    const swing = Math.abs(before) + Math.abs(after)
    if (!best || swing > best.swing) best = { year: years[i]!.year, swing }
  }
  return best?.year ?? null
}
