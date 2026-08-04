/**
 * The Tech layer: what year it is, expressed as modifiers.
 *
 * Registered once a year, which is the tier the layer was given in M1 for exactly this. Nothing
 * here changes within a year, and recomputing a learning curve hourly for three hundred assets
 * would be pure waste.
 *
 * ## Two rules this file follows, and one it makes visible
 *
 * **Every force gets its own modifier.** Inflation, escalation, learning, the quality premium
 * and standardisation could be collapsed into one number before registration, and the arithmetic
 * would be identical. They are not, because the inspector's explanation chain is the only place
 * a player ever finds out *why* a gas turbine costs twice what it did in 1995 — and "because of
 * time" is not an answer anyone can act on. One modifier per force costs a few objects a year
 * and turns the cost model from a black box into the most legible thing in the game.
 *
 * **Every one of them is a `MulFactor`.** These are ratios, not adjustments. Over a thirty-year
 * scenario inflation reaches +80% and a learning curve -60%; adding those within the layer would
 * give +20% where the truth is -28%. `AddFrac` is right for a 4% wear penalty and wrong here,
 * and the difference only becomes visible at the spans this milestone introduced.
 *
 * ## Vintage: what a machine gets and what it does not
 *
 * A plant is built to the state of the art of its own year and keeps it. It does not become more
 * efficient by standing there, which is why the progress factor for an existing plant is
 * evaluated at its **commissioning year** while its operating costs are evaluated at the
 * **current** one. Those two are the mechanism behind the single most important thing an ageing
 * fleet does to its owner: it falls further behind what a new machine would do, while costing
 * more every year to keep running. Neither half of that is stated anywhere as a rule.
 */

import { PLANT_TYPES, PLANT_TYPE_IDS } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { quoteTargetFor } from '@sim/build/commands'
import { Layer, Op, Param, type Modifier } from '@sim/params/types'
import { TICKS_PER_YEAR } from '@sim/core/time'
import type { PlantAsset } from '@sim/assets/types'
import {
  costOutlook,
  designLifeFactor,
  inflationFactor,
  progressFactor,
  progressTarget,
  realOpexFactor,
  standardisation,
} from './costs'

export const TECH_SOURCE = 'tech'

interface Entry {
  targetId: string
  mod: Modifier
}

function mul(
  param: Param,
  value: number,
  reasonKey: string,
  reasonParams?: Record<string, string | number>,
): Modifier {
  const m: Modifier = {
    layer: Layer.Tech,
    param,
    op: Op.MulFactor,
    value,
    sourceKind: 'tech',
    sourceId: TECH_SOURCE,
    reasonKey,
  }
  if (reasonParams) m.reasonParams = reasonParams
  return m
}

/** Skip a factor that would multiply by one — it is noise in the explanation, not information. */
function push(out: Entry[], targetId: string, mod: Modifier): void {
  if (Math.abs(mod.value - 1) < 5e-4) return
  out.push({ targetId, mod })
}

/** What year a plant was built in, which may be well before the scenario opens. */
export function vintageYear(plant: PlantAsset, startYear: number): number {
  return startYear + plant.commissionedTick / TICKS_PER_YEAR
}

/**
 * Everything the Tech layer contributes, for one year.
 *
 * `playerBuiltMw` and `builtCount` are per technology: the first feeds the learning curve, where
 * it is real but negligible, and the second feeds standardisation, where it is the whole point.
 */
export function techModifiers(
  year: number,
  plants: PlantAsset[],
  startYear: number,
  playerBuiltMw: Record<string, number> = {},
  builtCount: Record<string, number> = {},
): Entry[] {
  const out: Entry[] = []

  // --- What a new plant of each type would cost and do, this year ---------
  for (const typeId of PLANT_TYPE_IDS) {
    const type = PLANT_TYPES[typeId]
    const target = quoteTargetFor(typeId)
    const built = builtCount[typeId] ?? 0
    const outlook = costOutlook(typeId, year, type.capexPerKw.sourceYear, playerBuiltMw[typeId] ?? 0, built)

    push(out, target, mul(Param.CapexPerKw, outlook.inflation, 'tech.inflation'))
    push(out, target, mul(Param.CapexPerKw, outlook.escalation, 'tech.escalation'))
    push(out, target, mul(Param.CapexPerKw, outlook.learning, 'tech.learning'))
    push(out, target, mul(Param.CapexPerKw, outlook.quality, 'tech.quality'))
    if (built > 0) {
      const std = standardisation(built)
      push(out, target, mul(Param.CapexPerKw, std.capexFactor, 'tech.standardisation', { built }))
      push(out, target, mul(Param.BuildTimeMonths, std.buildTimeFactor, 'tech.standardisation', { built }))
    }

    // Operating cost for a machine bought today, so the build menu quotes what it will cost to
    // run rather than what a report said it cost to run in 2022.
    const opexYear = type.fixedOpexPerKwYear.sourceYear
    push(out, target, mul(Param.FixedOpexPerKwYear, inflationFactor(opexYear, year), 'tech.inflation'))
    push(out, target, mul(Param.FixedOpexPerKwYear, realOpexFactor(year, opexYear), 'tech.labourEscalation'))

    // Progress, landing wherever it means something for this technology.
    const progress = progressFactor(typeId, year, type.efficiency.sourceYear)
    const param = progressTarget(typeId) === 'efficiency' ? Param.Efficiency : Param.CapacityMw
    push(out, target, mul(param, progress, 'tech.progress'))
  }

  // --- What the fleet the player already owns costs and does ---------------
  for (const plant of plants) {
    const type = PLANT_TYPES[plant.typeId]
    const vintage = vintageYear(plant, startYear)

    // Built to its own year's state of the art, and it keeps it.
    const progress = progressFactor(plant.typeId, vintage, type.efficiency.sourceYear)
    const param = progressTarget(plant.typeId) === 'efficiency' ? Param.Efficiency : Param.CapacityMw
    push(out, plant.id, mul(param, progress, 'tech.vintage', { year: Math.round(vintage) }))

    // Running costs are paid in today's money, whatever year the machine is from. This is the
    // half of ageing that a condition percentage cannot express.
    const fixedYear = type.fixedOpexPerKwYear.sourceYear
    push(out, plant.id, mul(Param.FixedOpexPerKwYear, inflationFactor(fixedYear, year), 'tech.inflation'))
    push(out, plant.id, mul(Param.FixedOpexPerKwYear, realOpexFactor(year, fixedYear), 'tech.labourEscalation'))

    const varYear = type.varOpexPerMwh.sourceYear
    push(out, plant.id, mul(Param.VarOpexPerMwh, inflationFactor(varYear, year), 'tech.inflation'))
    push(out, plant.id, mul(Param.VarOpexPerMwh, realOpexFactor(year, varYear), 'tech.labourEscalation'))

    // Fuel is quoted in its own source year's money too. The per-fuel political index is a
    // separate, real-terms thing and rides on top of this in the Geopolitics layer.
    if (type.fuel !== 'none') {
      const fuelYear = FUELS[type.fuel].pricePerMwhThermal.sourceYear
      push(out, plant.id, mul(Param.FuelPricePerMwhThermal, inflationFactor(fuelYear, year), 'tech.inflation'))
    }
  }

  return out
}

/**
 * Design life for a plant, in years, including what its vintage was worth.
 *
 * Not a modifier because design life is not a `Param` — it is read once by the ageing model and
 * by the retirement logic, and adding a parameter for it would mean adding it to the bounds
 * table, the cache tiers and the save format for a number that changes once.
 */
export function designLifeYears(plant: PlantAsset, startYear: number): number {
  const type = PLANT_TYPES[plant.typeId]
  const factor = designLifeFactor(plant.typeId, vintageYear(plant, startYear), type.designLifeYears.sourceYear)
  return type.designLifeYears.value * factor * (1 + plant.lifeExtension)
}
