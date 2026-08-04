/**
 * Ageing.
 *
 * A power station is not a permanent object. It wears, it loses efficiency, it becomes less
 * available and more expensive to keep running, and eventually keeping it is worse than
 * losing it. Because scenarios start with an inherited fleet, the player meets this problem
 * on the first day rather than thirty years in — which is the point of a brownfield start.
 */

import { PLANT_TYPES } from '@content/plantTypes'
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
