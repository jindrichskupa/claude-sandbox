/**
 * Runtime state of the things the player owns and serves.
 *
 * The lifecycle fields are all present from the first version even though the early
 * milestones only use a few of them. They are in the save format, so adding repairs,
 * refurbishment, decommissioning and site remediation later does not invalidate anyone's
 * game — which is exactly the sort of thing that is nearly free now and miserable later.
 */

import type { PlantTypeId } from '@content/plantTypes'
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

  phase: LifecyclePhase
  /** Tick at which the current phase ends. Meaningless while Operating. */
  phaseEndsTick: number
  /**
   * When the unit entered service. Inherited plants have a negative value — they were
   * commissioned before the scenario begins, which is the whole point of a brownfield start.
   */
  commissionedTick: number

  /** Physical condition, 1 = as new. Falls with age and neglected maintenance. */
  conditionPct: number
  cumulativeRunHours: number
  cumulativeStarts: number

  /** Output in the last completed tick, in MW. Storage uses negative for charging. */
  outputMw: number
  /** Stored energy for storage assets. */
  storageMwh: number
  /** False during a forced outage. */
  online: boolean

  /** Capital cost actually paid, for accounting and for resale value. */
  capexPaid: number
}

export interface CityAsset {
  id: string
  nodeId: NodeId
  name: string
  /** Thousands of people. Drives demand growth and political weight. */
  population: number
  /** Demand at reference conditions, before the daily, seasonal and weather shaping. */
  baseDemandMw: number
  /** District heating demand at reference conditions. Unused until the heat milestone. */
  baseHeatDemandMwth: number

  /** Rolling measure of how well the city has been served, 0..1. */
  satisfaction: number
  /** Ticks with unserved energy in the recent past. */
  unservedTicksRecent: number
}

/** Whether a plant can generate at all right now. */
export function isDispatchable(p: PlantAsset): boolean {
  return p.phase === LifecyclePhase.Operating && p.online
}

/** Whether a plant still costs its owner fixed money. Mothballed units cost less but not nothing. */
export function incursFixedCost(p: PlantAsset): boolean {
  return (
    p.phase === LifecyclePhase.Operating ||
    p.phase === LifecyclePhase.Refurbishing ||
    p.phase === LifecyclePhase.Mothballed
  )
}
