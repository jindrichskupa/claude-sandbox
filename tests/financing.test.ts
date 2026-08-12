/**
 * Borrowing, as a decision rather than a leak.
 *
 * Debt used to be one number that only ever went up. A shortfall was covered by an automatic draw
 * on a facility nobody chose, interest accrued on the total for ever, and no repayment of principal
 * existed anywhere in the game — so the player could not choose to borrow, could not choose to
 * clear it, and largely did not know it had happened. The properties worth guarding are the ones
 * that make it a decision instead:
 *
 *   - principal actually leaves, so borrowing has a cost the player carries afterwards;
 *   - interest and principal are separate, because a regulator lets one through to customers and
 *     not the other, and folding them together would let a player raise the tariff by borrowing;
 *   - the price of debt rises as the balance sheet fills, so borrowing early is different from
 *     borrowing late;
 *   - being rescued is dearer than planning, or there is no reason to plan.
 */

import { describe, expect, it } from 'vitest'
import {
  borrowingHeadroom,
  effectiveInterestRate,
  emptyLedger,
  gearing,
  instalment,
  ledgerProfit,
  quoteLoan,
  repayLoan,
  serviceLoans,
  settlePeriod,
  takeLoan,
  type Finances,
} from '@sim/economy/economy'
import { recoverableCosts } from '@sim/economy/tariff'
import { ECONOMICS } from '@content/economics'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

function finances(over: Partial<Finances> = {}): Finances {
  return { cash: 500e6, debt: 0, trailingRevenue: 600e6, bankrupt: false, loans: [], loanSerial: 0, ...over }
}

describe('a loan', () => {
  it('is repaid, which is the whole of what was missing', () => {
    const f = finances()
    const loan = takeLoan(f, 100e6, 10, 0)!
    expect(loan.outstanding).toBe(100e6)
    expect(f.cash).toBe(600e6)

    // Ten years of monthly instalments clear it. Nothing did this before: the principal stood for
    // ever and only the interest was charged, so debt was a one-way ratchet.
    const ledger = emptyLedger()
    for (let month = 0; month < 10 * MONTHS_PER_YEAR; month++)
      serviceLoans(ledger, f, TICKS_PER_MONTH, month * TICKS_PER_MONTH)
    expect(f.loans).toHaveLength(0)
    expect(f.debt).toBe(0)

    // And what left the accounts is the principal plus its interest, in that order of size.
    expect(ledger.debtRepaid).toBeCloseTo(100e6, -4)
    expect(ledger.interest).toBeGreaterThan(0)
    expect(ledger.interest).toBeLessThan(100e6)
  })

  it('separates interest from principal, because a regulator does', () => {
    // The distinction is not bookkeeping neatness. Interest is the price of the money and is a
    // cost of providing the service; the money itself is not, because the capital it bought is
    // already in the rate base and comes back through depreciation. Charging both to customers
    // would mean a player could raise the tariff simply by borrowing.
    const f = finances()
    takeLoan(f, 200e6, 10, 0)
    const ledger = emptyLedger()
    serviceLoans(ledger, f, TICKS_PER_MONTH, 0)

    expect(ledger.interest).toBeGreaterThan(0)
    expect(ledger.debtRepaid).toBeGreaterThan(0)
    const recoverable = recoverableCosts(ledger)
    expect(recoverable).toBeCloseTo(ledger.interest, 6)
    expect(recoverable).toBeLessThan(ledger.interest + ledger.debtRepaid)

    // It does leave the cash, though — profit here is a cash figure, as capex already is.
    expect(ledgerProfit(ledger)).toBeCloseTo(-(ledger.interest + ledger.debtRepaid), 6)
  })

  it('gets dearer as the balance sheet fills up', () => {
    // Before gearing, debt was free at any level right up to a hard ceiling and then unavailable,
    // which gave a player no reason to borrow early rather than late.
    const empty = finances()
    // Borrowed rather than written into the field, because gearing is now a question about the
    // loans a utility actually holds: a project facility is secured on its asset and does not
    // fill the corporate balance sheet, so the total alone can no longer answer it.
    const loaded = finances()
    takeLoan(loaded, 2_000e6, 10, 0)
    expect(gearing(empty)).toBe(0)
    expect(gearing(loaded)).toBeGreaterThan(0.5)
    expect(effectiveInterestRate(1, gearing(loaded))).toBeGreaterThan(effectiveInterestRate(1, 0))

    // And the quote prices the gearing the utility would have *after* drawing, which is the
    // question a lender actually asks.
    const small = quoteLoan(empty, 10e6, 10)
    const large = quoteLoan(empty, borrowingHeadroom(empty), 10)
    expect(large.ratePerYear).toBeGreaterThan(small.ratePerYear)
  })

  it('never lends past the limit, and says so', () => {
    const f = finances()
    const room = borrowingHeadroom(f)
    const greedy = quoteLoan(f, room * 2, 10)
    expect(greedy.amount).toBeCloseTo(room, 0)
    expect(greedy.ok).toBe(false)

    takeLoan(f, room * 2, 10, 0)
    expect(f.debt).toBeCloseTo(room, 0)
    expect(borrowingHeadroom(f)).toBeCloseTo(0, 0)
    expect(takeLoan(f, 1e6, 10, 0)).toBeNull()
  })

  it('can be cleared early, and clearing it stops the interest', () => {
    const f = finances()
    takeLoan(f, 100e6, 10, 0)
    const before = { ...emptyLedger() }
    serviceLoans(before, f, TICKS_PER_MONTH, 0)

    const paid = repayLoan(f, f.loans[0]!.id)
    expect(paid).toBeGreaterThan(0)
    expect(f.loans).toHaveLength(0)
    expect(f.debt).toBe(0)

    const after = emptyLedger()
    serviceLoans(after, f, TICKS_PER_MONTH, 0)
    expect(after.interest).toBe(0)
  })

  it('amortises level, so the early years are mostly interest', () => {
    // The property that makes an early repayment worth so much, and the reason a long loan taken
    // to build something is a commitment rather than a formality.
    const monthly = instalment(120e6, 0.06, 120)
    expect(monthly).toBeGreaterThan(120e6 / 120)

    const f = finances()
    takeLoan(f, 120e6, 10, 0)
    const first = emptyLedger()
    serviceLoans(first, f, TICKS_PER_MONTH, 0)
    const firstInterest = first.interest

    for (let i = 0; i < 8 * MONTHS_PER_YEAR; i++)
      serviceLoans(emptyLedger(), f, TICKS_PER_MONTH, i * TICKS_PER_MONTH)
    const late = emptyLedger()
    serviceLoans(late, f, TICKS_PER_MONTH, 0)
    expect(late.interest).toBeLessThan(firstInterest)
  })
})

describe('the emergency facility', () => {
  it('is a loan now, with a rate and a term, and it is dearer', () => {
    // It used to be a silent addition to a total that nothing paid down — free, relative to
    // arranging finance properly, which is the same as saying there was no reason to plan.
    const f = finances({ cash: 0 })
    const ledger = emptyLedger()
    ledger.fuelCost = 50e6
    const rescue = settlePeriod(f, ledger, 0, 1)

    expect(rescue).toBeTruthy()
    expect(rescue!.kind).toBe('emergency')
    expect(f.cash).toBeCloseTo(0, 6)
    expect(f.bankrupt).toBe(false)

    const arranged = quoteLoan(finances(), rescue!.principal, ECONOMICS.emergencyTermYears.value)
    expect(rescue!.ratePerYear).toBeGreaterThan(arranged.ratePerYear)
    // Short, as such lending is: it has to be cleared, not carried.
    expect(rescue!.maturesTick - rescue!.takenTick).toBe(
      Math.round(ECONOMICS.emergencyTermYears.value * TICKS_PER_YEAR),
    )
  })

  it('still runs out, and that is still bankruptcy', () => {
    const f = finances({ cash: 0, trailingRevenue: 10e6 })
    const ledger = emptyLedger()
    ledger.fuelCost = 500e6
    settlePeriod(f, ledger, 0, 1)
    expect(f.bankrupt).toBe(true)
  })
})

describe('a scenario in play', () => {
  it('pays down the debt it inherited instead of carrying it for ever', () => {
    // The inherited debt is a loan like any other, and has to be, or it would be the one borrowing
    // in the game that is never repaid and never costs an instalment.
    const world = buildWorld(FIRST_REGION)
    expect(world.finances.loans).toHaveLength(1)
    expect(world.finances.debt).toBe(FIRST_REGION.startingDebt)

    const before = world.finances.debt
    for (let i = 0; i < TICKS_PER_YEAR * 2; i++) world.step()
    expect(world.finances.debt).toBeLessThan(before)
  }, 300_000)

  it('lets the player borrow, and the money arrives', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()
    const cash = world.finances.cash
    const loan = world.borrow(100e6, 10)

    expect(loan).toBeTruthy()
    expect(world.finances.cash).toBeCloseTo(cash + loan!.principal, 0)
    expect(world.finances.debt).toBeCloseTo(FIRST_REGION.startingDebt + loan!.principal, 0)
    // And it is filed, because being in debt is not something a player should have to discover.
    expect(world.news.all().some((n) => n.titleKey === 'news.loanTaken')).toBe(true)
  })
})
