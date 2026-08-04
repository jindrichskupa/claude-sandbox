/**
 * Scenario objectives: what the player is actually trying to do.
 *
 * Until now the scenario listed four objectives and nothing read them, so the only feedback the
 * game gave was a bank balance. That is the difference between a simulation and a game, and it
 * is what this file closes.
 *
 * The design follows the same rule as events and policy regimes: an objective is **data**, and
 * the conditions it can be built from are a **closed set** with one implementation each. No
 * objective contains code. Three things follow from that, and all three matter more than the
 * convenience:
 *
 *   - The player can be told precisely why an objective is or is not met, in the same words
 *     every scenario uses, because there is one implementation producing that answer.
 *   - A test can walk every objective in every scenario and check it is achievable, the same
 *     way `events.test.ts` checks every severe event has a way out.
 *   - Adding a scenario is authoring, not programming.
 *
 * ## Why some objectives can fail permanently and others cannot
 *
 * `AtEnd` objectives are judged once, when the scenario's clock runs out: they ask what the
 * state of the world is at the end, and until then they are simply pending. `Continuous` ones
 * are judged every year and can be **failed for good** — once a town has frozen, it has frozen,
 * and a scenario that quietly forgave it would be lying about what happened. The distinction is
 * declared per objective rather than inferred, because getting it wrong in either direction
 * produces a game that feels arbitrary.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { LifecyclePhase, isDispatchable, type PlantAsset } from '../assets/types'
import type { Finances, PeriodLedger } from '../economy/economy'

/**
 * Every condition an objective can be built from.
 *
 * Deliberately small. Each entry is one thing a scenario designer might reasonably ask of a
 * player, and adding one is a deliberate act with a single place to implement it.
 */
export type ObjectiveCondition =
  /** Unserved energy stays below `threshold` as a share of demand. */
  | { kind: 'unservedShareBelow'; threshold: number }
  /** No connected town is ever left without heat. */
  | { kind: 'noUnservedHeat' }
  /** The utility never goes bankrupt. */
  | { kind: 'neverBankrupt' }
  /** A named plant has been retired and is out of service. */
  | { kind: 'plantRetired'; plantId: string }
  /** Dispatchable capacity of at least this much is in service. */
  | { kind: 'capacityAtLeast'; mw: number }
  /** Carbon intensity of energy sold is below this, in tonnes per MWh. */
  | { kind: 'carbonIntensityBelow'; tPerMwh: number }
  /** Cash on hand is at least this much. */
  | { kind: 'cashAtLeast'; eur: number }
  /** At least this share of energy comes from plant that burns nothing. */
  | { kind: 'lowCarbonShareAtLeast'; share: number }

/** When an objective is judged, which decides whether it can fail for good. */
export type ObjectiveTiming = 'continuous' | 'atEnd'

export interface ObjectiveDef {
  id: string
  descriptionKey: string
  condition: ObjectiveCondition
  timing: ObjectiveTiming
  /**
   * Whether the scenario is lost without it. A scenario with no required objectives is a
   * sandbox, which is a legitimate thing to author and should not need a special case.
   */
  required: boolean
}

export type ObjectiveStatus = 'pending' | 'met' | 'failed'

export interface ObjectiveProgress {
  id: string
  status: ObjectiveStatus
  /** How far along, 0..1, where the condition admits a meaningful fraction. */
  progress: number
  /** The measured value and the target, for the panel to show without re-deriving them. */
  value: number
  target: number
}

/** Everything an objective may look at. Passed in so evaluation stays a pure function. */
export interface ObjectiveContext {
  plants: PlantAsset[]
  finances: Finances
  /** Totals since the scenario began, which is the window most objectives are about. */
  lifetime: PeriodLedger
  /** The year now, and the year the scenario is judged. */
  year: number
  endYear: number
}

/**
 * Measure one condition.
 *
 * Returns the measured value, the target, and whether it is currently satisfied. Separating the
 * measurement from the verdict is what lets the panel show "0.04% against a 0.1% limit" rather
 * than a tick or a cross, which is the difference between a player who can course-correct and
 * one who is guessing.
 */
export function measure(
  condition: ObjectiveCondition,
  context: ObjectiveContext,
): { value: number; target: number; satisfied: boolean } {
  switch (condition.kind) {
    case 'unservedShareBelow': {
      const total = context.lifetime.energySoldMwh + context.lifetime.energyUnservedMwh
      const share = total > 0 ? context.lifetime.energyUnservedMwh / total : 0
      return { value: share, target: condition.threshold, satisfied: share < condition.threshold }
    }
    case 'noUnservedHeat': {
      const cold = context.lifetime.heatUnservedMwh
      return { value: cold, target: 0, satisfied: cold <= 1e-6 }
    }
    case 'neverBankrupt':
      return { value: context.finances.bankrupt ? 1 : 0, target: 0, satisfied: !context.finances.bankrupt }
    case 'plantRetired': {
      const plant = context.plants.find((p) => p.id === condition.plantId)
      // A plant that no longer exists counts as retired; one still running does not, and one
      // being dismantled is on its way rather than there.
      const done =
        !plant ||
        plant.phase === LifecyclePhase.Remediating ||
        plant.phase === LifecyclePhase.Cleared ||
        plant.phase === LifecyclePhase.Decommissioning
      return { value: done ? 1 : 0, target: 1, satisfied: done }
    }
    case 'capacityAtLeast': {
      let mw = 0
      for (const plant of context.plants) {
        if (isDispatchable(plant)) mw += PLANT_TYPES[plant.typeId].capacityMw.value
      }
      return { value: mw, target: condition.mw, satisfied: mw >= condition.mw }
    }
    case 'carbonIntensityBelow': {
      const sold = context.lifetime.energySoldMwh
      const intensity = sold > 0 ? context.lifetime.co2Tonnes / sold : 0
      return { value: intensity, target: condition.tPerMwh, satisfied: intensity < condition.tPerMwh }
    }
    case 'cashAtLeast':
      return { value: context.finances.cash, target: condition.eur, satisfied: context.finances.cash >= condition.eur }
    case 'lowCarbonShareAtLeast': {
      // Measured on installed capacity rather than energy, because energy would need a second
      // accumulator per fuel and this is what a scenario brief would actually say.
      let total = 0
      let clean = 0
      for (const plant of context.plants) {
        if (!isDispatchable(plant)) continue
        const type = PLANT_TYPES[plant.typeId]
        total += type.capacityMw.value
        if (type.fuel === 'none') clean += type.capacityMw.value
      }
      const share = total > 0 ? clean / total : 0
      return { value: share, target: condition.share, satisfied: share >= condition.share }
    }
  }
}

/**
 * How far along a condition is, where that means anything.
 *
 * The two kinds of condition need opposite readings, and conflating them would produce a bar
 * that misleads exactly when it matters most.
 *
 * A **target** fills up as you approach it: half the capacity asked for is half done.
 *
 * A **limit** is the other way round. Its bar shows *headroom remaining*, and — importantly —
 * keeps showing it even while the condition is satisfied. A player who has used 90% of their
 * unserved-energy allowance is ten percent from failing, not ninety percent of the way to
 * succeeding, and a bar that filled up as they burned through it would be telling them they
 * were doing well right up until they lost.
 */
function progressOf(
  condition: ObjectiveCondition,
  measured: { value: number; target: number; satisfied: boolean },
): number {
  switch (condition.kind) {
    case 'unservedShareBelow':
    case 'carbonIntensityBelow':
      return measured.target > 0 ? Math.max(0, Math.min(1, 1 - measured.value / measured.target)) : 0
    case 'capacityAtLeast':
    case 'cashAtLeast':
    case 'lowCarbonShareAtLeast':
      return measured.target > 0 ? Math.max(0, Math.min(1, measured.value / measured.target)) : 1
    default:
      return measured.satisfied ? 1 : 0
  }
}

/**
 * Judge every objective and carry forward anything that has already failed for good.
 *
 * `previous` is what makes a continuous failure permanent: once a town has frozen, no later year
 * of good behaviour un-freezes it. Passing the previous state in rather than holding it here
 * keeps this a pure function, which is what lets the tests drive it directly.
 */
export function evaluateObjectives(
  objectives: ObjectiveDef[],
  context: ObjectiveContext,
  previous: ObjectiveProgress[] = [],
): ObjectiveProgress[] {
  const priorById = new Map(previous.map((p) => [p.id, p]))

  return objectives.map((objective) => {
    const measured = measure(objective.condition, context)
    const prior = priorById.get(objective.id)

    // Nothing rescues an objective that has already been failed for good.
    if (prior?.status === 'failed') {
      return { id: objective.id, status: 'failed', progress: 0, value: measured.value, target: measured.target }
    }

    // Neither kind is *decided* before the scenario ends, and for the same reason: an objective
    // that is currently satisfied is not an objective that has been achieved. Reporting "met" in
    // year three for something judged in year thirty would be telling the player they had banked
    // something they can still lose — which, for a capacity target they are about to demolish
    // half of, is precisely the wrong thing to say.
    //
    // The difference between the two is what happens on a breach: a continuous objective fails
    // for good the moment it is broken, an end-of-scenario one simply is not satisfied yet.
    let status: ObjectiveStatus
    if (objective.timing === 'continuous' && !measured.satisfied) {
      status = 'failed'
    } else if (context.year < context.endYear) {
      status = 'pending'
    } else {
      status = measured.satisfied ? 'met' : 'failed'
    }

    return {
      id: objective.id,
      status,
      progress: progressOf(objective.condition, measured),
      value: measured.value,
      target: measured.target,
    }
  })
}

export type ScenarioOutcome = 'playing' | 'won' | 'lost'

/**
 * Whether the scenario is over, and how.
 *
 * Bankruptcy ends it immediately: a utility that cannot pay its bills is not going to be judged
 * on its carbon intensity in nine years' time. Otherwise the verdict waits for the end year,
 * because an objective that is merely unmet is not yet failed.
 */
export function scenarioOutcome(
  objectives: ObjectiveDef[],
  progress: ObjectiveProgress[],
  context: ObjectiveContext,
): ScenarioOutcome {
  if (context.finances.bankrupt) return 'lost'

  const byId = new Map(progress.map((p) => [p.id, p]))
  const required = objectives.filter((o) => o.required)

  if (required.some((o) => byId.get(o.id)?.status === 'failed')) return 'lost'
  if (context.year < context.endYear) return 'playing'
  return required.every((o) => byId.get(o.id)?.status === 'met') ? 'won' : 'lost'
}
