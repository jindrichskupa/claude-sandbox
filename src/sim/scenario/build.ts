/**
 * Turning scenario data into a live world.
 *
 * The interesting part is that inherited plants get a *negative* commissioning tick. Age is
 * then simply `tick - commissionedTick`, with no special case anywhere in the ageing code
 * for "was here when the scenario started". A plant built in year 30 of a campaign and a
 * plant inherited on day one are the same kind of object, differing only in a number.
 */

import type { ScenarioContent } from '@content/scenarios/firstRegion'
import { PLANT_TYPES } from '@content/plantTypes'
import { TICKS_PER_YEAR } from '../core/time'
import { PLAYER, tileDistance, type GridEdge, type GridNode } from '../grid/network'
import { LifecyclePhase, type CityAsset, type PlantAsset } from '../assets/types'
import { expectedCondition } from '../assets/aging'
import { World, type ScenarioDef } from '../world'

export function toScenarioDef(content: ScenarioContent): ScenarioDef {
  return {
    id: content.id,
    nameKey: content.nameKey,
    startYear: content.startYear,
    seed: content.seed,
    mapWidth: content.mapWidth,
    mapHeight: content.mapHeight,
    kmPerTile: content.kmPerTile,
    climate: content.climate,
    startingCash: content.startingCash,
    startingDebt: content.startingDebt,
    tariffPerMwh: content.tariffPerMwh,
    carbonPricePerTonne: content.carbonPricePerTonne,
    objectives: content.objectives,
  }
}

export function buildWorld(content: ScenarioContent): World {
  const world = new World(toScenarioDef(content))

  for (const spec of content.nodes) {
    const node: GridNode = {
      id: spec.id,
      kind: spec.kind,
      ownerId: PLAYER,
      x: spec.x,
      y: spec.y,
    }
    if (spec.name) node.name = spec.name
    world.network.addNode(node)
  }

  for (const spec of content.lines) {
    const from = world.network.requireNode(spec.from)
    const to = world.network.requireNode(spec.to)
    const edge: GridEdge = {
      id: spec.id,
      commodity: 'electric',
      ownerId: PLAYER,
      from: spec.from,
      to: spec.to,
      kv: spec.kv,
      lengthKm: tileDistance(from, to) * content.kmPerTile,
      circuits: spec.circuits,
      energised: true,
      builtTick: -1,
    }
    world.network.addEdge(edge)
  }

  for (const spec of content.cities) {
    const city: CityAsset = {
      id: spec.id,
      nodeId: spec.nodeId,
      name: spec.name,
      population: spec.population,
      baseDemandMw: spec.baseDemandMw,
      baseHeatDemandMwth: spec.baseHeatDemandMwth,
      satisfaction: 0.8,
      unservedTicksRecent: 0,
    }
    world.addCity(city)
  }

  for (const spec of content.plants) {
    const type = PLANT_TYPES[spec.typeId]
    const commissionedTick = -Math.round(spec.ageYears * TICKS_PER_YEAR)
    const plant: PlantAsset = {
      id: spec.id,
      ownerId: PLAYER,
      typeId: spec.typeId,
      nodeId: spec.nodeId,
      phase: LifecyclePhase.Operating,
      phaseEndsTick: Number.MAX_SAFE_INTEGER,
      commissionedTick,
      conditionPct: 1,
      cumulativeRunHours: Math.round(spec.ageYears * TICKS_PER_YEAR * 0.6),
      cumulativeStarts: Math.round(spec.ageYears * 30),
      outputMw: 0,
      storageMwh: 0,
      online: true,
      capexPaid: type.capexPerKw.value * type.capacityMw.value * 1000,
    }
    // Start on the ageing curve rather than pristine — these units have a history.
    plant.conditionPct = expectedCondition(plant, 0)
    world.addPlant(plant)
  }

  // An inherited utility arrives with a trading history, and its bank knows it. Without
  // this the borrowing limit would be zero on day one and the player could not fund the
  // replacement the scenario is built around — a starting position that forbids the only
  // sensible move is a broken one, not a hard one.
  let annualDemandMwh = 0
  for (const spec of content.cities) annualDemandMwh += spec.baseDemandMw * TICKS_PER_YEAR
  world.finances.trailingRevenue = annualDemandMwh * content.tariffPerMwh

  // Prime the modifier layers and the first weather sample so tick 0 is already coherent.
  world.params.setTick(0)
  return world
}

/** Human-readable name of a plant, from the scenario data. */
export function plantDisplayNames(content: ScenarioContent): Map<string, string> {
  return new Map(content.plants.map((p) => [p.id, p.name]))
}
