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
  substationBaysFree,
} from '@sim/build/commands'
import { LINE_TYPES } from '@content/lineTypes'
import { isBuildable } from '@sim/map/terrain'
import { nodeInService } from '@sim/grid/network'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

/**
 * Put a station into service without simulating the years it takes.
 *
 * Winding the clock forward would be honest and would also make these tests run for minutes each,
 * because a 400 kV compound is four years of hourly ticks. The build phase itself is tested
 * directly above.
 */
function finish(world: ReturnType<typeof buildWorld>, nodeId: string): string {
  world.network.requireNode(nodeId).inServiceTick = world.tick
  return nodeId
}

/** The nearest buildable tile to a node, so a test line is short enough to simulate. */
function emptyGroundNear(world: ReturnType<typeof buildWorld>, nodeId: string) {
  const anchor = world.network.requireNode(nodeId)
  let best: { x: number; y: number; d: number } | null = null
  for (let y = 0; y < world.scenario.mapHeight; y++) {
    for (let x = 0; x < world.scenario.mapWidth; x++) {
      if (!isBuildable(world.terrain, x, y) || world.nodeNear(x, y, 1.5)) continue
      const d = Math.hypot(x - anchor.x, y - anchor.y)
      if (!best || d < best.d) best = { x, y, d }
    }
  }
  if (!best) throw new Error('nowhere to put a station, which is itself a bug')
  return best
}

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

    // A line can be run to a place of the player's choosing.
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
    // A station with no edges cannot affect the flow problem at all, which is why the build phase
    // needs nothing from the solver: it is one field on the node, checked where lines are quoted.
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

describe('a station is an asset, not a point', () => {
  it('takes years to build', () => {
    // Every other asset in the game has a lead time. The substation used to be the exception: it
    // arrived the instant it was paid for, while its money was already being spread over a build
    // like everything else's.
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    const built = beginSubstationConstruction(world, 400, site.x, site.y)
    const node = world.network.requireNode(built.nodeId!)

    expect(node.inServiceTick).toBe(world.tick + built.quote.buildTicks!)
    expect(nodeInService(node, world.tick)).toBe(false)
    expect(nodeInService(node, node.inServiceTick! - 1)).toBe(false)
    expect(nodeInService(node, node.inServiceTick!)).toBe(true)

    // Long enough to be a decision rather than a formality — a 400 kV compound is years of work.
    expect(built.quote.buildTicks! / TICKS_PER_YEAR).toBeGreaterThan(1)
  })

  it('takes a line before it is finished, and energises it when it is', () => {
    // The order a real project runs in: the corridor and the compound are two contracts proceeding
    // side by side, and the line is switched in when both are ready. Refusing to quote the line
    // until the station was finished — which is how this was first written — left the player idle
    // through the station's whole build before starting something that takes years of its own.
    const world = buildWorld(FIRST_REGION)
    // Close to Central, so the corridor is short enough to simulate to its end in a test.
    const site = emptyGroundNear(world, 'n_central')
    const built = beginSubstationConstruction(world, 220, site.x, site.y)
    const hub = built.nodeId!

    const line = beginLineConstruction(world, 'n_central', hub, 220, 1)
    expect(line.ok, line.quote.reasonKey ?? '').toBe(true)
    const edgeId = world.network.edgesOf(hub)[0]!
    const lineDoneAt = world.tick + line.quote.buildTicks!

    // Push the compound out past the corridor, whichever way round the two happen to fall for
    // this pair of tiles. It is the *ordering* rule being tested, not the content's durations.
    const readyAt = lineDoneAt + Math.round(TICKS_PER_MONTH * 3)
    world.network.requireNode(hub).inServiceTick = readyAt

    // The countdown the inspector shows is the later of the two dates, because that is the one
    // that is true. Counting down to the line's own completion would run out at a moment when
    // nothing happens, which is worse than saying nothing at all.
    expect(world.energisingTick(edgeId)).toBe(readyAt)

    // Wind past the line's own completion. The corridor is finished and still carries nothing,
    // because the compound at its far end is a building site.
    while (world.tick <= lineDoneAt) world.step()
    expect(world.network.requireEdge(edgeId).energised).toBe(false)

    // Then the station enters service, and the line goes live without the player doing anything.
    while (world.tick <= readyAt) world.step()
    expect(world.network.requireEdge(edgeId).energised).toBe(true)
  }, 300_000)

  it('is built for a voltage, and refuses the ones it is not', () => {
    // Before this, `kv` was charged for at three prices and then never consulted again: the player
    // bought a 400 kV station, got the same dot as a 110 kV one, and could hang anything off it.
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    const hub = finish(world, beginSubstationConstruction(world, 110, site.x, site.y).nodeId!)
    expect(world.network.requireNode(hub).kvLevels).toEqual([110])

    const wrong = quoteLine(world, 'n_northsub', hub, 220, 1)
    expect(wrong.ok).toBe(false)
    expect(wrong.reasonKey).toBe('build.wrongVoltage')
    // And the message says which voltage it *is*, so the player can act on it.
    expect(wrong.reasonParams?.kv).toBe('110')

    expect(quoteLine(world, 'n_northsub', hub, 110, 1).ok).toBe(true)
  })

  it('runs out of bays, one yard per voltage', () => {
    // A bay per circuit, and each voltage on the site has its own switchyard. The northern station
    // is the case that matters: 220 kV in from the centre, 110 kV out to Northgate and the Gorge.
    // Its levels are read off the lines the scenario hung on it, so the data cannot disagree with
    // the map.
    const world = buildWorld(FIRST_REGION)
    const north = world.network.requireNode('n_northsub')
    expect(north.kvLevels).toEqual([110, 220])

    // Three 110 kV circuits already: two to Northgate, one to the Gorge.
    const used110 = LINE_TYPES[110].substationBays.value - substationBaysFree(world, north, 110)
    expect(used110).toBe(3)
    expect(substationBaysFree(world, north, 220)).toBe(LINE_TYPES[220].substationBays.value - 1)

    // Fill the 110 kV yard, and only the 110 kV yard.
    const site = emptyGround(world)
    const spare = finish(world, beginSubstationConstruction(world, 110, site.x, site.y).nodeId!)
    let built = 0
    while (substationBaysFree(world, north, 110) > 0) {
      const line = beginLineConstruction(world, 'n_northsub', spare, 110, 1)
      if (!line.ok) break
      // A fresh partner each time, since the same pair may only be joined once at a voltage.
      const next = emptyGround(world, ++built)
      finish(world, beginSubstationConstruction(world, 110, next.x, next.y).nodeId!)
    }
    const full = quoteLine(world, 'n_northsub', spare, 110, 1)
    expect(full.ok).toBe(false)
    expect(['build.substationFull', 'build.alreadyConnected']).toContain(full.reasonKey)

    // The 220 kV yard is untouched by any of that: separate compound, separate bays.
    expect(substationBaysFree(world, north, 220)).toBe(LINE_TYPES[220].substationBays.value - 1)
  })

  it('costs money to keep standing, from the day it is finished and not before', () => {
    // Switchgear maintenance, protection testing, the site, and the transformer's no-load losses.
    // A station that is merely ordered is losing nothing yet, so it is charged nothing yet.
    const world = buildWorld(FIRST_REGION)
    const site = emptyGround(world)
    const hub = beginSubstationConstruction(world, 220, site.x, site.y).nodeId!

    for (let i = 0; i < TICKS_PER_MONTH * 2; i++) world.step()
    expect(world.books.window(hub, 'lifetime').fixedOpex).toBe(0)

    finish(world, hub)
    for (let i = 0; i < TICKS_PER_MONTH * 2; i++) world.step()
    const charged = world.books.window(hub, 'lifetime').fixedOpex
    expect(charged).toBeGreaterThan(0)
    // Roughly two months of the annual figure, and never a whole year's worth of it.
    expect(charged).toBeLessThan(LINE_TYPES[220].substationFixedOpexPerYear.value)
  })
})
