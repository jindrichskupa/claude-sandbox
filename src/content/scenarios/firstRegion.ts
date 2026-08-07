/**
 * The opening scenario: a small region with an inherited, ageing system.
 *
 * The starting position is a deliberate problem rather than a blank sheet. The player takes
 * over a utility whose fleet is mostly two thirds of the way through its life, whose cheap
 * lignite sits in the west behind a corridor that cannot carry all of it, and whose load is
 * in the east. On a cold still evening the corridor saturates, the eastern nodes price up,
 * and the gas turbine that nobody wanted to run becomes the only thing keeping the lights
 * on. Everything the player needs to learn is visible in the first winter.
 */

import { TEMPERATE_CLIMATE } from '../../sim/weather/weather'
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
}

export const FIRST_REGION: ScenarioContent = {
  id: 'first-region',
  nameKey: 'scenario.firstRegion.name',
  descriptionKey: 'scenario.firstRegion.description',
  startYear: 1995,
  seed: 20250803,
  mapWidth: 40,
  mapHeight: 30,
  kmPerTile: 10,
  startingCash: 400_000_000,
  startingDebt: 250_000_000,
  tariffPerMwh: 85,
  heatTariffPerMwh: 45,
  carbonPricePerTonne: 0,
  // 1995: liberalisation is the mood of the decade, and nothing is subsidised. Everything
  // political that follows is something the player's own system provokes.
  initialRegimeId: 'market_liberal',
  climate: TEMPERATE_CLIMATE,

  nodes: [
    // Load centres.
    { id: 'n_rivermouth', kind: 'city', x: 28, y: 22, name: 'Rivermouth' },
    { id: 'n_ironvale', kind: 'city', x: 12, y: 10, name: 'Ironvale' },
    { id: 'n_northgate', kind: 'city', x: 20, y: 4, name: 'Northgate' },
    { id: 'n_southbay', kind: 'city', x: 26, y: 28, name: 'Southbay' },

    // Generation sites.
    // Spread deliberately. Everything around the capital used to sit within a tile or two of
    // it, which read as a knot on screen and meant the corridors between them were shorter
    // than the station sprites at their ends — nothing the player could point at. Distances
    // here are chosen so every power line has a middle that belongs to the line.
    { id: 'n_blackridge', kind: 'plant', x: 8, y: 14, name: 'Blackridge' },
    { id: 'n_oldharbour', kind: 'plant', x: 28, y: 16, name: 'Old Harbour' },
    { id: 'n_gorge', kind: 'plant', x: 16, y: 3, name: 'Gorge' },
    { id: 'n_eastfield', kind: 'plant', x: 24, y: 18, name: 'Eastfield' },
    { id: 'n_millbrook', kind: 'plant', x: 24, y: 24, name: 'Millbrook' },
    // The two municipal heating plants. Both stand on the edge of the town they heat, because
    // a heat main loses too much to run any further than that.
    { id: 'n_ironworks', kind: 'plant', x: 14, y: 12, name: 'Ironworks' },
    { id: 'n_quayside', kind: 'plant', x: 30, y: 20, name: 'Quayside' },

    // Switching stations.
    { id: 'n_central', kind: 'substation', x: 20, y: 15, name: 'Central' },
    { id: 'n_northsub', kind: 'substation', x: 18, y: 8, name: 'North' },
  ],

  cities: [
    {
      id: 'c_rivermouth',
      nodeId: 'n_rivermouth',
      name: 'Rivermouth',
      population: 900,
      baseDemandMw: 380,
      baseHeatDemandMwth: 190,
    },
    {
      id: 'c_ironvale',
      nodeId: 'n_ironvale',
      name: 'Ironvale',
      population: 400,
      baseDemandMw: 255,
      baseHeatDemandMwth: 130,
    },
    {
      id: 'c_northgate',
      nodeId: 'n_northgate',
      name: 'Northgate',
      population: 180,
      baseDemandMw: 100,
      baseHeatDemandMwth: 95,
    },
    {
      id: 'c_southbay',
      nodeId: 'n_southbay',
      name: 'Southbay',
      population: 140,
      baseDemandMw: 75,
      baseHeatDemandMwth: 60,
    },
  ],

  plants: [
    // The lignite pair: cheap fuel, inflexible, dirty, and stuck behind a corridor.
    { id: 'p_blackridge1', nodeId: 'n_blackridge', typeId: 'lignite', name: 'Blackridge I', ageYears: 34 },
    { id: 'p_blackridge2', nodeId: 'n_blackridge', typeId: 'lignite', name: 'Blackridge II', ageYears: 28 },
    // Nearly finished: 41 years into a 45-year design life.
    { id: 'p_oldharbour', nodeId: 'n_oldharbour', typeId: 'coal', name: 'Old Harbour', ageYears: 41 },
    // Ancient but nearly immortal, and the cheapest thing on the system.
    { id: 'p_gorge', nodeId: 'n_gorge', typeId: 'hydro', name: 'Gorge', ageYears: 58 },
    // The one modern asset.
    { id: 'p_eastfield', nodeId: 'n_eastfield', typeId: 'ccgt', name: 'Eastfield', ageYears: 12 },
    // Expensive to run, but right next to the load.
    { id: 'p_millbrook', nodeId: 'n_millbrook', typeId: 'ocgt', name: 'Millbrook', ageYears: 18 },

    // The inherited district heating. Ironworks is the awkward one: a backpressure coal set,
    // so on the coldest evenings of the year it is 110 MW the dispatch cannot refuse — and in
    // April it is nearly idle no matter what the electricity is worth. Quayside is a modern
    // extraction unit that keeps its choice, which is exactly the contrast worth having on one
    // map. Both are old enough that the player will have to decide what replaces them.
    { id: 'p_ironworks', nodeId: 'n_ironworks', typeId: 'coal_chp', name: 'Ironworks', ageYears: 31 },
    { id: 'p_quayside', nodeId: 'n_quayside', typeId: 'gas_chp', name: 'Quayside', ageYears: 9 },
    // The peak boilers nobody thinks about until February. A cogeneration unit is sized for the
    // load it can run on economically all winter, never for the coldest hundred hours — those
    // are covered by boilers that cost a tenth as much per kilowatt and stand idle most of the
    // year. Every real heat network is built this way, and a player who retires them to save
    // the fixed cost will find out why in the first hard frost.
    { id: 'p_quayside_boiler_a', nodeId: 'n_quayside', typeId: 'heat_boiler', name: 'Quayside Boiler A', ageYears: 14 },
    { id: 'p_quayside_boiler_b', nodeId: 'n_quayside', typeId: 'heat_boiler', name: 'Quayside Boiler B', ageYears: 14 },
    { id: 'p_quayside_boiler_c', nodeId: 'n_quayside', typeId: 'heat_boiler', name: 'Quayside Boiler C', ageYears: 19 },
    { id: 'p_ironworks_boiler_a', nodeId: 'n_ironworks', typeId: 'heat_boiler', name: 'Ironworks Boiler A', ageYears: 22 },
    { id: 'p_ironworks_boiler_b', nodeId: 'n_ironworks', typeId: 'heat_boiler', name: 'Ironworks Boiler B', ageYears: 22 },
  ],

  lines: [
    // The western corridor. Two circuits, and still not enough for 1200 MW of lignite — and the
    // conductors went up in the late fifties, which is the other half of the same problem.
    { ageYears: 38, id: 'l_blackridge_central', from: 'n_blackridge', to: 'n_central', kv: 220, circuits: 2 },
    { ageYears: 44, id: 'l_blackridge_ironvale', from: 'n_blackridge', to: 'n_ironvale', kv: 110, circuits: 1 },

    // Central spine.
    { ageYears: 30, id: 'l_central_rivermouth', from: 'n_central', to: 'n_rivermouth', kv: 220, circuits: 2 },
    { ageYears: 35, id: 'l_central_north', from: 'n_central', to: 'n_northsub', kv: 220, circuits: 1 },
    { ageYears: 33, id: 'l_central_ironvale', from: 'n_central', to: 'n_ironvale', kv: 220, circuits: 1 },

    // The north, thin and remote.
    { ageYears: 41, id: 'l_north_northgate', from: 'n_northsub', to: 'n_northgate', kv: 110, circuits: 2 },
    { ageYears: 47, id: 'l_north_gorge', from: 'n_northsub', to: 'n_gorge', kv: 110, circuits: 1 },

    // Around the capital.
    { ageYears: 22, id: 'l_eastfield_rivermouth', from: 'n_eastfield', to: 'n_rivermouth', kv: 220, circuits: 1 },
    { ageYears: 45, id: 'l_oldharbour_rivermouth', from: 'n_oldharbour', to: 'n_rivermouth', kv: 220, circuits: 1 },
    { ageYears: 36, id: 'l_millbrook_rivermouth', from: 'n_millbrook', to: 'n_rivermouth', kv: 110, circuits: 1 },
    { ageYears: 39, id: 'l_quayside_rivermouth', from: 'n_quayside', to: 'n_rivermouth', kv: 110, circuits: 1 },
    { ageYears: 43, id: 'l_ironworks_ironvale', from: 'n_ironworks', to: 'n_ironvale', kv: 110, circuits: 1 },
    { ageYears: 34, id: 'l_rivermouth_southbay', from: 'n_rivermouth', to: 'n_southbay', kv: 110, circuits: 2 },
  ],

  // Short and fat, as every real heat main is: Ironworks is one tile from Ironvale, Quayside
  // two from Rivermouth. Anything longer would lose more to the ground than it delivered.
  heatPipes: [
    { id: 'h_ironworks_ironvale', from: 'n_ironworks', to: 'n_ironvale', dn: 700, pipes: 1 },
    { id: 'h_quayside_rivermouth', from: 'n_quayside', to: 'n_rivermouth', dn: 700, pipes: 1 },
  ],

  feedInTariffs: {},

  // Thirty years: long enough that the inherited fleet must be replaced rather than nursed,
  // and long enough for seven or eight governments to have their turn at the player.
  endYear: 2025,

  objectives: [
    {
      id: 'keep-lights-on',
      descriptionKey: 'objective.keepLightsOn',
      condition: { kind: 'unservedShareBelow', threshold: 0.001 },
      timing: 'continuous',
      required: true,
      // One bad year is survivable, two is not. Measured, the limit is breached in this
      // scenario's *third* year by two forced outages coinciding in a peak hour, with a healthy
      // fleet and a 69% reserve margin. A brief that a coin toss can end is not a hard brief.
      breachTolerance: 1,
    },
    {
      id: 'keep-the-heat-on',
      descriptionKey: 'objective.keepTheHeatOn',
      // Not required, and deliberately so. The inherited heat system has a real weakness — a
      // cogeneration unit tripping during a hard frost leaves a gap the boilers cannot quite
      // cover — so demanding perfection would make the scenario turn on a coincidence rather
      // than on a decision. It is the objective that separates a good run from a clean one.
      condition: { kind: 'noUnservedHeat' },
      timing: 'continuous',
      required: false,
    },
    {
      id: 'stay-solvent',
      descriptionKey: 'objective.staySolvent',
      condition: { kind: 'neverBankrupt' },
      timing: 'continuous',
      required: true,
    },
    {
      id: 'replace-old-harbour',
      descriptionKey: 'objective.replaceOldHarbour',
      // Forty-one years into a forty-five-year life when the scenario opens. Retiring it is the
      // one decision the whole starting position is built around.
      condition: { kind: 'plantRetired', plantId: 'p_oldharbour' },
      timing: 'atEnd',
      required: true,
    },
    {
      id: 'keep-the-capacity',
      descriptionKey: 'objective.keepTheCapacity',
      // Retiring Old Harbour without replacing it would satisfy the objective above and leave
      // the region short. This is what stops that being a strategy.
      condition: { kind: 'capacityAtLeast', mw: 2200 },
      timing: 'atEnd',
      required: true,
    },
    {
      id: 'cleaner-than-inherited',
      descriptionKey: 'objective.cleanerThanInherited',
      // The inherited fleet runs at roughly 0.9 t/MWh. This asks for a real improvement without
      // naming a technology that must deliver it — any route to the number counts.
      condition: { kind: 'carbonIntensityBelow', tPerMwh: 0.6 },
      timing: 'atEnd',
      required: false,
    },
  ],
}
