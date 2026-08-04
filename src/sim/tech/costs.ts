/**
 * Turning the cost trends into numbers, once a year.
 *
 * Everything here is a pure function of `(typeId, year, …)`. That is deliberate and it is what
 * makes the whole milestone testable: a test can ask what a photovoltaic array costs in 2015
 * without running a simulation, and the answer cannot depend on anything that happened in the
 * meantime.
 *
 * ## Two things to get right, and the second one is easy to get backwards
 *
 * **Nominal versus real.** This simulation runs in **nominal money** — the euros of the game's
 * current year, not of some fixed base. That is the honest choice for a game spanning thirty
 * years, and it produces three consequences that are all real and none of which had to be
 * written down separately:
 *
 *   - Old debt gets cheap. A loan taken in 1998 is repaid in 2020 money.
 *   - A fixed-price support contract erodes. Twenty years of a nominal feed-in tariff is worth
 *     far less at the end than at the start, which is exactly what happened to every early
 *     renewables scheme in Europe, and it is why contracts here are *not* indexed.
 *   - The regulated tariff keeps up, because it is reset against the market annually. Without
 *     that the utility would go bankrupt from inflation alone, which would be an artefact.
 *
 * **Every trend is anchored at the figure's own source year, not at some global epoch.** This is
 * the subtle one, and the first version of this file got it wrong. A trend index is only
 * meaningful as a *ratio between two years*, and the year a content figure is already quoted in
 * is its own denominator: an IEA capital cost published for 2020 is, by definition, the 2020
 * point on that technology's cost curve. So the factor applied to it is `index(gameYear) /
 * index(2020)` — which is above one before 2020 and below it after, for a falling technology.
 *
 * Anchoring everything at 1995 instead would have quietly asserted that the 2020 figures were
 * 1995 costs, making the opening scenario start with three decades of learning already banked and
 * every technology mispriced by however far it had travelled. The functions below therefore all
 * take a `sourceYear` and none of them return 1 at any fixed date.
 */

import { COST_TRENDS, PRICE_TRENDS, STANDARDISATION, TREND_BASE_YEAR } from '@content/costTrends'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'

/**
 * General price inflation between two years, in either direction.
 *
 * Carries a figure from the year its source published it to the year the game is in. A figure
 * published in 2022 and read in 1995 is *deflated*, which is correct and matters: the opening
 * scenario begins in 1995, so most of the content is quoted in money that does not exist yet.
 */
export function inflationFactor(fromYear: number, toYear: number): number {
  return Math.pow(1 + PRICE_TRENDS.generalInflationPerYear.value, toYear - fromYear)
}

/**
 * Cumulative capacity the world has built of a technology, by a given year.
 *
 * Exogenous, and the reasoning is in `costTrends.ts`: learning is a worldwide phenomenon and the
 * player's region is a rounding error in it. Their own megawatts are added because they are
 * genuinely part of the total, not because they will move it.
 */
export function worldDeployedMw(typeId: PlantTypeId, year: number, playerBuiltMw = 0): number {
  const learning = COST_TRENDS[typeId].learning
  const years = year - TREND_BASE_YEAR
  return learning.worldInstalled1995Mw.value * Math.pow(1 + learning.worldGrowthPerYear.value, years) + playerBuiltMw
}

/**
 * Wright's law: cost falls by a fixed fraction per doubling of cumulative production.
 *
 * In closed form `(Q/Q0)^log2(1-rate)`. Returns an absolute index, not a ratio between years —
 * callers divide two of these to get a factor.
 */
function learningIndex(typeId: PlantTypeId, year: number, rate: number, playerBuiltMw: number): number {
  if (rate <= 0) return 1
  const learning = COST_TRENDS[typeId].learning
  const base = learning.worldInstalled1995Mw.value
  if (base <= 0) return 1
  const quantity = worldDeployedMw(typeId, year, playerBuiltMw)
  if (quantity <= 0) return 1
  return Math.pow(quantity / base, Math.log2(1 - rate))
}

/** Decades since the trend epoch. Only ever used as a difference between two years. */
function decades(year: number): number {
  return (year - TREND_BASE_YEAR) / 10
}

/**
 * The three components of the real capital cost index, before any anchoring.
 *
 * Split out because both `realCapexFactor` and `costOutlook` need the same arithmetic, and
 * because a single function computing it twice with slightly different code is how the
 * explanation and the number it explains drift apart.
 */
function capexParts(
  typeId: PlantTypeId,
  year: number,
  playerBuiltMw: number,
): { equipment: number; escalation: number; total: number } {
  const trend = COST_TRENDS[typeId]
  const s = trend.structure

  const equipLearning = learningIndex(typeId, year, trend.learning.ratePerDoubling.value, playerBuiltMw)
  const installLearning = learningIndex(typeId, year, trend.learning.installRatePerDoubling.value, playerBuiltMw)
  const quality = Math.pow(1 + trend.progress.qualityCostPerDecade.value, decades(year))
  const labour = Math.pow(1 + PRICE_TRENDS.labourRealGrowthPerYear.value, year - TREND_BASE_YEAR)
  const civil = Math.pow(1 + PRICE_TRENDS.civilRealGrowthPerYear.value, year - TREND_BASE_YEAR)

  // Labour and civil works escalate *and* learn. The two pull against each other, and which one
  // wins is the whole question: for a solar farm the learning wins comfortably, for a dam the
  // escalation wins outright, and neither outcome is written down anywhere.
  const equipment = s.equipment.value * equipLearning * quality
  const escalation = (s.labour.value * labour + s.civil.value * civil) * installLearning
  return { equipment, escalation, total: equipment + escalation }
}

/**
 * Real capital cost multiplier to apply to a figure quoted in `sourceYear` money.
 *
 * A worked example, because the interaction between the two tables is the point. Photovoltaics
 * between 2020 and 1995: the world went from 600 MW to hundreds of gigawatts over that period,
 * so running the index *backwards* to 1995 gives a number several times higher than the 2020
 * figure — which is what a 1995 solar array actually cost. New nuclear over the same span barely
 * moves on learning, because the world did not manage one doubling, while labour and civil works
 * — seventy percent of its cost — escalated throughout. Its index therefore *rises* with time.
 * Neither of those results appears anywhere in the content.
 */
export function realCapexFactor(
  typeId: PlantTypeId,
  year: number,
  sourceYear: number,
  playerBuiltMw = 0,
): number {
  // The player's own fleet is part of today's cumulative total but was not part of the total in
  // the source year, so it is only added on the numerator side.
  const now = capexParts(typeId, year, playerBuiltMw).total
  const then = capexParts(typeId, sourceYear, 0).total
  return then > 0 ? now / then : 1
}

/**
 * How much better the machine itself has got, relative to the year the figure was quoted in.
 *
 * Applied to the technology as a class and fixed at the year of construction — a plant does not
 * improve by standing there. Refurbishment is the mechanism for putting newer technology into an
 * older machine, and it already exists.
 *
 * **Where this lands depends on what the technology burns**, and the distinction is not cosmetic.
 * For anything with a fuel, progress means thermal conversion efficiency, and `Param.Efficiency`
 * is exactly the right home for it. For wind, solar, hydro and storage the `efficiency` field is
 * a placeholder equal to one — there is no fuel to convert, and the weather model does the work —
 * so putting a gain there would mean nothing and would then be clamped away at 0.99. What
 * actually improved for those technologies is how much energy one standard installation
 * harvests: taller towers, larger rotors, better modules. `progressTarget` says which of the two
 * a caller is looking at, so the gain lands where it means something.
 */
export function progressTarget(typeId: PlantTypeId): 'efficiency' | 'capacity' {
  return PLANT_TYPES[typeId].fuel === 'none' ? 'capacity' : 'efficiency'
}

export function progressFactor(typeId: PlantTypeId, year: number, sourceYear: number): number {
  const rate = COST_TRENDS[typeId].progress.efficiencyGainPerDecade.value
  return Math.pow(1 + rate, decades(year) - decades(sourceYear))
}

export function designLifeFactor(typeId: PlantTypeId, year: number, sourceYear: number): number {
  const rate = COST_TRENDS[typeId].progress.lifeGainPerDecade.value
  return Math.pow(1 + rate, decades(year) - decades(sourceYear))
}

/**
 * Real escalation of operating and maintenance cost.
 *
 * Operations are labour, so they follow the labour index rather than the general one. This is
 * why an old fleet becomes expensive to keep in service in a way that its original capital cost
 * gives no hint of, and it is the force behind many real decisions to close a plant that still
 * works perfectly well.
 */
export function realOpexFactor(year: number, sourceYear: number): number {
  return Math.pow(1 + PRICE_TRENDS.labourRealGrowthPerYear.value, year - sourceYear)
}

/**
 * Real escalation of a dismantling bill.
 *
 * Half people, half plant and muck, and no equipment share at all — so no learning. That is why
 * decommissioning provisions set decades in advance are so reliably short: the thing being
 * provided for is made entirely of the two components that only ever go up.
 */
export function realDecommissioningFactor(year: number, sourceYear: number): number {
  const labour = Math.pow(1 + PRICE_TRENDS.labourRealGrowthPerYear.value, year - sourceYear)
  const civil = Math.pow(1 + PRICE_TRENDS.civilRealGrowthPerYear.value, year - sourceYear)
  return 0.5 * labour + 0.5 * civil
}

/** Real fuel price trend, before the per-fuel political index. Near zero on purpose. */
export function realFuelFactor(year: number, sourceYear: number): number {
  return Math.pow(1 + PRICE_TRENDS.fuelRealGrowthPerYear.value, year - sourceYear)
}

/**
 * What repeating yourself is worth.
 *
 * `built` is how many of this type the player has already commissioned. The first one gets
 * nothing, because there is nothing to have learned from yet.
 *
 * Capped, and the cap matters more than the rate. Without one, a player who built forty of the
 * same thing would eventually get it for nothing — turning a real effect into an exploit, and
 * punishing a mixed fleet far beyond anything the effect justifies.
 */
export function standardisation(built: number): { capexFactor: number; buildTimeFactor: number } {
  const repeats = Math.max(0, built)
  const cap = STANDARDISATION.maxReduction.value
  return {
    capexFactor: 1 - Math.min(cap, repeats * STANDARDISATION.capexReductionPerRepeat.value),
    buildTimeFactor: 1 - Math.min(cap, repeats * STANDARDISATION.buildTimeReductionPerRepeat.value),
  }
}

/**
 * Every force on a technology's capital cost, separated.
 *
 * Returned as separate factors rather than one number so the parameter pipeline can register
 * each with its own reason and the inspector can show which force did what. A single combined
 * multiplier would be cheaper and would throw away the only part of this that teaches anything.
 */
export interface CostOutlook {
  /** General inflation from the figure's own source year to now. */
  inflation: number
  /** Escalation on labour, land and civil works, weighted by their shares. */
  escalation: number
  /** Learning, on equipment and on installation. At or below 1 after the source year. */
  learning: number
  /** Quality premium for a better machine, weighted by the equipment share. */
  quality: number
  /** Discount for having built this type before. */
  standardisation: number
  /** Product of the three real terms: escalation, learning and quality. */
  realCapex: number
}

/**
 * Decompose the real capex factor into the forces that made it.
 *
 * The decomposition is a **chain**, not three independent ratios: escalation is applied first,
 * then learning on top of that, then the quality premium on top of that. Written that way the
 * denominators cancel and the three factors multiply back to `realCapex` exactly. An explanation
 * that does not reconcile with the number it explains is worse than no explanation, so it is
 * worth a few extra lines to make the identity structural rather than approximate.
 *
 * The order is a presentation choice with one defensible answer: escalation is what happens to a
 * technology that does nothing, learning is what deployment does to it, and quality is what is
 * added back for the machine being a better one. Each rung is a departure from the one before.
 */
export function costOutlook(
  typeId: PlantTypeId,
  year: number,
  sourceYear: number,
  playerBuiltMw = 0,
  builtCount = 0,
): CostOutlook {
  const trend = COST_TRENDS[typeId]
  const s = trend.structure

  const labourAt = (y: number) => Math.pow(1 + PRICE_TRENDS.labourRealGrowthPerYear.value, y - TREND_BASE_YEAR)
  const civilAt = (y: number) => Math.pow(1 + PRICE_TRENDS.civilRealGrowthPerYear.value, y - TREND_BASE_YEAR)
  const qualityAt = (y: number) => Math.pow(1 + trend.progress.qualityCostPerDecade.value, decades(y))
  const equipLearnAt = (y: number, built: number) =>
    learningIndex(typeId, y, trend.learning.ratePerDoubling.value, built)
  const installLearnAt = (y: number, built: number) =>
    learningIndex(typeId, y, trend.learning.installRatePerDoubling.value, built)

  /** The cost index after applying only the forces up to and including `stage`. */
  const upTo = (y: number, built: number, stage: 'escalation' | 'learning' | 'quality'): number => {
    const escalated = s.labour.value * labourAt(y) + s.civil.value * civilAt(y)
    if (stage === 'escalation') return s.equipment.value + escalated
    const learned = s.equipment.value * equipLearnAt(y, built) + escalated * installLearnAt(y, built)
    if (stage === 'learning') return learned
    return s.equipment.value * equipLearnAt(y, built) * qualityAt(y) + escalated * installLearnAt(y, built)
  }

  // Each rung is a ratio between the same stage evaluated now and in the source year, so the
  // chain telescopes to exactly `realCapexFactor`.
  const escalation = upTo(year, 0, 'escalation') / upTo(sourceYear, 0, 'escalation')
  const learning =
    upTo(year, playerBuiltMw, 'learning') /
    upTo(sourceYear, 0, 'learning') /
    escalation
  const quality =
    upTo(year, playerBuiltMw, 'quality') /
    upTo(sourceYear, 0, 'quality') /
    (escalation * learning)

  return {
    inflation: inflationFactor(sourceYear, year),
    escalation,
    learning,
    quality,
    standardisation: standardisation(builtCount).capexFactor,
    realCapex: realCapexFactor(typeId, year, sourceYear, playerBuiltMw),
  }
}
