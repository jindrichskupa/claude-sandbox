/**
 * Turning scenario data into a live world.
 *
 * The interesting part is that inherited plants get a *negative* commissioning tick. Age is
 * then simply `tick - commissionedTick`, with no special case anywhere in the ageing code
 * for "was here when the scenario started". A plant built in year 30 of a campaign and a
 * plant inherited on day one are the same kind of object, differing only in a number.
 */

import type { ScenarioContent } from '@content/scenarios/types'
import { PLANT_TYPES } from '@content/plantTypes'
import { TICKS_PER_YEAR } from '../core/time'
import type { VoltageLevel } from '@content/lineTypes'
import { PLAYER, type GridEdge, type GridNode } from '../grid/network'
import { routeLine, simplifyRoute } from '../grid/routing'
import { LifecyclePhase, type CityAsset, type PlantAsset } from '../assets/types'
import { expectedCondition } from '../assets/aging'
import { expectedLineCondition } from '../grid/aging'
import { designLifeFactor } from '../tech/costs'
import { World, type ScenarioDef } from '../world'
import type { SaveData } from './save'

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
    heatTariffPerMwh: content.heatTariffPerMwh,
    carbonPricePerTonne: content.carbonPricePerTonne,
    initialRegimeId: content.initialRegimeId,
    objectives: content.objectives,
    endYear: content.endYear,
    feedInTariffs: content.feedInTariffs ?? {},
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
    if (spec.kvLevels) node.kvLevels = [...spec.kvLevels]
    world.network.addNode(node)
  }

  for (const spec of content.lines) {
    const from = world.network.requireNode(spec.from)
    const to = world.network.requireNode(spec.to)
    // Inherited lines were routed by somebody too, so they follow corridors like any other.
    const route = routeLine(world.terrain, from.x, from.y, to.x, to.y)
    const edge: GridEdge = {
      id: spec.id,
      commodity: 'electric',
      ownerId: PLAYER,
      from: spec.from,
      to: spec.to,
      kv: spec.kv,
      lengthKm: route.lengthTiles * content.kmPerTile,
      circuits: spec.circuits,
      energised: true,
      // Negative, exactly as an inherited plant's commissioning tick is: the corridor was strung
      // decades before the scenario opens, and a brownfield start whose network was built
      // yesterday is not a brownfield start.
      builtTick: -Math.round(spec.ageYears * TICKS_PER_YEAR),
      conditionPct: expectedLineCondition(
        { kv: spec.kv, builtTick: -Math.round(spec.ageYears * TICKS_PER_YEAR) } as GridEdge,
        0,
      ),
      route: simplifyRoute(route),
    }
    world.network.addEdge(edge)
  }

  // What the inherited switching stations are built for, read off the lines hanging on them
  // rather than written down twice. Two reasons to derive it: the scenario cannot then contradict
  // its own map, and the northern station is genuinely a transformer station — 220 kV in from the
  // centre, 110 kV out to Northgate and the Gorge — which a hand-written single level would have
  // described wrongly. A station the scenario gave an explicit list keeps it.
  //
  // The inherited stations have to be constrained for the same reason the player's are. Leaving
  // them unlimited while limiting the ones the player pays for would make building your own
  // station a penalty, which is backwards.
  for (const node of world.network.allNodes()) {
    if (node.kind !== 'substation' || node.kvLevels) continue
    const levels = new Set<VoltageLevel>()
    for (const edgeId of world.network.edgesOf(node.id)) {
      const edge = world.network.requireEdge(edgeId)
      if (edge.commodity === 'electric' && edge.kv !== 0) levels.add(edge.kv)
    }
    if (levels.size) node.kvLevels = [...levels].sort((a, b) => a - b)
  }

  // Heat mains. Same graph as the power lines, and routed the same way — a buried pipe follows
  // the ground just as an overhead line does, and rather more expensively.
  for (const spec of content.heatPipes) {
    const from = world.network.requireNode(spec.from)
    const to = world.network.requireNode(spec.to)
    const route = routeLine(world.terrain, from.x, from.y, to.x, to.y)
    world.network.addEdge({
      id: spec.id,
      commodity: 'heat',
      ownerId: PLAYER,
      from: spec.from,
      to: spec.to,
      kv: 0,
      dn: spec.dn,
      lengthKm: route.lengthTiles * content.kmPerTile,
      circuits: spec.pipes,
      energised: true,
      builtTick: -1,
      // Heat mains have no ageing model of their own yet — see the network milestone, which did
      // the electric side. A buried pipe wears differently enough that guessing at it here would
      // be worse than leaving it out.
      conditionPct: 1,
      route: simplifyRoute(route),
    })
  }

  for (const spec of content.cities) {
    const city: CityAsset = {
      id: spec.id,
      nodeId: spec.nodeId,
      name: spec.name,
      population: spec.population,
      startingPopulation: spec.population,
      rooftopSolarMw: 0,
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
      // The author named these — Blackridge I and Blackridge II are two machines on one site —
      // and until the plant had a name field of its own the pair of names went nowhere. Both
      // units answered to the site's name and the inspector printed the raw id.
      name: spec.name,
      phase: LifecyclePhase.Operating,
      phaseEndsTick: Number.MAX_SAFE_INTEGER,
      commissionedTick,
      // What a machine of this vintage was built to last. An inherited unit from the 1960s does
      // not get the design life the same technology reaches today.
      designLifeYears:
        type.designLifeYears.value *
        designLifeFactor(spec.typeId, content.startYear - spec.ageYears, type.designLifeYears.sourceYear),
      conditionPct: 1,
      cumulativeRunHours: Math.round(spec.ageYears * TICKS_PER_YEAR * 0.6),
      cumulativeStarts: Math.round(spec.ageYears * 30),
      outputMw: 0,
      heatOutputMw: 0,
      storageMwh: 0,
      heatStoredMwhth: 0,
      cyclesUsed: 0,
      online: true,
      capexPaid: type.capexPerKw.value * type.capacityMw.value * 1000,
      refurbishments: 0,
      lifeExtension: 0,
      efficiencyUplift: 0,
      capacityUplift: 0,
    }
    // Start on the ageing curve rather than pristine — these units have a history.
    plant.conditionPct = expectedCondition(plant, 0)
    world.addPlant(plant)
  }

  // Support the inherited fleet already enjoys. Written as contracts rather than as a
  // per-technology setting, so a later government can tear them up like any other — which is
  // the whole point of modelling them as promises to individual machines.
  let contractSerial = 0
  for (const spec of content.plants) {
    const price = content.feedInTariffs?.[spec.typeId]
    if (!price) continue
    const commissionedTick = -Math.round(spec.ageYears * TICKS_PER_YEAR)
    world.state.contracts.push({
      id: `c_inherited_${++contractSerial}`,
      plantId: spec.id,
      typeId: spec.typeId,
      pricePerMwh: price,
      grantedTick: commissionedTick,
      startsTick: commissionedTick,
      expiresTick: commissionedTick + Math.round(20 * TICKS_PER_YEAR),
      grantedByRegimeId: content.initialRegimeId,
    })
  }

  // An inherited utility arrives with a trading history, and its bank knows it. Without
  // this the borrowing limit would be zero on day one and the player could not fund the
  // replacement the scenario is built around — a starting position that forbids the only
  // sensible move is a broken one, not a hard one.
  let annualDemandMwh = 0
  for (const spec of content.cities) annualDemandMwh += spec.baseDemandMw * TICKS_PER_YEAR
  world.finances.trailingRevenue = annualDemandMwh * content.tariffPerMwh

  // Prime the modifier layers and the first weather sample so tick 0 is already coherent. The
  // tech layer especially: without it the build menu would quote every technology at its source
  // year's price until the first year rolled over.
  world.applyTechTrends()
  world.params.setTick(0)
  // And judge the objectives once, so the panel opens on a list rather than on nothing. Without
  // this the player would see an empty brief until the first year closed, which is the one point
  // in the game where they most need to know what they have been asked to do.
  world.judgeObjectives()
  return world
}

/**
 * Rebuild a world from a save.
 *
 * Constructs the scenario's world *empty* — no plants, no cities, no lines — and then applies
 * the save over it. That ordering is what makes the map, the weather model and the island
 * caches come out right without being saved: they are built from the scenario's seed, which has
 * not changed, and only the things that genuinely vary are restored on top.
 */
export function loadWorld(content: ScenarioContent, data: SaveData): World {
  const world = new World(toScenarioDef(content))
  world.applySaveData(data)
  return world
}

/** Human-readable name of a plant, from the scenario data. */
export function plantDisplayNames(content: ScenarioContent): Map<string, string> {
  return new Map(content.plants.map((p) => [p.id, p.name]))
}
