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
  /** How old the unit already is when the scenario begins. */
  ageYears: number
}

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
}
