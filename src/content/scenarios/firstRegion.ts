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

export interface NodeSpec {
  id: string
  kind: 'plant' | 'city' | 'substation'
  x: number
  y: number
  name?: string
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
  carbonPricePerTonne: number
  climate: typeof TEMPERATE_CLIMATE
  nodes: NodeSpec[]
  cities: CitySpec[]
  plants: PlantSpec[]
  lines: LineSpec[]
  objectives: Array<{ id: string; descriptionKey: string }>
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
  carbonPricePerTonne: 0,
  climate: TEMPERATE_CLIMATE,

  nodes: [
    // Load centres.
    { id: 'n_rivermouth', kind: 'city', x: 28, y: 22, name: 'Rivermouth' },
    { id: 'n_ironvale', kind: 'city', x: 12, y: 10, name: 'Ironvale' },
    { id: 'n_northgate', kind: 'city', x: 20, y: 4, name: 'Northgate' },
    { id: 'n_southbay', kind: 'city', x: 33, y: 27, name: 'Southbay' },

    // Generation sites.
    { id: 'n_blackridge', kind: 'plant', x: 8, y: 14, name: 'Blackridge' },
    { id: 'n_oldharbour', kind: 'plant', x: 30, y: 25, name: 'Old Harbour' },
    { id: 'n_gorge', kind: 'plant', x: 16, y: 3, name: 'Gorge' },
    { id: 'n_eastfield', kind: 'plant', x: 24, y: 18, name: 'Eastfield' },
    { id: 'n_millbrook', kind: 'plant', x: 27, y: 21, name: 'Millbrook' },

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
      baseHeatDemandMwth: 320,
    },
    {
      id: 'c_ironvale',
      nodeId: 'n_ironvale',
      name: 'Ironvale',
      population: 400,
      baseDemandMw: 255,
      baseHeatDemandMwth: 190,
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
  ],

  lines: [
    // The western corridor. Two circuits, and still not enough for 1200 MW of lignite.
    { id: 'l_blackridge_central', from: 'n_blackridge', to: 'n_central', kv: 220, circuits: 2 },
    { id: 'l_blackridge_ironvale', from: 'n_blackridge', to: 'n_ironvale', kv: 110, circuits: 1 },

    // Central spine.
    { id: 'l_central_rivermouth', from: 'n_central', to: 'n_rivermouth', kv: 220, circuits: 2 },
    { id: 'l_central_north', from: 'n_central', to: 'n_northsub', kv: 220, circuits: 1 },
    { id: 'l_central_ironvale', from: 'n_central', to: 'n_ironvale', kv: 220, circuits: 1 },

    // The north, thin and remote.
    { id: 'l_north_northgate', from: 'n_northsub', to: 'n_northgate', kv: 110, circuits: 2 },
    { id: 'l_north_gorge', from: 'n_northsub', to: 'n_gorge', kv: 110, circuits: 1 },

    // Around the capital.
    { id: 'l_eastfield_rivermouth', from: 'n_eastfield', to: 'n_rivermouth', kv: 220, circuits: 1 },
    { id: 'l_oldharbour_rivermouth', from: 'n_oldharbour', to: 'n_rivermouth', kv: 220, circuits: 1 },
    { id: 'l_millbrook_rivermouth', from: 'n_millbrook', to: 'n_rivermouth', kv: 110, circuits: 1 },
    { id: 'l_rivermouth_southbay', from: 'n_rivermouth', to: 'n_southbay', kv: 110, circuits: 2 },
  ],

  objectives: [
    { id: 'keep-lights-on', descriptionKey: 'objective.keepLightsOn' },
    { id: 'stay-solvent', descriptionKey: 'objective.staySolvent' },
    { id: 'replace-old-harbour', descriptionKey: 'objective.replaceOldHarbour' },
  ],
}
