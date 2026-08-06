/**
 * Can the opening scenario actually be finished?
 *
 * `tests/autoPlayer.ts` answers a narrower question — that the scenario is *playable*, and that a
 * deliberately naive strategy's decisions reach the simulation. It loses, and the test says so
 * rather than pretending otherwise. What it cannot tell you is whether that is the scenario being
 * hard or the bot being bad, because a bot that loses is consistent with both.
 *
 * This probe separates the two by fixing the bot's known weaknesses one at a time and watching
 * which one flips the result. Each is a thing a person would obviously do and the scripted player
 * does not:
 *
 * 1. **Reserve against the megawatts that will turn up, not the ones on the nameplate.** This is
 *    the big one, and it was already suspected: `firmCapacityMw` sums `type.capacityMw`, which is
 *    what the unit produced when it was new. A fleet two thirds through its life has lost output
 *    to wear, loses more to forced outages, and since the wear-out model some of it is failing
 *    beyond repair. A planner working from the nameplate is satisfied every year and watches the
 *    lights go out anyway.
 *
 * 2. **Refurbish.** An overhaul costs about half of new capacity and returns the unit better than
 *    it was. A player who only ever builds new is leaving the cheapest capacity on the table.
 *
 * 3. **Both.**
 *
 * The output is four runs — the baseline and the three variants — reported against the four
 * *required* objectives. Anything that finishes with all four met is a proof the scenario can be
 * won; a run that fails is only evidence about that strategy.
 *
 * Run: npx tsx scripts/canItBeWon.ts
 */

import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '../src/content/plantTypes'
import { FUELS } from '../src/content/fuels'
import { VOLTAGE_LEVELS, type VoltageLevel } from '../src/content/lineTypes'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { buildWorld } from '../src/sim/scenario/build'
import { LifecyclePhase } from '../src/sim/assets/types'
import { lifeFraction } from '../src/sim/assets/aging'
import { Param } from '../src/sim/params/types'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { judgeSite } from '../src/sim/build/siting'
import { tileDistance } from '../src/sim/grid/network'
import {
  beginLineConstruction,
  beginPlantConstruction,
  quoteLine,
  quotePlant,
  quoteRefurbishment,
  quoteTargetFor,
  refurbishPlant,
  retirePlant,
} from '../src/sim/build/commands'
import type { World } from '../src/sim/world'

interface Strategy {
  name: string
  /** Count capacity as the dispatch will actually see it, rather than as the catalogue lists it. */
  deratedReserve: boolean
  /** Overhaul a worn unit when that is cheaper than replacing it. */
  refurbish: boolean
}

const LOAD_FACTOR: Record<string, number> = { none: 0.55, wind: 0.28, solar: 0.13, riverflow: 0.45 }

/** Nameplate firm capacity: what the catalogue says, which is what the naive planner counts. */
function namePlateFirmMw(world: World): number {
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
 * Firm capacity as the dispatch will see it: through the modifier pipeline, and discounted for
 * the chance the unit is simply not there when asked.
 *
 * Plant under construction is counted at its nameplate, because that is what it will be when it
 * arrives — the point of the discount is wear, not optimism about the future.
 */
function effectiveFirmMw(world: World): number {
  let mw = 0
  for (const plant of world.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (type.weatherDependence !== 'none' || type.heatOnly) continue
    if (plant.phase === LifecyclePhase.Building) {
      mw += type.capacityMw.value
      continue
    }
    if (plant.phase !== LifecyclePhase.Operating) continue
    const capacity = world.params.get(plant.id, Param.CapacityMw)
    const availability = world.params.getOr(plant.id, Param.Availability, 1)
    mw += capacity * Math.max(0, Math.min(1, availability)) * (1 - type.forcedOutageRate.value)
  }
  return mw
}

function marginalCost(world: World, plantId: string, typeId: PlantTypeId): number {
  const type = PLANT_TYPES[typeId]
  if (type.fuel === 'none') return world.params.getOr(plantId, Param.VarOpexPerMwh, 0)
  const efficiency = Math.max(0.05, world.params.get(plantId, Param.Efficiency))
  const fuel = world.params.get(plantId, Param.FuelPricePerMwhThermal)
  const carbon = FUELS[type.fuel].co2PerMwhThermal.value * world.state.carbonPricePerTonne
  return world.params.getOr(plantId, Param.VarOpexPerMwh, 0) + (fuel + carbon) / efficiency
}

/**
 * The same crude levelised cost the scripted player uses, from the game's own parameters.
 *
 * Lifted verbatim from `tests/autoPlayer.ts` rather than rewritten, and the first version here
 * was rewritten and was wrong: it left the capital term a thousand times too large against the
 * fuel term, so every ranking came back "build the cheapest thing to build" whatever it cost to
 * run. It duly chose gas turbines eleven times. A comparison of strategies is only worth
 * anything if both sides are choosing by the same rule.
 */
function levelisedCost(world: World, typeId: PlantTypeId, capacityFactor: number): number {
  const type = PLANT_TYPES[typeId]
  const target = quoteTargetFor(typeId)
  const capexPerKw = world.params.get(target, Param.CapexPerKw)
  const fixedPerKwYear = world.params.get(target, Param.FixedOpexPerKwYear)
  const efficiency = Math.max(0.05, world.params.get(target, Param.Efficiency))
  const life = Math.max(5, type.designLifeYears.value)

  const mwhPerMwYear = Math.max(1, capacityFactor * TICKS_PER_YEAR)
  const capitalPerMwYear = (capexPerKw * 1000) / life
  const fixedPerMwYear = fixedPerKwYear * 1000

  const fuel = FUELS[type.fuel]
  const fuelPerMwh =
    type.fuel === 'none'
      ? 0
      : (fuel.pricePerMwhThermal.value * (world.state.fuelPriceIndex[type.fuel] ?? 1)) / efficiency
  const carbonPerMwh =
    type.fuel === 'none' ? 0 : (fuel.co2PerMwhThermal.value * world.state.carbonPricePerTonne) / efficiency

  return (
    (capitalPerMwYear + fixedPerMwYear) / mwhPerMwYear + type.varOpexPerMwh.value + fuelPerMwh + carbonPerMwh
  )
}

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
      let nearest = Infinity
      for (const city of world.cities) {
        const node = world.network.getNode(city.nodeId)
        if (node) nearest = Math.min(nearest, tileDistance(node, { x, y } as never))
      }
      const score = verdict.quality * 2 - nearest / 20
      if (!best || score > best.score) best = { x, y, score }
    }
  }
  return best ? { x: best.x, y: best.y } : null
}

function play(strategy: Strategy) {
  const world = buildWorld(FIRST_REGION)
  const reserve = 1.15
  const firmMw = strategy.deratedReserve ? effectiveFirmMw : namePlateFirmMw
  const built: string[] = []
  const refurbished: string[] = []
  const retired: string[] = []
  let peakDemandMw = 0
  let lastMonth = -1

  while (world.date.year < world.scenario.endYear && !world.finances.bankrupt) {
    world.step()
    const demand = world.lastDispatch?.totalDemandMw ?? 0
    if (demand > peakDemandMw) peakDemandMw = demand

    const date = world.date
    if (date.month === lastMonth) continue
    lastMonth = date.month

    // 1. Retire what is past its design life, but never before the lights can spare it.
    //
    //    Weather-dependent plant is exempt, and finding out why was worth the run. The test is
    //    against *firm* capacity, and a wind farm or a run-of-river station contributes none —
    //    so closing one costs nothing in this arithmetic and the check waves it through every
    //    time. The baseline run duly demolished the region's hydro station in 2004: the oldest
    //    asset on the system, the cheapest thing on it, and the one a real utility rebuilds
    //    rather than removes. A planner that only counts firmness will always give away energy
    //    for free, because energy is not the thing it is counting.
    for (const plant of world.plants) {
      if (plant.phase !== LifecyclePhase.Operating) continue
      if (lifeFraction(plant, world.tick) < 1) continue
      const type = PLANT_TYPES[plant.typeId]
      if (type.heatOnly || type.weatherDependence !== 'none') continue
      if (firmMw(world) - type.capacityMw.value < peakDemandMw * reserve) continue
      if (retirePlant(world, plant.id).ok) retired.push(`${date.year}: ${plant.id}`)
    }

    // 2. Close what burns money every hour it runs, if the capacity is genuinely spare.
    const spare = firmMw(world) - peakDemandMw * reserve
    if (spare > 0) {
      for (const plant of world.plants) {
        if (plant.phase !== LifecyclePhase.Operating) continue
        const type = PLANT_TYPES[plant.typeId]
        if (type.heatOnly || type.chp || type.weatherDependence !== 'none') continue
        const marginal = marginalCost(world, plant.id, plant.typeId)
        if (marginal < world.state.regulatedTariffPerMwh) continue
        if (type.capacityMw.value > spare) continue
        if (retirePlant(world, plant.id).ok) {
          retired.push(`${date.year}: ${plant.id} (uneconomic at ${Math.round(marginal)}/MWh)`)
          break
        }
      }
    }

    // 3. Overhaul before replacing. The cheapest megawatt is usually one you already own — and
    //    unlike a new station it comes back in months rather than years, which is the part that
    //    matters when the fleet is wearing out faster than anything can be built.
    if (strategy.refurbish) {
      for (const plant of world.plants) {
        if (plant.phase !== LifecyclePhase.Operating) continue
        const type = PLANT_TYPES[plant.typeId]
        if (type.heatOnly) continue
        if (plant.conditionPct > 0.75) continue
        // Only when the fleet can spare it, for the same reason retirement waits.
        const lost = type.weatherDependence === 'none' ? world.params.get(plant.id, Param.CapacityMw) : 0
        if (firmMw(world) - lost < peakDemandMw * reserve) continue
        const quote = quoteRefurbishment(world, plant.id)
        if (!quote.ok) continue
        if (refurbishPlant(world, plant.id).ok) {
          refurbished.push(`${date.year}: ${plant.id}`)
          break
        }
      }
    }

    // 4. Hold the reserve margin. Build the cheapest firm thing that can stand here today.
    if (firmMw(world) >= peakDemandMw * reserve) continue

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
      if (kv * 2.5 < capacity && kv !== 400) continue
      if (!quoteLine(world, node.id, nearest.id, kv, 1).ok) continue
      beginLineConstruction(world, node.id, nearest.id, kv, 1)
      break
    }
  }

  world.judgeObjectives()
  const sold = world.lifetimeLedger.energySoldMwh
  const unserved = world.lifetimeLedger.energyUnservedMwh
  return {
    strategy: strategy.name,
    outcome: world.outcome,
    year: world.date.year,
    cash: world.finances.cash,
    debt: world.finances.debt,
    peakDemandMw,
    nameplateMw: namePlateFirmMw(world),
    effectiveMw: effectiveFirmMw(world),
    unservedShare: sold + unserved > 0 ? unserved / (sold + unserved) : 0,
    carbonIntensity: sold > 0 ? world.lifetimeLedger.co2Tonnes / sold : 0,
    built,
    refurbished,
    retired,
    objectives: world.scenario.objectives.map((o) => ({
      id: o.id,
      required: o.required,
      status: world.objectives.find((p) => p.id === o.id)?.status ?? 'pending',
    })),
  }
}

const STRATEGIES: Strategy[] = [
  { name: 'baseline (nameplate reserve, no overhauls)', deratedReserve: false, refurbish: false },
  { name: 'derated reserve', deratedReserve: true, refurbish: false },
  { name: 'overhauls', deratedReserve: false, refurbish: true },
  { name: 'derated reserve + overhauls', deratedReserve: true, refurbish: true },
]

for (const strategy of STRATEGIES) {
  const r = play(strategy)
  const required = r.objectives.filter((o) => o.required)
  const met = required.filter((o) => o.status === 'met').length
  console.log('')
  console.log('='.repeat(78))
  console.log(r.strategy.toUpperCase())
  console.log('='.repeat(78))
  console.log(
    `  ${r.outcome} in ${r.year} — required objectives met ${met}/${required.length}`,
    `\n  cash ${Math.round(r.cash / 1e6)}m  debt ${Math.round(r.debt / 1e6)}m`,
    `\n  peak ${Math.round(r.peakDemandMw)} MW  nameplate ${Math.round(r.nameplateMw)} MW  effective ${Math.round(r.effectiveMw)} MW`,
    `\n  unserved ${(r.unservedShare * 100).toFixed(3)}%  intensity ${r.carbonIntensity.toFixed(2)} t/MWh`,
  )
  for (const o of r.objectives) {
    console.log(`    ${o.status === 'met' ? '✓' : o.status === 'failed' ? '✗' : '·'} ${o.id}${o.required ? '' : ' (optional)'} — ${o.status}`)
  }
  console.log('  built:', r.built.length ? r.built.join('; ') : 'nothing')
  console.log('  overhauled:', r.refurbished.length ? r.refurbished.join('; ') : 'nothing')
  console.log('  retired:', r.retired.length ? r.retired.join('; ') : 'nothing')
}
