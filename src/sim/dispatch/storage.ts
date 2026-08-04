/**
 * Storage.
 *
 * Storage is awkward in a single-period dispatch, and it is worth being explicit about why.
 * Minimum-cost flow answers one hour at a time, but a battery's decision is inherently about
 * *other* hours: charging now is only sensible because of what tonight will cost. A correct
 * treatment is a multi-period optimisation over the whole day, which would be a different
 * and much heavier solver.
 *
 * So the decision is taken outside the flow problem and handed to it as a constraint, and it
 * is taken by looking *forward*. An earlier version compared the current price against the
 * recent past, which was measurably bad: a fast battery chasing small spreads emptied itself
 * on merely-expensive evenings and stood empty through the genuinely scarce ones, leaving
 * unserved energy worse than if the battery had not existed. Reacting to yesterday cannot fix
 * that; only anticipating tomorrow can.
 *
 * The policy is also duration-aware, and that is what separates a two-hour battery from a
 * six-hour pumped station. Each unit works out how many hours it needs to fill and how many
 * it can supply for, then claims exactly that many of the slackest and tightest hours in the
 * forecast window. A short store takes the sharpest peak; a long one covers a whole evening.
 *
 * The asymmetry matters and is deliberate: **discharging is offered, charging is committed**.
 * A discharge is an arc the solver may decline if something cheaper turns up, whereas a
 * charge has already been decided and becomes real demand. That mirrors how storage is
 * actually operated against a day-ahead position, and it keeps the solver honest — a unit
 * cannot quietly discharge into its own charging.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { LifecyclePhase, type PlantAsset } from '../assets/types'
import { Param } from '../params/types'
import type { Params } from '../params/Params'
import { rankHours, type ForecastHour } from './forecast'

export type StorageMode = 'idle' | 'charging' | 'discharging'

export interface StoragePlan {
  plantId: string
  mode: StorageMode
  /** MW to charge at, when charging. */
  chargeMw: number
  /** Maximum MW available to discharge, when discharging. */
  dischargeCeilingMw: number
  /** Price the discharge is offered at. */
  offerPricePerMwh: number
}

/** How far ahead the policy plans. Long enough to span a night and the following peak. */
export const FORECAST_WINDOW_HOURS = 36
/** Percentile of recent prices taken as the cost of charging, for the break-even test. */
const CHEAP_PERCENTILE = 0.25
/** Percentile taken as the expected selling price. */
const DEAR_PERCENTILE = 0.8
/** Extra slack hours claimed beyond the strict minimum, so a fill is not left half-finished. */
const CHARGE_HEADROOM = 1.4

export function isStorage(plant: PlantAsset): boolean {
  return PLANT_TYPES[plant.typeId].storage !== null
}

/**
 * One-way efficiency. The round trip is split evenly between filling and emptying, so a
 * megawatt-hour bought is not a megawatt-hour sold, in either direction.
 */
export function onewayEfficiency(plant: PlantAsset): number {
  const spec = PLANT_TYPES[plant.typeId].storage
  return spec ? Math.sqrt(spec.roundTripEfficiency.value) : 1
}

/** Rated energy capacity when new. */
export function ratedEnergyMwh(plant: PlantAsset): number {
  const spec = PLANT_TYPES[plant.typeId].storage
  return spec ? spec.energyMwh.value : 0
}

/**
 * Usable energy capacity now, after cycling has worn it.
 *
 * A battery does not fail on its last cycle; it fades. Capacity declines roughly in
 * proportion to how much of the cycle life has been used, which is why a store worked hard
 * for revenue is a smaller store in ten years than one worked gently.
 */
export function energyCapacityMwh(plant: PlantAsset): number {
  const spec = PLANT_TYPES[plant.typeId].storage
  if (!spec) return 0
  const rated = spec.energyMwh.value
  if (!spec.cycleLife || !spec.capacityFadeOverLife) return rated

  const used = Math.min(1, plant.cyclesUsed / Math.max(1, spec.cycleLife.value))
  return rated * (1 - spec.capacityFadeOverLife.value * used)
}

/** How much of the cycle life has been consumed, 0..1. Null when life is not cycle-limited. */
export function cycleLifeUsed(plant: PlantAsset): number | null {
  const spec = PLANT_TYPES[plant.typeId].storage
  if (!spec?.cycleLife) return null
  return Math.min(1, plant.cyclesUsed / Math.max(1, spec.cycleLife.value))
}

/** True once a cycle-limited store has been worked past its rated life. */
export function isCycleExhausted(plant: PlantAsset): boolean {
  const used = cycleLifeUsed(plant)
  return used !== null && used >= 1
}

/** Percentile of a price sample. The sample is small, so a plain sort is fine. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[i]!
}

export interface StoragePolicyInput {
  plants: PlantAsset[]
  params: Params
  /** Recent hourly prices, most recent last. Used only to judge whether trading pays. */
  priceHistory: number[]
  /** True if the system failed to serve demand in the previous tick. */
  recentShortage: boolean
  /**
   * Residual load for the coming hours, with the *current* hour first. Without it the policy
   * falls back to reacting to recent prices, which works but is measurably worse.
   */
  forecast?: ForecastHour[]
}

/**
 * Decide what every storage unit should do this hour.
 *
 * The rule is deliberately simple and legible, because the player has to be able to predict
 * it: fill when prices are in the bottom third of the recent range, empty when they are in
 * the top third, and do nothing in between unless the spread is not worth the round-trip
 * loss.
 */
export function planStorage(input: StoragePolicyInput): Map<string, StoragePlan> {
  const { plants, params, priceHistory, recentShortage, forecast } = input
  const plans = new Map<string, StoragePlan>()

  const sorted = [...priceHistory].sort((a, b) => a - b)
  const cheap = percentile(sorted, CHEAP_PERCENTILE)
  const dear = percentile(sorted, DEAR_PERCENTILE)
  const latest = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]! : 0

  // Where the current hour sits among the coming ones, 0 = slackest, 1 = tightest.
  const ranks = forecast ? rankHours(forecast) : null
  const currentTick = forecast && forecast.length > 0 ? forecast[0]!.tick : null
  const currentRank = ranks && currentTick !== null ? ranks.get(currentTick) : undefined
  const windowLength = forecast?.length ?? 0

  for (const plant of plants) {
    if (!isStorage(plant) || plant.phase !== LifecyclePhase.Operating || !plant.online) continue

    const power = params.get(plant.id, Param.CapacityMw) * params.get(plant.id, Param.Availability)
    const varOpex = params.get(plant.id, Param.VarOpexPerMwh)
    const eta = onewayEfficiency(plant)
    const capacityMwh = energyCapacityMwh(plant)
    const stored = Math.max(0, Math.min(capacityMwh, plant.storageMwh))

    // What one stored MWh cost to put in, and therefore the least it may be sold for.
    // Charging at a negative price makes this negative too, which is correct: being paid to
    // take power away means almost any later sale is profitable.
    const breakEven = cheap / Math.max(0.01, eta * eta) + varOpex * 2

    const headroomMwh = capacityMwh - stored
    const canCharge = headroomMwh > 0.01 && power > 0
    const canDischarge = stored > 0.01 && power > 0

    // Whether the spread is worth having is decided by the break-even price, not by a ratio
    // between two percentiles. An earlier version used a ratio, and it was quietly fatal:
    // with only a handful of units on the system the price distribution is a step function,
    // so the two percentiles frequently landed on the *same* value and the ratio test blocked
    // every action forever. The break-even test states the same idea physically and does not
    // care how lumpy the distribution is.
    const worthTrading = dear > breakEven

    let mode: StorageMode = 'idle'

    if (canDischarge && recentShortage) {
      // Scarcity beats arbitrage by three orders of magnitude. Never sit on stored energy
      // while the lights are out.
      mode = 'discharging'
    } else if (currentRank !== undefined && windowLength > 1) {
      // How many hours this unit needs to fill, and how many it can supply for. A short
      // store claims a narrow band at each end; a long one claims a wide one.
      const hoursToFill = Math.min(windowLength, Math.max(1, (headroomMwh / eta / Math.max(1, power)) * CHARGE_HEADROOM))
      const hoursToEmpty = Math.min(windowLength, Math.max(1, (stored * eta) / Math.max(1, power)))

      const chargeThreshold = hoursToFill / windowLength
      const dischargeThreshold = 1 - hoursToEmpty / windowLength

      if (canDischarge && currentRank >= dischargeThreshold && latest > breakEven) {
        mode = 'discharging'
      } else if (canCharge && !recentShortage && currentRank <= chargeThreshold && worthTrading) {
        mode = 'charging'
      }
    } else {
      // No forecast: fall back to the reactive rule.
      if (canDischarge && latest >= dear && latest > breakEven) mode = 'discharging'
      else if (canCharge && !recentShortage && latest <= cheap && worthTrading) mode = 'charging'
    }

    // One tick is one hour, so MW and MWh are interchangeable within a tick.
    const chargeMw = mode === 'charging' ? Math.min(power, headroomMwh / eta) : 0
    const dischargeCeilingMw = mode === 'discharging' ? Math.min(power, stored * eta) : 0

    plans.set(plant.id, {
      plantId: plant.id,
      mode,
      chargeMw,
      dischargeCeilingMw,
      offerPricePerMwh: Math.max(breakEven, varOpex),
    })
  }

  return plans
}

/**
 * Move energy in or out after the dispatch has run. `deliveredMw` is what the solver
 * actually took from the unit, which may be less than it offered.
 */
export function settleStorage(plant: PlantAsset, plan: StoragePlan | undefined, deliveredMw: number): void {
  if (!plan) return
  const eta = onewayEfficiency(plant)
  const capacityMwh = energyCapacityMwh(plant)

  if (plan.mode === 'charging') {
    // Only what the grid actually delivered goes in. The plan is an intention, and the
    // solver is entitled to curtail it when the system is short; crediting the intention
    // would put energy into the store that nobody ever generated.
    const actuallyCharged = Math.max(0, -deliveredMw)
    plant.storageMwh = Math.min(capacityMwh, plant.storageMwh + actuallyCharged * eta)
    plant.outputMw = -actuallyCharged
  } else if (plan.mode === 'discharging' && deliveredMw > 0) {
    const drawn = deliveredMw / eta
    plant.storageMwh = Math.max(0, plant.storageMwh - drawn)
    plant.outputMw = deliveredMw
    // Cycle counting is by energy throughput, not by "times emptied": a store cycled to half
    // depth twice has done the same work as one cycled fully once, and wears accordingly.
    const rated = ratedEnergyMwh(plant)
    if (rated > 0) plant.cyclesUsed += drawn / rated
  } else {
    plant.outputMw = 0
  }
}
