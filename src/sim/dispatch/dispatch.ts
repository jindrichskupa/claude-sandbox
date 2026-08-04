/**
 * Hourly dispatch: who generates, where the power flows, what it costs, and who goes dark.
 *
 * The whole thing is one minimum-cost flow problem per tick, solved twice so that
 * transmission losses can be paid for by the generation that causes them.
 */

import { LINE_TYPES, lineLossMw } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { ECONOMICS } from '@content/economics'
import type { Network, NodeId } from '../grid/network'
import type { Islands } from '../grid/islands'
import { isDispatchable, type CityAsset, type PlantAsset } from '../assets/types'
import { Param } from '../params/types'
import type { Params } from '../params/Params'
import { MinCostFlowSolver } from './minCostFlow'
import { isStorage, type StoragePlan } from './storage'

export interface DispatchResult {
  /** MW generated per plant. Negative for storage that is charging. */
  generationMw: Map<string, number>
  /** Signed MW per line, positive meaning `from` to `to`. */
  lineFlowMw: Map<string, number>
  lineLossMw: Map<string, number>
  /** MW actually delivered per city. */
  servedMw: Map<string, number>
  /** MW of demand that could not be met. */
  unservedMw: Map<string, number>
  /** Marginal cost of delivering one more MW to each node. */
  nodalPrice: Map<NodeId, number>

  /** Demand from cities. Deliberately excludes the grid's own losses and storage charging. */
  totalDemandMw: number
  totalGenerationMw: number
  totalLossMw: number
  totalUnservedMw: number
  /** MW drawn by storage that was actually charging. */
  totalStorageChargeMw: number
  /** MW supplied by storage that was discharging. */
  totalStorageDischargeMw: number
  /** Marginal cost of the most expensive dispatched unit, per island. */
  marketPriceByIsland: number[]
  /** Fuel plus carbon plus variable cost of this hour's generation. */
  totalVariableCost: number
  aborted: boolean
}

/**
 * Short-run marginal cost of one more MWh from a plant: fuel, carbon, and non-fuel variable
 * cost. This is what orders the merit stack, and it is why a cheap fuel burnt inefficiently
 * can lose to an expensive fuel burnt well.
 */
export function marginalCostPerMwh(plant: PlantAsset, params: Params, carbonPrice: number): number {
  const type = PLANT_TYPES[plant.typeId]
  const efficiency = params.get(plant.id, Param.Efficiency)
  const varOpex = params.get(plant.id, Param.VarOpexPerMwh)
  const fuel = FUELS[type.fuel]

  if (type.fuel === 'none') return varOpex

  const fuelPrice = params.get(plant.id, Param.FuelPricePerMwhThermal)
  const thermalPerElectric = 1 / Math.max(0.01, efficiency)
  const fuelCost = fuelPrice * thermalPerElectric
  const carbonCost = carbonPrice * fuel.co2PerMwhThermal.value * thermalPerElectric
  return fuelCost + carbonCost + varOpex
}

/** Available output right now, after availability, ramp rate and minimum load. */
export function availableRange(plant: PlantAsset, params: Params): { floor: number; ceiling: number } {
  const type = PLANT_TYPES[plant.typeId]
  const capacity = params.get(plant.id, Param.CapacityMw)
  const availability = params.get(plant.id, Param.Availability)
  const ramp = params.get(plant.id, Param.RampRatePerHour)

  const maxByAvailability = capacity * availability
  const rampStep = capacity * ramp
  const ceiling = Math.max(0, Math.min(maxByAvailability, plant.outputMw + rampStep))

  // A unit that cannot ramp down fast enough is still producing next hour whether the
  // market wants it or not. That floor is what makes inflexible plant genuinely awkward.
  const minLoad = type.minLoadFraction.value * capacity
  const rampFloor = Math.max(0, plant.outputMw - rampStep)
  const floor = plant.outputMw > 0 ? Math.min(ceiling, Math.max(rampFloor, Math.min(minLoad, ceiling))) : 0

  return { floor, ceiling }
}

interface Built {
  solver: MinCostFlowSolver
  source: number
  sink: number
  indexOf: Map<NodeId, number>
  plantArcs: Array<{ plant: PlantAsset; floorArc: number; costArc: number; cost: number }>
  cityArcs: Array<{ city: CityAsset; serveArc: number; unservedArc: number; demand: number }>
  lineArcs: Array<{ edgeId: string; fwd: number; rev: number }>
  lossArcs: Array<{ serveArc: number; unservedArc: number }>
  storageArcs: Array<{ plantId: string; dischargeArc: number; chargeArc: number; forgoArc: number }>
  totalDemand: number
}

export interface DispatchInput {
  network: Network
  islands: Islands
  plants: PlantAsset[]
  cities: CityAsset[]
  params: Params
  carbonPrice: number
  /** Extra demand per node from the previous loss estimate, in MW. */
  lossDemand?: Map<NodeId, number>
  /** What each storage unit intends to do this hour. See `storage.ts`. */
  storagePlans?: Map<string, StoragePlan>
}

function build(input: DispatchInput): Built {
  const { network, plants, cities, params, carbonPrice, lossDemand, storagePlans } = input
  const nodeIds = network.nodeIds()
  const indexOf = new Map<NodeId, number>()
  nodeIds.forEach((id, i) => indexOf.set(id, i))

  const source = nodeIds.length
  const sink = nodeIds.length + 1
  const nodeCount = nodeIds.length + 2

  const dispatchable = plants.filter(isDispatchable)
  const electricEdges = network.activeEdges('electric')
  // Two arcs per plant, three per storage unit, two per city, two per node carrying losses,
  // two directions per line.
  const maxEdges =
    dispatchable.length * 3 + cities.length * 2 + electricEdges.length * 2 + nodeIds.length * 2 + 8

  const solver = new MinCostFlowSolver(nodeCount, maxEdges)
  solver.reset()

  const plantArcs: Built['plantArcs'] = []
  const storageArcs: Built['storageArcs'] = []
  let storageChargeDemand = 0

  for (const plant of dispatchable) {
    const node = indexOf.get(plant.nodeId)
    if (node === undefined) continue

    if (isStorage(plant)) {
      // Storage does not belong in the merit stack; its decision was already made by the
      // policy in `storage.ts`, and here it is only a shape the solver understands.
      const plan = storagePlans?.get(plant.id)
      if (!plan || plan.mode === 'idle') continue

      if (plan.mode === 'discharging' && plan.dischargeCeilingMw > 0) {
        const dischargeArc = solver.addArc(source, node, plan.dischargeCeilingMw, plan.offerPricePerMwh)
        storageArcs.push({ plantId: plant.id, dischargeArc, chargeArc: -1, forgoArc: -1 })
      } else if (plan.mode === 'charging' && plan.chargeMw > 0) {
        // Charging is real demand, but curtailable: if the system turns out to be short, the
        // battery goes without rather than a city going dark. The forgo arc is what lets the
        // solver make that trade, priced above any generator but far below lost load.
        const chargeArc = solver.addArc(node, sink, plan.chargeMw, 0)
        const forgoArc = solver.addArc(source, node, plan.chargeMw, ECONOMICS.forgoneChargePricePerMwh.value)
        storageChargeDemand += plan.chargeMw
        storageArcs.push({ plantId: plant.id, dischargeArc: -1, chargeArc, forgoArc })
      }
      continue
    }

    const { floor, ceiling } = availableRange(plant, params)
    const cost = marginalCostPerMwh(plant, params, carbonPrice)

    // The must-run floor is offered at zero cost: the fuel is being burnt regardless, so
    // from this hour's point of view that energy is already paid for.
    const floorArc = floor > 0 ? solver.addArc(source, node, floor, 0) : -1
    const above = Math.max(0, ceiling - floor)
    const costArc = above > 0 ? solver.addArc(source, node, above, cost) : -1
    plantArcs.push({ plant, floorArc, costArc, cost })
  }

  const cityArcs: Built['cityArcs'] = []
  let totalDemand = storageChargeDemand
  for (const city of cities) {
    const node = indexOf.get(city.nodeId)
    if (node === undefined) continue
    const demand = Math.max(0, params.get(city.id, Param.DemandMw))
    totalDemand += demand
    const serveArc = solver.addArc(node, sink, demand, 0)
    // Last-resort arc. Using it means the lights went out, and its price is what makes
    // scarcity show up as a very high nodal price rather than an unsolvable problem.
    const unservedArc = solver.addArc(source, node, demand, ECONOMICS.valueOfLostLoadPerMwh.value)
    cityArcs.push({ city, serveArc, unservedArc, demand })
  }

  // Losses get their own demand arcs at each line's endpoints. They are deliberately never
  // folded into a city's figure: if they were, "demand served" would quietly include the
  // grid's own consumption and every number shown to the player would be a little wrong.
  const lossArcs: Built['lossArcs'] = []
  if (lossDemand) {
    for (const [nodeId, mw] of lossDemand) {
      if (mw <= 1e-9) continue
      const node = indexOf.get(nodeId)
      if (node === undefined) continue
      totalDemand += mw
      const serveArc = solver.addArc(node, sink, mw, 0)
      const unservedArc = solver.addArc(source, node, mw, ECONOMICS.valueOfLostLoadPerMwh.value)
      lossArcs.push({ serveArc, unservedArc })
    }
  }

  const tieBreak = ECONOMICS.wheelingTieBreakPerMwh.value
  const lineArcs: Built['lineArcs'] = []
  for (const edge of electricEdges) {
    const a = indexOf.get(edge.from)
    const b = indexOf.get(edge.to)
    if (a === undefined || b === undefined) continue
    const capacity = params.getOr(edge.id, Param.LineCapacityMw, lineCapacityOf(edge.kv, edge.circuits))
    const fwd = solver.addArc(a, b, capacity, tieBreak)
    const rev = solver.addArc(b, a, capacity, tieBreak)
    lineArcs.push({ edgeId: edge.id, fwd, rev })
  }

  return { solver, source, sink, indexOf, plantArcs, cityArcs, lineArcs, lossArcs, storageArcs, totalDemand }
}

function lineCapacityOf(kv: number, circuits: number): number {
  if (kv === 110 || kv === 220 || kv === 400) return LINE_TYPES[kv].capacityMw.value * circuits
  return 0
}

/** One pass of the flow problem, with no loss feedback. */
function solveOnce(input: DispatchInput): DispatchResult {
  const built = build(input)
  const { solver, source, sink, indexOf, plantArcs, cityArcs, lineArcs, lossArcs, storageArcs, totalDemand } =
    built
  const result = solver.solve(source, sink, totalDemand)

  const generationMw = new Map<string, number>()
  let totalGenerationMw = 0
  let totalVariableCost = 0
  const dispatchedCostByIsland: number[] = new Array<number>(input.islands.count).fill(0)

  for (const { plant, floorArc, costArc, cost } of plantArcs) {
    const mw = (floorArc >= 0 ? solver.flowOf(floorArc) : 0) + (costArc >= 0 ? solver.flowOf(costArc) : 0)
    generationMw.set(plant.id, mw)
    totalGenerationMw += mw
    totalVariableCost += mw * cost
    if (mw > 1e-6) {
      const island = input.islands.islandOf.get(plant.nodeId)
      if (island !== undefined) {
        dispatchedCostByIsland[island] = Math.max(dispatchedCostByIsland[island]!, cost)
      }
    }
  }

  // Storage, read back as a signed figure: positive discharged, negative charged. Only the
  // charge that actually happened counts — a forgone charge is not consumption.
  let totalStorageChargeMw = 0
  let totalStorageDischargeMw = 0
  for (const { plantId, dischargeArc, chargeArc, forgoArc } of storageArcs) {
    let mw = 0
    if (dischargeArc >= 0) {
      mw = solver.flowOf(dischargeArc)
      totalGenerationMw += mw
      totalStorageDischargeMw += mw
    } else if (chargeArc >= 0) {
      const charged = Math.max(0, solver.flowOf(chargeArc) - (forgoArc >= 0 ? solver.flowOf(forgoArc) : 0))
      mw = -charged
      totalStorageChargeMw += charged
    }
    generationMw.set(plantId, mw)
  }

  const servedMw = new Map<string, number>()
  const unservedMw = new Map<string, number>()
  let totalUnservedMw = 0
  let cityDemandMw = 0
  for (const { city, serveArc, unservedArc, demand } of cityArcs) {
    cityDemandMw += demand
    const unserved = solver.flowOf(unservedArc)
    const served = solver.flowOf(serveArc) - unserved
    servedMw.set(city.id, Math.max(0, served))
    unservedMw.set(city.id, Math.max(0, unserved))
    totalUnservedMw += Math.max(0, unserved)
  }

  const lineFlowMw = new Map<string, number>()
  const lossMap = new Map<string, number>()
  for (const { edgeId, fwd, rev } of lineArcs) {
    const net = solver.flowOf(fwd) - solver.flowOf(rev)
    lineFlowMw.set(edgeId, net)
    const edge = input.network.requireEdge(edgeId)
    lossMap.set(edgeId, lossOf(edge.kv, edge.lengthKm, edge.circuits, net))
  }

  // Losses actually covered by generation in *this* solve. Reported rather than the losses
  // implied by the final flows, so that generation minus demand equals losses exactly.
  //
  // A loss can itself go unserved: when the system is already short, the grid cannot even
  // cover its own consumption. That shortfall is unserved energy like any other, and
  // counting it as delivered would quietly break conservation.
  let totalLossMw = 0
  for (const { serveArc, unservedArc } of lossArcs) {
    const shortfall = solver.flowOf(unservedArc)
    totalLossMw += solver.flowOf(serveArc) - shortfall
    totalUnservedMw += shortfall
  }

  const nodalPrice = new Map<NodeId, number>()
  const sourcePotential = result.potential[source] ?? 0
  for (const [nodeId, idx] of indexOf) {
    const p = result.potential[idx]
    nodalPrice.set(nodeId, Number.isFinite(p) ? (p as number) - sourcePotential : 0)
  }

  return {
    generationMw,
    lineFlowMw,
    lineLossMw: lossMap,
    servedMw,
    unservedMw,
    nodalPrice,
    totalDemandMw: cityDemandMw,
    totalGenerationMw,
    totalLossMw,
    totalUnservedMw,
    totalStorageChargeMw,
    totalStorageDischargeMw,
    marketPriceByIsland: dispatchedCostByIsland,
    totalVariableCost,
    aborted: result.aborted,
  }
}

function lossOf(kv: number, lengthKm: number, circuits: number, flowMw: number): number {
  if (kv !== 110 && kv !== 220 && kv !== 400) return 0
  const type = LINE_TYPES[kv]
  // Parallel circuits share the current, so resistance falls as 1/n and loss with it.
  const resistancePerKm = type.resistanceOhmPerKm.value / Math.max(1, circuits)
  return lineLossMw(Math.abs(flowMw), resistancePerKm, lengthKm, kv)
}

/** Split each line's loss evenly between its two ends and total it up per node. */
function lossDemandFrom(result: DispatchResult, input: DispatchInput): Map<NodeId, number> {
  const lossDemand = new Map<NodeId, number>()
  for (const [edgeId, loss] of result.lineLossMw) {
    if (loss <= 0) continue
    const edge = input.network.requireEdge(edgeId)
    const half = loss / 2
    lossDemand.set(edge.from, (lossDemand.get(edge.from) ?? 0) + half)
    lossDemand.set(edge.to, (lossDemand.get(edge.to) ?? 0) + half)
  }
  return lossDemand
}

/** Maximum loss-feedback passes. In practice two or three are always enough. */
const MAX_LOSS_PASSES = 5
/** Stop when a further pass would move total losses by less than this fraction. */
const LOSS_CONVERGENCE = 0.005

/**
 * Full dispatch.
 *
 * Losses depend on flows, and flows depend on losses, so this is a fixed point: solve
 * ignoring losses, charge each line's loss to its two endpoints, re-solve, repeat. Carrying
 * the losses raises the flows, which raises the losses again, so a single correction pass
 * would understate them — the iteration runs until the answer stops moving.
 *
 * It converges quickly because each round's correction is a few percent of the last one's.
 */
export function dispatch(input: DispatchInput): DispatchResult {
  let result = solveOnce(input)
  let previousLoss = 0

  for (let pass = 0; pass < MAX_LOSS_PASSES; pass++) {
    const lossDemand = lossDemandFrom(result, input)
    if (lossDemand.size === 0) return result

    const next = solveOnce({ ...input, lossDemand })
    const applied = next.totalLossMw
    result = next
    if (applied <= 0) return result
    if (Math.abs(applied - previousLoss) <= LOSS_CONVERGENCE * applied) return result
    previousLoss = applied
  }

  return result
}
