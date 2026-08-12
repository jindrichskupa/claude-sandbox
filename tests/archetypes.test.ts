/**
 * Utilities that believe different things, and what the content does to them.
 *
 * The neutrality claim in this project is enforced mechanically wherever a single number can carry
 * it: every value in `content/` names its source, no modifier exists without an origin the player
 * can see, the policy table is tested for balance on both sides. None of that reaches the shape of
 * the content taken *together* — whether the costs, the carbon price, the tariff and the weather
 * add up to a game with one answer in it. That is not a property of any number and cannot be found
 * by reading one.
 *
 * It can be found by playing, several ways, and comparing. The full five-way comparison over the
 * whole scenario is `scripts/archetypes.ts`, which prints and does not judge — like `canItBeWon`
 * and `paceProbe` beside it, it is a probe to run when the content changes, because five thirty-
 * year runs is minutes of simulation and not something a test suite should carry.
 *
 * What is left here is what is worth guarding on every commit, and it splits in two. Most of it
 * costs nothing at all: the archetypes are declarations, and whether they contradict each other,
 * and whether between them they leave a technology nobody would ever build, are questions about
 * those declarations and about the catalogue. That last one is the structural half of the
 * neutrality claim and it is free. The other part is one short two-archetype run, which is the
 * cheapest thing that can show a conviction reaching the simulation and changing the answer.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '@content/plantTypes'
import { ARCHETYPES, FOSSIL_ZEALOT, GREEN_ZEALOT, playScenario, type PlayResult } from './autoPlayer'

/** Everything a utility could in principle be asked to build, heat-only plant aside. */
const GENERATORS = PLANT_TYPE_IDS.filter((id) => !PLANT_TYPES[id].heatOnly)

/** The technologies a run put in the ground, read back out of its build log. */
function chosen(result: PlayResult): PlantTypeId[] {
  return [...new Set(result.built.map((line) => line.split(': ')[1]?.split(' ')[0] as PlantTypeId))]
}

describe('the archetypes are actually different utilities', () => {
  it('gives each of them something to build and something to refuse', () => {
    for (const strategy of ARCHETYPES) {
      const allowed = GENERATORS.filter((id) => strategy.builds(id))
      expect(allowed.length, `${strategy.id} would build nothing`).toBeGreaterThan(0)
      // A conviction that forbids nothing is not a conviction. The novelty seeker is the
      // exception on purpose — its whole belief is about *order*, not about exclusion — so it is
      // the one archetype allowed to accept everything.
      if (strategy.id !== 'novelty') {
        expect(allowed.length, `${strategy.id} refuses nothing`).toBeLessThan(GENERATORS.length)
      }
    }
  })

  it('holds the convictions it says it holds', () => {
    const burns = (id: PlantTypeId): boolean => PLANT_TYPES[id].fuel !== 'none'
    expect(GENERATORS.filter(GREEN_ZEALOT.builds).some(burns)).toBe(false)
    expect(GENERATORS.filter(FOSSIL_ZEALOT.builds).every((id) => PLANT_TYPES[id].category === 'thermal')).toBe(true)
  })

  it('counts a megawatt of anything at somewhere between none of it and all of it', () => {
    for (const strategy of ARCHETYPES) {
      for (const id of GENERATORS) {
        const credit = strategy.capacityCredit(id)
        expect(credit, `${strategy.id} credits ${id}`).toBeGreaterThanOrEqual(0)
        expect(credit, `${strategy.id} credits ${id}`).toBeLessThanOrEqual(1)
      }
      // And it must count *something*, or it can never decide it has built enough and will build
      // until it is bankrupt. An earlier version of the green archetype did exactly that.
      expect(
        GENERATORS.filter((id) => strategy.builds(id)).some((id) => strategy.capacityCredit(id) > 0),
        `${strategy.id} counts nothing it would build`,
      ).toBe(true)
    }
  })

  it('leaves no technology that no conviction would ever reach for', () => {
    // The structural half of the neutrality claim, and the cheap half: a technology in the
    // catalogue that not one of five incompatible utilities would even *consider* is content
    // nobody can use. It says nothing about whether the numbers then make it worth building —
    // that is what the script measures, and the answer there is more interesting.
    const orphans = GENERATORS.filter((id) => !ARCHETYPES.some((s) => s.builds(id)))
    expect(orphans, 'no archetype would consider these').toEqual([])
  })
})

describe('a conviction reaches the simulation and changes the answer', () => {
  // Two archetypes rather than five, and eight years rather than thirty, because this is the
  // regression guard and not the measurement. Green against fossil is the sharpest available
  // pair: they disagree about every plant on the map.
  const UNTIL = FIRST_REGION.startYear + 8

  it('sends a green utility and a fossil one to different places', () => {
    const green = playScenario(buildWorld(FIRST_REGION), { strategy: GREEN_ZEALOT, untilYear: UNTIL })
    const fossil = playScenario(buildWorld(FIRST_REGION), { strategy: FOSSIL_ZEALOT, untilYear: UNTIL })

    for (const result of [green, fossil]) {
      console.log(
        `${result.strategy}: ${result.bankrupt ? 'bankrupt' : result.outcome} ${result.year}, ` +
          `built [${chosen(result).join(', ')}], ` +
          `unserved ${(result.unservedShare * 100).toFixed(2)}%, ` +
          `carbon ${result.carbonIntensity.toFixed(3)} t/MWh, ` +
          `cash ${Math.round(result.cash / 1e6)}m`,
      )
    }

    // Each built only what it would own. This is the assertion that catches a strategy quietly
    // stopping being consulted, which is the way this whole harness would rot.
    for (const [result, strategy] of [
      [green, GREEN_ZEALOT],
      [fossil, FOSSIL_ZEALOT],
    ] as const) {
      for (const typeId of chosen(result)) {
        expect(strategy.builds(typeId), `${strategy.id} built ${typeId}`).toBe(true)
      }
      for (const line of result.built) {
        const year = Number(line.split(':')[0])
        const typeId = line.split(': ')[1]?.split(' ')[0] as PlantTypeId
        expect(year, `${strategy.id} built ${typeId} in ${year}`).toBeGreaterThanOrEqual(
          PLANT_TYPES[typeId].availableFromYear.value,
        )
      }
    }

    // At least one of them has to have done something, or the comparison is between two utilities
    // that both sat still. Both being idle is exactly what happened before the archetypes planned
    // against what will actually turn up rather than against the catalogue.
    expect(green.built.length + fossil.built.length, 'neither utility built anything').toBeGreaterThan(0)

    // And the beliefs have to show up in the one number they most disagree about. A green utility
    // that ends a run as carbon-intensive as a fossil one has not been playing its own game.
    expect(
      fossil.carbonIntensity - green.carbonIntensity,
      'the green utility emitted as much as the fossil one',
    ).toBeGreaterThan(0.05)
  }, 900_000)
})
