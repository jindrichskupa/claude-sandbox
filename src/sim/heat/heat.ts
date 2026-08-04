/**
 * District heating.
 *
 * Heat is a second commodity with its own network, and it is not electricity with different
 * units. Three differences drive everything in this file:
 *
 * **Heat cannot be refused.** A brownout is a bad afternoon. A heat network that fails in
 * February freezes and splits the pipework inside the buildings it serves, and the town is
 * uninhabitable for weeks. So unserved heat is priced far above unserved electricity, and the
 * heat problem is solved *first* — the cogeneration units then arrive at the electrical
 * dispatch with their heat duty already fixed. That is also how these plants are really run,
 * and it is where the phrase "heat-led" comes from.
 *
 * **Losses do not depend on the load.** A buried main loses heat through its insulation
 * whether anyone is drawing from it or not, so the loss is a constant per kilometre rather
 * than a function of flow. This is why there is no fixed-point iteration here, unlike the
 * electrical dispatch: the losses are known before the solve, so they go in as demand once and
 * the answer is exact. It is also why heat networks are compact — a long pipe to a small load
 * is hopeless no matter how lightly it is used.
 *
 * **The two commodities are physically locked together at the plant.** See `ChpSpec` for the
 * extraction and backpressure couplings. Both reduce to bounds on a single arc in the
 * electrical problem, which is the reason the flow solver needs no changes at all.
 *
 * The heat problem itself is a minimum-cost flow, solved with the same solver as electricity.
 * The design notes originally called for a tree walk on the grounds that heat networks are
 * small and tree-shaped, but reusing a solver that is already written and already tested is
 * both less code and more correct — it handles pipe capacity limits and rings without a
 * special case, and the nodal duals come out for free.
 */

import { FUELS } from '@content/fuels'
import { HEAT_PIPE_TYPES, isPipeSize, pipeStandingLossMw } from '@content/heatPipeTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { isHeatDispatchable, type CityAsset, type PlantAsset } from '../assets/types'
import type { GridEdge, Network, NodeId } from '../grid/network'
import type { Islands } from '../grid/islands'
import { MinCostFlowSolver } from '../dispatch/minCostFlow'
import { Param } from '../params/types'
import type { Params } from '../params/Params'
import { BASE_PRICES, type Prices } from '../tech/money'

/** What a cogeneration unit's heat duty forces it to do on the electrical side. */
export interface ChpCommitment {
  plantId: string
  mode: 'extraction' | 'backpressure'
  /** Heat the unit is delivering this hour, MW thermal. */
  heatMw: number
  /**
   * Electrical output the coupling *forces*, for a backpressure set. The dispatch has no say:
   * floor and ceiling both become this. Null for extraction units, which retain a choice.
   */
  forcedOutputMw: number | null
  /** Electrical capacity the heat duty removes, for an extraction unit. Zero otherwise. */
  capacityDerateMw: number
}

export interface HeatResult {
  /** Heat delivered per plant, MW thermal. Negative for an accumulator being charged. */
  heatMw: Map<string, number>
  servedHeatMw: Map<string, number>
  unservedHeatMw: Map<string, number>
  /** Signed heat flow per pipe, positive meaning `from` to `to`. */
  pipeFlowMw: Map<string, number>

  totalHeatDemandMw: number
  totalHeatSuppliedMw: number
  /** Standing losses actually covered by generation. */
  totalHeatLossMw: number
  totalUnservedHeatMw: number
  /** Electricity the network's circulating pumps draw, by node. */
  pumpingDemandMw: Map<NodeId, number>
  /** Fuel plus carbon plus variable cost of this hour's heat. */
  totalVariableCost: number

  commitments: Map<string, ChpCommitment>
  aborted: boolean
}

export interface HeatDispatchInput {
  network: Network
  /** Islands over heat edges, not electric ones. */
  islands: Islands
  plants: PlantAsset[]
  cities: CityAsset[]
  params: Params
  carbonPrice: number
  /**
   * What a megawatt-hour of electricity is worth right now. Cogeneration heat is priced
   * against it, because for these machines heat and power are alternative uses of the same
   * steam — which is the entire reason the two commodities cannot be costed separately.
   */
  electricityPricePerMwh: number
  /** Economy-wide prices in the money of the current year. See `tech/money.ts`. */
  prices?: Prices
}

/** How an accumulator intends to spend this hour. */
export interface AccumulatorPlan {
  plantId: string
  mode: 'idle' | 'charging' | 'discharging'
  chargeMw: number
  dischargeCeilingMw: number
  /** Price the discharge is offered at: what it will cost to put the heat back. */
  offerPricePerMwh: number
}

/** Rated heat output after availability, in MW thermal. */
export function heatCeilingMw(plant: PlantAsset, params: Params): number {
  const type = PLANT_TYPES[plant.typeId]
  const availability = params.get(plant.id, Param.Availability)

  if (type.heatOnly) {
    return Math.max(0, params.get(plant.id, Param.CapacityMw) * availability)
  }
  if (!type.chp) return 0

  const rated = Math.max(0, params.getOr(plant.id, Param.HeatCapacityMwth, type.chp.heatCapacityMwth.value))
  const electricalMax = params.get(plant.id, Param.CapacityMw) * availability

  // The coupling also limits the heat: an extraction unit cannot bleed off more steam than it
  // has, and a backpressure set cannot make heat without somewhere for the electricity to go.
  if (type.chp.mode === 'backpressure') {
    const cm = Math.max(0.01, type.chp.powerPerHeat.value)
    return Math.min(rated, electricalMax / cm)
  }
  const cv = type.chp.powerLossPerHeat.value
  return cv > 0 ? Math.min(rated, electricalMax / cv) : rated
}

/**
 * Short-run marginal cost of one more MWh of heat.
 *
 * A boiler's is the obvious one: fuel divided by efficiency. The cogeneration cases are the
 * interesting ones, and they are where the sequential heat-then-electricity treatment earns
 * its keep.
 *
 * An **extraction** unit burns the same fuel whether or not it bleeds steam for heat; what the
 * heat costs is the electricity it displaces. So the marginal cost is the opportunity cost,
 * `cv` megawatt-hours of power per megawatt-hour of heat.
 *
 * A **backpressure** set makes both together and cannot separate them. Its heat costs the fuel
 * for the whole package minus the value of the electricity that comes with it — which for
 * cheap coal against a decent power price comes out *negative*. That is not a bug and not a
 * subsidy: it is the reason municipal cogeneration was built in the first place. Heat is the
 * by-product, and the by-product pays.
 */
export function heatMarginalCostPerMwh(
  plant: PlantAsset,
  params: Params,
  carbonPrice: number,
  electricityPricePerMwh: number,
): number {
  const type = PLANT_TYPES[plant.typeId]
  const varOpex = params.get(plant.id, Param.VarOpexPerMwh)
  const fuel = FUELS[type.fuel]

  if (type.heatOnly) {
    if (type.heatOnly.kind === 'accumulator') return varOpex
    const efficiency = Math.max(0.01, params.get(plant.id, Param.Efficiency))
    const fuelPrice = params.getOr(plant.id, Param.FuelPricePerMwhThermal, fuel.pricePerMwhThermal.value)
    const thermalPerHeat = 1 / efficiency
    return fuelPrice * thermalPerHeat + carbonPrice * fuel.co2PerMwhThermal.value * thermalPerHeat + varOpex
  }

  if (!type.chp) return Infinity

  if (type.chp.mode === 'extraction') {
    return type.chp.powerLossPerHeat.value * electricityPricePerMwh + varOpex
  }

  const cm = type.chp.powerPerHeat.value
  const totalEfficiency = Math.max(0.01, type.chp.totalEfficiency.value)
  const fuelPrice = params.getOr(plant.id, Param.FuelPricePerMwhThermal, fuel.pricePerMwhThermal.value)
  // Fuel for one MWh of heat plus the cm MWh of electricity that comes with it, unavoidably.
  const thermalPerHeat = (1 + cm) / totalEfficiency
  const fuelCost = fuelPrice * thermalPerHeat
  const carbonCost = carbonPrice * fuel.co2PerMwhThermal.value * thermalPerHeat
  return fuelCost + carbonCost + varOpex - cm * electricityPricePerMwh
}

/** Whether this plant is a heat accumulator — a tank, not a battery. */
export function isHeatStore(plant: PlantAsset): boolean {
  return PLANT_TYPES[plant.typeId].heatOnly?.kind === 'accumulator'
}

/** Usable stored heat capacity, MWh thermal. */
export function heatStoreCapacityMwh(plant: PlantAsset): number {
  return PLANT_TYPES[plant.typeId].heatOnly?.storageMwhth?.value ?? 0
}

/** One-way charge or discharge efficiency, the round trip split evenly between the two. */
export function heatStoreEfficiency(plant: PlantAsset): number {
  const spec = PLANT_TYPES[plant.typeId].heatOnly
  return spec?.thermalEfficiency ? Math.sqrt(spec.thermalEfficiency.value) : 1
}

interface SourceOffer {
  plant: PlantAsset
  cost: number
  ceiling: number
}

/**
 * Decide what each accumulator does, before the flow problem is posed.
 *
 * The rule is the one an operator would state in a sentence: **fill from whatever cheap heat
 * is spare right now, and empty whenever the alternative is lighting a boiler.** A store is
 * worth exactly what it costs to refill it, so that is the price its discharge is offered at —
 * which puts it correctly between cheap cogeneration heat and expensive boiler heat without
 * anyone having to tune a threshold.
 *
 * No forecast is needed, and that is a real difference from the electrical battery in
 * `dispatch/storage.ts`. A battery arbitrages a price that swings on a daily cycle it must
 * anticipate; an accumulator serves a heat load that follows the outdoor temperature, and the
 * cheap hours are simply the ones when the cogeneration units have spare heat capacity. The
 * greedy answer and the anticipating answer coincide.
 */
export function planAccumulators(input: HeatDispatchInput): Map<string, AccumulatorPlan> {
  const { plants, cities, params, islands, network, carbonPrice, electricityPricePerMwh } = input
  const plans = new Map<string, AccumulatorPlan>()

  const accumulators = plants.filter((p) => isHeatDispatchable(p) && isHeatStore(p))
  if (accumulators.length === 0) return plans

  // Merit stack and heat load per island, so each store sees only its own network.
  const offersByIsland = new Map<number, SourceOffer[]>()
  const demandByIsland = new Map<number, number>()

  for (const plant of plants) {
    if (!isHeatDispatchable(plant) || isHeatStore(plant)) continue
    const island = islands.islandOf.get(plant.nodeId)
    if (island === undefined) continue
    const ceiling = heatCeilingMw(plant, params)
    if (ceiling <= 0) continue
    const cost = heatMarginalCostPerMwh(plant, params, carbonPrice, electricityPricePerMwh)
    if (!Number.isFinite(cost)) continue
    const list = offersByIsland.get(island) ?? []
    list.push({ plant, cost, ceiling })
    offersByIsland.set(island, list)
  }

  for (const city of cities) {
    const island = islands.islandOf.get(city.nodeId)
    if (island === undefined) continue
    const demand = Math.max(0, params.getOr(city.id, Param.HeatDemandMw, 0))
    if (demand <= 0) continue
    demandByIsland.set(island, (demandByIsland.get(island) ?? 0) + demand)
  }
  for (const [island, mw] of standingLossByIsland(network, islands)) {
    demandByIsland.set(island, (demandByIsland.get(island) ?? 0) + mw)
  }

  for (const store of accumulators) {
    const island = islands.islandOf.get(store.nodeId)
    const offers = (island === undefined ? undefined : offersByIsland.get(island)) ?? []
    offers.sort((a, b) => a.cost - b.cost)

    let remaining = island === undefined ? 0 : (demandByIsland.get(island) ?? 0)
    let marginalCost = offers.length > 0 ? offers[0]!.cost : Infinity
    let spareCost = Infinity
    let spareMw = 0

    for (const offer of offers) {
      const used = Math.min(offer.ceiling, remaining)
      if (used > 0) marginalCost = offer.cost
      remaining -= used
      const headroom = offer.ceiling - used
      if (headroom > 1e-6 && spareMw <= 1e-6) {
        spareCost = offer.cost
        spareMw = headroom
      } else if (headroom > 1e-6 && offer.cost === spareCost) {
        spareMw += headroom
      }
    }
    // Demand this island cannot meet at all: nothing to arbitrage, and the store should give
    // everything it has.
    const short = remaining > 1e-6

    const rating = Math.max(0, params.get(store.id, Param.CapacityMw) * params.get(store.id, Param.Availability))
    const eta = heatStoreEfficiency(store)
    const capacity = heatStoreCapacityMwh(store)
    const stored = Math.max(0, Math.min(capacity, store.heatStoredMwhth))
    const varOpex = params.get(store.id, Param.VarOpexPerMwh)

    // What it would cost to put back whatever comes out. Infinite if nothing cheap is spare,
    // in which case emptying the store is a decision to be short later, not an arbitrage.
    const refillCost = Number.isFinite(spareCost) ? spareCost / eta : Infinity
    const dischargeCeiling = Math.min(rating, stored * eta)
    const headroomMwh = Math.max(0, capacity - stored)
    const chargeMw = Math.min(rating, spareMw, headroomMwh / eta)

    let plan: AccumulatorPlan = {
      plantId: store.id,
      mode: 'idle',
      chargeMw: 0,
      dischargeCeilingMw: 0,
      offerPricePerMwh: 0,
    }

    if (dischargeCeiling > 1e-6 && (short || marginalCost > refillCost + varOpex)) {
      plan = {
        plantId: store.id,
        mode: 'discharging',
        chargeMw: 0,
        dischargeCeilingMw: dischargeCeiling,
        // Priced at replacement cost, so the solver uses it ahead of anything dearer and
        // leaves it alone when something cheaper is available.
        offerPricePerMwh: short ? -1 : refillCost + varOpex,
      }
    } else if (chargeMw > 1e-6 && Number.isFinite(spareCost) && !short) {
      plan = {
        plantId: store.id,
        mode: 'charging',
        chargeMw,
        dischargeCeilingMw: 0,
        offerPricePerMwh: spareCost,
      }
    }
    plans.set(store.id, plan)
  }

  return plans
}

/** Standing loss of every energised pipe, totalled per island. */
function standingLossByIsland(network: Network, islands: Islands): Map<number, number> {
  const out = new Map<number, number>()
  for (const edge of network.activeEdges('heat')) {
    const island = islands.islandOf.get(edge.from)
    if (island === undefined) continue
    out.set(island, (out.get(island) ?? 0) + standingLossOf(edge))
  }
  return out
}

/** Heat lost from one pipe: constant per kilometre, independent of what it is carrying. */
function standingLossOf(edge: GridEdge): number {
  if (edge.dn === undefined || !isPipeSize(edge.dn)) return 0
  const type = HEAT_PIPE_TYPES[edge.dn]
  // Two parallel mains lose twice as much: the insulated surface doubles with them.
  return pipeStandingLossMw(type.standingLossMwPerKm.value, edge.lengthKm) * Math.max(1, edge.circuits)
}

function pipeCapacityOf(edge: GridEdge): number {
  if (edge.dn === undefined || !isPipeSize(edge.dn)) return 0
  return HEAT_PIPE_TYPES[edge.dn].capacityMwth.value * Math.max(1, edge.circuits)
}

/**
 * Solve one hour of heat.
 *
 * Returns both the heat delivered and — the part the rest of the simulation needs — what each
 * cogeneration unit's heat duty now forces it to do with its electricity.
 */
export function dispatchHeat(input: HeatDispatchInput): HeatResult {
  const { network, plants, cities, params, carbonPrice, electricityPricePerMwh, islands } = input

  const heatEdges = network.activeEdges('heat')
  const sources = plants.filter(isHeatDispatchable)
  const commitments = new Map<string, ChpCommitment>()

  const empty: HeatResult = {
    heatMw: new Map(),
    servedHeatMw: new Map(),
    unservedHeatMw: new Map(),
    pipeFlowMw: new Map(),
    totalHeatDemandMw: 0,
    totalHeatSuppliedMw: 0,
    totalHeatLossMw: 0,
    totalUnservedHeatMw: 0,
    pumpingDemandMw: new Map(),
    totalVariableCost: 0,
    commitments,
    aborted: false,
  }
  // No pipes and no heat plant means no heat system, and the whole solve can be skipped. This
  // is the common case in a scenario without district heating, and it costs one comparison.
  if (heatEdges.length === 0 && sources.length === 0) return empty

  const accumulatorPlans = planAccumulators(input)

  const nodeIds = network.nodeIds()
  const indexOf = new Map<NodeId, number>()
  nodeIds.forEach((id, i) => indexOf.set(id, i))
  const source = nodeIds.length
  const sink = nodeIds.length + 1

  const maxEdges = sources.length * 2 + cities.length * 2 + heatEdges.length * 4 + 8
  const solver = new MinCostFlowSolver(nodeIds.length + 2, maxEdges)
  solver.reset()

  // Backpressure cogeneration can bid below zero — see `heatMarginalCostPerMwh`. Shifting every
  // injection arc by a constant keeps Dijkstra's non-negativity requirement without changing
  // which solution is cheapest, exactly as in the electrical dispatch.
  let minBid = 0
  for (const plant of sources) {
    if (isHeatStore(plant)) continue
    const cost = heatMarginalCostPerMwh(plant, params, carbonPrice, electricityPricePerMwh)
    if (Number.isFinite(cost)) minBid = Math.min(minBid, cost)
  }
  for (const plan of accumulatorPlans.values()) {
    if (plan.mode === 'discharging') minBid = Math.min(minBid, plan.offerPricePerMwh)
  }
  const costShift = minBid < 0 ? -minBid : 0

  const supplyArcs: Array<{ plant: PlantAsset; arc: number; cost: number }> = []
  const storeArcs: Array<{ plantId: string; dischargeArc: number; chargeArc: number; forgoArc: number }> = []
  let storeChargeDemand = 0

  for (const plant of sources) {
    const node = indexOf.get(plant.nodeId)
    if (node === undefined) continue

    if (isHeatStore(plant)) {
      const plan = accumulatorPlans.get(plant.id)
      if (!plan || plan.mode === 'idle') continue
      if (plan.mode === 'discharging') {
        const arc = solver.addArc(source, node, plan.dischargeCeilingMw, plan.offerPricePerMwh + costShift)
        storeArcs.push({ plantId: plant.id, dischargeArc: arc, chargeArc: -1, forgoArc: -1 })
      } else {
        // Charging is demand, but the town comes first: if the network turns out to be short,
        // the tank goes without rather than a radiator going cold.
        const chargeArc = solver.addArc(node, sink, plan.chargeMw, 0)
        const forgoArc = solver.addArc(
          source,
          node,
          plan.chargeMw,
          (input.prices ?? BASE_PRICES).forgoneChargePricePerMwh + costShift,
        )
        storeChargeDemand += plan.chargeMw
        storeArcs.push({ plantId: plant.id, dischargeArc: -1, chargeArc, forgoArc })
      }
      continue
    }

    const ceiling = heatCeilingMw(plant, params)
    if (ceiling <= 0) continue
    const cost = heatMarginalCostPerMwh(plant, params, carbonPrice, electricityPricePerMwh)
    if (!Number.isFinite(cost)) continue
    const arc = solver.addArc(source, node, ceiling, cost + costShift)
    supplyArcs.push({ plant, arc, cost })
  }

  const demandArcs: Array<{ city: CityAsset; serveArc: number; unservedArc: number; demand: number }> = []
  let totalDemand = storeChargeDemand
  let cityDemand = 0
  for (const city of cities) {
    const node = indexOf.get(city.nodeId)
    if (node === undefined) continue
    const demand = Math.max(0, params.getOr(city.id, Param.HeatDemandMw, 0))
    if (demand <= 0) continue
    if (!hasHeatConnection(islands, city.nodeId)) continue
    cityDemand += demand
    totalDemand += demand
    const serveArc = solver.addArc(node, sink, demand, 0)
    const unservedArc = solver.addArc(source, node, demand, (input.prices ?? BASE_PRICES).valueOfLostHeatPerMwh + costShift)
    demandArcs.push({ city, serveArc, unservedArc, demand })
  }

  // Standing losses, known before the solve because they do not depend on the flow. Half at
  // each end of the pipe, which is as good as any split for a loss spread along its length.
  const lossArcs: Array<{ serveArc: number; unservedArc: number }> = []
  const lossAtNode = new Map<NodeId, number>()
  for (const edge of heatEdges) {
    const loss = standingLossOf(edge)
    if (loss <= 0) continue
    lossAtNode.set(edge.from, (lossAtNode.get(edge.from) ?? 0) + loss / 2)
    lossAtNode.set(edge.to, (lossAtNode.get(edge.to) ?? 0) + loss / 2)
  }
  for (const [nodeId, mw] of lossAtNode) {
    const node = indexOf.get(nodeId)
    if (node === undefined) continue
    totalDemand += mw
    const serveArc = solver.addArc(node, sink, mw, 0)
    const unservedArc = solver.addArc(source, node, mw, (input.prices ?? BASE_PRICES).valueOfLostHeatPerMwh + costShift)
    lossArcs.push({ serveArc, unservedArc })
  }

  const tieBreak = (input.prices ?? BASE_PRICES).wheelingTieBreakPerMwh
  const pipeArcs: Array<{ edgeId: string; fwd: number; rev: number }> = []
  for (const edge of heatEdges) {
    const a = indexOf.get(edge.from)
    const b = indexOf.get(edge.to)
    if (a === undefined || b === undefined) continue
    const capacity = params.getOr(edge.id, Param.PipeCapacityMwth, pipeCapacityOf(edge))
    pipeArcs.push({
      edgeId: edge.id,
      fwd: solver.addArc(a, b, capacity, tieBreak),
      rev: solver.addArc(b, a, capacity, tieBreak),
    })
  }

  if (totalDemand <= 0) return empty

  const result = solver.solve(source, sink, totalDemand)

  const heatMw = new Map<string, number>()
  let totalHeatSuppliedMw = 0
  let totalVariableCost = 0
  for (const { plant, arc, cost } of supplyArcs) {
    const mw = solver.flowOf(arc)
    heatMw.set(plant.id, mw)
    totalHeatSuppliedMw += mw
    totalVariableCost += mw * cost
  }
  for (const { plantId, dischargeArc, chargeArc, forgoArc } of storeArcs) {
    let mw = 0
    if (dischargeArc >= 0) {
      mw = solver.flowOf(dischargeArc)
      totalHeatSuppliedMw += mw
    } else if (chargeArc >= 0) {
      const charged = Math.max(0, solver.flowOf(chargeArc) - (forgoArc >= 0 ? solver.flowOf(forgoArc) : 0))
      mw = -charged
    }
    heatMw.set(plantId, mw)
  }

  const servedHeatMw = new Map<string, number>()
  const unservedHeatMw = new Map<string, number>()
  let totalUnservedHeatMw = 0
  for (const { city, serveArc, unservedArc } of demandArcs) {
    const unserved = solver.flowOf(unservedArc)
    servedHeatMw.set(city.id, Math.max(0, solver.flowOf(serveArc) - unserved))
    unservedHeatMw.set(city.id, Math.max(0, unserved))
    totalUnservedHeatMw += Math.max(0, unserved)
  }

  let totalHeatLossMw = 0
  for (const { serveArc, unservedArc } of lossArcs) {
    const shortfall = solver.flowOf(unservedArc)
    totalHeatLossMw += solver.flowOf(serveArc) - shortfall
    totalUnservedHeatMw += shortfall
  }

  const pipeFlowMw = new Map<string, number>()
  const pumpingDemandMw = new Map<NodeId, number>()
  for (const { edgeId, fwd, rev } of pipeArcs) {
    const net = solver.flowOf(fwd) - solver.flowOf(rev)
    pipeFlowMw.set(edgeId, net)
    const edge = network.requireEdge(edgeId)
    if (edge.dn === undefined || !isPipeSize(edge.dn)) continue
    // Circulating pumps are the heat network's own electricity bill. Small, but it is a real
    // link between the two commodities and the only one that runs the other way.
    const pumping = Math.abs(net) * HEAT_PIPE_TYPES[edge.dn].pumpingPowerFraction.value
    if (pumping <= 0) continue
    pumpingDemandMw.set(edge.from, (pumpingDemandMw.get(edge.from) ?? 0) + pumping / 2)
    pumpingDemandMw.set(edge.to, (pumpingDemandMw.get(edge.to) ?? 0) + pumping / 2)
  }

  for (const { plant } of supplyArcs) {
    const type = PLANT_TYPES[plant.typeId]
    if (!type.chp) continue
    const q = heatMw.get(plant.id) ?? 0
    commitments.set(plant.id, {
      plantId: plant.id,
      mode: type.chp.mode,
      heatMw: q,
      forcedOutputMw: type.chp.mode === 'backpressure' ? q * type.chp.powerPerHeat.value : null,
      capacityDerateMw: type.chp.mode === 'extraction' ? q * type.chp.powerLossPerHeat.value : 0,
    })
  }

  return {
    heatMw,
    servedHeatMw,
    unservedHeatMw,
    pipeFlowMw,
    totalHeatDemandMw: cityDemand,
    totalHeatSuppliedMw,
    totalHeatLossMw,
    totalUnservedHeatMw,
    pumpingDemandMw,
    totalVariableCost,
    commitments,
    aborted: result.aborted,
  }
}

/**
 * Whether this node is on a heat network at all.
 *
 * A city with no pipe to it heats itself, house by house, and is outside this simulation. Only
 * a city actually connected to a network can be left cold by the utility, so this is the line
 * between "not our business" and "failure to supply".
 */
function hasHeatConnection(islands: Islands, nodeId: NodeId): boolean {
  const island = islands.islandOf.get(nodeId)
  if (island === undefined) return false
  return (islands.edges[island]?.length ?? 0) > 0
}

/**
 * Move heat into and out of an accumulator once the hour is settled.
 *
 * As with the electrical store, only the heat that was *actually* delivered counts. Crediting
 * a planned charge that the solver then curtailed would create heat out of nothing, which is
 * precisely the bug that got past the tests the first time round in `dispatch/storage.ts`.
 */
export function settleHeatStore(plant: PlantAsset, deliveredMw: number): void {
  if (!isHeatStore(plant)) return
  const eta = heatStoreEfficiency(plant)
  const capacity = heatStoreCapacityMwh(plant)
  const standingLoss = PLANT_TYPES[plant.typeId].heatOnly?.standingLossPerHour?.value ?? 0

  if (deliveredMw > 0) {
    plant.heatStoredMwhth -= deliveredMw / eta
  } else if (deliveredMw < 0) {
    plant.heatStoredMwhth += -deliveredMw * eta
  }
  // The tank cools whether or not anyone touched it, which is what limits how long heat can
  // usefully be kept.
  plant.heatStoredMwhth *= 1 - standingLoss
  plant.heatStoredMwhth = Math.max(0, Math.min(capacity, plant.heatStoredMwhth))
  plant.heatOutputMw = deliveredMw
}
