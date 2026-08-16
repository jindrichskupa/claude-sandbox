/**
 * Somebody else's unfinished work.
 *
 * A brownfield start was machines and corridors and nothing else, which left out the half of a
 * real handover that is hardest: the commitments. Czechia in 1995 is the case that forced it —
 * the loudest question in Czech energy that year was whether to finish a reactor that had been
 * under construction for eight years, and a scenario that can only describe finished machines
 * cannot ask it.
 *
 * What is tested here is the pair. Inheriting the project is half of it; being able to walk away
 * is the other half, because a commitment that cannot be abandoned is not a decision.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { CZECHIA_1995 } from '@content/scenarios/czechia1995'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { LifecyclePhase } from '@sim/assets/types'
import { TICKS_PER_YEAR } from '@sim/core/time'
import {
  abandonProject,
  beginPlantConstruction,
  buildProgress,
  quoteAbandonment,
  quotePlant,
} from '@sim/build/commands'
import { corporateDebt } from '@sim/economy/economy'
import type { PlantTypeId } from '@content/plantTypes'
import type { World } from '@sim/world'

/**
 * The first square this technology may stand on.
 *
 * `financed` matters and defaults to off: a project facility has a minimum size, so asking for a
 * financed quote on a 50 MW wind farm refuses every square on the map for a reason that has
 * nothing to do with the ground.
 */
function findSite(world: World, typeId: PlantTypeId, financed = false): { x: number; y: number } {
  for (let y = 0; y < world.terrain.height; y++) {
    for (let x = 0; x < world.terrain.width; x++) {
      if (quotePlant(world, typeId, x, y, financed).ok) return { x, y }
    }
  }
  throw new Error(`nowhere to put a ${typeId}`)
}

describe('a project inherited half-finished', () => {
  it('arrives under construction, off the system, with only what is left to pay', () => {
    const world = buildWorld(CZECHIA_1995)
    const temelin = world.plants.find((p) => p.id === 'p_temelin')!

    expect(temelin.phase).toBe(LifecyclePhase.Building)
    expect(temelin.online).toBe(false)
    expect(temelin.outputMw).toBe(0)
    // Seven years from the scenario's start, which is 2002 — the year it was actually finished.
    expect(Math.round(temelin.phaseEndsTick / TICKS_PER_YEAR)).toBe(7)

    // Only the remaining share is scheduled. The rest was spent by whoever the player took over
    // from and is not on the books at all — see `PlantSpec.inProgress`.
    const full = 6000 * 1000 * 1000
    expect(world.committedSpend()).toBeGreaterThan(full * 0.3)
    expect(world.committedSpend()).toBeLessThan(full * 0.75)
  })

  it('knows how far through it is, which the time left alone cannot say', () => {
    const world = buildWorld(CZECHIA_1995)
    const temelin = world.plants.find((p) => p.id === 'p_temelin')!
    // Eight years done of a fifteen-year build. A reactor seven years from finishing could equally
    // be seven years from a standing start, and the two are not worth the same to walk away from.
    expect(buildProgress(world, temelin)).toBeCloseTo(8 / 15, 2)

    const fresh = world.plants.find((p) => p.id === 'p_dlouhestrane')!
    expect(buildProgress(world, fresh)).toBeCloseTo(17 / 18, 2)
  })

  it('finishes on its own and joins the system, like anything else being built', () => {
    const world = buildWorld(CZECHIA_1995)
    // Dlouhé stráně has a year to run. Two years is comfortably past it.
    for (let i = 0; i < TICKS_PER_YEAR * 2; i++) world.step()

    const pumped = world.plants.find((p) => p.id === 'p_dlouhestrane')!
    expect(pumped.phase).toBe(LifecyclePhase.Operating)
    expect(pumped.online).toBe(true)
    // Its life starts when it enters service, not when the scenario opened.
    expect(pumped.commissionedTick).toBeGreaterThan(0)
  })

  it('brings an inherited overhaul back better, and back to the age it already had', () => {
    const world = buildWorld(CZECHIA_1995)
    const before = world.plants.find((p) => p.id === 'p_tusimice')!
    expect(before.phase).toBe(LifecyclePhase.Refurbishing)
    // An overhaul is not a new machine: the unit keeps the twenty-one years it has already run.
    expect(before.commissionedTick).toBeLessThan(0)

    for (let i = 0; i < TICKS_PER_YEAR * 2; i++) world.step()
    const after = world.plants.find((p) => p.id === 'p_tusimice')!
    expect(after.phase).toBe(LifecyclePhase.Operating)
    expect(after.refurbishments).toBe(1)
    expect(after.lifeExtension).toBeGreaterThan(0)
  })
})

describe('walking away from an unfinished project', () => {
  it('costs more the further the work got, and never nothing', () => {
    const world = buildWorld(CZECHIA_1995)
    const early = quoteAbandonment(world, 'p_temelin')
    expect(early.ok).toBe(true)
    // Never free. Eight years of concrete has to be demolished or handed over whatever happens.
    expect(early.totalCost).toBeGreaterThan(0)

    // Three more years of building, and there is half as much again to make safe. The first
    // version of this compared a reactor with a pumped station per megawatt, which measured the
    // difference between decommissioning a reactor and decommissioning a reservoir — a fact about
    // the technologies, not about how far either project had got.
    for (let i = 0; i < TICKS_PER_YEAR * 3; i++) world.step()
    const later = quoteAbandonment(world, 'p_temelin')
    expect(later.ok).toBe(true)
    expect(later.totalCost).toBeGreaterThan(early.totalCost * 1.25)
  })

  it('stops the bill, occupies the site, and hands it back years later', () => {
    const world = buildWorld(CZECHIA_1995)
    const committedBefore = world.committedSpend()

    const result = abandonProject(world, 'p_temelin')
    expect(result.ok).toBe(true)

    const temelin = world.plants.find((p) => p.id === 'p_temelin')!
    expect(temelin.phase).toBe(LifecyclePhase.Remediating)
    // The capex is gone and a much smaller make-safe bill has replaced it.
    expect(world.committedSpend()).toBeLessThan(committedBefore * 0.5)

    // Three years to hand back a containment that never held fuel, against twenty to release the
    // site of a reactor that ran. Four years is past it either way.
    for (let i = 0; i < TICKS_PER_YEAR * 4; i++) world.step()
    expect(temelin.phase).toBe(LifecyclePhase.Cleared)
  })

  it('refuses anything that is not being built', () => {
    const world = buildWorld(CZECHIA_1995)
    // An operating unit is retired, not abandoned, and the refusal says which.
    expect(quoteAbandonment(world, 'p_dukovany1').reasonKey).toBe('build.notAbandonable')
    // So is an inherited overhaul: putting a machine back together is a different question.
    expect(quoteAbandonment(world, 'p_tusimice').reasonKey).toBe('build.notAbandonable')
    expect(quoteAbandonment(world, 'p_nothing').reasonKey).toBe('build.noSuchPlant')
  })

  it('brings a cancelled project facility back onto the company, at once', () => {
    // The player's own project rather than an inherited one, because that is where a facility
    // exists. `abandonProject` cannot tell the difference and should not.
    const world = buildWorld(FIRST_REGION)
    world.finances.cash = 3_000_000_000

    // Wherever the map will take one. The site is not the point of this test and pinning a
    // coordinate would make it break for a reason it is not about.
    const site = findSite(world, 'nuclear', true)
    const built = beginPlantConstruction(world, 'nuclear', site.x, site.y, true)
    expect(built.ok).toBe(true)
    const plantId = built.plantId!

    // Let the facility draw against a few months of construction spending.
    for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
    const loan = world.finances.loans.find((l) => l.assetId === plantId)!
    expect(loan.kind).toBe('project')
    expect(loan.outstanding).toBeGreaterThan(0)
    // While it is somebody else's risk, the borrowing limit does not count it.
    const corporateBefore = corporateDebt(world.finances)

    abandonProject(world, plantId)

    expect(loan.kind).toBe('planned')
    expect(loan.commitment).toBeUndefined()
    // Repayments start now rather than on a commissioning date that will never arrive.
    expect(loan.repaymentsStartTick).toBe(world.tick)
    // And the balance is on the company's books, where it was not a moment ago.
    expect(corporateDebt(world.finances)).toBeGreaterThan(corporateBefore)
    expect(corporateDebt(world.finances) - corporateBefore).toBeCloseTo(loan.outstanding, -3)
  })

  it('gives the ground back, so a misplaced farm can be replaced', () => {
    // The whole point of being able to cancel, and the case that found it broken. A player put a
    // wind farm in the wrong place, cancelled it the same month, and could never build there
    // again: the phase reached `Cleared` and stopped, while the plant stayed in the fleet and its
    // node stayed on the map, so `nodeNear` went on refusing anything within a tile and a half.
    // Not for a year, not for five — for ever.
    const world = buildWorld(CZECHIA_1995)
    world.finances.cash = 2_000_000_000

    const site = findSite(world, 'wind')
    const built = beginPlantConstruction(world, 'wind', site.x, site.y)
    expect(built.ok).toBe(true)
    world.step()

    // Cancelled before anything is built, so there is nothing to make safe and nothing to wait
    // for. That is the right amount of forgiveness for a misclick; a reactor eight years in is a
    // different question and gets a different answer.
    const quote = quoteAbandonment(world, built.plantId!)
    expect(quote.totalCost).toBeLessThan(1000)
    expect(abandonProject(world, built.plantId!).ok).toBe(true)

    const nodeId = world.getPlant(built.plantId!)!.nodeId
    for (let i = 0; i < 200; i++) world.step()

    expect(world.plants.some((p) => p.id === built.plantId)).toBe(false)
    expect(world.network.getNode(nodeId)).toBeUndefined()
    expect(world.nodeNear(site.x, site.y, 1.5)).toBeNull()
    // And the ground takes a farm again.
    expect(quotePlant(world, 'wind', site.x, site.y).ok).toBe(true)
  })

  it('keeps a site that still has a line running to it', () => {
    // The other half of the rule. Prunéřov is two units on one node with a 400 kV corridor to
    // Řeporyje; clearing one of them must not take the switchyard, the line, or its twin with it.
    const world = buildWorld(CZECHIA_1995)
    const twin = world.getPlant('p_prunerov1')!
    twin.phase = LifecyclePhase.Remediating
    twin.phaseEndsTick = world.tick + 1

    world.step()
    world.step()

    expect(world.plants.some((p) => p.id === 'p_prunerov1')).toBe(false)
    expect(world.plants.some((p) => p.id === 'p_prunerov2')).toBe(true)
    expect(world.network.getNode('n_prunerov')).toBeDefined()
    expect(world.network.getEdge('l_prunerov_reporyje')).toBeDefined()
  })

  it('survives a save, so a cancelled project does not come back', () => {
    const world = buildWorld(CZECHIA_1995)
    abandonProject(world, 'p_temelin')
    for (let i = 0; i < 200; i++) world.step()

    const loaded = buildWorld(CZECHIA_1995)
    loaded.applySaveData(JSON.parse(JSON.stringify(world.toSaveData())))
    const temelin = loaded.plants.find((p) => p.id === 'p_temelin')!
    expect(temelin.phase).toBe(LifecyclePhase.Remediating)
    expect(loaded.committedSpend()).toBeCloseTo(world.committedSpend(), 3)
  })
})
