/**
 * Construction and retirement.
 *
 * Everything the player can actually *do* goes through here, and every command follows the
 * same shape: a quote you can show before committing, a validity check that explains itself,
 * and a commit that mutates the world. Keeping the quote and the commit next to each other is
 * what stops the price in the build menu from drifting away from the price actually charged.
 *
 * Capital is spent over the construction period rather than up front. That is how projects
 * are really financed, and it turns a long build into a sustained commitment the player has
 * to plan around instead of a single moment of pain.
 */

import { LINE_TYPES, type VoltageLevel } from '@content/lineTypes'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '../core/time'
import { LifecyclePhase, type PlantAsset } from '../assets/types'
import { lifeFraction } from '../assets/aging'
import { PLAYER, tileDistance, type GridEdge, type GridNode, type NodeId } from '../grid/network'
import { judgeSite } from './siting'
import { routeLine, simplifyRoute } from '../grid/routing'
import { Param } from '../params/types'
import { canAfford } from '../economy/economy'
import type { World } from '../world'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

/**
 * How far through its life a plant must be before an overhaul is worth doing.
 *
 * The industry calls this a mid-life refurbishment for a reason: done much earlier, the
 * parts being replaced still have most of their service left, so the money buys very little.
 */
const REFURBISH_EARLIEST_LIFE_FRACTION = 0.45

/** A costed, checked proposal. `reasonKey` explains a refusal in the player's language. */
export interface Quote {
  ok: boolean
  totalCost: number
  buildTicks: number
  reasonKey?: string
  reasonParams?: Record<string, string | number>
  /** How well the ground suits this technology, 0..1. Only meaningful when `ok`. */
  siteQuality?: number
  /** Route length for a line quote, following the corridor rather than the straight line. */
  lengthKm?: number
  /** The corridor itself, as tile corners. */
  route?: Array<{ x: number; y: number }>
}

/** Synthetic parameter target used to price a plant that does not exist yet. */
export function quoteTargetFor(typeId: PlantTypeId): string {
  return `quote:${typeId}`
}

function refuse(reasonKey: string, reasonParams?: Record<string, string | number>): Quote {
  const q: Quote = { ok: false, totalCost: 0, buildTicks: 0, reasonKey }
  if (reasonParams) q.reasonParams = reasonParams
  return q
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

/** What a new plant of this type would cost and how long it would take. */
export function quotePlant(world: World, typeId: PlantTypeId, x: number, y: number): Quote {
  const type = PLANT_TYPES[typeId]
  const year = world.date.year

  if (year < type.availableFromYear.value) {
    return refuse('build.notYetAvailable', { year: type.availableFromYear.value })
  }
  // What this particular technology needs from the ground, which is not the same for a solar
  // farm, a nuclear station and a run-of-river turbine. Checked before the spacing rule so
  // that the physical reason is the one reported when both apply.
  const verdict = judgeSite(typeId, {
    terrain: world.terrain,
    network: world.network,
    cities: world.cities,
    x,
    y,
  })
  if (!verdict.ok) return refuse(verdict.reasonKey ?? 'build.unsuitableGround', verdict.reasonParams)

  if (world.nodeNear(x, y, 1.5)) {
    return refuse('build.tooClose')
  }

  const target = quoteTargetFor(typeId)
  const capacityMw = world.params.get(target, Param.CapacityMw)
  const capexPerKw = world.params.get(target, Param.CapexPerKw)
  const buildMonths = world.params.get(target, Param.BuildTimeMonths)

  const totalCost = capexPerKw * capacityMw * 1000
  const buildTicks = Math.max(1, Math.round(buildMonths * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) {
    return refuse('build.cannotAfford')
  }
  return { ok: true, totalCost, buildTicks, siteQuality: verdict.quality }
}

/**
 * Start building a plant on empty ground. Creates its site node too, so the player places a
 * station rather than first placing a node and then a station on it.
 */
export function beginPlantConstruction(
  world: World,
  typeId: PlantTypeId,
  x: number,
  y: number,
): { ok: boolean; plantId?: string; quote: Quote } {
  const quote = quotePlant(world, typeId, x, y)
  if (!quote.ok) return { ok: false, quote }

  const type = PLANT_TYPES[typeId]
  const serial = world.nextSerial()
  const nodeId = `n_built_${serial}`
  const plantId = `p_built_${serial}`

  const node: GridNode = {
    id: nodeId,
    kind: 'plant',
    ownerId: PLAYER,
    x,
    y,
    nameKey: type.nameKey,
    nameIndex: serial,
  }
  world.network.addNode(node)

  const plant: PlantAsset = {
    id: plantId,
    ownerId: PLAYER,
    typeId,
    nodeId,
    phase: LifecyclePhase.Building,
    phaseEndsTick: world.tick + quote.buildTicks,
    // Set on commissioning; until then the plant has no age.
    commissionedTick: world.tick + quote.buildTicks,
    conditionPct: 1,
    cumulativeRunHours: 0,
    cumulativeStarts: 0,
    outputMw: 0,
    storageMwh: 0,
    cyclesUsed: 0,
    online: false,
    capexPaid: 0,
    refurbishments: 0,
    lifeExtension: 0,
    efficiencyUplift: 0,
    capacityUplift: 0,
  }
  world.addPlant(plant)
  world.scheduleSpending(plantId, quote.totalCost, quote.buildTicks, 'capex')

  return { ok: true, plantId, quote }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** What a line between two existing nodes would cost. */
export function quoteLine(world: World, fromId: NodeId, toId: NodeId, kv: VoltageLevel, circuits = 1): Quote {
  if (fromId === toId) return refuse('build.sameNode')
  const from = world.network.getNode(fromId)
  const to = world.network.getNode(toId)
  if (!from || !to) return refuse('build.noSuchNode')

  const duplicate = world.network
    .edgesOf(fromId)
    .map((id) => world.network.requireEdge(id))
    .some((e) => (e.from === toId || e.to === toId) && e.kv === kv)
  if (duplicate) return refuse('build.alreadyConnected')

  // The line follows the cheapest corridor it can find rather than the straight line, so
  // going around a ridge is a real option rather than an imaginary one.
  const route = routeLine(world.terrain, from.x, from.y, to.x, to.y)
  const type = LINE_TYPES[kv]
  const lengthKm = route.lengthTiles * world.scenario.kmPerTile
  const weightedKm = route.weightedLengthTiles * world.scenario.kmPerTile

  const totalCost = type.capexPerKm.value * weightedKm * circuits + type.substationCapex.value * 2
  const buildMonths = (type.buildTimeMonthsPer100Km.value * lengthKm) / 100
  const buildTicks = Math.max(1, Math.round(Math.max(3, buildMonths) * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks, lengthKm, route: simplifyRoute(route) }
}

/**
 * Start building a line. It is created de-energised, so it carries nothing and does not join
 * two islands until it is finished — which is the whole point of a construction time.
 */
export function beginLineConstruction(
  world: World,
  fromId: NodeId,
  toId: NodeId,
  kv: VoltageLevel,
  circuits = 1,
): { ok: boolean; edgeId?: string; quote: Quote } {
  const quote = quoteLine(world, fromId, toId, kv, circuits)
  if (!quote.ok) return { ok: false, quote }

  const from = world.network.requireNode(fromId)
  const to = world.network.requireNode(toId)
  const edgeId = `l_built_${world.nextSerial()}`

  const edge: GridEdge = {
    id: edgeId,
    commodity: 'electric',
    ownerId: PLAYER,
    from: fromId,
    to: toId,
    kv,
    // The routed length, not the straight line: a line that goes around a mountain really is
    // longer, and it should lose more energy for it.
    lengthKm: quote.lengthKm ?? tileDistance(from, to) * world.scenario.kmPerTile,
    circuits,
    energised: false,
    builtTick: world.tick + quote.buildTicks,
    ...(quote.route ? { route: quote.route } : {}),
  }
  world.network.addEdge(edge)
  world.scheduleSpending(edgeId, quote.totalCost, quote.buildTicks, 'capex')
  world.scheduleEnergising(edgeId, world.tick + quote.buildTicks)

  return { ok: true, edgeId, quote }
}

// ---------------------------------------------------------------------------
// Retirement
// ---------------------------------------------------------------------------

export function quoteRetirement(world: World, plantId: string): Quote {
  const plant = world.getPlant(plantId)
  if (!plant) return refuse('build.noSuchPlant')
  if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) {
    return refuse('build.notRetirable')
  }

  const type = PLANT_TYPES[plant.typeId]
  const capacityMw = world.params.get(plant.id, Param.CapacityMw)
  const totalCost = type.decommissionCostPerKw.value * capacityMw * 1000
  const buildTicks = Math.max(1, Math.round(type.decommissionYears.value * TICKS_PER_YEAR))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks }
}

/**
 * Retire a plant. Dismantling costs money and takes years, and the site stays occupied
 * through remediation afterwards — a coal station does not become a green field the moment
 * you stop burning coal in it.
 */
export function retirePlant(world: World, plantId: string): { ok: boolean; quote: Quote } {
  const quote = quoteRetirement(world, plantId)
  if (!quote.ok) return { ok: false, quote }

  const plant = world.getPlant(plantId)!
  plant.phase = LifecyclePhase.Decommissioning
  plant.phaseEndsTick = world.tick + quote.buildTicks
  plant.online = false
  plant.outputMw = 0
  world.scheduleSpending(plantId, quote.totalCost, quote.buildTicks, 'decommissioning')

  return { ok: true, quote }
}

// ---------------------------------------------------------------------------
// Refurbishment
// ---------------------------------------------------------------------------

/**
 * What a mid-life overhaul would cost and buy.
 *
 * Refurbishment is the third answer to an ageing plant, between running it into the ground
 * and demolishing it, and it is the one real operators reach for most often. It restores
 * condition, extends the design life, and — because the technology inside has moved on since
 * the shell was built — usually leaves the machine better than it was new.
 */
export function quoteRefurbishment(world: World, plantId: string): Quote {
  const plant = world.getPlant(plantId)
  if (!plant) return refuse('build.noSuchPlant')
  if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) {
    return refuse('build.notRefurbishable')
  }

  const type = PLANT_TYPES[plant.typeId]

  // There is no point overhauling something nearly new, and each further overhaul buys less.
  const life = lifeFraction(plant, world.tick)
  if (life < REFURBISH_EARLIEST_LIFE_FRACTION) return refuse('build.tooNewToRefurbish')
  if (plant.refurbishments >= 2) return refuse('build.alreadyRebuilt')

  const capacityMw = world.params.get(plant.id, Param.CapacityMw)
  const capexPerKw = world.params.get(plant.id, Param.CapexPerKw)
  // Diminishing returns: a second overhaul costs more and delivers less.
  const escalation = 1 + plant.refurbishments * 0.35
  const totalCost = type.refurbishCostFraction.value * escalation * capexPerKw * capacityMw * 1000
  const buildTicks = Math.max(1, Math.round(type.refurbishMonths.value * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks }
}

/** Begin an overhaul. The plant is out of service for the duration, which is the real cost. */
export function refurbishPlant(world: World, plantId: string): { ok: boolean; quote: Quote } {
  const quote = quoteRefurbishment(world, plantId)
  if (!quote.ok) return { ok: false, quote }

  const plant = world.getPlant(plantId)!
  plant.phase = LifecyclePhase.Refurbishing
  plant.phaseEndsTick = world.tick + quote.buildTicks
  plant.online = false
  plant.outputMw = 0
  world.scheduleSpending(plantId, quote.totalCost, quote.buildTicks, 'capex')

  return { ok: true, quote }
}

/** What an overhaul would gain, for the build panel to show before the player commits. */
export function refurbishmentGains(world: World, plantId: string): {
  lifeYears: number
  efficiencyPct: number
  capacityMw: number
} | null {
  const plant = world.getPlant(plantId)
  if (!plant) return null
  const type = PLANT_TYPES[plant.typeId]
  const escalation = 1 / (1 + plant.refurbishments * 0.5)
  return {
    lifeYears: type.designLifeYears.value * type.refurbishLifeExtension.value * escalation,
    efficiencyPct: type.refurbishEfficiencyGain.value * escalation,
    capacityMw: world.params.get(plant.id, Param.CapacityMw) * type.refurbishCapacityGain.value * escalation,
  }
}

/** Mothball a plant: it stops running and costs less, but can be brought back. */
export function mothballPlant(world: World, plantId: string): boolean {
  const plant = world.getPlant(plantId)
  if (!plant || plant.phase !== LifecyclePhase.Operating) return false
  plant.phase = LifecyclePhase.Mothballed
  plant.online = false
  plant.outputMw = 0
  return true
}

export function reactivatePlant(world: World, plantId: string): boolean {
  const plant = world.getPlant(plantId)
  if (!plant || plant.phase !== LifecyclePhase.Mothballed) return false
  plant.phase = LifecyclePhase.Operating
  plant.online = true
  return true
}
