/**
 * Borrowing against a project rather than against the balance sheet.
 *
 * The measurement that produced this: a reactor costs 3005 million and the opening utility has
 * 400 in the bank. It has 724 valid sites, a competitive levelised cost, and no route to being
 * built — because every facility in the game was sized on trailing revenue times a multiple,
 * which means a utility can never borrow to build something larger than the business it already
 * has. The one time the control player got there, in 2009, it was bankrupt by 2012.
 *
 * That is a real constraint on a real company and it is also not how infrastructure is financed.
 * A lender looks at the asset, takes security over it, and advances against what it will earn.
 *
 * What these tests are mostly about is that this does not become free money. A facility has to
 * cost more than corporate debt, has to leave a real equity cheque to write, has to owe more at
 * commissioning than was ever drawn, and has to outlive the thing it paid for. Every one of those
 * is the difference between a decision and a formality.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { ECONOMICS } from '@content/economics'
import { PLANT_TYPES } from '@content/plantTypes'
import {
  corporateDebt,
  borrowingHeadroom,
  drawProjectFinance,
  effectiveInterestRate,
  emptyLedger,
  openProjectFacility,
  quoteProjectFinance,
  serviceLoans,
  takeLoan,
  type Finances,
} from '@sim/economy/economy'
import { beginPlantConstruction, quotePlant, retirePlant } from '@sim/build/commands'
import { isBuildable } from '@sim/map/terrain'
import { TICKS_PER_YEAR } from '@sim/core/time'
import type { World } from '@sim/world'

function finances(over: Partial<Finances> = {}): Finances {
  return {
    cash: 500e6,
    debt: 0,
    trailingRevenue: 500e6,
    bankrupt: false,
    loans: [],
    loanSerial: 0,
    ...over,
  }
}

/** Somewhere a reactor may legally stand, so the test is about money and not about ground. */
function reactorSite(world: World): { x: number; y: number } {
  for (let y = 0; y < FIRST_REGION.mapHeight; y++) {
    for (let x = 0; x < FIRST_REGION.mapWidth; x++) {
      if (world.nodeNear(x, y, 1.5)) continue
      if (!isBuildable(world.terrain, x, y)) continue
      if (quotePlant(world, 'nuclear', x, y, true).ok) return { x, y }
    }
  }
  throw new Error('nowhere to put a reactor')
}

describe('what a lender will offer against a project', () => {
  it('advances against the asset, and leaves a real cheque to write', () => {
    const capex = 3000e6
    const quote = quoteProjectFinance(capex, 6 * TICKS_PER_YEAR)
    expect(quote.ok).toBe(true)
    expect(quote.commitment).toBeCloseTo(capex * ECONOMICS.projectDebtShare.value, 0)
    expect(quote.equity).toBeCloseTo(capex - quote.commitment, 0)
    // Nine hundred million is not a rounding error. The gate on a facility is the equity, and it
    // has to be a gate or this is a way of getting anything for nothing.
    expect(quote.equity).toBeGreaterThan(capex * 0.2)
  })

  it('costs more than corporate debt, because the money arrives before the revenue does', () => {
    const quote = quoteProjectFinance(3000e6, 6 * TICKS_PER_YEAR)
    expect(quote.ratePerYear).toBeGreaterThan(effectiveInterestRate(1, 0))
  })

  it('owes more at commissioning than was ever drawn', () => {
    // The interest during construction is real and has to land somewhere. It rolls into the
    // balance, because there is nothing earning yet to pay it from — which is why a six-year
    // build is a materially worse proposition than a two-year one at the same price.
    const quick = quoteProjectFinance(3000e6, 2 * TICKS_PER_YEAR)
    const slow = quoteProjectFinance(3000e6, 8 * TICKS_PER_YEAR)
    expect(quick.balanceAtCommissioning).toBeGreaterThan(quick.commitment)
    expect(slow.balanceAtCommissioning).toBeGreaterThan(quick.balanceAtCommissioning)
  })

  it('is not on offer for things too small to be worth arranging', () => {
    const small = quoteProjectFinance(ECONOMICS.projectMinimumSize.value / 2, TICKS_PER_YEAR)
    expect(small.ok).toBe(false)
    expect(small.reasonKey).toBe('build.projectTooSmall')
  })
})

describe('the facility over its life', () => {
  it('draws only against the work, and only up to what was committed', () => {
    const f = finances({ cash: 0 })
    openProjectFacility(f, 'p_test', 1000e6, TICKS_PER_YEAR, 0)
    const commitment = f.loans[0]!.commitment!

    // A facility is a promise to fund construction, not a lump sum. Handing the money over on
    // signature would let a player raise it for a reactor and spend it on something else, which
    // is the one thing this arrangement exists to prevent.
    expect(f.cash).toBe(0)
    expect(f.loans[0]!.outstanding).toBe(0)

    let drawn = 0
    for (let i = 0; i < 20; i++) drawn += drawProjectFinance(f, 'p_test', 100e6)
    expect(drawn).toBeCloseTo(commitment, 0)
    expect(f.cash).toBeCloseTo(commitment, 0)
    // Two thousand million of spending on a thousand million project draws the facility and then
    // stops, rather than lending against work that was never in the deal.
    expect(drawProjectFinance(f, 'p_test', 100e6)).toBe(0)
  })

  it('draws nothing for an asset it was not arranged for', () => {
    const f = finances()
    openProjectFacility(f, 'p_reactor', 1000e6, TICKS_PER_YEAR, 0)
    expect(drawProjectFinance(f, 'p_something_else', 100e6)).toBe(0)
  })

  it('charges nothing while the thing is being built, and more for it afterwards', () => {
    const f = finances({ cash: 0 })
    const build = 4 * TICKS_PER_YEAR
    openProjectFacility(f, 'p_test', 1000e6, build, 0)
    drawProjectFinance(f, 'p_test', 1000e6)
    const drawn = f.loans[0]!.outstanding
    const cashAfterDrawing = f.cash

    const duringBuild = emptyLedger()
    for (let month = 0; month < 48; month++) {
      serviceLoans(duringBuild, f, TICKS_PER_YEAR / 12, month * (TICKS_PER_YEAR / 12))
    }
    // Nothing paid, nothing charged to the period — an asset under construction capitalises its
    // interest into what it cost — and more owed than was borrowed.
    expect(duringBuild.interest).toBe(0)
    expect(duringBuild.debtRepaid).toBe(0)
    // Against what the drawdown put in, not against zero: the facility funds the work, so cash
    // going *up* is the arrangement working. What must not happen is any of it going back out.
    expect(f.cash).toBe(cashAfterDrawing)
    expect(f.loans[0]!.outstanding).toBeGreaterThan(drawn * 1.2)

    const afterwards = emptyLedger()
    serviceLoans(afterwards, f, TICKS_PER_YEAR / 12, build + 1)
    expect(afterwards.interest).toBeGreaterThan(0)
    expect(afterwards.debtRepaid).toBeGreaterThan(0)
  })

  it('clears itself over its term', () => {
    const f = finances({ cash: 0 })
    const build = 2 * TICKS_PER_YEAR
    openProjectFacility(f, 'p_test', 1000e6, build, 0)
    drawProjectFinance(f, 'p_test', 1000e6)

    const ledger = emptyLedger()
    const months = Math.round((ECONOMICS.projectTermYears.value + 3) * 12)
    for (let month = 0; month < months; month++) {
      serviceLoans(ledger, f, TICKS_PER_YEAR / 12, month * (TICKS_PER_YEAR / 12))
    }
    expect(f.loans).toHaveLength(0)
    expect(f.debt).toBeCloseTo(0, -4)
  })
})

describe('what it does to the balance sheet', () => {
  it('stays out of the corporate ceiling and inside the total owed', () => {
    const f = finances()
    const headroomBefore = borrowingHeadroom(f)
    openProjectFacility(f, 'p_test', 1000e6, TICKS_PER_YEAR, 0)
    drawProjectFinance(f, 'p_test', 1000e6)

    // Out of the ceiling, because it is secured on the station rather than on the business. This
    // is the change that makes a reactor reachable at all.
    expect(borrowingHeadroom(f)).toBeCloseTo(headroomBefore, 0)
    expect(corporateDebt(f)).toBe(0)

    // And in the total, because the money is owed either way and the accounts, the brief and the
    // objectives all read that number. Leaving it out would be a lie that flattered the player.
    expect(f.debt).toBeGreaterThan(0)
  })

  it('still lets ordinary borrowing fill the corporate ceiling', () => {
    const f = finances()
    openProjectFacility(f, 'p_test', 1000e6, TICKS_PER_YEAR, 0)
    drawProjectFinance(f, 'p_test', 1000e6)
    const loan = takeLoan(f, borrowingHeadroom(f), 10, 0)
    expect(loan).not.toBeNull()
    expect(borrowingHeadroom(f)).toBeCloseTo(0, 0)
  })
})

describe('a reactor, which is what this was for', () => {
  it('is refused for cash and offered against itself, from the opening year', () => {
    const world = buildWorld(FIRST_REGION)
    const site = reactorSite(world)

    const cash = quotePlant(world, 'nuclear', site.x, site.y)
    const financed = quotePlant(world, 'nuclear', site.x, site.y, true)
    expect(cash.ok, 'a reactor was already affordable for cash; this test proves nothing').toBe(false)
    expect(cash.reasonKey).toBe('build.cannotAfford')
    expect(financed.facility?.ok).toBe(true)
    // The station does not get cheaper; only the cheque does. Compared against the facility's own
    // two halves rather than against the refused quote, which reports no cost at all — a refusal
    // has no price, which is right and made the first version of this assertion meaningless.
    const facility = financed.facility!
    expect(financed.totalCost).toBeGreaterThan(2500e6)
    expect(facility.commitment + facility.equity).toBeCloseTo(financed.totalCost, 0)
  })

  it('does not offer a facility for a gas turbine', () => {
    // A peaking turbine rather than a battery, which does not exist until 2015 and would fail
    // this for the wrong reason entirely — the first version of this test did, and reported
    // 'not yet available' while claiming to be about the size of the deal.
    const world = buildWorld(FIRST_REGION)
    const site = reactorSite(world)
    const capex = PLANT_TYPES.ocgt.capexPerKw.value * PLANT_TYPES.ocgt.capacityMw.value * 1000
    expect(capex, 'a gas turbine has grown into project-finance territory').toBeLessThan(
      ECONOMICS.projectMinimumSize.value,
    )
    expect(quotePlant(world, 'ocgt', site.x, site.y, true).reasonKey).toBe('build.projectTooSmall')
  })

  it('survives the station it paid for', () => {
    // The debt is the point at which this stops being free money. A player who financed a
    // reactor and then closed it early is still paying for it, every month, for as long as the
    // facility runs — which is what makes the decision a decision.
    const world = buildWorld(FIRST_REGION)
    const site = reactorSite(world)
    const built = beginPlantConstruction(world, 'nuclear', site.x, site.y, true)
    expect(built.ok).toBe(true)

    for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
    const owed = world.finances.debt
    expect(owed, 'a year of building drew nothing').toBeGreaterThan(0)

    retirePlant(world, built.plantId!)
    world.step()
    expect(world.finances.loans.some((l) => l.assetId === built.plantId)).toBe(true)
    expect(world.finances.debt).toBeGreaterThan(owed * 0.9)
  }, 120_000)

  it('carries the facility through a save and a load', () => {
    const world = buildWorld(FIRST_REGION)
    const site = reactorSite(world)
    beginPlantConstruction(world, 'nuclear', site.x, site.y, true)
    for (let i = 0; i < 24 * 40; i++) world.step()

    const loaded = buildWorld(FIRST_REGION)
    loaded.applySaveData(JSON.parse(JSON.stringify(world.toSaveData())))
    const before = world.finances.loans.find((l) => l.kind === 'project')!
    const after = loaded.finances.loans.find((l) => l.kind === 'project')!
    expect(after.outstanding).toBeCloseTo(before.outstanding, 3)
    expect(after.drawn).toBeCloseTo(before.drawn!, 3)
    expect(after.repaymentsStartTick).toBe(before.repaymentsStartTick)
  }, 120_000)
})
