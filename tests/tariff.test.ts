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
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { mothballPlant } from '@sim/build/commands'
import { ledgerProfit } from '@sim/economy/economy'

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

  it('weights the average by energy delivered rather than by the hour', () => {
    // The accumulator is private, so this recovers what the regulator must have used by inverting
    // the reset arithmetic, and checks it against the two candidate averages computed here from
    // the same hours. Weighted and unweighted differ by a few percent — small enough that only a
    // reconstruction like this can tell them apart, and large enough to decide solvency over
    // thirty years.
    const world = buildWorld(FIRST_REGION)
    const before = world.state.regulatedTariffPerMwh

    let weightedSum = 0
    let volume = 0
    let flatSum = 0
    let servedHours = 0
    for (let i = 0; i < TICKS_PER_YEAR; i++) {
      world.step()
      const snap = world.recentHistory(1)[0]!
      if (snap.unservedMw > 0.01) continue
      const served = Math.max(0, snap.demandMw - snap.unservedMw)
      weightedSum += snap.pricePerMwh * served
      volume += served
      flatSum += snap.pricePerMwh
      servedHours++
    }
    const weighted = weightedSum / volume
    const unweighted = flatSum / servedHours

    // Load and price are positively correlated in any system with a peak, so the weighted mean
    // must be the higher of the two. If this ever fails the scenario has no peak worth the name
    // and the rest of the assertion means nothing.
    expect(weighted).toBeGreaterThan(unweighted)

    // Invert `tariff = before + (reset - before) * 0.6` to recover the reset the regulator used,
    // then invert the retail margin to get back to the wholesale average behind it.
    const after = world.state.regulatedTariffPerMwh
    const impliedWholesale = (before + (after - before) / 0.6) / 1.35

    expect(Math.abs(impliedWholesale - weighted)).toBeLessThan(Math.abs(impliedWholesale - unweighted))
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
