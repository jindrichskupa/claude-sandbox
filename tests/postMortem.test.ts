/**
 * Why the lights went out, and whether the game says so truthfully.
 *
 * These tests exist because the obvious post-mortem would have lied. The first design said "your
 * firm capacity fell behind demand", and about the opening scenario that is confidently wrong: it
 * fails its reliability objective in year one while carrying a 178% capacity margin, and 129 of
 * the 163 failing hours are a town on the wrong side of a broken line. A player told to build
 * more plant would have spent years and a fortune making the problem no better at all.
 *
 * So the thing under test is not that a panel appears. It is that each cause is decided by the
 * facts that distinguish it, and — the part that took three attempts — that the classifier reads
 * the same numbers the dispatch read. Twice it did not: it counted a cogeneration set at what the
 * catalogue says rather than what its heat duty leaves it, and it measured a corridor against a
 * new line's rating rather than a worn one's. Both produced hours the report could not explain,
 * and both are covered below.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { classifyHour, ShortfallLog, worstOf, type PlantCeilings } from '@sim/reliability/shortfall'
import { computeIslands } from '@sim/grid/islands'
import { PLANT_TYPES } from '@content/plantTypes'
import type { World } from '@sim/world'

/** A year of the scenario as it stands, which is where every measured claim here comes from. */
function playedYear(): World {
  const world = buildWorld(FIRST_REGION)
  for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
  return world
}

describe('the causes are decided by the facts that tell them apart', () => {
  /**
   * Every plant at its nameplate, with nothing derated and nothing held back.
   *
   * Nameplate rather than an arbitrarily huge number, which the first version of this used and
   * which quietly broke the islanding test: giving *every* plant ten gigawatts gave the northern
   * island ten gigawatts too, so the north was never short and the classifier was right to say
   * so. An island is short relative to what is inside it, and a fixture that forgets that is
   * testing nothing.
   */
  function nameplateCeilings(world: World): Map<string, PlantCeilings> {
    const ceilings = new Map<string, PlantCeilings>()
    for (const plant of world.plants) {
      const mw = PLANT_TYPES[plant.typeId].capacityMw.value
      ceilings.set(plant.id, { structural: mw, now: mw })
    }
    return ceilings
  }

  it('calls a town cut off from its generation islanded, however much plant exists elsewhere', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()

    // Sever the north. Northgate is then in an island with the Gorge and not much else.
    world.network.setEnergised('l_central_north', false)
    const islands = computeIslands(world.network, 'electric')
    expect(islands.count, 'the scenario no longer splits when this line opens').toBeGreaterThan(1)

    const facts = classifyHour({
      network: world.network,
      islands,
      plants: world.plants,
      cities: world.cities,
      ceilings: nameplateCeilings(world),
      unservedByCity: new Map([['c_northgate', 120]]),
      totalUnservedMw: 120,
      totalLoadMw: 900,
      lineFlowMw: new Map(),
      lineCapacityMw: () => 1000,
      demandOf: (cityId) => (cityId === 'c_northgate' ? 175 : 200),
    })

    expect(facts.cause).toBe('islanded')
    // And it names the break, which is the actionable half: a town cut off has a line to mend,
    // not a category to consider.
    expect(facts.missingLines).toContain('l_central_north')
  })

  it('separates a fleet that is too small from one that could not get there in time', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()
    const islands = computeIslands(world.network, 'electric')

    const shared = {
      network: world.network,
      islands,
      plants: world.plants,
      cities: world.cities,
      unservedByCity: new Map([['c_rivermouth', 50]]),
      totalUnservedMw: 50,
      lineFlowMw: new Map<string, number>(),
      lineCapacityMw: () => 1000,
      demandOf: () => 100,
    }

    const tooSmall = new Map<string, PlantCeilings>()
    for (const plant of world.plants) tooSmall.set(plant.id, { structural: 10, now: 10 })
    expect(classifyHour({ ...shared, ceilings: tooSmall, totalLoadMw: 5000 }).cause).toBe('capacity')

    // Big enough on paper, and not this hour: that is a different problem with a different
    // answer — build something quicker, or put a store beside it — and saying "not enough plant"
    // would send the player to build capacity they already have.
    const tooSlow = new Map<string, PlantCeilings>()
    for (const plant of world.plants) tooSlow.set(plant.id, { structural: 1000, now: 10 })
    expect(classifyHour({ ...shared, ceilings: tooSlow, totalLoadMw: 5000 }).cause).toBe('ramp')
  })

  it('measures a corridor against the rating the dispatch used, not the catalogue', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()
    const islands = computeIslands(world.network, 'electric')
    const edge = world.network.requireEdge('l_blackridge_ironvale')

    const shared = {
      network: world.network,
      islands,
      plants: world.plants,
      cities: world.cities,
      ceilings: nameplateCeilings(world),
      unservedByCity: new Map([['c_ironvale', 20]]),
      totalUnservedMw: 20,
      totalLoadMw: 100,
      lineFlowMw: new Map([[edge.id, 139]]),
      demandOf: () => 100,
    }

    // 139 MW on a line the catalogue rates at 150 is 93% full and looks fine. The same 139 MW on
    // the same line worn down to 140 is hard against its limit — and the dispatch, which derates
    // a worn corridor, was working from the second number. Reading the first is what left
    // twenty-nine hours of the opening year unexplained.
    expect(classifyHour({ ...shared, lineCapacityMw: () => 150 }).cause).not.toBe('corridor')
    expect(classifyHour({ ...shared, lineCapacityMw: () => 140 }).cause).toBe('corridor')
  })
})

describe('a played year, explained', () => {
  it('accounts for every hour it went short', () => {
    const world = playedYear()
    const ranked = world.shortfalls.ranked('electric')
    for (const { cause, tally } of ranked) {
      console.log(`${cause}: ${tally.hours} h, ${Math.round(tally.mwh)} MWh`)
    }

    expect(world.shortfalls.totalMwh('electric'), 'year one is meant to go short').toBeGreaterThan(1000)

    // The one assertion that matters. `unexplained` is an honest category and it is also a
    // confession, and every time it has had anything in it the classifier has turned out to be
    // reading the wrong number rather than facing a genuine mystery.
    const unexplained = ranked.find((r) => r.cause === 'unexplained')
    expect(unexplained?.tally.mwh ?? 0, 'the report cannot explain some of its own hours').toBe(0)
  }, 300_000)

  it('finds the network to blame, not the fleet, which is the whole point', () => {
    const world = playedYear()
    const dominant = world.shortfalls.dominant('electric')
    expect(dominant?.cause).toBe('islanded')

    // Not asserted as a target to hit but as a guard on the claim the panel makes: if a content
    // change ever makes this scenario genuinely short of plant, the post-mortem will say so and
    // this test should be read again rather than adjusted.
    const capacity = world.shortfalls.ranked().find((r) => r.cause === 'capacity')
    expect(dominant!.tally.mwh).toBeGreaterThan((capacity?.tally.mwh ?? 0) * 3)

    // And it names somewhere real to go and look.
    const city = worstOf(dominant!.tally.byCity)
    expect(city).not.toBeNull()
    expect(world.cities.some((c) => c.id === city!.id)).toBe(true)
    const line = worstOf(dominant!.tally.byMissingLine)
    expect(line, 'an islanded town with no line to mend is not a finding').not.toBeNull()
    expect(world.network.getEdge(line!.id)).toBeDefined()
  }, 300_000)

  it('carries the record through a save and a load', () => {
    const world = playedYear()
    const before = world.shortfalls.totalMwh('electric')

    const loaded = buildWorld(FIRST_REGION)
    loaded.applySaveData(JSON.parse(JSON.stringify(world.toSaveData())))
    expect(loaded.shortfalls.totalMwh('electric')).toBeCloseTo(before, 3)
    expect(loaded.shortfalls.dominant('electric')?.cause).toBe('islanded')
  }, 300_000)

  it('reads an older save, which simply has nothing to report', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()
    const save = JSON.parse(JSON.stringify(world.toSaveData())) as Record<string, unknown>
    delete save.shortfalls
    const loaded = buildWorld(FIRST_REGION)
    loaded.applySaveData(save as never)
    expect(loaded.shortfalls.totalMwh('electric')).toBe(0)
    expect(loaded.shortfalls.dominant('electric')).toBeNull()
  })
})

describe('the log itself', () => {
  it('blames every line whose repair would have relieved the same hour, not a share of it', () => {
    const log = new ShortfallLog()
    log.record({
      cause: 'islanded',
      totalUnservedMw: 100,
      unservedByCity: new Map([['c_a', 100]]),
      missingLines: ['l_one', 'l_two'],
    })
    // Two breaks that each stranded the same town are each fully responsible for it. Splitting
    // the blame would make a corridor look half as urgent as it is, and the player would mend
    // neither.
    const tally = log.dominant()!.tally
    expect(tally.byMissingLine['l_one']).toBe(100)
    expect(tally.byMissingLine['l_two']).toBe(100)
    expect(tally.mwh).toBe(100)
  })

  it('ranks causes by the energy against them', () => {
    const log = new ShortfallLog()
    const hour = (cause: 'capacity' | 'corridor', mw: number) =>
      log.record({ cause, totalUnservedMw: mw, unservedByCity: new Map(), missingLines: [] })
    hour('capacity', 10)
    hour('corridor', 40)
    hour('capacity', 5)
    expect(log.ranked().map((r) => r.cause)).toEqual(['corridor', 'capacity'])
    expect(log.dominant()!.tally.mwh).toBe(40)
    expect(log.totalMwh()).toBe(55)
  })
})
