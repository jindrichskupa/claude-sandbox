/**
 * Ageing.
 *
 * A power station is not a permanent object. It wears, it loses efficiency, it becomes less
 * available and more expensive to keep running, and eventually keeping it is worse than
 * losing it. Because scenarios start with an inherited fleet, the player meets this problem
 * on the first day rather than thirty years in — which is the point of a brownfield start.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { RELIABILITY } from '@content/reliability'
import { TICKS_PER_YEAR } from '../core/time'
import { cycleLifeUsed } from '../dispatch/storage'
import { Layer, Op, Param, type Modifier } from '../params/types'
import { LifecyclePhase, type PlantAsset } from './types'

export const AGE_SOURCE = 'age'

/** Age of a plant in years at a given tick. */
export function ageYears(plant: PlantAsset, tick: number): number {
  return Math.max(0, (tick - plant.commissionedTick) / TICKS_PER_YEAR)
}

/**
 * How far through its life the plant is, where 1 means it has reached the end of it.
 *
 * For most machines that is simply age. For a battery it is whichever of age and cycling
 * runs out first, and in practice cycling usually does: a store worked hard for arbitrage
 * revenue reaches its cycle limit years before its calendar warranty. Taking the maximum
 * here means every consequence of ageing — falling condition, rising maintenance, more
 * outages — becomes cycle-aware without a single special case downstream.
 */
export function lifeFraction(plant: PlantAsset, tick: number): number {
  // Refurbishment buys extra design life, so the same age is a smaller fraction of it. The
  // design life itself is the machine's own, fixed at its vintage, not the datasheet's.
  const life = plant.designLifeYears * (1 + plant.lifeExtension)
  const calendar = ageYears(plant, tick) / Math.max(1, life)
  const cycles = cycleLifeUsed(plant)
  return cycles === null ? calendar : Math.max(calendar, cycles)
}

/**
 * Condition decays roughly linearly through the design life, then accelerates. Running a
 * plant past its design life is possible and sometimes correct, but the curve makes clear
 * you are now on borrowed time.
 */
export function expectedCondition(plant: PlantAsset, tick: number): number {
  const f = lifeFraction(plant, tick)
  if (f <= 1) return Math.max(0, 1 - 0.35 * f)
  return Math.max(0.1, 0.65 - 0.5 * (f - 1))
}

/**
 * Modifiers describing what age has done to one plant.
 *
 * These sit in the Age layer, which is recomputed monthly rather than hourly — nothing here
 * changes meaningfully within a day.
 */
export function agingModifiers(plants: PlantAsset[], tick: number): Array<{ targetId: string; mod: Modifier }> {
  const out: Array<{ targetId: string; mod: Modifier }> = []

  for (const plant of plants) {
    if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) continue
    const type = PLANT_TYPES[plant.typeId]
    const years = ageYears(plant, tick)
    const yearsRounded = Math.round(years)

    // Efficiency decays with cumulative wear: fouling, blade erosion, panel degradation.
    const effLoss = -Math.min(0.3, type.annualEfficiencyDecay.value * years)
    if (effLoss < 0) {
      out.push({
        targetId: plant.id,
        mod: {
          layer: Layer.Age,
          param: Param.Efficiency,
          op: Op.AddFrac,
          value: effLoss,
          sourceKind: 'age',
          sourceId: AGE_SOURCE,
          reasonKey: 'reason.wearEfficiency',
          reasonParams: { years: yearsRounded },
        },
      })
    }

    // Availability falls as the condition does: more forced outages, longer repairs.
    const availLoss = -Math.min(0.5, (1 - plant.conditionPct) * 0.6)
    if (availLoss < 0) {
      out.push({
        targetId: plant.id,
        mod: {
          layer: Layer.Age,
          param: Param.Availability,
          op: Op.AddFrac,
          value: availLoss,
          sourceKind: 'age',
          sourceId: AGE_SOURCE,
          reasonKey: 'reason.wearAvailability',
          reasonParams: { condition: Math.round(plant.conditionPct * 100) },
        },
      })
    }

    // Maintenance gets more expensive, steeply so past design life.
    const f = lifeFraction(plant, tick)
    const opexRise = f <= 1 ? 0.5 * f : 0.5 + 1.2 * (f - 1)
    if (opexRise > 0.01) {
      out.push({
        targetId: plant.id,
        mod: {
          layer: Layer.Age,
          param: Param.FixedOpexPerKwYear,
          op: Op.AddFrac,
          value: opexRise,
          sourceKind: 'age',
          sourceId: AGE_SOURCE,
          reasonKey: 'reason.maintenanceCost',
          reasonParams: { years: yearsRounded },
        },
      })
    }
  }

  return out
}

/**
 * How much more often this machine fails than a new one of the same type.
 *
 * One through the useful life and rising as a power past it — the wear-out region of a bathtub
 * hazard curve. See `content/reliability.ts` for why that shape and not a cliff.
 */
export function wearFactor(plant: PlantAsset, tick: number): number {
  const overrun = Math.max(0, lifeFraction(plant, tick) - 1)
  return Math.pow(1 + overrun, RELIABILITY.wearOutExponent.value)
}

/**
 * The annual forced-outage rate this machine actually has, right now.
 *
 * One function, two callers: the dice that decide whether it trips, and the forecast panel that
 * warns the player it might. They cannot disagree about the odds, which is the whole reason this
 * is not computed at each site.
 *
 * Condition and age are both in it and are not the same thing. Condition is what neglect and
 * running hours have done to a machine; age is what its design assumptions have run out of.
 * A well-maintained forty-year-old boiler is in good condition and still made of forty-year-old
 * steel.
 */
export function forcedOutageRate(plant: PlantAsset, tick: number, maintenanceLevel: number): number {
  const type = PLANT_TYPES[plant.typeId]
  const wear = 1 + (1 - plant.conditionPct) * 2
  return (type.forcedOutageRate.value * wear * wearFactor(plant, tick)) / Math.max(0.1, maintenanceLevel)
}

/**
 * The chance that a failure, having happened, turns out to be beyond economic repair.
 *
 * Zero for anything that is not nearly worn out, then interpolated from the design life to twice
 * it. This is the number that turns "my fleet is old" from a slow cost into a thing that can
 * happen to the player on a Tuesday — and it is the reason refurbishment, which resets condition
 * and buys design life, is worth its price.
 */
export function terminalFailureShare(plant: PlantAsset, tick: number): number {
  const f = lifeFraction(plant, tick)
  if (f < RELIABILITY.terminalFromLifeFraction.value) return 0
  const atOne = RELIABILITY.terminalShareAtDesignLife.value
  const atTwo = RELIABILITY.terminalShareAtDoubleLife.value
  // Linear between the two anchors, extrapolated no further than twice the gap again: a machine
  // at three times its design life is a museum piece, and a share above one is meaningless.
  return Math.max(0, Math.min(0.6, atOne + (atTwo - atOne) * (f - 1)))
}

/** Advance condition by one tick of running. Called by the world. */
export function advanceCondition(plant: PlantAsset, tick: number, ran: boolean): void {
  if (plant.phase !== LifecyclePhase.Operating) return
  if (ran) plant.cumulativeRunHours += 1
  // Condition drifts toward what its age implies, so an inherited old plant settles onto
  // the curve rather than starting pristine.
  const target = expectedCondition(plant, tick)
  plant.conditionPct += (target - plant.conditionPct) * 0.002
  plant.conditionPct = Math.max(0, Math.min(1, plant.conditionPct))
}
