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

import { LINE_TYPES, VOLTAGE_LEVELS, type VoltageLevel } from '@content/lineTypes'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { HEAT_PIPE_TYPES, type PipeSize } from '@content/heatPipeTypes'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '../core/time'
import { LifecyclePhase, type PlantAsset } from '../assets/types'
import { lifeFraction } from '../assets/aging'
import { designLifeFactor, realDecommissioningFactor } from '../tech/costs'
import { isWorthRenewing } from '../grid/aging'
import { nominal } from '../tech/money'
import { PLAYER, tileDistance, type GridEdge, type GridNode, type NodeId } from '../grid/network'
import { judgeSite } from './siting'
import { isBuildable } from '../map/terrain'
import { routeLine, simplifyRoute } from '../grid/routing'
import { Param } from '../params/types'
import { canAfford } from '../economy/economy'
import { REGIMES_BY_ID } from '@content/policies'
import { offerContract } from '../policy/contracts'
import type { World } from '../world'
import { NewsImportance } from '../news/news'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

/**
 * How far through its life a plant must be before an overhaul is worth doing.
 *
 * The industry calls this a mid-life refurbishment for a reason: done much earlier, the
 * parts being replaced still have most of their service left, so the money buys very little.
 */
const REFURBISH_EARLIEST_LIFE_FRACTION = 0.45

/**
 * What a second circuit costs, as a fraction of a first one's conductor cost.
 *
 * The land, the consents, the access and the towers are already bought. What is left is
 * conductor, fittings and the crews to string them.
 */
const SECOND_CIRCUIT_COST_FRACTION = 0.45

/** Towers are built for two circuits. A third would be a new corridor, not an upgrade. */
const MAX_CIRCUITS = 2

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
  // A ban is a state of the world, not a price: it refuses outright. The reason names the
  // government rather than the technology, because "this one will not permit it" is what tells
  // the player the next one might.
  const regime = REGIMES_BY_ID.get(world.state.policyRegimeId)
  if (regime?.levers.bans.includes(typeId)) return refuse('build.bannedByPolicy')
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
    // The vintage is the year it enters service, not the year it was ordered — which is the
    // right way round, and occasionally worth a year of extra design life on a long build.
    designLifeYears:
      type.designLifeYears.value *
      designLifeFactor(
        typeId,
        world.scenario.startYear + (world.tick + quote.buildTicks) / TICKS_PER_YEAR,
        type.designLifeYears.sourceYear,
      ),
    conditionPct: 1,
    cumulativeRunHours: 0,
    cumulativeStarts: 0,
    outputMw: 0,
    heatOutputMw: 0,
    storageMwh: 0,
    heatStoredMwhth: 0,
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

  // The promise is made now, at the investment decision, and runs from the day the plant enters
  // service. That gap — one construction time and possibly one election — is the whole risk
  // profile of building anything in this industry.
  const contract = offerContract(
    world.state.policyRegimeId,
    plantId,
    typeId,
    world.tick,
    world.tick + quote.buildTicks,
    world.nextSerial(),
  )
  if (contract) world.state.contracts.push(contract)

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

// ---------------------------------------------------------------------------
// Substations
// ---------------------------------------------------------------------------

/**
 * What a switching station on empty ground would cost.
 *
 * Until this existed, a line could only ever join two nodes that were already on the map, so the
 * player could connect what the scenario had given them and nothing else — no new junction, no
 * way to split a long corridor, no hub. That is most of what building a grid *is*, and it was
 * missing while the scenario itself contained two substations the player could only look at.
 *
 * The price is the station: the site, the busbar, the switchgear. Each line into it still pays
 * for its own bays at both ends, as it always has, so nothing is charged twice.
 */
export function quoteSubstation(world: World, kv: VoltageLevel, x: number, y: number): Quote {
  if (!isBuildable(world.terrain, x, y)) return refuse('build.unsuitableGround')
  if (world.nodeNear(x, y, 1.5)) return refuse('build.tooClose')

  const type = LINE_TYPES[kv]
  const totalCost = type.substationCapex.value
  const buildTicks = Math.max(1, Math.round(type.substationBuildMonths.value * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks }
}

/**
 * Put a substation on the map.
 *
 * The node appears at once and there is deliberately no half-built state for it, which is worth
 * explaining because every other asset has one. A substation on its own does nothing whatever: it
 * is a place for lines to meet, and the first line to reach it takes years. Giving the node its
 * own energised flag would mean teaching the island decomposition and the flow solver about a
 * third kind of not-yet-real thing, in order to model a delay that the lines already impose.
 */
export function beginSubstationConstruction(
  world: World,
  kv: VoltageLevel,
  x: number,
  y: number,
): { ok: boolean; nodeId?: string; quote: Quote } {
  const quote = quoteSubstation(world, kv, x, y)
  if (!quote.ok) return { ok: false, quote }

  const serial = world.nextSerial()
  const nodeId = `n_sub_${serial}`
  world.network.addNode({
    id: nodeId,
    kind: 'substation',
    ownerId: PLAYER,
    x,
    y,
    nameKey: `line.${kv}`,
    nameIndex: serial,
  })
  world.scheduleSpending(nodeId, quote.totalCost, quote.buildTicks, 'capex')
  world.reportNews({
    category: 'grid',
    importance: NewsImportance.Notable,
    titleKey: 'news.substationBuilt',
    params: { kv },
    subjectId: nodeId,
    subjectKind: 'node',
  })
  return { ok: true, nodeId, quote }
}

/**
 * What a second circuit on an existing line would cost.
 *
 * A corridor is not mostly conductor. The land, the consents, the access roads and the towers
 * are already there and already paid for, so stringing another set of conductors on them buys a
 * second circuit's worth of capacity for a fraction of a second corridor's price — and it is the
 * first thing any real utility does when a route runs short. The substation bays at each end are
 * the part you do pay for in full: they are new switchgear either way.
 *
 * It is also the answer to a question the interface could not previously answer at all. Asking
 * for a second line between the same two points was simply refused, so the only way to reinforce
 * a route was a parallel corridor drawn on top of the first one.
 */
export function quoteLineUpgrade(world: World, edgeId: string): Quote {
  const edge = world.network.getEdge(edgeId)
  if (!edge) return refuse('build.noSuchNode')
  if (edge.commodity !== 'electric' || edge.kv === 0) return refuse('build.notUpgradable')
  if (!edge.energised) return refuse('build.stillBuilding')
  if (edge.upgradeAtTick !== undefined) return refuse('build.alreadyUpgrading')
  if (edge.circuits >= MAX_CIRCUITS) return refuse('build.maxCircuits', { circuits: MAX_CIRCUITS })

  const type = LINE_TYPES[edge.kv]
  const totalCost =
    type.capexPerKm.value * edge.lengthKm * SECOND_CIRCUIT_COST_FRACTION + type.substationCapex.value * 2
  // Quicker than a new corridor for the same reason it is cheaper: no route to consent, no
  // towers to erect, only conductors to string on steel that is already standing.
  const buildMonths = (type.buildTimeMonthsPer100Km.value * edge.lengthKm) / 100
  const buildTicks = Math.max(1, Math.round(Math.max(2, buildMonths * 0.5) * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks, lengthKm: edge.lengthKm }
}

/** Commit to a second circuit. The capacity arrives when the crews are finished, not now. */
export function upgradeLine(world: World, edgeId: string): { ok: boolean; quote: Quote } {
  const quote = quoteLineUpgrade(world, edgeId)
  if (!quote.ok) return { ok: false, quote }
  const edge = world.network.requireEdge(edgeId)
  edge.upgradeAtTick = world.tick + quote.buildTicks
  edge.upgradeToCircuits = edge.circuits + 1
  world.scheduleSpending(edgeId, quote.totalCost, quote.buildTicks, 'capex')
  return { ok: true, quote }
}

/**
 * Re-conductoring: what a line has instead of refurbishment.
 *
 * Towers and foundations outlive several generations of the plant they connect; what wears out is
 * the conductor, the insulators and the fittings. So the renewal is a third of the cost of a new
 * line and the corridor keeps its route, its consents and its steel. Offered from halfway through
 * the design life rather than at the end of it, because renewal is a plan and not a repair — and
 * a game that only offered it once the line was failing would have turned it into one.
 *
 * The line stays in service throughout. Re-conductoring is done circuit by circuit on a live
 * corridor, and taking the whole thing out for a year would be a different and much worse
 * decision than the one being modelled.
 */
export function quoteLineRenewal(world: World, edgeId: string): Quote {
  const edge = world.network.getEdge(edgeId)
  if (!edge) return refuse('build.noSuchNode')
  if (edge.commodity !== 'electric' || edge.kv === 0) return refuse('build.notUpgradable')
  if (!edge.energised) return refuse('build.stillBuilding')
  if (edge.upgradeAtTick !== undefined) return refuse('build.alreadyUpgrading')
  if (!isWorthRenewing(edge, world.tick)) return refuse('build.tooNewToRenew')

  const type = LINE_TYPES[edge.kv]
  const year = world.date.year
  // A line is steel and labour and nothing that learns, so its price only ever goes up — the same
  // arithmetic that makes decommissioning provisions so reliably short.
  const totalCost =
    nominal(type.capexPerKm, year) *
    realDecommissioningFactor(year, type.capexPerKm.sourceYear) *
    edge.lengthKm *
    Math.max(1, edge.circuits) *
    type.refurbishCostFraction.value
  const buildMonths = (type.buildTimeMonthsPer100Km.value * edge.lengthKm) / 100
  const buildTicks = Math.max(1, Math.round(Math.max(2, buildMonths * 0.4) * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks, lengthKm: edge.lengthKm }
}

export function renewLine(world: World, edgeId: string): { ok: boolean; quote: Quote } {
  const quote = quoteLineRenewal(world, edgeId)
  if (!quote.ok) return { ok: false, quote }
  const edge = world.network.requireEdge(edgeId)
  edge.upgradeAtTick = world.tick + quote.buildTicks
  edge.upgradeToCircuits = edge.circuits
  // The clock restarts, which is what re-conductoring buys and why it is not merely a repair.
  edge.upgradeRenewsAge = true
  world.scheduleSpending(edgeId, quote.totalCost, quote.buildTicks, 'capex')
  return { ok: true, quote }
}

/**
 * Rebuilding a corridor at the next voltage up.
 *
 * The decision the scenario's own premise asks for and the game has never offered. A 110 kV line
 * between a load centre and its generation is a corridor whose route, consents and easements
 * already exist — which is the expensive and slow part of any new line — so raising it to 220
 * costs far less than a new corridor and multiplies the capacity more than three times while
 * cutting the losses fourfold at the same flow.
 *
 * Priced as the difference between the two voltages plus the substations at each end, because
 * the substations are what actually has to be replaced: the towers can often be reused or
 * extended, the switchgear cannot.
 */
export function quoteVoltageUpgrade(world: World, edgeId: string): Quote {
  const edge = world.network.getEdge(edgeId)
  if (!edge) return refuse('build.noSuchNode')
  if (edge.commodity !== 'electric' || edge.kv === 0) return refuse('build.notUpgradable')
  if (!edge.energised) return refuse('build.stillBuilding')
  if (edge.upgradeAtTick !== undefined) return refuse('build.alreadyUpgrading')

  const next = nextVoltage(edge.kv)
  if (next === null) return refuse('build.alreadyHighestVoltage')

  const from = LINE_TYPES[edge.kv]
  const to = LINE_TYPES[next]
  const year = world.date.year
  const conductorDelta = Math.max(0, nominal(to.capexPerKm, year) - nominal(from.capexPerKm, year) * 0.4)
  const totalCost =
    (conductorDelta * realDecommissioningFactor(year, to.capexPerKm.sourceYear) * edge.lengthKm) +
    nominal(to.substationCapex, year) * 2
  const buildMonths = (to.buildTimeMonthsPer100Km.value * edge.lengthKm) / 100
  const buildTicks = Math.max(1, Math.round(Math.max(6, buildMonths * 0.7) * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks, lengthKm: edge.lengthKm }
}

export function upgradeVoltage(world: World, edgeId: string): { ok: boolean; quote: Quote } {
  const quote = quoteVoltageUpgrade(world, edgeId)
  if (!quote.ok) return { ok: false, quote }
  const edge = world.network.requireEdge(edgeId)
  const next = nextVoltage(edge.kv as VoltageLevel)
  if (next === null) return { ok: false, quote: refuse('build.alreadyHighestVoltage') }
  edge.upgradeAtTick = world.tick + quote.buildTicks
  edge.upgradeToCircuits = edge.circuits
  edge.upgradeToKv = next
  edge.upgradeRenewsAge = true
  world.scheduleSpending(edgeId, quote.totalCost, quote.buildTicks, 'capex')
  return { ok: true, quote }
}

/** The next voltage level up, or null at the top of the ladder. */
export function nextVoltage(kv: VoltageLevel): VoltageLevel | null {
  const index = VOLTAGE_LEVELS.indexOf(kv)
  return index >= 0 && index + 1 < VOLTAGE_LEVELS.length ? VOLTAGE_LEVELS[index + 1]! : null
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
    conditionPct: 1,
    ...(quote.route ? { route: quote.route } : {}),
  }
  world.network.addEdge(edge)
  world.scheduleSpending(edgeId, quote.totalCost, quote.buildTicks, 'capex')
  world.scheduleEnergising(edgeId, world.tick + quote.buildTicks)

  return { ok: true, edgeId, quote }
}

// ---------------------------------------------------------------------------
// Heat mains
// ---------------------------------------------------------------------------

/**
 * What a district heating main would cost.
 *
 * Deliberately the same shape as `quoteLine`, because a pipe and a power line are the same
 * object in the network — but the numbers behave completely differently, and the player should
 * feel it. A heat main costs two to four times as much per kilometre as an overhead line and
 * loses heat every hour of its life regardless of load, so the length shown in this quote is
 * not a detail. Beyond twenty or thirty kilometres the answer is always to build the plant
 * somewhere else instead.
 */
export function quoteHeatPipe(world: World, fromId: NodeId, toId: NodeId, dn: PipeSize, pipes = 1): Quote {
  if (fromId === toId) return refuse('build.sameNode')
  const from = world.network.getNode(fromId)
  const to = world.network.getNode(toId)
  if (!from || !to) return refuse('build.noSuchNode')

  const duplicate = world.network
    .edgesOf(fromId)
    .map((id) => world.network.requireEdge(id))
    .some((e) => e.commodity === 'heat' && (e.from === toId || e.to === toId))
  if (duplicate) return refuse('build.alreadyConnected')

  const route = routeLine(world.terrain, from.x, from.y, to.x, to.y)
  const type = HEAT_PIPE_TYPES[dn]
  const lengthKm = route.lengthTiles * world.scenario.kmPerTile
  const weightedKm = route.weightedLengthTiles * world.scenario.kmPerTile

  const totalCost = type.capexPerKm.value * weightedKm * pipes
  const buildMonths = (type.buildTimeMonthsPer10Km.value * lengthKm) / 10
  const buildTicks = Math.max(1, Math.round(Math.max(2, buildMonths) * TICKS_PER_MONTH))

  if (!canAfford(world.finances, totalCost)) return refuse('build.cannotAfford')
  return { ok: true, totalCost, buildTicks, lengthKm, route: simplifyRoute(route) }
}

/** Start building a heat main. Like a power line, it carries nothing until it is finished. */
export function beginHeatPipeConstruction(
  world: World,
  fromId: NodeId,
  toId: NodeId,
  dn: PipeSize,
  pipes = 1,
): { ok: boolean; edgeId?: string; quote: Quote } {
  const quote = quoteHeatPipe(world, fromId, toId, dn, pipes)
  if (!quote.ok) return { ok: false, quote }

  const from = world.network.requireNode(fromId)
  const to = world.network.requireNode(toId)
  const edgeId = `h_built_${world.nextSerial()}`

  const edge: GridEdge = {
    id: edgeId,
    commodity: 'heat',
    ownerId: PLAYER,
    from: fromId,
    to: toId,
    kv: 0,
    dn,
    lengthKm: quote.lengthKm ?? tileDistance(from, to) * world.scenario.kmPerTile,
    circuits: pipes,
    energised: false,
    builtTick: world.tick + quote.buildTicks,
    conditionPct: 1,
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
  // Dismantling is half labour and half civil works and nothing else, so it inflates *and*
  // escalates and never learns. This is why decommissioning provisions set decades in advance
  // are so reliably short: the thing being provided for is made entirely of the two components
  // that only ever go up.
  const year = world.date.year
  const source = type.decommissionCostPerKw.sourceYear
  const totalCost =
    nominal(type.decommissionCostPerKw, year) *
    realDecommissioningFactor(year, source) *
    capacityMw *
    1000
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
  world.reportNews({
    category: 'fleet',
    importance: NewsImportance.Notable,
    titleKey: 'news.retirementBegun',
    params: {
      plant: world.plantDisplayName(plantId),
      months: Math.max(1, Math.round(quote.buildTicks / (TICKS_PER_YEAR / 12))),
    },
    subjectId: plantId,
    subjectKind: 'plant',
  })

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
    lifeYears: plant.designLifeYears * type.refurbishLifeExtension.value * escalation,
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
