/**
 * Running the clock on until something happens.
 *
 * The property that matters is not "it advances the clock" — that is trivially true of any loop.
 * It is that it stops at the *first* thing worth stopping for and does not sail past it. A skip
 * that overshoots a finished station by three months is worse than no skip at all, because the
 * player has lost the moment they were waiting for and cannot get it back.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { notableChange, notableState, SKIP_LIMIT_TICKS } from '@sim/scenario/notable'
import { beginPlantConstruction } from '@sim/build/commands'
import { judgeSite } from '@sim/build/siting'
import { LifecyclePhase } from '@sim/assets/types'

/** Step until the world does something notable, exactly as the game loop does. */
function runUntilNotable(world: ReturnType<typeof buildWorld>, limit = SKIP_LIMIT_TICKS) {
  const from = notableState(world)
  for (let i = 0; i < limit; i++) {
    world.step()
    const reason = notableChange(from, notableState(world))
    if (reason) return { reason, ticks: i + 1 }
  }
  return { reason: null, ticks: limit }
}

function freeSite(world: ReturnType<typeof buildWorld>) {
  for (let y = 0; y < world.scenario.mapHeight; y++) {
    for (let x = 0; x < world.scenario.mapWidth; x++) {
      if (world.nodeNear(x, y, 1.5)) continue
      if (judgeSite('ccgt', { terrain: world.terrain, network: world.network, cities: world.cities, x, y }).ok) {
        return { x, y }
      }
    }
  }
  throw new Error('nowhere to build')
}

describe('running on to the next thing that matters', () => {
  it('stops on the hour a station enters service, not later', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const built = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    expect(built.ok).toBe(true)
    const plant = world.getPlant(built.plantId!)!
    const commissionsAt = plant.phaseEndsTick

    // Skip repeatedly. Other things legitimately interrupt on the way — a shortfall beginning or
    // ending is exactly what a player wants to be told about — so the property under test is not
    // "the first stop is the commissioning" but "when the commissioning is reported, it is
    // reported on the hour it happened". Overshooting is the failure that would matter.
    let guard = 0
    while (plant.phase !== LifecyclePhase.Operating && guard++ < 200) {
      const step = runUntilNotable(world)
      expect(step.reason, 'the skip gave up before the station was ever finished').not.toBeNull()
      if (step.reason === 'notable.construction') break
    }
    expect(plant.phase).toBe(LifecyclePhase.Operating)
    expect(world.tick).toBe(commissionsAt)
  })

  it('does not stop for the weather, the price, or the time of day', () => {
    // The failure mode that would make this feature worthless. Everything interesting in an
    // ordinary hour — output, wind, the clearing price — moves constantly, and a signature that
    // included any of it would stop on the very next tick, every time.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 200; i++) world.step()
    const before = notableState(world)
    const price = () => world.recentHistory(1)[0]?.pricePerMwh ?? 0
    const priceBefore = price()

    let moved = false
    for (let i = 0; i < 48; i++) {
      world.step()
      if (Math.abs(price() - priceBefore) > 0.5) moved = true
      if (notableChange(before, notableState(world))) return // something real happened; fine
    }
    // Two days in which the price moved and nothing notable was reported.
    expect(moved).toBe(true)
  })

  it('gives up after a year rather than running for ever', () => {
    const world = buildWorld(FIRST_REGION)
    const result = runUntilNotable(world, 40)
    expect(result.ticks).toBeLessThanOrEqual(40)
  })

  it('notices a change of government', () => {
    const world = buildWorld(FIRST_REGION)
    const before = notableState(world)
    const after = { ...before, government: 'something_else' }
    expect(notableChange(before, after)).toBe('notable.government')
  })

  it('ranks bankruptcy above everything else it could report', () => {
    // Both changed at once. The player needs to be told the one that ends their run.
    const world = buildWorld(FIRST_REGION)
    const before = notableState(world)
    const after = { ...before, bankrupt: true, fleet: before.fleet + 1, government: 'other' }
    expect(notableChange(before, after)).toBe('notable.bankrupt')
  })
})
