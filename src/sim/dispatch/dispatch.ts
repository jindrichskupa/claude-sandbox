/**
 * Hourly dispatch: who generates, where the power flows, what it costs, and who goes dark.
 *
 * The whole thing is one minimum-cost flow problem per tick, solved twice so that
 * transmission losses can be paid for by the generation that causes them.
 */

import { LINE_TYPES, lineLossMw } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import type { Network, NodeId } from '../grid/network'
import type { Islands } from '../grid/islands'
import { isDispatchable, type CityAsset, type PlantAsset } from '../assets/types'
import { Param } from '../params/types'
import type { Params } from '../params/Params'
import { BASE_PRICES, type Prices } from '../tech/money'
import { MinCostFlowSolver } from './minCostFlow'
import { isStorage, type StoragePlan } from './storage'
import type { ChpCommitment } from '../heat/heat'

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
  /** MW drawn by the heat network's pumps. Not a loss and not a city's demand. */
  totalAuxDemandMw: number
  /** Rooftop export actually absorbed, per city. What is missing was curtailed. */
  rooftopTakenMw: Map<string, number>
  /** Rooftop energy consumed behind the meter, which the utility never got to sell. */
  totalRooftopSelfUseMw: number
  totalRooftopExportMw: number
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

  // A guaranteed price paid outside the market changes what a plant is willing to bid, not
  // what it costs to run. A unit on a feed-in tariff of 80 with a variable cost of 1 will pay
  // up to 79 to stay on rather than be curtailed, because being curtailed forfeits the
  // tariff. That is why real markets with subsidised renewables clear below zero, and it is
  // the mechanism, not a special case.
  const subsidy = params.getOr(plant.id, Param.FeedInTariffPerMwh, 0)

  if (type.fuel === 'none') return varOpex - subsidy

  const fuelPrice = params.get(plant.id, Param.FuelPricePerMwhThermal)
  const thermalPerElectric = 1 / Math.max(0.01, efficiency)
  const fuelCost = fuelPrice * thermalPerElectric
  const carbonCost = carbonPrice * fuel.co2PerMwhThermal.value * thermalPerElectric
  return fuelCost + carbonCost + varOpex - subsidy
}

/**
 * Available output right now, after availability, ramp rate, minimum load — and any heat duty
 * the plant has already been committed to.
 *
 * The cogeneration case is the interesting one, and it is the reason this function takes a
 * commitment at all. A **backpressure** set has no electrical freedom left once its heat duty
 * is fixed: floor and ceiling collapse onto the same number and the dispatch simply has to
 * accept the injection. An **extraction** unit keeps its choice but loses ceiling, because the
 * steam bled off for the town is steam that is not turning the low-pressure turbine.
 */
export function availableRange(
  plant: PlantAsset,
  params: Params,
  commitment?: ChpCommitment,
): { floor: number; ceiling: number } {
  const type = PLANT_TYPES[plant.typeId]
  const capacity = params.get(plant.id, Param.CapacityMw)
  const availability = params.get(plant.id, Param.Availability)
  const ramp = params.get(plant.id, Param.RampRatePerHour)

  const maxByAvailability = capacity * availability
  const rampStep = capacity * ramp

  // A backpressure unit heating a town in February is not participating in a market. The ramp
  // limit is deliberately not applied: the heat load it follows moves over hours, not minutes,
  // so the constraint would almost never bind — and where it did, the alternative on offer
  // would be to stop heating the town, which is not a trade the dispatch gets to make.
  if (commitment?.forcedOutputMw !== null && commitment?.forcedOutputMw !== undefined) {
    const forced = Math.max(0, Math.min(maxByAvailability, commitment.forcedOutputMw))
    return { floor: forced, ceiling: forced }
  }

  const derate = commitment?.capacityDerateMw ?? 0
  const ceiling = Math.max(0, Math.min(maxByAvailability - derate, plant.outputMw + rampStep))

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
  auxArcs: Array<{ serveArc: number; unservedArc: number }>
  storageArcs: Array<{ plantId: string; dischargeArc: number; chargeArc: number; forgoArc: number }>
  rooftopArcs: Array<{ cityId: string; arc: number; offeredMw: number; selfUseMw: number }>
  totalDemand: number
  /** Amount added to every injection arc so the solver sees only non-negative costs. */
  costShift: number
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
  /**
   * A first guess at the loss demand, normally last hour's answer. Purely a convergence aid:
   * the fixed point it converges to is the same one, reached in fewer solves.
   */
  initialLossDemand?: Map<NodeId, number>
  /** What each storage unit intends to do this hour. See `storage.ts`. */
  storagePlans?: Map<string, StoragePlan>
  /** Heat duties already settled by the heat dispatch, which bound what cogeneration can do. */
  chpCommitments?: Map<string, ChpCommitment>
  /**
   * Extra electrical demand per node that is not a city's: the heat network's circulating
   * pumps. Kept separate from `lossDemand` so it is never reported as a transmission loss.
   */
  auxDemand?: Map<NodeId, number>
  /**
   * Economy-wide prices in the money of the current year. Optional so solver tests, which care
   * about the ordering these impose and not about what decade it is, can leave it out.
   */
  prices?: Prices
  /**
   * Photovoltaics on the town's own roofs, per city id.
   *
   * `selfUseMw` never reaches the market: it is netted off behind the meter, so the city's demand
   * arc shrinks and the sale simply does not happen. `exportMw` is offered as generation at
   * `bidPerMwh`, which under a support scheme is well below zero — a household paid per unit
   * produced forfeits that payment by being curtailed and will pay to stay on. That is the whole
   * mechanism behind a negative price, and it is the same one a subsidised plant uses.
   */
  rooftop?: Map<string, { selfUseMw: number; exportMw: number; bidPerMwh: number }>
}

function build(input: DispatchInput): Built {
  const { network, plants, cities, params, carbonPrice, lossDemand, storagePlans, chpCommitments, auxDemand, rooftop } =
    input
  const nodeIds = network.nodeIds()
  const indexOf = new Map<NodeId, number>()
  nodeIds.forEach((id, i) => indexOf.set(id, i))

  const source = nodeIds.length
  const sink = nodeIds.length + 1
  const nodeCount = nodeIds.length + 2

  const dispatchable = plants.filter(isDispatchable)
  const electricEdges = network.activeEdges('electric')
  // Two arcs per plant, three per storage unit, two per city, two per node carrying losses,
  // two more per node carrying pump load, two directions per line.
  const maxEdges =
    dispatchable.length * 3 + cities.length * 2 + electricEdges.length * 2 + nodeIds.length * 4 + 8

  const solver = new MinCostFlowSolver(nodeCount, maxEdges)
  solver.reset()

  /**
   * Shortest-path costing needs non-negative arc costs, but a subsidised generator bids
   * below zero on purpose. Adding a constant to *every* arc leaving the source fixes that
   * without changing anything: each unit of flow crosses exactly one such arc, so the total
   * cost rises by a constant and the cheapest solution is still the cheapest solution. The
   * node potentials all shift by the same amount, so subtracting it afterwards recovers the
   * true prices — including negative ones.
   */
  let minBid = 0
  for (const plant of dispatchable) {
    if (isStorage(plant)) continue
    minBid = Math.min(minBid, marginalCostPerMwh(plant, params, carbonPrice))
  }
  for (const plan of storagePlans?.values() ?? []) {
    if (plan.mode === 'discharging') minBid = Math.min(minBid, plan.offerPricePerMwh)
  }
  // Rooftop is usually the most negative bid on the system once a support scheme exists, so it
  // has to be in the shift or every arc cost the solver sees would go negative anyway.
  for (const r of rooftop?.values() ?? []) {
    if (r.exportMw > 0) minBid = Math.min(minBid, r.bidPerMwh)
  }
  const costShift = minBid < 0 ? -minBid : 0

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
        const dischargeArc = solver.addArc(source, node, plan.dischargeCeilingMw, plan.offerPricePerMwh + costShift)
        storageArcs.push({ plantId: plant.id, dischargeArc, chargeArc: -1, forgoArc: -1 })
      } else if (plan.mode === 'charging' && plan.chargeMw > 0) {
        // Charging is real demand, but curtailable: if the system turns out to be short, the
        // battery goes without rather than a city going dark. The forgo arc is what lets the
        // solver make that trade, priced above any generator but far below lost load.
        const chargeArc = solver.addArc(node, sink, plan.chargeMw, 0)
        const forgoArc = solver.addArc(
          source,
          node,
          plan.chargeMw,
          (input.prices ?? BASE_PRICES).forgoneChargePricePerMwh + costShift,
        )
        storageChargeDemand += plan.chargeMw
        storageArcs.push({ plantId: plant.id, dischargeArc: -1, chargeArc, forgoArc })
      }
      continue
    }

    const { floor, ceiling } = availableRange(plant, params, chpCommitments?.get(plant.id))
    const cost = marginalCostPerMwh(plant, params, carbonPrice)

    // The must-run floor is offered at zero cost: the fuel is being burnt regardless, so
    // from this hour's point of view that energy is already paid for.
    const floorArc = floor > 0 ? solver.addArc(source, node, floor, costShift) : -1
    const above = Math.max(0, ceiling - floor)
    const costArc = above > 0 ? solver.addArc(source, node, above, cost + costShift) : -1
    plantArcs.push({ plant, floorArc, costArc, cost })
  }

  const cityArcs: Built['cityArcs'] = []
  const rooftopArcs: Built['rooftopArcs'] = []
  let totalDemand = storageChargeDemand
  for (const city of cities) {
    const node = indexOf.get(city.nodeId)
    if (node === undefined) continue
    const own = rooftop?.get(city.id)
    // Behind-the-meter output never appears as demand *or* as generation. It is simply a sale
    // that does not happen, which is exactly how it looks to the utility that used to make it.
    const demand = Math.max(0, params.get(city.id, Param.DemandMw) - (own?.selfUseMw ?? 0))
    if (own && own.exportMw > 0) {
      rooftopArcs.push({
        cityId: city.id,
        arc: solver.addArc(source, node, own.exportMw, own.bidPerMwh + costShift),
        offeredMw: own.exportMw,
        selfUseMw: own.selfUseMw,
      })
    }
    totalDemand += demand
    const serveArc = solver.addArc(node, sink, demand, 0)
    // Last-resort arc. Using it means the lights went out, and its price is what makes
    // scarcity show up as a very high nodal price rather than an unsolvable problem.
    const unservedArc = solver.addArc(source, node, demand, (input.prices ?? BASE_PRICES).valueOfLostLoadPerMwh + costShift)
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
      const unservedArc = solver.addArc(source, node, mw, (input.prices ?? BASE_PRICES).valueOfLostLoadPerMwh + costShift)
      lossArcs.push({ serveArc, unservedArc })
    }
  }

  // The heat network's pumps, drawn at the nodes where the pumping stations stand. Real
  // demand like any other, and it can go unserved like any other.
  const auxArcs: Built['auxArcs'] = []
  if (auxDemand) {
    for (const [nodeId, mw] of auxDemand) {
      if (mw <= 1e-9) continue
      const node = indexOf.get(nodeId)
      if (node === undefined) continue
      totalDemand += mw
      const serveArc = solver.addArc(node, sink, mw, 0)
      const unservedArc = solver.addArc(source, node, mw, (input.prices ?? BASE_PRICES).valueOfLostLoadPerMwh + costShift)
      auxArcs.push({ serveArc, unservedArc })
    }
  }

  const tieBreak = (input.prices ?? BASE_PRICES).wheelingTieBreakPerMwh
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

  return {
    solver,
    source,
    sink,
    indexOf,
    plantArcs,
    cityArcs,
    lineArcs,
    lossArcs,
    auxArcs,
    storageArcs,
    rooftopArcs,
    totalDemand,
    costShift,
  }
}

function lineCapacityOf(kv: number, circuits: number): number {
  if (kv === 110 || kv === 220 || kv === 400) return LINE_TYPES[kv].capacityMw.value * circuits
  return 0
}

/** One pass of the flow problem, with no loss feedback. */
function solveOnce(input: DispatchInput): DispatchResult {
  const built = build(input)
  const {
    solver,
    source,
    sink,
    indexOf,
    plantArcs,
    cityArcs,
    lineArcs,
    lossArcs,
    auxArcs,
    storageArcs,
    rooftopArcs,
    totalDemand,
    costShift,
  } = built
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

  // Rooftop export the system actually took. Counted as generation, because it is: it came off
  // a roof, went into the network and served somebody else's load. What was not taken was
  // curtailed, which under a support scheme is a household losing money and, in most of Europe,
  // an argument on the evening news.
  const rooftopTakenMw = new Map<string, number>()
  let totalRooftopExportMw = 0
  let totalRooftopSelfUseMw = 0
  for (const { cityId, arc, selfUseMw } of rooftopArcs) {
    const mw = solver.flowOf(arc)
    rooftopTakenMw.set(cityId, mw)
    totalGenerationMw += mw
    totalRooftopExportMw += mw
    totalRooftopSelfUseMw += selfUseMw
  }
  // Self-consumption at towns with nothing left over still has to be counted, and those towns
  // never got an export arc.
  for (const [cityId, own] of input.rooftop ?? []) {
    if (own.exportMw <= 0) totalRooftopSelfUseMw += own.selfUseMw
    if (!rooftopTakenMw.has(cityId)) rooftopTakenMw.set(cityId, 0)
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

  let totalAuxDemandMw = 0
  for (const { serveArc, unservedArc } of auxArcs) {
    const shortfall = solver.flowOf(unservedArc)
    totalAuxDemandMw += solver.flowOf(serveArc) - shortfall
    totalUnservedMw += shortfall
  }

  const nodalPrice = new Map<NodeId, number>()
  const sourcePotential = result.potential[source] ?? 0
  for (const [nodeId, idx] of indexOf) {
    const p = result.potential[idx]
    // Undo the shift, which is what lets a price come out below zero.
    nodalPrice.set(nodeId, Number.isFinite(p) ? (p as number) - sourcePotential - costShift : 0)
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
    totalAuxDemandMw,
    rooftopTakenMw,
    totalRooftopSelfUseMw,
    totalRooftopExportMw,
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
  return lossDemandOf(result, input.network)
}

/** The same split, exposed so the caller can carry one hour's answer into the next. */
export function lossDemandOf(result: DispatchResult, network: Network): Map<NodeId, number> {
  const lossDemand = new Map<NodeId, number>()
  for (const [edgeId, loss] of result.lineLossMw) {
    if (loss <= 0) continue
    const edge = network.requireEdge(edgeId)
    const half = loss / 2
    lossDemand.set(edge.from, (lossDemand.get(edge.from) ?? 0) + half)
    lossDemand.set(edge.to, (lossDemand.get(edge.to) ?? 0) + half)
  }
  return lossDemand
}

/** Maximum loss-feedback passes. In practice two or three are always enough. */
const MAX_LOSS_PASSES = 5
/**
 * Stop when a further pass would move total losses by less than this fraction *of the losses*.
 *
 * Losses run at a few percent of demand, so 2% of them is well under a tenth of a percent of the
 * quantity anyone looks at — comfortably inside the uncertainty of every input the model has.
 * The previous 0.005 bought no accuracy anybody could observe and cost an extra solve on most
 * hours, which on a forty-year game is a great deal of arithmetic for nothing.
 */
const LOSS_CONVERGENCE = 0.02

/**
 * Full dispatch.
 *
 * Losses depend on flows, and flows depend on losses, so this is a fixed point: solve with an
 * estimate of the losses, charge each line's loss to its two endpoints, re-solve, repeat.
 * Carrying the losses raises the flows, which raises the losses again, so a single correction
 * pass would understate them — the iteration runs until the answer stops moving.
 *
 * **Warm start.** `initialLossDemand` lets the caller begin from the previous hour's answer
 * rather than from zero. Load moves slowly from one hour to the next, so last hour's losses are
 * an excellent first guess and the iteration converges in one or two passes instead of three or
 * four. The fixed point is the same either way — only the number of solves to reach it changes,
 * and the convergence test is what guarantees that. Measured on the opening scenario it roughly
 * halves the cost of a tick.
 */
export function dispatch(input: DispatchInput): DispatchResult {
  let result = solveOnce(
    input.initialLossDemand ? { ...input, lossDemand: input.initialLossDemand } : input,
  )
  let previousLoss = result.totalLossMw

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
