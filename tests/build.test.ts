/**
 * Construction, retirement and the money that goes with them.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import {
  beginLineConstruction,
  beginPlantConstruction,
  mothballPlant,
  quoteLine,
  quotePlant,
  quoteRefurbishment,
  reactivatePlant,
  refurbishPlant,
  retirePlant,
} from '@sim/build/commands'
import { isBuildable, routeCostFactor } from '@sim/map/terrain'
import { judgeSite } from '@sim/build/siting'
import { lifeFraction } from '@sim/assets/aging'
import { Param } from '@sim/params/types'
import { PLANT_TYPES } from '@content/plantTypes'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

/** Find somewhere the scenario will actually accept a station of this type. */
function freeSite(world: ReturnType<typeof buildWorld>, typeId: 'ccgt' | 'ocgt' | 'nuclear' = 'ccgt') {
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
      if (verdict.ok) return { x, y }
    }
  }
  throw new Error('the scenario has nowhere to build, which is itself a bug')
}

describe('siting rules', () => {
  it('refuses water and mountains', () => {
    const world = buildWorld(FIRST_REGION)
    let refusedSomewhere = false
    for (let y = 0; y < world.scenario.mapHeight; y++) {
      for (let x = 0; x < world.scenario.mapWidth; x++) {
        if (isBuildable(world.terrain, x, y)) continue
        const quote = quotePlant(world, 'ccgt', x, y)
        expect(quote.ok).toBe(false)
        expect(quote.reasonKey).toBe('build.unsuitableGround')
        refusedSomewhere = true
      }
    }
    expect(refusedSomewhere).toBe(true)
  })

  it('refuses to stack a station on top of an existing one', () => {
    const world = buildWorld(FIRST_REGION)
    const existing = world.network.requireNode('n_central')
    const quote = quotePlant(world, 'ccgt', existing.x, existing.y)
    expect(quote.ok).toBe(false)
    expect(quote.reasonKey).toBe('build.tooClose')
  })

  it('refuses a technology that does not exist yet', () => {
    // The scenario opens in 1995. Grid-scale lithium storage does not.
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const quote = quotePlant(world, 'battery', site.x, site.y)
    expect(quote.ok).toBe(false)
    expect(quote.reasonKey).toBe('build.notYetAvailable')
    expect(quote.reasonParams?.year).toBe(PLANT_TYPES.battery.availableFromYear.value)
  })

  it('allows a technology that does', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    expect(quotePlant(world, 'ccgt', site.x, site.y).ok).toBe(true)
  })
})

describe('building a plant', () => {
  it('creates a plant under construction that generates nothing yet', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const before = world.plants.length

    const result = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    expect(result.ok).toBe(true)
    expect(world.plants.length).toBe(before + 1)

    const plant = world.getPlant(result.plantId!)!
    expect(plant.phase).toBe(LifecyclePhase.Building)
    expect(plant.online).toBe(false)

    world.step()
    expect(world.lastDispatch!.generationMw.get(plant.id) ?? 0).toBeCloseTo(0, 6)
  })

  it('commissions the plant when the build time is up, and not before', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const result = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    const plant = world.getPlant(result.plantId!)!
    const buildTicks = result.quote.buildTicks

    // One tick short: still a building site.
    for (let i = 0; i < buildTicks - 1; i++) world.step()
    expect(plant.phase).toBe(LifecyclePhase.Building)

    world.step()
    expect(plant.phase).toBe(LifecyclePhase.Operating)
    expect(plant.online).toBe(true)
    expect(plant.commissionedTick).toBe(world.tick)
    // A new machine starts in perfect condition and with no age.
    expect(plant.conditionPct).toBe(1)
  })

  it('spends the capital across the build rather than in one lump', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const result = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    const total = result.quote.totalCost
    const buildTicks = result.quote.buildTicks

    // Measured through the outstanding commitment rather than the open ledger, which is
    // swept into the monthly one and would lose whichever instalment fell on the boundary.
    expect(world.committedSpend()).toBeCloseTo(total, 0)

    world.step()
    expect(total - world.committedSpend()).toBeCloseTo(total / buildTicks, 3)

    for (let i = 1; i < buildTicks; i++) world.step()
    expect(world.committedSpend()).toBeCloseTo(0, 6)

    // And nothing more once it is finished.
    world.step()
    expect(world.committedSpend()).toBeCloseTo(0, 6)
  })

  it('refuses a project the utility cannot fund', () => {
    const world = buildWorld(FIRST_REGION)
    world.finances.cash = 1_000_000
    world.finances.trailingRevenue = 0
    const site = freeSite(world, 'nuclear')
    const quote = quotePlant(world, 'nuclear', site.x, site.y)
    expect(quote.ok).toBe(false)
    expect(quote.reasonKey).toBe('build.cannotAfford')
  })
})

describe('building a line', () => {
  it('creates a de-energised line that carries nothing until it is finished', () => {
    const world = buildWorld(FIRST_REGION)
    const result = beginLineConstruction(world, 'n_gorge', 'n_ironvale', 220, 1)
    expect(result.ok).toBe(true)

    const edge = world.network.requireEdge(result.edgeId!)
    expect(edge.energised).toBe(false)

    world.step()
    expect(world.lastDispatch!.lineFlowMw.get(edge.id) ?? 0).toBeCloseTo(0, 6)

    for (let i = 0; i < result.quote.buildTicks; i++) world.step()
    expect(world.network.requireEdge(edge.id).energised).toBe(true)
  })

  it('charges more for a route over rough ground', () => {
    const world = buildWorld(FIRST_REGION)
    // Find the easiest and the hardest crossing of the same length anywhere on the map, and
    // check the cost model actually distinguishes them.
    let easiest = Infinity
    let hardest = 0
    for (let y = 2; y < world.scenario.mapHeight - 2; y += 2) {
      for (let x = 2; x < world.scenario.mapWidth - 6; x += 2) {
        const factor = routeCostFactor(world.terrain, x, y, x + 4, y)
        easiest = Math.min(easiest, factor)
        hardest = Math.max(hardest, factor)
      }
    }
    expect(easiest).toBeCloseTo(1, 1)
    expect(hardest).toBeGreaterThan(1.4)
  })

  it('refuses a duplicate connection at the same voltage', () => {
    const world = buildWorld(FIRST_REGION)
    // The scenario already has a 220 kV line between these two.
    const quote = quoteLine(world, 'n_blackridge', 'n_central', 220, 1)
    expect(quote.ok).toBe(false)
    expect(quote.reasonKey).toBe('build.alreadyConnected')
  })

  it('refuses a line to nowhere', () => {
    const world = buildWorld(FIRST_REGION)
    expect(quoteLine(world, 'n_central', 'n_central', 220, 1).reasonKey).toBe('build.sameNode')
    expect(quoteLine(world, 'n_central', 'nope', 220, 1).reasonKey).toBe('build.noSuchNode')
  })
})

describe('retirement', () => {
  it('stops the plant, charges the dismantling, and frees the site only after remediation', () => {
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_oldharbour')!

    const result = retirePlant(world, 'p_oldharbour')
    expect(result.ok).toBe(true)
    expect(plant.phase).toBe(LifecyclePhase.Decommissioning)
    expect(plant.online).toBe(false)

    world.step()
    expect(world.openLedger.decommissioningCost).toBeGreaterThan(0)
    expect(world.lastDispatch!.generationMw.get(plant.id) ?? 0).toBeCloseTo(0, 6)

    // Through dismantling and into remediation, at which point the scrap value arrives.
    for (let i = 0; i < result.quote.buildTicks; i++) world.step()
    expect(plant.phase).toBe(LifecyclePhase.Remediating)

    const type = PLANT_TYPES[plant.typeId]
    const remediationTicks = Math.round(type.remediationYears.value * TICKS_PER_YEAR)
    for (let i = 0; i < remediationTicks; i++) world.step()
    expect(plant.phase).toBe(LifecyclePhase.Cleared)
  })

  it('refuses to retire something already being dismantled', () => {
    const world = buildWorld(FIRST_REGION)
    retirePlant(world, 'p_millbrook')
    const second = retirePlant(world, 'p_millbrook')
    expect(second.ok).toBe(false)
    expect(second.quote.reasonKey).toBe('build.notRetirable')
  })

  it('mothballs and reactivates', () => {
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_millbrook')!

    expect(mothballPlant(world, plant.id)).toBe(true)
    expect(plant.phase).toBe(LifecyclePhase.Mothballed)
    world.step()
    expect(world.lastDispatch!.generationMw.get(plant.id) ?? 0).toBeCloseTo(0, 6)

    expect(reactivatePlant(world, plant.id)).toBe(true)
    expect(plant.phase).toBe(LifecyclePhase.Operating)
  })
})

describe('a built plant actually helps', () => {
  it('adds generation once commissioned and connected', () => {
    const world = buildWorld(FIRST_REGION)
    // Put a gas turbine next to the capital and wire it in.
    const site = { x: 26, y: 24 }
    expect(isBuildable(world.terrain, site.x, site.y)).toBe(true)

    const built = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    expect(built.ok).toBe(true)
    const plant = world.getPlant(built.plantId!)!

    const line = beginLineConstruction(world, plant.nodeId, 'n_rivermouth', 220, 1)
    expect(line.ok).toBe(true)

    const ticks = Math.max(built.quote.buildTicks, line.quote.buildTicks) + 1
    for (let i = 0; i < ticks; i++) world.step()

    expect(plant.phase).toBe(LifecyclePhase.Operating)
    expect(world.network.requireEdge(line.edgeId!).energised).toBe(true)

    // Two identical gas units would split on the dispatch tie-break alone, and the older one
    // sits closer to the load, so it would win every hour. Retire the coal station to make
    // room and the new plant has to earn its place on cost.
    retirePlant(world, 'p_oldharbour')

    let produced = 0
    for (let i = 0; i < 24 * 14; i++) {
      world.step()
      produced += world.lastDispatch!.generationMw.get(plant.id) ?? 0
    }
    expect(produced).toBeGreaterThan(0)
  })

  it('takes roughly the quoted time, in months', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const result = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    const months = result.quote.buildTicks / TICKS_PER_MONTH
    expect(months).toBeCloseTo(PLANT_TYPES.ccgt.buildTimeMonths.value, 0)
  })
})

describe('refurbishment', () => {
  it('refuses a plant that is too new to be worth overhauling', () => {
    const world = buildWorld(FIRST_REGION)
    // Eastfield is twelve years into a thirty-year life.
    const quote = quoteRefurbishment(world, 'p_eastfield')
    expect(quote.ok).toBe(false)
    expect(quote.reasonKey).toBe('build.tooNewToRefurbish')
  })

  it('offers an overhaul on a worn-out plant, and takes it out of service meanwhile', () => {
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_oldharbour')!
    const quote = quoteRefurbishment(world, plant.id)
    expect(quote.ok).toBe(true)
    // Cheaper than building new, which is the whole point.
    const newBuild = PLANT_TYPES.coal.capexPerKw.value * PLANT_TYPES.coal.capacityMw.value * 1000
    expect(quote.totalCost).toBeLessThan(newBuild * 0.6)

    const result = refurbishPlant(world, plant.id)
    expect(result.ok).toBe(true)
    expect(plant.phase).toBe(LifecyclePhase.Refurbishing)

    world.step()
    expect(world.lastDispatch!.generationMw.get(plant.id) ?? 0).toBeCloseTo(0, 6)
    expect(world.openLedger.capex).toBeGreaterThan(0)
  })

  it('returns the plant better than it was, and with more life left', () => {
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_oldharbour')!

    const conditionBefore = plant.conditionPct
    const efficiencyBefore = world.params.get(plant.id, Param.Efficiency)
    const capacityBefore = world.params.get(plant.id, Param.CapacityMw)
    const lifeBefore = lifeFraction(plant, world.tick)

    const result = refurbishPlant(world, plant.id)
    for (let i = 0; i < result.quote.buildTicks; i++) world.step()

    expect(plant.phase).toBe(LifecyclePhase.Operating)
    expect(plant.online).toBe(true)
    expect(plant.refurbishments).toBe(1)
    expect(plant.conditionPct).toBeGreaterThan(conditionBefore)
    expect(world.params.get(plant.id, Param.Efficiency)).toBeGreaterThan(efficiencyBefore)
    expect(world.params.get(plant.id, Param.CapacityMw)).toBeGreaterThan(capacityBefore)
    // Older in years, but a smaller fraction of a life that is now longer.
    expect(lifeFraction(plant, world.tick)).toBeLessThan(lifeBefore)
  })

  it('gives diminishing returns and eventually refuses a third rebuild', () => {
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_oldharbour')!

    const first = refurbishPlant(world, plant.id)
    for (let i = 0; i < first.quote.buildTicks; i++) world.step()
    const firstGain = plant.lifeExtension

    // Age it back into refurbishable territory.
    plant.conditionPct = 0.4
    plant.commissionedTick -= TICKS_PER_YEAR * 30

    const second = refurbishPlant(world, plant.id)
    expect(second.ok).toBe(true)
    // The second overhaul costs more than the first.
    expect(second.quote.totalCost).toBeGreaterThan(first.quote.totalCost)
    for (let i = 0; i < second.quote.buildTicks; i++) world.step()

    // ...and buys less.
    expect(plant.lifeExtension - firstGain).toBeLessThan(firstGain)
    expect(plant.refurbishments).toBe(2)

    plant.commissionedTick -= TICKS_PER_YEAR * 30
    const third = refurbishPlant(world, plant.id)
    expect(third.ok).toBe(false)
    expect(third.quote.reasonKey).toBe('build.alreadyRebuilt')
  })

  it('gives a battery a fresh set of cells', () => {
    const world = buildWorld({ ...FIRST_REGION, startYear: 2020 })
    const site = freeSite(world)
    const built = beginPlantConstruction(world, 'battery', site.x, site.y)
    expect(built.ok).toBe(true)
    const plant = world.getPlant(built.plantId!)!
    for (let i = 0; i < built.quote.buildTicks; i++) world.step()

    // Worked most of the way through its cycle life.
    plant.cyclesUsed = PLANT_TYPES.battery.storage!.cycleLife!.value * 0.85
    expect(lifeFraction(plant, world.tick)).toBeGreaterThan(0.8)

    const result = refurbishPlant(world, plant.id)
    expect(result.ok).toBe(true)
    for (let i = 0; i < result.quote.buildTicks; i++) world.step()

    expect(plant.cyclesUsed).toBe(0)
    expect(lifeFraction(plant, world.tick)).toBeLessThan(0.2)
  })
})
