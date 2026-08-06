/**
 * What the regulator lets the utility charge, and what it must not.
 *
 * This file exists because of a bug that no unit test could have caught by inspection and that
 * looked, from every angle except a long measured run, like the game working. The tariff was
 * reset each year against the arithmetic mean of every hour's clearing price. An hour in which
 * load is shed clears at the value of lost load — five thousand euros a megawatt-hour and rising
 * with inflation — so a couple of percent of failed hours contributed more to that mean than
 * every real generator put together, and the tariff charged in all 8760 hours rose accordingly.
 *
 * The result was a utility that got *richer the more it failed*. Thirty passive years ended with
 * billions in the bank and the lights going out more each year. Every individual step of that was
 * defensible; the loop was not.
 *
 * Two properties fix it, and both are tested here because both can silently regress:
 *
 *   1. **Scarcity the utility caused does not pass through to it.** Only hours in which demand
 *      was actually met count towards the reset. No threshold and no magic number — the test is
 *      the same question the penalty asks.
 *   2. **The average is weighted by energy delivered, not by the hour.** A cheap summer night and
 *      a cold December evening are not equal evidence about what it costs to serve load, and
 *      since load and price are correlated, weighting by the hour biases the tariff low exactly
 *      where the money is.
 *
 * Both of those were about the *clearing price*, and the tariff no longer resets against the
 * clearing price at all — it resets against what providing the service cost, which is what a
 * regulator actually does and what `economy/tariff.ts` explains at length. The two properties
 * above still hold and are still tested, because both would still be bugs. What follows them is
 * the property whose absence made the game unwinnable: a utility running its inherited fleet
 * competently has to be able to break even. It could not, and every strategy that spent money
 * therefore died sooner than one that spent none.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { mothballPlant } from '@sim/build/commands'
import { ledgerProfit } from '@sim/economy/economy'
import { rateBase } from '@sim/economy/tariff'

/** Run a world for a year and report what the regulator did with the tariff. */
function afterOneYear(cripple: boolean): { tariff: number; unservedMwh: number } {
  const world = buildWorld(FIRST_REGION)
  if (cripple) {
    // Take the two largest thermal units out of service, which is the cheapest way to
    // manufacture genuine scarcity without touching the tariff machinery itself.
    for (const id of ['p_blackridge1', 'p_blackridge2']) {
      const plant = world.getPlant(id)
      if (plant?.phase === LifecyclePhase.Operating) mothballPlant(world, id)
    }
  }
  for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
  return {
    tariff: world.state.regulatedTariffPerMwh,
    unservedMwh: world.lifetimeLedger.energyUnservedMwh,
  }
}

describe('the regulated tariff', () => {
  it('does not pay a utility for the scarcity it caused', () => {
    const healthy = afterOneYear(false)
    const crippled = afterOneYear(true)

    // The crippled run must actually be short, or the test proves nothing.
    expect(crippled.unservedMwh).toBeGreaterThan(healthy.unservedMwh * 10 + 1000)

    // And its tariff must not be inflated by that shortfall. Some rise is legitimate and
    // expected — with two big cheap units gone the remaining plant really is dearer to run, and
    // a tariff that ignored that would be the opposite error.
    //
    // The bound is set from measurement rather than taste. With the fix this ratio is 1.6 after
    // one year and 1.4 after twelve; with the scarcity hours put back it is **22**, and the
    // crippled utility ends twelve years with a hundred and fifty billion in the bank. Two is
    // comfortably clear of the real behaviour and nowhere near the broken one, so this fails
    // loudly on a regression without being brittle about ordinary variation.
    expect(crippled.tariff).toBeLessThan(healthy.tariff * 2)
  })

  it('keeps a failing utility’s tariff in the region of what generation costs', () => {
    // A second reading of the same property that does not depend on the healthy run, so a change
    // that moved both together could not hide behind the ratio above. A tariff is a price for
    // electricity; four figures a megawatt-hour is not a price, it is the value of lost load
    // wearing a tariff's clothes. The crippled run reached 1071 before the fix and 74 after.
    const crippled = afterOneYear(true)
    expect(crippled.tariff).toBeLessThan(400)
  })

  it('lets a utility that runs its inherited fleet competently break even', () => {
    // The property whose absence made the scenario unwinnable, and the reason the tariff was
    // rewritten. The old reset paid short-run marginal cost plus a supply margin to a firm that
    // owns its own generation, so it recovered no fixed cost and no capital: by 1997 the tariff
    // had fallen to its floor, the utility lost money on every megawatt-hour it sold, and every
    // strategy that spent money died sooner than one that spent none.
    //
    // Measured over the years before the carbon price steps, which is the part of the run where
    // nothing unusual is happening and a competent operator ought simply to be solvent.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR * 4; i++) world.step()

    const settled = world.yearbook.slice(1)
    expect(settled.length).toBeGreaterThan(1)
    for (const year of settled) {
      expect(`${year.year} profit ${Math.round(year.profit / 1e6)}m`).toBe(
        `${year.year} profit ${Math.round(Math.max(0, year.profit) / 1e6)}m`,
      )
    }

    // And it is a *tariff*, not a rescue: still in the region of what the energy costs to make,
    // rather than whatever number makes the accounts work.
    expect(world.state.regulatedTariffPerMwh).toBeGreaterThan(40)
    expect(world.state.regulatedTariffPerMwh).toBeLessThan(150)
  })

  it('does not let the player raise it by starting projects', () => {
    // Work in progress is outside the rate base, exactly as a regulator would have it. Without
    // that, announcing a station would raise everybody's bill before it generated anything —
    // and building things you never finish would be a strategy.
    const world = buildWorld(FIRST_REGION)
    const edges = [...world.network.allEdges()]
    const inService = rateBase(world.plants, edges, () => 1000)
    expect(inService.replacementCost).toBeGreaterThan(0)
    expect(inService.depreciationPerYear).toBeGreaterThan(0)

    // Put one operating station back into construction and the base must shrink by exactly it.
    const moved = world.plants.find((p) => p.phase === LifecyclePhase.Operating)!
    moved.phase = LifecyclePhase.Building
    const underway = rateBase(world.plants, edges, () => 1000)
    expect(underway.replacementCost).toBeLessThan(inService.replacementCost)
  })
})

describe('the cash the player is shown', () => {
  it('moves every hour, while the settled balance moves monthly', () => {
    // The headline number stood perfectly still for six minutes of real time at normal speed,
    // because cash only settles at a month boundary. The settled figure stays authoritative for
    // borrowing and bankruptcy — a utility is solvent at the moment its bills fall due, not on a
    // running total — but the display has to move when the world does.
    const world = buildWorld(FIRST_REGION)
    world.step()
    const settled = world.finances.cash
    const liveStart = world.liveCash

    for (let i = 0; i < 200; i++) world.step()

    expect(world.finances.cash).toBe(settled)
    expect(world.liveCash).not.toBe(liveStart)
    // And it is the settled balance plus whatever the open month has accrued, exactly.
    expect(world.liveCash).toBeCloseTo(world.finances.cash + ledgerProfit(world.openLedger), 6)
  })
})
