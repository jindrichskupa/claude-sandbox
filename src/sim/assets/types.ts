/**
 * Runtime state of the things the player owns and serves.
 *
 * The lifecycle fields are all present from the first version even though the early
 * milestones only use a few of them. They are in the save format, so adding repairs,
 * refurbishment, decommissioning and site remediation later does not invalidate anyone's
 * game — which is exactly the sort of thing that is nearly free now and miserable later.
 */

import { isHeatOnlyType, isHeatSourceType, type PlantTypeId } from '@content/plantTypes'
import type { NodeId, OwnerId } from '../grid/network'

/**
 * Where an asset is in its life. Note that this is a state machine, deliberately *not*
 * an availability modifier of zero: "this plant is being dismantled" is a different kind
 * of fact from "this plant is derated today", and conflating them makes both harder to
 * reason about.
 */
export enum LifecyclePhase {
  Planned,
  Building,
  Operating,
  Refurbishing,
  Mothballed,
  Decommissioning,
  Remediating,
  Cleared,
}

export const LIFECYCLE_KEYS: Record<LifecyclePhase, string> = {
  [LifecyclePhase.Planned]: 'lifecycle.planned',
  [LifecyclePhase.Building]: 'lifecycle.building',
  [LifecyclePhase.Operating]: 'lifecycle.operating',
  [LifecyclePhase.Refurbishing]: 'lifecycle.refurbishing',
  [LifecyclePhase.Mothballed]: 'lifecycle.mothballed',
  [LifecyclePhase.Decommissioning]: 'lifecycle.decommissioning',
  [LifecyclePhase.Remediating]: 'lifecycle.remediating',
  [LifecyclePhase.Cleared]: 'lifecycle.cleared',
}

export interface PlantAsset {
  id: string
  ownerId: OwnerId
  typeId: PlantTypeId
  nodeId: NodeId
  /**
   * What this unit is called, if it is called anything in particular.
   *
   * On the plant rather than on its node, because a site is not a machine: Blackridge is one
   * place with two lignite sets on it, and the scenario has always named them Blackridge I and
   * Blackridge II. Reading the name off the node meant both answered to "Blackridge" and the
   * inspector, which read neither, printed `blackridge1` — so the two names the author wrote
   * were carried through the whole game and shown nowhere.
   *
   * Absent means the unit has no name of its own and is described by its site and technology,
   * which is the right answer for the first gas turbine the player drops on empty ground.
   */
  name?: string

  phase: LifecyclePhase
  /** Tick at which the current phase ends. Meaningless while Operating. */
  phaseEndsTick: number
  /**
   * When work began on a unit that is still being built. Negative for an inherited project, on
   * the same principle as `commissionedTick`: somebody broke ground before the scenario opened.
   *
   * Kept because how far through a project is cannot be recovered from the time left alone — a
   * reactor with seven years to run may be seven years from a standing start or fifteen years into
   * a build that was supposed to take six. `quoteAbandonment` prices walking away from it, and the
   * two cases are not worth the same.
   */
  buildStartTick?: number
  /**
   * When the unit entered service. Inherited plants have a negative value — they were
   * commissioned before the scenario begins, which is the whole point of a brownfield start.
   */
  commissionedTick: number

  /**
   * Design life in years for *this* machine, before any refurbishment extension.
   *
   * Stored on the asset rather than read from the type, because it depends on the machine's
   * vintage: design lives lengthened over the game's span — twenty-year wind turbines became
   * twenty-five, forty-year reactors became sixty — and the plant keeps whatever its year of
   * construction was good for. Fixed at commissioning, exactly like the capacity uplift beside
   * it, so nothing downstream has to know what year it is to ask how old a plant is getting.
   */
  designLifeYears: number

  /** Physical condition, 1 = as new. Falls with age and neglected maintenance. */
  conditionPct: number
  cumulativeRunHours: number
  cumulativeStarts: number

  /** Output in the last completed tick, in MW. Storage uses negative for charging. */
  outputMw: number
  /**
   * Heat delivered to the district heating network in the last completed tick, in MW thermal.
   * Negative for an accumulator that is being charged. Zero for anything without a heat side.
   */
  heatOutputMw: number
  /** Stored energy for storage assets. */
  storageMwh: number
  /** Stored heat for an accumulator, in MWh thermal. Kept apart from `storageMwh` on purpose:
   *  thermal and electrical megawatt-hours are not interchangeable and should not share a
   *  field that lets them be added together by accident. */
  heatStoredMwhth: number
  /**
   * Equivalent full cycles a store has delivered. One cycle is its whole usable energy
   * discharged once, whether in an hour or over a week.
   */
  cyclesUsed: number
  /** False during a forced outage. */
  online: boolean

  /** Capital cost actually paid, for accounting and for resale value. */
  capexPaid: number

  /** How many times this unit has been refurbished. */
  refurbishments: number
  /** Extra design life bought by refurbishment, as a fraction of the original. */
  lifeExtension: number
  /** Efficiency gained by refurbishment, as a fraction. */
  efficiencyUplift: number
  /** Capacity gained by uprating, as a fraction. */
  capacityUplift: number
}

export interface CityAsset {
  id: string
  nodeId: NodeId
  name: string
  /** Thousands of people. Drives demand growth and political weight. */
  population: number
  /**
   * The population the scenario opened with.
   *
   * Kept because demand growth is expressed as a *ratio* to it, and the base demand the scenario
   * quoted belongs to that many people. Recomputing it from the current population would make
   * the town's growth invisible the moment it happened.
   */
  startingPopulation: number
  /**
   * Photovoltaics on this town's own roofs, in MW. Not the player's — see `sim/city/rooftop.ts`.
   */
  rooftopSolarMw: number
  /** Demand at reference conditions, before the daily, seasonal and weather shaping. */
  baseDemandMw: number
  /** District heating demand at reference conditions. Unused until the heat milestone. */
  baseHeatDemandMwth: number

  /** Rolling measure of how well the city has been served, 0..1. */
  satisfaction: number
  /** Ticks with unserved energy in the recent past. */
  unservedTicksRecent: number
}

/**
 * Whether a plant can generate *electricity* right now.
 *
 * Heat-only plant is excluded here rather than at each call site, which is what keeps a
 * boiler's thermal megawatts from quietly appearing in the electrical merit order, the
 * capacity headline or the generation mix. For those, `capacityMw` is a thermal rating, and
 * one forgotten filter would put it on the wrong side of the energy balance.
 */
export function isDispatchable(p: PlantAsset): boolean {
  return p.phase === LifecyclePhase.Operating && p.online && !isHeatOnlyType(p.typeId)
}

/** Whether a plant can put heat into a district heating network right now. */
export function isHeatDispatchable(p: PlantAsset): boolean {
  return p.phase === LifecyclePhase.Operating && p.online && isHeatSourceType(p.typeId)
}

/** Whether a plant still costs its owner fixed money. Mothballed units cost less but not nothing. */
export function incursFixedCost(p: PlantAsset): boolean {
  return (
    p.phase === LifecyclePhase.Operating ||
    p.phase === LifecyclePhase.Refurbishing ||
    p.phase === LifecyclePhase.Mothballed
  )
}
