/**
 * A competent player, scripted.
 *
 * Every balance measurement in this project until now watched a utility that did *nothing*: no
 * retirements, no replacements, no lines. That is a useful control and a terrible target. It
 * meant hours of tuning the tariff, the carbon price and the cost trends against a run in which
 * the player never made a decision — while the question that actually matters, whether a person
 * playing well can finish the scenario, was answered by no test at all. The one test called
 * "can actually be won" assembles the winning state by hand rather than playing to it.
 *
 * So this plays. Not well — it has no strategy, no foresight beyond a year, and no idea that
 * technologies get cheaper. It is a floor, not a ceiling: if *this* can finish, a person can.
 *
 * ## Why it must not know what to build
 *
 * The obvious way to write this is to have it build gas turbines, because gas turbines are cheap
 * and quick and would make the test pass. That would quietly turn the neutrality guarantee inside
 * out: the balance target would become "the scenario is winnable by the technology the test
 * author picked", and any content change that made that technology worse would look like a
 * scenario that had become unwinnable.
 *
 * Instead it ranks whatever is available on a crude levelised cost computed from the same
 * parameters the game charges it — and it recomputes that every time, so a technology that gets
 * cheaper gets chosen later without anybody telling it to. Which technology wins is an *output*
 * of this harness, not an input, and is worth looking at.
 */

import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { VOLTAGE_LEVELS, type VoltageLevel } from '@content/lineTypes'
import { isDispatchable, LifecyclePhase } from '@sim/assets/types'
import { lifeFraction } from '@sim/assets/aging'
import { Param } from '@sim/params/types'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { judgeSite } from '@sim/build/siting'
import { tileDistance } from '@sim/grid/network'
import {
  beginLineConstruction,
  beginPlantConstruction,
  quoteLine,
  quotePlant,
  quoteTargetFor,
  retirePlant,
} from '@sim/build/commands'
import type { World } from '@sim/world'

export interface PlayOptions {
  /** How much dispatchable capacity to hold above the highest demand seen, as a fraction. */
  reserveMargin?: number
  /** Stop early, for a quicker test. Defaults to the scenario's own end year. */
  untilYear?: number
  /** Called once a year with a one-line summary, for a harness that wants to print progress. */
  onYear?: (line: string) => void
}

export interface PlayResult {
  outcome: string
  year: number
  cash: number
  debt: number
  peakDemandMw: number
  firmCapacityMw: number
  unservedShare: number
  carbonIntensity: number
  /** What it chose to build, in order. The most interesting output here. */
  built: string[]
  retired: string[]
  objectives: Array<{ id: string; status: string; required: boolean }>
}

/**
 * A crude levelised cost, in euros per MWh, from the parameters the game will actually charge.
 *
 * Deliberately simple and deliberately *not* tuned: annualised capital at a flat rate, fixed and
 * variable operating cost, fuel at the plant's efficiency, and carbon at the price in force. No
 * discounting, no residual value, no learning. A real investor's model is far better than this,
 * and a real investor still gets it wrong; what matters here is that it uses no number the game
 * does not use and expresses no preference the content does not justify.
 */
function levelisedCost(world: World, typeId: PlantTypeId, capacityFactor: number): number {
  const type = PLANT_TYPES[typeId]
  const target = quoteTargetFor(typeId)
  const capexPerKw = world.params.get(target, Param.CapexPerKw)
  const fixedPerKwYear = world.params.get(target, Param.FixedOpexPerKwYear)
  const efficiency = Math.max(0.05, world.params.get(target, Param.Efficiency))
  const life = Math.max(5, type.designLifeYears.value)

  const hours = Math.max(1, capacityFactor * TICKS_PER_YEAR)
  const mwhPerMwYear = hours

  const capitalPerMwYear = (capexPerKw * 1000) / life
  const fixedPerMwYear = fixedPerKwYear * 1000

  const fuel = FUELS[type.fuel]
  const fuelPerMwh = type.fuel === 'none' ? 0 : (fuel.pricePerMwhThermal.value * (world.state.fuelPriceIndex[type.fuel] ?? 1)) / efficiency
  const carbonPerMwh =
    type.fuel === 'none' ? 0 : (fuel.co2PerMwhThermal.value * world.state.carbonPricePerTonne) / efficiency

  return (
    (capitalPerMwYear + fixedPerMwYear) / mwhPerMwYear + type.varOpexPerMwh.value + fuelPerMwh + carbonPerMwh
  )
}

/**
 * Roughly what share of the year each kind of plant runs.
 *
 * Sourced from nothing and meant to be crude: it exists so an intermittent technology is not
 * costed as though it produced around the clock, which would make it look several times better
 * than it is. Wrong in detail, right in ordering, and it is the harness's opinion rather than
 * the game's — no simulation code reads it.
 */
const LOAD_FACTOR: Record<string, number> = {
  none: 0.5,
  wind: 0.28,
  solar: 0.13,
  riverflow: 0.45,
}

/** What one more megawatt-hour out of this machine costs right now. */
function marginalCost(world: World, plantId: string, typeId: PlantTypeId): number {
  const type = PLANT_TYPES[typeId]
  if (type.fuel === 'none') return world.params.getOr(plantId, Param.VarOpexPerMwh, 0)
  const efficiency = Math.max(0.05, world.params.get(plantId, Param.Efficiency))
  const fuel = world.params.get(plantId, Param.FuelPricePerMwhThermal)
  const carbon = FUELS[type.fuel].co2PerMwhThermal.value * world.state.carbonPricePerTonne
  return world.params.getOr(plantId, Param.VarOpexPerMwh, 0) + (fuel + carbon) / efficiency
}

/** Somewhere this technology will actually stand, as near the demand as the rules allow. */
function siteFor(world: World, typeId: PlantTypeId): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null
  for (let y = 0; y < world.scenario.mapHeight; y++) {
    for (let x = 0; x < world.scenario.mapWidth; x++) {
      if (world.nodeNear(x, y, 1.5)) continue
      const verdict = judgeSite(typeId, {
        terrain: world.terrain,
        network: world.network,
        cities: world.cities,
        x,
        y,
      })
      if (!verdict.ok) continue
      // Close to an existing node keeps the connection cheap; a good site is worth a detour.
      let nearest = Infinity
      for (const node of world.network.allNodes()) {
        nearest = Math.min(nearest, Math.hypot(node.x - x, node.y - y))
      }
      const score = (verdict.quality ?? 0.5) * 10 - nearest
      if (!best || score > best.score) best = { x, y, score }
    }
  }
  return best
}

/** Firm capacity in service or on its way: what the lights actually depend on. */
function firmCapacityMw(world: World): number {
  let mw = 0
  for (const plant of world.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (type.weatherDependence !== 'none' || type.heatOnly) continue
    if (plant.phase === LifecyclePhase.Operating || plant.phase === LifecyclePhase.Building) {
      mw += type.capacityMw.value
    }
  }
  return mw
}

/**
 * Play the scenario to its end year.
 *
 * Decisions are taken once a month, which is roughly how often a utility's board meets and is
 * frequent enough that a shortfall is noticed within a season.
 */
export function playScenario(world: World, options: PlayOptions = {}): PlayResult {
  const reserve = options.reserveMargin ?? 1.15
  const untilYear = options.untilYear ?? world.scenario.endYear
  const built: string[] = []
  const retired: string[] = []

  let peakDemandMw = 0
  let lastDecisionMonth = -1

  while (world.date.year < untilYear && !world.finances.bankrupt) {
    world.step()
    const demand = world.lastDispatch?.totalDemandMw ?? 0
    if (demand > peakDemandMw) peakDemandMw = demand

    const date = world.date
    if (date.month === lastDecisionMonth) continue
    lastDecisionMonth = date.month
    if (date.month === 0) {
      options.onYear?.(
        `${date.year} firm ${Math.round(firmCapacityMw(world))}MW peak ${Math.round(peakDemandMw)}MW ` +
          `cash ${Math.round(world.finances.cash / 1e6)}m debt ${Math.round(world.finances.debt / 1e6)}m ` +
          `tariff ${Math.round(world.state.regulatedTariffPerMwh)} carbon ${Math.round(world.state.carbonPricePerTonne)} ` +
          `gov ${world.state.policyRegimeId}`,
      )
    }

    // 1. Retire what has run past its design life — but only if the lights can spare it.
    //
    //    The first version of this player retired unconditionally, and it is worth recording why
    //    that was wrong, because it looked like diligence. Closing an end-of-life station the
    //    month it expires, before its replacement exists, drops firm capacity below peak demand
    //    for however many years the replacement takes to build. It produced 1.5% unserved energy
    //    against an objective of 0.1% — fifteen times over — and made the scenario look
    //    unwinnable when what was actually broken was the order of two decisions. A real utility
    //    runs a tired plant past its design life precisely until the new one is ready.
    for (const plant of world.plants) {
      if (plant.phase !== LifecyclePhase.Operating) continue
      if (lifeFraction(plant, world.tick) < 1) continue
      const type = PLANT_TYPES[plant.typeId]
      if (type.heatOnly) continue
      const firmNow = firmCapacityMw(world)
      const lost = type.weatherDependence === 'none' ? type.capacityMw.value : 0
      if (firmNow - lost < peakDemandMw * reserve) continue
      const result = retirePlant(world, plant.id)
      if (result.ok) retired.push(`${date.year}: ${plant.id}`)
    }

    // 2. Close what is losing money, if the lights can spare it.
    //
    //    This is the decision the first version of this player could not make, and its absence
    //    was the whole reason it went bankrupt in 2010: it held an inherited lignite fleet all
    //    the way through a 60 EUR/t carbon price because the units had life left in them. Real
    //    utilities closed exactly those plants for exactly that reason, and a harness that cannot
    //    do it is measuring an impossible strategy rather than a hard scenario.
    const spare = firmCapacityMw(world) - peakDemandMw * reserve
    if (spare > 0) {
      for (const plant of world.plants) {
        if (plant.phase !== LifecyclePhase.Operating) continue
        const type = PLANT_TYPES[plant.typeId]
        if (type.heatOnly || type.chp) continue
        if (type.weatherDependence !== 'none') continue
        const marginal = marginalCost(world, plant.id, plant.typeId)
        // Persistently above what the utility is paid for the energy: it burns money whenever
        // it runs, and the capacity is not needed.
        if (marginal < world.state.regulatedTariffPerMwh) continue
        if (type.capacityMw.value > spare) continue
        const result = retirePlant(world, plant.id)
        if (result.ok) {
          retired.push(`${date.year}: ${plant.id} (uneconomic at ${Math.round(marginal)}/MWh)`)
          break
        }
      }
    }

    // 3. Hold a reserve margin over the highest demand seen. Nothing cleverer: no forecast, no
    //    view on prices, no plan. A floor, not a ceiling.
    const target = peakDemandMw * reserve
    if (firmCapacityMw(world) >= target) continue

    // 3. Pick the cheapest thing that can actually be built here, now, by this government.
    //    Ranked by levelised cost computed from the game's own parameters, so the answer moves
    //    as costs move and nothing is hard-coded.
    // Only firm plant, because the shortage being fixed is a shortage of *firm* capacity. An
    // earlier version ranked every technology here and cheerfully built run-of-river every month
    // for three years: hydro won on cost, does not count towards firmness, so the gap never
    // closed and it built until it went bankrupt. Choosing the cheapest thing that does not solve
    // the problem is a very easy mistake for an optimiser to make, and worth the comment.
    let choice: { typeId: PlantTypeId; site: { x: number; y: number }; cost: number } | null = null
    for (const typeId of PLANT_TYPE_IDS) {
      const type = PLANT_TYPES[typeId]
      if (type.heatOnly || type.storage) continue
      if (type.weatherDependence !== 'none') continue
      const site = siteFor(world, typeId)
      if (!site) continue
      if (!quotePlant(world, typeId, site.x, site.y).ok) continue
      const cost = levelisedCost(world, typeId, LOAD_FACTOR[type.weatherDependence] ?? 0.5)
      if (!choice || cost < choice.cost) choice = { typeId, site, cost }
    }
    if (!choice) continue

    const placed = beginPlantConstruction(world, choice.typeId, choice.site.x, choice.site.y)
    if (!placed.ok) continue
    built.push(`${date.year}: ${choice.typeId} at ${Math.round(choice.cost)}/MWh`)

    // 4. Wire it in. A station nobody can reach generates nothing, and the cheapest connection
    //    that will carry its output is the one to build.
    const plant = world.getPlant(placed.plantId!)!
    const node = world.network.requireNode(plant.nodeId)
    let nearest: { id: string; distance: number } | null = null
    for (const other of world.network.allNodes()) {
      if (other.id === node.id || other.kind === 'plant') continue
      const distance = tileDistance(other, node)
      if (!nearest || distance < nearest.distance) nearest = { id: other.id, distance }
    }
    if (!nearest) continue
    const capacity = PLANT_TYPES[choice.typeId].capacityMw.value
    for (const kv of VOLTAGE_LEVELS as readonly VoltageLevel[]) {
      // The lowest voltage that will carry the output, which is what a utility would build.
      if (kv * 2.5 < capacity && kv !== 400) continue
      if (!quoteLine(world, node.id, nearest.id, kv, 1).ok) continue
      beginLineConstruction(world, node.id, nearest.id, kv, 1)
      break
    }

    options.onYear?.(
      `${date.year}-${String(date.month + 1).padStart(2, '0')} built ${choice.typeId}, firm ${Math.round(firmCapacityMw(world))} MW, cash ${Math.round(world.finances.cash / 1e6)}m`,
    )
  }

  world.judgeObjectives()
  const sold = world.lifetimeLedger.energySoldMwh
  const unserved = world.lifetimeLedger.energyUnservedMwh
  return {
    outcome: world.outcome,
    year: world.date.year,
    cash: world.finances.cash,
    debt: world.finances.debt,
    peakDemandMw,
    firmCapacityMw: firmCapacityMw(world),
    unservedShare: sold + unserved > 0 ? unserved / (sold + unserved) : 0,
    carbonIntensity: sold > 0 ? world.lifetimeLedger.co2Tonnes / sold : 0,
    built,
    retired,
    objectives: world.scenario.objectives.map((o) => ({
      id: o.id,
      required: o.required,
      status: world.objectives.find((p) => p.id === o.id)?.status ?? 'pending',
    })),
  }
}

/** A count of dispatchable plant, for a harness that wants to sanity-check the fleet. */
export function dispatchableCount(world: World): number {
  return world.plants.filter(isDispatchable).length
}
