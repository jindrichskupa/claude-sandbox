/**
 * Storage.
 *
 * Storage is awkward in a single-period dispatch, and it is worth being explicit about why.
 * Minimum-cost flow answers one hour at a time, but a battery's decision is inherently about
 * *other* hours: charging now is only sensible because of what tonight will cost. A correct
 * treatment is a multi-period optimisation over the whole day, which would be a different
 * and much heavier solver.
 *
 * So the decision is taken outside the flow problem and handed to it as a constraint. Each
 * tick, a policy looks at where the recent price sits in its own distribution and decides
 * whether this unit should be filling, emptying, or waiting. The flow solver then sees an
 * ordinary generator or an ordinary load.
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

/** Below this percentile of recent prices, filling up is worthwhile. */
const CHARGE_PERCENTILE = 0.3
/** Above this percentile, emptying is worthwhile. */
const DISCHARGE_PERCENTILE = 0.7
/** How much cheaper the charge must be than the expected discharge to bother. */
const MIN_SPREAD_RATIO = 1.25

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

export function energyCapacityMwh(plant: PlantAsset): number {
  const spec = PLANT_TYPES[plant.typeId].storage
  return spec ? spec.energyMwh.value : 0
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
  /** Recent hourly prices, most recent last. */
  priceHistory: number[]
  /** True if the system failed to serve demand in the previous tick. */
  recentShortage: boolean
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
  const { plants, params, priceHistory, recentShortage } = input
  const plans = new Map<string, StoragePlan>()

  const sorted = [...priceHistory].sort((a, b) => a - b)
  const cheap = percentile(sorted, CHARGE_PERCENTILE)
  const dear = percentile(sorted, DISCHARGE_PERCENTILE)
  const latest = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]! : 0

  for (const plant of plants) {
    if (!isStorage(plant) || plant.phase !== LifecyclePhase.Operating || !plant.online) continue

    const power = params.get(plant.id, Param.CapacityMw) * params.get(plant.id, Param.Availability)
    const varOpex = params.get(plant.id, Param.VarOpexPerMwh)
    const eta = onewayEfficiency(plant)
    const capacityMwh = energyCapacityMwh(plant)
    const stored = Math.max(0, Math.min(capacityMwh, plant.storageMwh))

    // What one stored MWh cost to put in, and therefore the least it may be sold for.
    const breakEven = cheap / Math.max(0.01, eta * eta) + varOpex * 2

    const headroomMwh = capacityMwh - stored
    const canCharge = headroomMwh > 0.01 && power > 0
    const canDischarge = stored > 0.01 && power > 0

    let mode: StorageMode = 'idle'
    if (
      canDischarge &&
      latest >= dear &&
      dear > breakEven &&
      // Never sit idle through a shortage: unserved energy is worth far more than arbitrage.
      (recentShortage || dear >= cheap * MIN_SPREAD_RATIO)
    ) {
      mode = 'discharging'
    } else if (canCharge && latest <= cheap && !recentShortage && dear >= cheap * MIN_SPREAD_RATIO) {
      mode = 'charging'
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
    // Charging is committed, so the full planned amount is drawn whether or not it was cheap.
    plant.storageMwh = Math.min(capacityMwh, plant.storageMwh + plan.chargeMw * eta)
    plant.outputMw = -plan.chargeMw
  } else if (plan.mode === 'discharging' && deliveredMw > 0) {
    plant.storageMwh = Math.max(0, plant.storageMwh - deliveredMw / eta)
    plant.outputMw = deliveredMw
  } else {
    plant.outputMw = 0
  }
}
