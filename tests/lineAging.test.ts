/**
 * The network as a system you run.
 *
 * Until this, a corridor was scenery. Stations had condition, wear, maintenance, forced outages,
 * refurbishment and — since the wear-out model — the possibility of failing beyond repair. A line
 * had a `builtTick` and nothing else: it never got worse, never failed, never cost anything to
 * keep, and the only thing the player could do to one was string a second circuit. In a game
 * whose own premise is that the corridor is the interesting constraint, that made the whole
 * ageing-and-renewal half of it apply to generation only.
 *
 * What is asserted here is the shape and the loop: a line ages, faults, costs money to own, and
 * has two different answers to age — new conductors on the same route, or the same route rebuilt
 * to a higher standard. The severities are balance decisions and are printed rather than pinned.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { LINE_TYPES } from '@content/lineTypes'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { Param } from '@sim/params/types'
import {
  expectedLineCondition,
  isWorthRenewing,
  lineFaultRate,
  lineLifeFraction,
  lineWearFactor,
  repairTicks,
} from '@sim/grid/aging'
import {
  demolishLine,
  nextVoltage,
  quoteLineDemolition,
  quoteLineRenewal,
  quoteVoltageUpgrade,
  renewLine,
  upgradeVoltage,
} from '@sim/build/commands'
import type { GridEdge } from '@sim/grid/network'

function line(kv: 110 | 220 | 400, lengthKm: number, ageYears: number, conditionPct = 1): GridEdge {
  return {
    id: 'l_test',
    commodity: 'electric',
    ownerId: 'player',
    from: 'a',
    to: 'b',
    kv,
    lengthKm,
    circuits: 1,
    energised: true,
    builtTick: -ageYears * TICKS_PER_YEAR,
    conditionPct,
  }
}

describe('a corridor gets old', () => {
  it('faults more the longer it is, and less the higher the voltage', () => {
    // Length matters most: a fault is a thing that happens *somewhere along* a line. Voltage
    // matters because higher levels are built to a higher standard — which is a real argument for
    // 220 over more 110, and one the player can now discover from the panel.
    const short = lineFaultRate(line(110, 50, 0), 1)
    const long = lineFaultRate(line(110, 200, 0), 1)
    expect(long).toBeCloseTo(short * 4, 6)

    const lowVoltage = lineFaultRate(line(110, 100, 0), 1)
    const highVoltage = lineFaultRate(line(400, 100, 0), 1)
    expect(highVoltage).toBeLessThan(lowVoltage)
    console.log('faults a year on 100 km:', { '110kV': lowVoltage, '400kV': highVoltage })
  })

  it('answers to maintenance and to condition', () => {
    const worn = line(220, 100, 0, 0.4)
    expect(lineFaultRate(worn, 0.6)).toBeGreaterThan(lineFaultRate(worn, 1))
    expect(lineFaultRate(worn, 1.4)).toBeLessThan(lineFaultRate(worn, 1))
    expect(lineFaultRate(worn, 1)).toBeGreaterThan(lineFaultRate(line(220, 100, 0, 1), 1))
  })

  it('wears out on the same bathtub curve the fleet does', () => {
    expect(lineWearFactor(line(220, 100, 30), 0)).toBe(1)
    const past = lineWearFactor(line(220, 100, 90), 0)
    expect(past).toBeGreaterThan(2)
    // And it takes longer to fix when it is old, because the fault is harder to find and nobody
    // has maintained the access roads either.
    expect(repairTicks(line(220, 100, 0, 0.3))).toBeGreaterThan(repairTicks(line(220, 100, 0, 1)))
  })

  it('is derated rather than disconnected as it wears', () => {
    // Small — a few percent — but it lands precisely on the constraint the scenario is built
    // around, and it is how a network left alone stops being able to do its job.
    const world = buildWorld(FIRST_REGION)
    const edge = world.network.allEdges().find((e) => e.commodity === 'electric' && e.kv !== 0)!
    const fresh = world.params.get(edge.id, Param.LineCapacityMw)

    edge.conditionPct = 0.4
    for (let i = 0; i < TICKS_PER_YEAR / 6; i++) world.step()
    const worn = world.params.get(edge.id, Param.LineCapacityMw)
    console.log('rating fresh vs worn:', Math.round(fresh), '→', Math.round(worn))
    expect(worn).toBeLessThan(fresh)
    expect(worn).toBeGreaterThan(fresh * 0.7)
  }, 120_000)

  it('settles onto the curve its age implies, gently', () => {
    // Gentler than a machine's, and it should be: no combustion, no rotating mass, no thermal
    // cycling — only corrosion, fatigue at the clamps and forty years of weather.
    expect(expectedLineCondition(line(220, 100, 0), 0)).toBeCloseTo(1, 3)
    const endOfLife = expectedLineCondition(line(220, 100, 60), 0)
    expect(endOfLife).toBeLessThan(0.8)
    expect(endOfLife).toBeGreaterThan(0.5)
  })
})

describe('what a player can do about it', () => {
  it('offers re-conductoring from halfway through the life, not at the end', () => {
    // Renewal is a plan, not a repair. Offering it only once the corridor was failing would make
    // it a repair — which is exactly the mistake the game is trying to let the player avoid.
    expect(isWorthRenewing(line(220, 100, 10), 0)).toBe(false)
    expect(isWorthRenewing(line(220, 100, 45), 0)).toBe(true)
  })

  it('restarts the clock when the new conductors go up', () => {
    const world = buildWorld(FIRST_REGION)
    const edge = world.network.allEdges().find((e) => e.commodity === 'electric' && e.kv !== 0)!
    // Age it past the halfway point so the option is on offer.
    edge.builtTick = -45 * TICKS_PER_YEAR
    edge.conditionPct = 0.6

    const quote = quoteLineRenewal(world, edge.id)
    expect(quote.ok, quote.reasonKey).toBe(true)
    // A third of a new line, because the towers, the route and the consents already exist.
    const newLine = LINE_TYPES[edge.kv as 110 | 220 | 400].capexPerKm.value * edge.lengthKm
    expect(quote.totalCost).toBeLessThan(newLine * 0.6)
    console.log('re-conductoring', Math.round(quote.totalCost / 1e6), 'm against a new line at', Math.round(newLine / 1e6), 'm')

    expect(renewLine(world, edge.id).ok).toBe(true)
    const finishes = edge.upgradeAtTick!
    // It stays in service throughout: re-conductoring is done on a live corridor circuit by
    // circuit, and taking the whole thing out for a year would be a different, worse decision.
    expect(edge.energised).toBe(true)
    while (world.tick <= finishes) world.step()

    expect(lineLifeFraction(edge, world.tick)).toBeLessThan(0.05)
    // Not exactly one: condition drifts towards its target every hour, and the hour after the
    // new conductors go up is already one hour of drift away from new.
    expect(edge.conditionPct).toBeGreaterThan(0.99)
    expect(world.news.all().some((n) => n.titleKey === 'news.lineRenewed')).toBe(true)
  }, 300_000)

  it('rebuilds a corridor at the next voltage up, which is the decision the scenario asks for', () => {
    const world = buildWorld(FIRST_REGION)
    const edge = world.network.allEdges().find((e) => e.commodity === 'electric' && e.kv === 110)
    if (!edge) return // no 110 kV corridor in this scenario; nothing to prove
    const before = LINE_TYPES[110].capacityMw.value * edge.circuits

    const quote = quoteVoltageUpgrade(world, edge.id)
    expect(quote.ok, quote.reasonKey).toBe(true)
    expect(upgradeVoltage(world, edge.id).ok).toBe(true)
    const finishes = edge.upgradeAtTick!
    while (world.tick <= finishes) world.step()

    expect(edge.kv).toBe(nextVoltage(110))
    const after = LINE_TYPES[edge.kv as 220].capacityMw.value * edge.circuits
    console.log('uprated 110 → 220:', before, 'MW →', after, 'MW for', Math.round(quote.totalCost / 1e6), 'm')
    expect(after).toBeGreaterThan(before * 2)
    expect(world.news.all().some((n) => n.titleKey === 'news.lineUprated')).toBe(true)
    // And the clock restarts, because it is new metal on the same route.
    expect(lineLifeFraction(edge, world.tick)).toBeLessThan(0.05)
  }, 300_000)

  it('refuses to uprate what is already at the top of the ladder', () => {
    expect(nextVoltage(400)).toBeNull()
    const world = buildWorld(FIRST_REGION)
    const top = world.network.allEdges().find((e) => e.kv === 400)
    if (!top) return
    expect(quoteVoltageUpgrade(world, top.id).reasonKey).toBe('build.alreadyHighestVoltage')
  })
})

describe('getting rid of one', () => {
  it('takes a corridor down, so a route you no longer want stops costing you', () => {
    // Reported by a player who built a better route, watched the flow keep going the old way and
    // found no way to remove the old line. The flow behaviour is correct — two parallel paths
    // share the current — but there was no way to demolish one, so the only option was to keep
    // paying for it for ever.
    const world = buildWorld(FIRST_REGION)
    const edge = world.network.allEdges().find((e) => e.commodity === 'electric' && e.kv !== 0)!
    const before = world.network.allEdges().length

    const quote = quoteLineDemolition(world, edge.id)
    expect(quote.ok, quote.reasonKey).toBe(true)
    // Cheaper than building it, because most of a line is conductor and steel that comes back as
    // scrap and there is no contaminated land underneath. Not free, which is the point.
    const newLine = LINE_TYPES[edge.kv as 110 | 220 | 400].capexPerKm.value * edge.lengthKm
    expect(quote.totalCost).toBeLessThan(newLine * 0.3)
    expect(quote.totalCost).toBeGreaterThan(0)

    expect(demolishLine(world, edge.id).ok).toBe(true)
    expect(world.network.allEdges().length).toBe(before - 1)
    expect(world.network.getEdge(edge.id)).toBeUndefined()
    expect(world.news.all().some((n) => n.titleKey === 'news.lineDemolished')).toBe(true)

    // And the system carries on without it, islanded or not — a solver that gave up when a
    // corridor was removed would make this unusable.
    for (let i = 0; i < 48; i++) world.step()
    expect(world.lastDispatch?.aborted).toBeFalsy()
  }, 120_000)

  it('refuses while work is already under way on the same corridor', () => {
    const world = buildWorld(FIRST_REGION)
    const edge = world.network.allEdges().find((e) => e.commodity === 'electric' && e.kv !== 0)!
    edge.builtTick = -45 * TICKS_PER_YEAR
    renewLine(world, edge.id)
    expect(quoteLineDemolition(world, edge.id).reasonKey).toBe('build.alreadyUpgrading')
  })
})

describe('the network costs money to own', () => {
  it('charges for every kilometre, every month, whether anything flows or not', () => {
    // The content has carried `fixedOpexPerKmYear` since the first milestone and nobody was ever
    // charged it. A network that is free is one the player has no reason to think about.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR / 6; i++) world.step()

    let networkOpex = 0
    for (const edge of world.network.allEdges()) {
      if (edge.commodity !== 'electric' || edge.kv === 0) continue
      networkOpex += world.books.window(edge.id, 'lifetime').fixedOpex
    }
    console.log('two months of network opex:', Math.round(networkOpex / 1e6), 'm')
    expect(networkOpex).toBeGreaterThan(0)
    // And it is charged to the corridors themselves, so the accounts can say which one.
    expect(world.lifetimeLedger.fixedOpex).toBeGreaterThan(networkOpex)
  }, 120_000)

  it('takes a corridor out when it faults, and puts it back', () => {
    const world = buildWorld(FIRST_REGION)
    // A long, worn, low-voltage line faults often enough to see inside a few years.
    for (const edge of world.network.allEdges()) {
      if (edge.commodity === 'electric' && edge.kv !== 0) edge.conditionPct = 0.2
    }

    let faults = 0
    let restored = 0
    let downNow = 0
    for (let i = 0; i < TICKS_PER_YEAR * 3; i++) {
      world.step()
      const down = world.network.allEdges().filter((e) => e.faultUntilTick !== undefined).length
      if (down > downNow) faults += down - downNow
      if (down < downNow) restored += downNow - down
      downNow = down
    }
    console.log('faults in three years:', faults, 'restored:', restored)
    expect(faults).toBeGreaterThan(0)
    // Everything that went down came back, bar whatever is still out at the end.
    expect(restored).toBeGreaterThanOrEqual(faults - downNow)
    expect(world.news.all().some((n) => n.titleKey === 'news.lineFault')).toBe(true)
  }, 300_000)
})
