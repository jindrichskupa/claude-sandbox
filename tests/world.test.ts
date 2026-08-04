/**
 * Whole-world behaviour.
 *
 * These run the real scenario for years at a time. They are less about any single formula
 * and more about the thing that actually breaks in a simulation game: a slow drift that
 * looks fine for a week and is absurd by year ten.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { ageYears } from '@sim/assets/aging'

function runYears(years: number) {
  const world = buildWorld(FIRST_REGION)
  const ticks = Math.round(years * TICKS_PER_YEAR)
  for (let i = 0; i < ticks; i++) world.step()
  return world
}

describe('brownfield start', () => {
  it('begins with an inherited fleet that is already worn', () => {
    const world = buildWorld(FIRST_REGION)
    expect(world.plants.length).toBeGreaterThan(0)

    for (const plant of world.plants) {
      expect(plant.phase).toBe(LifecyclePhase.Operating)
      // Inherited plants were commissioned before the scenario began.
      expect(plant.commissionedTick).toBeLessThan(0)
      expect(ageYears(plant, 0)).toBeGreaterThan(0)
      // And none of them is in factory condition.
      expect(plant.conditionPct).toBeLessThan(1)
      expect(plant.conditionPct).toBeGreaterThan(0)
    }
  })

  it('starts with the oldest unit closest to the end of its life', () => {
    const world = buildWorld(FIRST_REGION)
    const oldHarbour = world.getPlant('p_oldharbour')!
    const eastfield = world.getPlant('p_eastfield')!
    expect(oldHarbour.conditionPct).toBeLessThan(eastfield.conditionPct)
  })
})

describe('one year of operation', () => {
  it('runs a full year without the solver giving up', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR; i++) {
      const snap = world.step()
      expect(Number.isFinite(snap.demandMw)).toBe(true)
      expect(Number.isFinite(snap.generationMw)).toBe(true)
      expect(world.lastDispatch!.aborted).toBe(false)
    }
  })

  it('conserves power every hour: generation equals served demand plus losses', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 2000; i++) {
      world.step()
      const d = world.lastDispatch!
      let served = 0
      for (const city of world.cities) served += d.servedMw.get(city.id) ?? 0
      expect(d.totalGenerationMw).toBeCloseTo(served + d.totalLossMw + d.totalStorageChargeMw, 3)
    }
  })

  it('produces a seasonal demand swing, with winter above summer', () => {
    const world = buildWorld(FIRST_REGION)
    let winter = 0
    let winterN = 0
    let summer = 0
    let summerN = 0
    for (let i = 0; i < TICKS_PER_YEAR; i++) {
      const snap = world.step()
      if (snap.date.month === 0) {
        winter += snap.demandMw
        winterN++
      } else if (snap.date.month === 6) {
        summer += snap.demandMw
        summerN++
      }
    }
    expect(winter / winterN).toBeGreaterThan(summer / summerN)
  })

  it('keeps losses to a plausible share of demand', () => {
    const world = buildWorld(FIRST_REGION)
    let demand = 0
    let loss = 0
    for (let i = 0; i < TICKS_PER_YEAR; i++) {
      const snap = world.step()
      demand += snap.demandMw
      loss += snap.lossMw
    }
    const share = loss / demand
    // Real transmission systems lose a few percent. Much more than this means the loss
    // model or the network is wrong, and it would be easy not to notice.
    expect(share).toBeGreaterThan(0.001)
    expect(share).toBeLessThan(0.12)
  })
})

describe('determinism', () => {
  it('two runs from the same seed are identical', () => {
    const a = runYears(0.5)
    const b = runYears(0.5)
    expect(a.finances.cash).toBeCloseTo(b.finances.cash, 6)
    expect(a.weather.tempC).toBeCloseTo(b.weather.tempC, 9)
    expect(a.tick).toBe(b.tick)
  })
})

describe('a decade of operation', () => {
  it('ages the fleet without the economy or the grid running away', () => {
    const world = runYears(10)

    expect(Number.isFinite(world.finances.cash)).toBe(true)
    expect(Number.isFinite(world.finances.debt)).toBe(true)
    expect(world.finances.debt).toBeGreaterThanOrEqual(0)

    // The inherited fleet must actually have degraded over ten years.
    const oldHarbour = world.getPlant('p_oldharbour')!
    expect(ageYears(oldHarbour, world.tick)).toBeGreaterThan(50)
    expect(oldHarbour.conditionPct).toBeLessThan(0.7)

    // Public opinion stays a probability.
    expect(world.state.publicOpinion).toBeGreaterThanOrEqual(0)
    expect(world.state.publicOpinion).toBeLessThanOrEqual(1)
  })

  it('records history without unbounded growth', () => {
    const world = runYears(2)
    const history = world.recentHistory(10_000)
    expect(history.length).toBeLessThanOrEqual(TICKS_PER_YEAR)
    expect(history.length).toBeGreaterThan(0)
    // Oldest first.
    for (let i = 1; i < history.length; i++) {
      expect(history[i]!.tick).toBeGreaterThan(history[i - 1]!.tick)
    }
  })
})
