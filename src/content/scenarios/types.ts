/**
 * What a scenario is, as data.
 *
 * Here rather than beside the first scenario, which is where it began and where it stopped
 * making sense the moment there was a second one: a new grid should not have to import its own
 * shape from another grid. The types are the contract every scenario writes against and the
 * loader reads; the scenarios themselves are the content.
 */

import type { TEMPERATE_CLIMATE } from '../../sim/weather/weather'
import type { PlantTypeId } from '../plantTypes'
import type { VoltageLevel } from '../lineTypes'
import type { PipeSize } from '../heatPipeTypes'
import type { ObjectiveDef } from '../../sim/scenario/objectives'

export interface NodeSpec {
  id: string
  kind: 'plant' | 'city' | 'substation'
  x: number
  y: number
  name?: string
  /**
   * The voltages an inherited switching station is built for.
   *
   * Left out on purpose in the ordinary case: the levels are then read off the lines the scenario
   * actually hangs on the station, which cannot disagree with the map. Write it only for a station
   * that is built for a level it does not yet host — a 400 kV compound waiting for its first
   * 400 kV line — because that is the one thing the lines cannot tell us.
   */
  kvLevels?: VoltageLevel[]
}

export interface CitySpec {
  id: string
  nodeId: string
  name: string
  /** Thousands of people. */
  population: number
  baseDemandMw: number
  baseHeatDemandMwth: number
}

export interface PlantSpec {
  id: string
  nodeId: string
  typeId: PlantTypeId
  name: string
  /** How old the unit already is when the scenario begins. Ignored for a unit still being built. */
  ageYears: number
  /**
   * Overhauls this machine has already had before the scenario opens.
   *
   * Age alone cannot describe an inherited thermal fleet, and getting it wrong is not cosmetic:
   * a Czech lignite unit from 1974 is 41 years old in 2015 against a 45-year design life, so on
   * age alone it dies in the scenario's fourth year — when in life it was comprehensively
   * rebuilt in between and runs into the 2040s. That rebuild is the whole reason half the fleet
   * survived, and a scenario that could not say so would be handing the player a fleet that
   * collapses for a reason that never happened.
   *
   * Counted rather than described, because what an overhaul buys belongs to the technology and
   * not to the scenario: `applyOverhaul` reads the extension, the efficiency gain and the
   * diminishing return off the plant type, exactly as it does when the player pays for one.
   */
  refurbishments?: number
  /**
   * Work already under way when the scenario opens.
   *
   * A brownfield start is not only machines: it is also somebody else's half-finished commitments.
   * Without this a scenario can hand the player a fleet but not a decision about a hole in the
   * ground — and for Czechia in 1995 the hole in the ground at Temelín *was* the decision.
   *
   * The money already spent is gone and is not modelled: a sunk cost that the player can still
   * see on a balance sheet is a sunk cost they will keep trying to recover, which is the one
   * behaviour this should not encourage. Only what is left to pay is scheduled.
   */
  inProgress?: InProgressSpec
}

export interface InProgressSpec {
  /**
   * `building` is a unit that has never run; `refurbishing` is one that has, and is in pieces.
   *
   * The difference matters on the day it finishes: a new unit starts its life then, an overhauled
   * one goes back to the life it already had, extended.
   */
  kind: 'building' | 'refurbishing'
  /** Years still to run when the scenario opens. */
  yearsRemaining: number
  /**
   * Years the work has already taken.
   *
   * Written down rather than derived, because it is a fact the scenario knows and nothing else
   * can recover: a reactor seven years from finishing may be seven years from a standing start or
   * fifteen years into a build that was meant to take six, and what it costs to walk away from
   * the two is not the same. See `quoteAbandonment`.
   */
  yearsElapsed: number
  /**
   * What fraction of the project's cost has still to be paid.
   *
   * A reactor eight years into construction and seven from finishing is not half paid for, because
   * the expensive part — the machinery, the instrumentation, the commissioning — comes last. The
   * scenario states the share rather than deriving it from the time left, because the two are not
   * proportional in any real project.
   */
  costRemainingShare: number
}

/**
 * Something that happened on a date, whatever the player was doing.
 *
 * The politics in this game is emergent: elections read the price, the blackouts, the emissions
 * and the import exposure, and the player's own record decides who governs. That is the right
 * default and it stays the default. What it cannot express is history — the things that happened
 * *to* a Czech utility between 1995 and 2025 because of decisions taken in Brussels, Berlin and
 * Moscow, which no amount of running a good system would have avoided.
 *
 * A timeline entry is one of those. It is not a difficulty knob and must not be used as one:
 * every entry names a real event, carries a source like every other number in `content/`, and
 * the set as a whole has to point in both directions or it is an argument rather than a record.
 *
 * Fairness is handled the way it is for any other event. A scheduled `EventDef` keeps its
 * choices, so there is always something the player can do; and unlike a sampled event it is
 * *known in advance*, because the briefing can list the timeline. Being told in 1995 that a
 * carbon price arrives in 2005 is the fairest warning this game gives about anything.
 */
export type TimelineEntry = {
  /** The year it lands, at the start of it. */
  year: number
  /** What it was, one line, for the briefing and the news feed. */
  headlineKey: string
  /** Where the claim comes from. Same discipline as `Sourced`. */
  source: string
} & (
  | {
      /**
       * An event from the catalogue, fired on a date instead of sampled by risk.
       *
       * Historical events are ordinary `EventDef`s with a base rate of zero, so the sampler never
       * raises them and the fairness test still covers them. One registry, one set of rules.
       */
      eventId: string
      regimeId?: never
    }
  | {
      /**
       * A government takes office.
       *
       * A one-off installation, not a lock: the next election runs normally and can throw it out
       * again. The timeline sets the field, the player's record still decides the match.
       */
      regimeId: string
      eventId?: never
    }
)

export interface LineSpec {
  id: string
  from: string
  to: string
  kv: VoltageLevel
  circuits: number
  /**
   * How old the corridor already is when the scenario begins.
   *
   * The same field the inherited plant carries, and for the same reason: a brownfield start whose
   * network was built yesterday is not a brownfield start. It also decides whether the renewal
   * mechanics ever fire — a line with a sixty-year design life that begins at zero is one the
   * player will never have to think about inside a thirty-year scenario.
   */
  ageYears: number
}

/**
 * A district heating main. Same graph, same island finder, same save format as a power line —
 * which is what the `commodity` field on every edge was put there for in the first milestone.
 */
export interface HeatPipeSpec {
  id: string
  from: string
  to: string
  dn: PipeSize
  /** Parallel mains. Doubles both the capacity and the standing loss. */
  pipes: number
}

export interface ScenarioContent {
  id: string
  nameKey: string
  descriptionKey: string
  startYear: number
  seed: number
  mapWidth: number
  mapHeight: number
  kmPerTile: number
  startingCash: number
  startingDebt: number
  tariffPerMwh: number
  heatTariffPerMwh: number
  carbonPricePerTonne: number
  /** The government in office when the scenario opens. */
  initialRegimeId: string
  climate: typeof TEMPERATE_CLIMATE
  nodes: NodeSpec[]
  cities: CitySpec[]
  plants: PlantSpec[]
  lines: LineSpec[]
  heatPipes: HeatPipeSpec[]
  objectives: ObjectiveDef[]
  /** The year the scenario is judged. */
  endYear: number
  /**
   * Guaranteed price per MWh paid to a technology regardless of the market, by type.
   *
   * This is the mechanism behind negative prices: a plant on a guaranteed tariff forfeits it
   * by being curtailed, so it will bid below zero to stay on. Here it is a flat scenario
   * setting; the policy milestone will make it something that arrives, changes and gets
   * withdrawn, which is what makes it interesting.
   */
  feedInTariffs?: Partial<Record<PlantTypeId, number>>
  /**
   * The map, drawn rather than generated. One string per row, one character per tile.
   *
   *     ~  water          .  plain        f  forest       h  hill      M  mountain
   *                       ,  plain+river  F  forest+river H  hill+river
   *
   * For a region that exists. The generator classifies terrain by rank and slopes the land toward
   * one corner, which guarantees a coast — right for an invented place and wrong for a landlocked
   * one. See `terrainFromRows`.
   */
  terrainRows?: string[]
  /**
   * Dated history: what happened anyway, whatever the player did.
   *
   * Optional, and both invented scenarios leave it out on purpose — an invented region has no
   * history to be faithful to, and giving it one would be authoring difficulty and calling it a
   * record. See `TimelineEntry`.
   */
  timeline?: TimelineEntry[]
}
