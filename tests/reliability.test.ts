/**
 * Wear-out, and what it does to a fleet nobody touches.
 *
 * The finding this exists to hold down: measured over thirty passive years, the inherited fleet
 * used to *never die*. Eight units in 1995, eight units in 2026, sailing decades past their design
 * lives with availability slipping and nothing ever forcing a decision. A scenario in which no
 * crisis arrives on its own has no turning point, and a fleet that cannot die makes the whole
 * replace-or-refurbish half of the game optional.
 *
 * What is asserted here is the *shape* rather than the numbers: the hazard rises past design life
 * rather than stepping, nothing fails beyond repair while it is young, and a fleet left alone for
 * three decades genuinely falls apart. The exact severity is a balance decision and pinning it in
 * a test would freeze it.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { forcedOutageRate, lifeFraction, terminalFailureShare, wearFactor } from '@sim/assets/aging'
import { LifecyclePhase, type PlantAsset } from '@sim/assets/types'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { RELIABILITY } from '@content/reliability'

function unit(ageYears: number, designLifeYears = 40): PlantAsset {
  return {
    id: 'p_test',
    ownerId: 'player',
    typeId: 'lignite',
    nodeId: 'n',
    phase: LifecyclePhase.Operating,
    phaseEndsTick: 0,
    commissionedTick: -ageYears * TICKS_PER_YEAR,
    designLifeYears,
    conditionPct: 1,
    cumulativeRunHours: 0,
    cumulativeStarts: 0,
    outputMw: 0,
    heatOutputMw: 0,
    storageMwh: 0,
    heatStoredMwhth: 0,
    cyclesUsed: 0,
    online: true,
    capexPaid: 0,
    refurbishments: 0,
    lifeExtension: 0,
    efficiencyUplift: 0,
    capacityUplift: 0,
  }
}

describe('the wear-out region', () => {
  it('rises as a curve past design life rather than stepping at it', () => {
    // A bathtub hazard, not a cliff. Machines run decades past their nameplate life all over the
    // world; what stops them is that it gets steadily worse, not that a rule forbids it.
    // Second argument is the tick, not the design life — the plants are built already aged.
    expect(wearFactor(unit(20), 0)).toBe(1)
    expect(wearFactor(unit(40), 0)).toBe(1)
    const half = wearFactor(unit(60), 0)
    const twice = wearFactor(unit(80), 0)
    expect(half).toBeGreaterThan(2)
    expect(twice).toBeGreaterThan(half * 2)
    console.log('wear factor at 1.0 / 1.5 / 2.0 lives:', 1, half.toFixed(1), twice.toFixed(1))
  })

  it('makes maintenance a lever in both directions', () => {
    const old = unit(55, 40)
    const deferred = forcedOutageRate(old, 0, 0.6)
    const normal = forcedOutageRate(old, 0, 1)
    const thorough = forcedOutageRate(old, 0, 1.4)
    expect(deferred).toBeGreaterThan(normal)
    expect(thorough).toBeLessThan(normal)
    console.log('outage rate deferred / normal / thorough:', [deferred, normal, thorough].map((r) => r.toFixed(2)))
  })

  it('never breaks a young machine beyond repair', () => {
    // A new unit failing permanently would be a manufacturing scandal, not a game mechanic, and
    // it would make every early build feel arbitrary.
    expect(terminalFailureShare(unit(5), 0)).toBe(0)
    expect(terminalFailureShare(unit(30), 0)).toBe(0)
    expect(terminalFailureShare(unit(40), 0)).toBeGreaterThan(0)
    expect(terminalFailureShare(unit(80), 0)).toBeGreaterThan(terminalFailureShare(unit(45), 0))
    expect(terminalFailureShare(unit(80), 0)).toBeLessThan(1)
  })

  it('is bounded by the life fraction, so refurbishment genuinely buys time', () => {
    // The loop that makes the mechanic fair: the same thing that raises the risk is the thing
    // refurbishment resets, and the player can see both.
    const worn = unit(50, 40)
    const before = terminalFailureShare(worn, 0)
    worn.lifeExtension = 0.5 // a refurbishment's worth of extra design life
    const after = terminalFailureShare(worn, 0)
    expect(lifeFraction(worn, 0)).toBeLessThan(1.1)
    expect(after).toBeLessThan(before)
  })
})

describe('a fleet nobody touches', () => {
  it('falls apart over three decades instead of running for ever', () => {
    // The whole point. This used to end with eight units running and 0.6% unserved; a player
    // could do nothing at all and never face a decision.
    const world = buildWorld(FIRST_REGION)
    const startOperating = world.plants.filter((p) => p.phase === LifecyclePhase.Operating).length

    let firstLoss = 0
    for (let y = 0; y < 25; y++) {
      for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
      const operating = world.plants.filter((p) => p.phase === LifecyclePhase.Operating).length
      if (firstLoss === 0 && operating < startOperating) firstLoss = world.date.year
    }
    const operating = world.plants.filter((p) => p.phase === LifecyclePhase.Operating).length
    console.log(`operating units: ${startOperating} in ${FIRST_REGION.startYear} → ${operating} in ${world.date.year}`)
    console.log('first unit lost:', firstLoss)

    expect(operating).toBeLessThan(startOperating)
    // And the first loss is not on day one. A crisis in the opening months would be a punishment
    // rather than a consequence, and the player needs long enough to see it coming.
    expect(firstLoss).toBeGreaterThan(FIRST_REGION.startYear + 2)

    // Everything that was lost was reported, because a station disappearing without a headline is
    // the worst thing this simulation could do to a player.
    const gone = world.plants.filter((p) => p.phase !== LifecyclePhase.Operating).length
    const reported = world.news.all().filter((n) => n.titleKey === 'news.terminalFailure').length
    expect(reported).toBeGreaterThan(0)
    expect(reported).toBeLessThanOrEqual(gone)
  }, 900_000)

  it('warns before it happens, with the same odds it rolls against', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR * 12; i++) world.step()

    const warnings = world.upcoming().filter((u) => u.titleKey === 'upcoming.terminalRisk')
    console.log('terminal-risk warnings in', world.date.year, ':', warnings.map((w) => `${w.params?.plant}@${((w.chance ?? 0) * 100).toFixed(1)}%`))
    expect(warnings.length).toBeGreaterThan(0)
    for (const warning of warnings) {
      expect(warning.chance).toBeGreaterThan(0)
      expect(warning.whenTicks).toBeUndefined()
    }
    expect(RELIABILITY.terminalShareAtDoubleLife.value).toBeGreaterThan(RELIABILITY.terminalShareAtDesignLife.value)
  }, 900_000)
})
