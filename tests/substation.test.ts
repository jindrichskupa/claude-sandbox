/**
 * Substations, and the thing they unblock.
 *
 * The point of these tests is not that a node appears when you pay for one. It is that a network
 * the player could not previously build becomes buildable: before this, a line could only join
 * two nodes the scenario had already placed, so the player could wire up what they were given and
 * nothing else — no junction of their own, no way to split a long corridor, no hub. Most of what
 * building a grid *is* was missing, while the scenario itself contained two substations they
 * could only look at.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import {
  beginLineConstruction,
  beginSubstationConstruction,
  quoteLine,
  quoteSubstation,
} from '@sim/build/commands'
import { LINE_TYPES } from '@content/lineTypes'
import { isBuildable } from '@sim/map/terrain'

function emptyGround(world: ReturnType<typeof buildWorld>, skip = 0) {
  let seen = 0
  for (let y = 0; y < world.scenario.mapHeight; y++) {
    for (let x = 0; x < world.scenario.mapWidth; x++) {
      if (!isBuildable(world.terrain, x, y) || world.nodeNear(x, y, 1.5)) continue
      if (seen++ < skip) continue
      return { x, y }
    }
  }
  throw new Error('the map has no empty ground, which is itself a bug')
}

describe('building a substation', () => {
  it('charges the switchgear for its voltage, and takes time to build', () => {
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    for (const kv of [110, 220, 400] as const) {
      const quote = quoteSubstation(world, kv, site.x, site.y)
      expect(quote.ok, `${kv} kV`).toBe(true)
      expect(quote.totalCost).toBe(LINE_TYPES[kv].substationCapex.value)
      expect(quote.buildTicks).toBeGreaterThan(0)
    }
    // Higher voltage, larger machine, longer wait. Both hold across the whole table.
    expect(quoteSubstation(world, 400, site.x, site.y).totalCost).toBeGreaterThan(
      quoteSubstation(world, 110, site.x, site.y).totalCost,
    )
    expect(quoteSubstation(world, 400, site.x, site.y).buildTicks).toBeGreaterThan(
      quoteSubstation(world, 110, site.x, site.y).buildTicks,
    )
  })

  it('refuses water, mountains and ground that is already occupied', () => {
    const world = buildWorld(FIRST_REGION)
    let refusedGround = false
    for (let y = 0; y < world.scenario.mapHeight && !refusedGround; y++) {
      for (let x = 0; x < world.scenario.mapWidth; x++) {
        if (isBuildable(world.terrain, x, y)) continue
        const quote = quoteSubstation(world, 220, x, y)
        expect(quote.ok).toBe(false)
        expect(quote.reasonKey).toBe('build.unsuitableGround')
        refusedGround = true
        break
      }
    }
    expect(refusedGround).toBe(true)

    const existing = world.network.requireNode('n_central')
    expect(quoteSubstation(world, 220, existing.x, existing.y).reasonKey).toBe('build.tooClose')
  })

  it('spends the money over the build rather than in one lump', () => {
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    const before = world.committedSpend()
    const built = beginSubstationConstruction(world, 220, site.x, site.y)
    expect(built.ok).toBe(true)
    expect(world.committedSpend() - before).toBeCloseTo(built.quote.totalCost, 0)
  })

  it('lets the player build a junction the scenario never gave them', () => {
    // The whole point. Two nodes that are far apart get a new meeting place between them, and
    // lines run to it — a topology that simply could not be expressed before, because every line
    // had to end at something the scenario had placed.
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)

    const built = beginSubstationConstruction(world, 220, site.x, site.y)
    expect(built.ok).toBe(true)
    const hub = built.nodeId!
    expect(world.network.requireNode(hub).kind).toBe('substation')

    // A line can now be run to a place of the player's choosing.
    const quote = quoteLine(world, 'n_central', hub, 220, 1)
    expect(quote.ok, quote.reasonKey ?? '').toBe(true)
    const line = beginLineConstruction(world, 'n_central', hub, 220, 1)
    expect(line.ok).toBe(true)

    // And a second one, which is what makes it a junction rather than a dead end.
    const second = beginLineConstruction(world, 'n_northsub', hub, 220, 1)
    expect(second.ok, second.quote.reasonKey ?? '').toBe(true)
    expect(world.network.edgesOf(hub).length).toBe(2)
  })

  it('carries nothing until a line reaches it', () => {
    // There is deliberately no half-built state for the node itself, and this is why that is
    // safe: on its own a substation is a place for lines to meet, and the first line to arrive
    // takes years. A node with no edges cannot affect the flow problem at all.
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    const built = beginSubstationConstruction(world, 220, site.x, site.y)
    expect(world.network.edgesOf(built.nodeId!).length).toBe(0)

    const before = world.lastDispatch?.totalGenerationMw
    world.step()
    expect(world.lastDispatch!.aborted).toBeFalsy()
    if (before !== undefined) {
      expect(world.lastDispatch!.totalGenerationMw).toBeGreaterThan(0)
    }
  })
})
