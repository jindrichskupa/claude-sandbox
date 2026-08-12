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
 *
 * ## Why there is more than one of them
 *
 * One scripted player proves the scenario can be finished by *that* player. It says nothing about
 * whether the content quietly rewards one technology, because there is nothing to compare it
 * against — and "no ideological thumb on the scale" is a claim about the whole space of ways to
 * play, not about the one path the author happened to script.
 *
 * So the player takes a `Strategy`: a set of convictions about what to build, what a megawatt of
 * it is worth in the worst hour, and what to close on principle. `LEAST_COST` is the original and
 * is the control; the four archetypes beside it are deliberately not sensible, because a scenario
 * that can only be finished by a shrewd investor is a scenario about investing and ought to say
 * so out loud. What each of them does to the carbon intensity, the unserved share and the money
 * is an output. If three of the four are impossible, the numbers are wrong rather than the
 * players — and that is a finding this file can produce and no amount of good intention can.
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
  /** What this utility believes. Defaults to the least-cost control this file started as. */
  strategy?: Strategy
  /** How much dispatchable capacity to hold above the highest demand seen, as a fraction. */
  reserveMargin?: number
  /** Stop early, for a quicker test. Defaults to the scenario's own end year. */
  untilYear?: number
  /** Called once a year with a one-line summary, for a harness that wants to print progress. */
  onYear?: (line: string) => void
  /** Called after every hour, for a probe that wants to measure the run rather than summarise it. */
  onTick?: () => void
}

export interface PlayResult {
  strategy: string
  outcome: string
  year: number
  cash: number
  debt: number
  peakDemandMw: number
  firmCapacityMw: number
  unservedShare: number
  carbonIntensity: number
  /** Whether the run ended because the money ran out rather than because the years did. */
  bankrupt: boolean
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
function levelisedCost(
  world: World,
  typeId: PlantTypeId,
  capacityFactor: number,
  options: { ignoreCarbon?: boolean } = {},
): number {
  const type = PLANT_TYPES[typeId]
  const target = quoteTargetFor(typeId)
  const capexPerKw = world.params.get(target, Param.CapexPerKw)
  const fixedPerKwYear = world.params.get(target, Param.FixedOpexPerKwYear)
  const efficiency = Math.max(0.05, world.params.get(target, Param.Efficiency))
  const life = Math.max(5, type.designLifeYears.value)

  const capitalPerMwYear = (capexPerKw * 1000) / life
  const fixedPerMwYear = fixedPerKwYear * 1000

  // A store is not a generator and costing it as one is a category error, not an approximation.
  // Its fuel is electricity it has to buy, and its output is bounded by how often it can be
  // cycled rather than by how many hours there are in a year. Without this branch, a machine that
  // burns nothing and is credited with running half the time comes out as the cheapest thing on
  // the board by a wide margin — and the green archetype duly built three pumped stations and
  // nothing at all to charge them from, which is the same "cheapest thing that does not solve the
  // problem" trap the comment further down describes, wearing a different hat.
  if (type.storage) {
    const store = type.storage
    // One full cycle a day is a hard-worked store and about the most either technology sees.
    const mwhPerMwYear = Math.max(1, store.energyMwh.value / type.capacityMw.value) * 365
    const bought = Math.max(5, world.systemPricePerMwh) / Math.max(0.3, store.roundTripEfficiency.value)
    return (capitalPerMwYear + fixedPerMwYear) / mwhPerMwYear + type.varOpexPerMwh.value + bought
  }

  const hours = Math.max(1, capacityFactor * TICKS_PER_YEAR)
  const mwhPerMwYear = hours

  const fuel = FUELS[type.fuel]
  const fuelPerMwh = type.fuel === 'none' ? 0 : (fuel.pricePerMwhThermal.value * (world.state.fuelPriceIndex[type.fuel] ?? 1)) / efficiency
  const carbonPerMwh =
    type.fuel === 'none' || options.ignoreCarbon
      ? 0
      : (fuel.co2PerMwhThermal.value * world.state.carbonPricePerTonne) / efficiency

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

/**
 * What a megawatt of a technology is worth towards keeping the lights on in the worst hour.
 *
 * The harness's opinion, like `LOAD_FACTOR` above, and for the same reason: no simulation code
 * reads it, and it exists so a planner can plan. A utility that will build nothing but wind still
 * has to answer "how much of this counts?" before it can decide it has built enough — and if the
 * answer were nameplate, it would stop building at a quarter of what it needs, while if it were
 * zero it would build until it was bankrupt and never stop. Neither is a strategy.
 *
 * The numbers are the ordinary shape of a capacity credit in a winter-peaking system: firm plant
 * counts fully, run-of-river counts for a good part of itself because the river is still there in
 * January, wind counts for a little, and solar counts for almost nothing because the peak is at
 * six on a dark evening. A store counts for its power rating and no more, discounted because four
 * hours of it does not cover an evening.
 */
const CAPACITY_CREDIT: Record<string, number> = {
  none: 1,
  riverflow: 0.4,
  wind: 0.15,
  solar: 0.02,
}

/**
 * What a utility believes, expressed as the four decisions that follow from believing it.
 *
 * The point of having more than one is the neutrality claim. A single scripted player proves the
 * scenario can be finished by *that* player; it says nothing about whether the content quietly
 * rewards one technology, because there is only one path through it to compare against. Four
 * players with incompatible convictions, run on the same map with the same weather, produce four
 * outcomes — and if three of them are impossible, the numbers are wrong rather than the players.
 */
export interface Strategy {
  id: string
  /** What this utility believes, in one line, for the comparison to print. */
  creed: string
  /** Whether it will build this technology at all. */
  builds: (typeId: PlantTypeId) => boolean
  /** What it counts a megawatt of this towards the worst hour of the year. */
  capacityCredit: (typeId: PlantTypeId) => number
  /**
   * Which of the things it will build it prefers. Lower wins.
   *
   * Given the levelised cost so a strategy that ranks on cost can simply return it, and the year
   * so one that ranks on novelty can reach for `availableFromYear`.
   */
  rank: (world: World, typeId: PlantTypeId, costPerMwh: number) => number
  /**
   * Whether it will close an inherited plant on principle, once the lights can spare it, rather
   * than only when the plant is worn out or losing money.
   *
   * Without this the archetypes would differ only in what they add, and every one of them would
   * carry the same inherited lignite for thirty years — so the carbon intensity, which is the
   * number that ought to separate them most, would come out nearly identical for all four and
   * prove nothing.
   */
  closesOnPrinciple: (typeId: PlantTypeId) => boolean
  /**
   * Whether it plans against the catalogue or against what will actually turn up.
   *
   * A planner that reserves against nameplate capacity is satisfied every year by a fleet that
   * is two thirds through its life, has lost output to wear, loses more to forced outages and is
   * beginning to fail beyond repair — and it watches the lights go out anyway. That is a known
   * weakness, measured in `scripts/canItBeWon.ts`, and here it is fatal for a different reason:
   * a planner who never sees a shortfall never has an investment decision to take, so four
   * utilities with four incompatible convictions build nothing and come out identical. The first
   * run of this comparison did exactly that, and the four archetypes agreed to three decimal
   * places because none of them had done anything.
   *
   * True only for `LEAST_COST`, which is the control and has to keep behaving as it did when
   * every earlier measurement was taken against it.
   */
  plansOnNameplate: boolean
}

const firmCredit = (typeId: PlantTypeId): number =>
  PLANT_TYPES[typeId].weatherDependence === 'none' && !PLANT_TYPES[typeId].storage ? 1 : 0

const creditFor = (typeId: PlantTypeId): number => {
  const type = PLANT_TYPES[typeId]
  if (type.storage) return 0.5
  return CAPACITY_CREDIT[type.weatherDependence] ?? 0
}

const isThermal = (typeId: PlantTypeId): boolean => PLANT_TYPES[typeId].category === 'thermal'

/**
 * The player every earlier measurement in this project was taken against.
 *
 * Kept exactly as it was — firm plant only, ranked on cost, weather-dependent capacity counted
 * as nothing — so that the runs recorded in `winnable.test.ts` and `paceProbe.ts` still mean what
 * they said. It is the control, not a fifth opinion.
 */
export const LEAST_COST: Strategy = {
  id: 'least-cost',
  creed: 'Whatever is cheapest per megawatt-hour and can be relied on.',
  builds: (typeId) => {
    const type = PLANT_TYPES[typeId]
    return !type.heatOnly && !type.storage && type.weatherDependence === 'none'
  },
  capacityCredit: firmCredit,
  rank: (_world, _typeId, cost) => cost,
  closesOnPrinciple: () => false,
  plansOnNameplate: true,
}

export const GREEN_ZEALOT: Strategy = {
  id: 'green',
  creed: 'Nothing that burns anything, whatever it costs.',
  builds: (typeId) => {
    const type = PLANT_TYPES[typeId]
    if (type.heatOnly) return false
    return ['wind', 'solar', 'hydro', 'storage'].includes(type.category)
  },
  capacityCredit: creditFor,
  rank: (_world, _typeId, cost) => cost,
  // Closes anything with a flue, in the order the dispatch would have run it.
  closesOnPrinciple: (typeId) => isThermal(typeId),
  plansOnNameplate: false,
}

export const FOSSIL_ZEALOT: Strategy = {
  id: 'fossil',
  creed: 'Thermal plant, and carbon is somebody else\'s problem.',
  builds: (typeId) => isThermal(typeId) && !PLANT_TYPES[typeId].heatOnly,
  capacityCredit: firmCredit,
  // Ranks on the cost *without* carbon, which is the belief rather than an error: this utility
  // does not think the carbon price will last, so it does not price it into an investment that
  // will run for forty years. It pays it every hour regardless, which is the point.
  rank: (world, typeId, _cost) => levelisedCost(world, typeId, 0.5, { ignoreCarbon: true }),
  closesOnPrinciple: () => false,
  plansOnNameplate: false,
}

export const NUCLEAR_ZEALOT: Strategy = {
  id: 'nuclear',
  creed: 'Baseload above all. Build reactors; fill the gaps with whatever is cheapest.',
  builds: (typeId) => {
    const type = PLANT_TYPES[typeId]
    return !type.heatOnly && !type.storage && type.weatherDependence === 'none'
  },
  capacityCredit: firmCredit,
  // A reactor always wins if one can be built; everything else is a stopgap ranked on cost. The
  // offset is larger than any levelised cost the content can produce, so the preference is
  // absolute rather than a heavy thumb.
  rank: (_world, typeId, cost) => (PLANT_TYPES[typeId].category === 'nuclear' ? cost - 10_000 : cost),
  closesOnPrinciple: () => false,
  plansOnNameplate: false,
}

export const NOVELTY_SEEKER: Strategy = {
  id: 'novelty',
  creed: 'Whatever is newest. The old way of doing things is the problem.',
  builds: (typeId) => !PLANT_TYPES[typeId].heatOnly,
  capacityCredit: creditFor,
  // Newest first, ties broken on cost. Nothing about this is sensible and that is the test: a
  // scenario that can only be finished by a shrewd investor is a scenario about investing, and
  // this is the archetype that says so if it is.
  rank: (_world, typeId, cost) => -PLANT_TYPES[typeId].availableFromYear.value * 1000 + cost,
  closesOnPrinciple: () => false,
  plansOnNameplate: false,
}

export const ARCHETYPES: Strategy[] = [
  LEAST_COST,
  GREEN_ZEALOT,
  FOSSIL_ZEALOT,
  NUCLEAR_ZEALOT,
  NOVELTY_SEEKER,
]

/** What one more megawatt-hour out of this machine costs right now. */
function marginalCost(world: World, plantId: string, typeId: PlantTypeId): number {
  const type = PLANT_TYPES[typeId]
  if (type.fuel === 'none') return world.params.getOr(plantId, Param.VarOpexPerMwh, 0)
  const efficiency = Math.max(0.05, world.params.get(plantId, Param.Efficiency))
  const fuel = world.params.get(plantId, Param.FuelPricePerMwhThermal)
  const carbon = FUELS[type.fuel].co2PerMwhThermal.value * world.state.carbonPricePerTonne
  return world.params.getOr(plantId, Param.VarOpexPerMwh, 0) + (fuel + carbon) / efficiency
}

/**
 * Sites already found, per world, keyed by technology and the state of the graph.
 *
 * The search below walks every tile on the map and judges it, for every technology a strategy
 * will consider, at every monthly decision. Its answer depends on the terrain, which never
 * changes, and on where the nodes are, which changes only when something is built — so between
 * two builds it returns the same site over and over at full price. With five archetypes each
 * playing thirty years it was most of the wall clock. The key is exact rather than a heuristic:
 * `topologyEpoch` is bumped by the network on every structural change, so a stale entry cannot
 * survive the thing that would have invalidated it.
 */
const siteCache = new WeakMap<World, Map<string, { x: number; y: number } | null>>()

/** Somewhere this technology will actually stand, as near the demand as the rules allow. */
function siteFor(world: World, typeId: PlantTypeId): { x: number; y: number } | null {
  let cache = siteCache.get(world)
  if (!cache) {
    cache = new Map()
    siteCache.set(world, cache)
  }
  const key = `${typeId}:${world.network.topologyEpoch}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const found = searchForSite(world, typeId)
  // One epoch's worth of answers at a time; the map would otherwise grow without bound over a
  // thirty-year run and keep every site it ever found for a graph that no longer exists.
  if (cache.size > PLANT_TYPE_IDS.length * 2) cache.clear()
  cache.set(key, found)
  return found
}

function searchForSite(world: World, typeId: PlantTypeId): { x: number; y: number } | null {
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

/**
 * Capacity in service or on its way, counted the way this utility counts it.
 *
 * Not a fact about the fleet but a belief about it, which is why the strategy supplies the
 * weights. `LEAST_COST` counts firm plant at nameplate and everything else at nothing, which is
 * exactly what this function did before there was more than one player; the others count a wind
 * farm for the part of it that can be relied on in the worst hour of the year.
 */
function plannedCapacityMw(world: World, strategy: Strategy): number {
  let mw = 0
  for (const plant of world.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (type.heatOnly) continue
    const credit = strategy.capacityCredit(plant.typeId)
    if (credit <= 0) continue
    // Plant under construction counts at its nameplate whatever the strategy believes, because
    // that is what it will be when it arrives. The discount below is for wear, not for pessimism
    // about the future.
    if (plant.phase === LifecyclePhase.Building) {
      mw += type.capacityMw.value * credit
      continue
    }
    if (plant.phase !== LifecyclePhase.Operating) continue
    if (strategy.plansOnNameplate) {
      mw += type.capacityMw.value * credit
      continue
    }
    const capacity = world.params.get(plant.id, Param.CapacityMw)
    const availability = Math.max(0, Math.min(1, world.params.getOr(plant.id, Param.Availability, 1)))
    mw += capacity * availability * (1 - type.forcedOutageRate.value) * credit
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
  const strategy = options.strategy ?? LEAST_COST
  const reserve = options.reserveMargin ?? 1.15
  const untilYear = options.untilYear ?? world.scenario.endYear
  const built: string[] = []
  const retired: string[] = []

  let peakDemandMw = 0
  let lastDecisionMonth = -1

  while (world.date.year < untilYear && !world.finances.bankrupt) {
    world.step()
    options.onTick?.()
    const demand = world.lastDispatch?.totalDemandMw ?? 0
    if (demand > peakDemandMw) peakDemandMw = demand

    const date = world.date
    if (date.month === lastDecisionMonth) continue
    lastDecisionMonth = date.month
    if (date.month === 0) {
      options.onYear?.(
        `${date.year} firm ${Math.round(plannedCapacityMw(world, strategy))}MW peak ${Math.round(peakDemandMw)}MW ` +
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
      const firmNow = plannedCapacityMw(world, strategy)
      const lost = type.capacityMw.value * strategy.capacityCredit(plant.typeId)
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
    const spare = plannedCapacityMw(world, strategy) - peakDemandMw * reserve
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

    // 2b. Close what this utility will not be seen to own, once the lights can spare it.
    //
    //     A conviction that only decides what to add is not a conviction: every archetype would
    //     carry the same inherited lignite for thirty years and come out with nearly the same
    //     carbon intensity, which is the number that ought to separate them most. The condition
    //     is the same one that governs every other closure here — capacity first, principle
    //     second — so a zealot still cannot switch the lights off to make a point.
    if (spare > 0) {
      for (const plant of world.plants) {
        if (plant.phase !== LifecyclePhase.Operating) continue
        const type = PLANT_TYPES[plant.typeId]
        if (type.heatOnly || type.chp) continue
        if (!strategy.closesOnPrinciple(plant.typeId)) continue
        if (type.capacityMw.value * strategy.capacityCredit(plant.typeId) > spare) continue
        const result = retirePlant(world, plant.id)
        if (result.ok) {
          retired.push(`${date.year}: ${plant.id} (${strategy.id} will not own it)`)
          break
        }
      }
    }

    // 3. Hold a reserve margin over the highest demand seen. Nothing cleverer: no forecast, no
    //    view on prices, no plan. A floor, not a ceiling.
    const target = peakDemandMw * reserve
    if (plannedCapacityMw(world, strategy) >= target) continue

    // 4. Pick something this utility will own that can actually be built here, now, by this
    //    government. What "best" means is the strategy's; what is *possible* is the game's, and
    //    every candidate goes through the same quote the player's own button does.
    //
    //    Anything with no capacity credit under this strategy is skipped whatever it ranks,
    //    because the shortage being fixed is a shortage of the thing the credit measures. An
    //    earlier version had no such rule and cheerfully built run-of-river every month for three
    //    years: hydro won on cost, counted for nothing, so the gap never closed and it built
    //    until it went bankrupt. Choosing the cheapest thing that does not solve the problem is a
    //    very easy mistake for an optimiser to make, and worth the comment.
    let choice: { typeId: PlantTypeId; site: { x: number; y: number }; cost: number; score: number } | null = null
    for (const typeId of PLANT_TYPE_IDS) {
      const type = PLANT_TYPES[typeId]
      if (!strategy.builds(typeId)) continue
      if (strategy.capacityCredit(typeId) <= 0) continue
      const site = siteFor(world, typeId)
      if (!site) continue
      if (!quotePlant(world, typeId, site.x, site.y).ok) continue
      const cost = levelisedCost(world, typeId, LOAD_FACTOR[type.weatherDependence] ?? 0.5)
      const score = strategy.rank(world, typeId, cost)
      if (!choice || score < choice.score) choice = { typeId, site, cost, score }
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
      `${date.year}-${String(date.month + 1).padStart(2, '0')} built ${choice.typeId}, firm ${Math.round(plannedCapacityMw(world, strategy))} MW, cash ${Math.round(world.finances.cash / 1e6)}m`,
    )
  }

  world.judgeObjectives()
  const sold = world.lifetimeLedger.energySoldMwh
  const unserved = world.lifetimeLedger.energyUnservedMwh
  return {
    strategy: strategy.id,
    outcome: world.outcome,
    bankrupt: world.finances.bankrupt,
    year: world.date.year,
    cash: world.finances.cash,
    debt: world.finances.debt,
    peakDemandMw,
    firmCapacityMw: plannedCapacityMw(world, strategy),
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
