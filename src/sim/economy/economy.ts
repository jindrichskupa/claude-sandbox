/**
 * Money.
 *
 * Hourly costs and revenue accumulate into an open period; the period closes monthly, which
 * is when fixed costs land and the player finds out whether the month was any good. Keeping
 * hourly and periodic accounting separate is what stops fixed costs from being charged 8760
 * times a year by accident.
 */

import { ECONOMICS } from '@content/economics'
import { BASE_PRICES, type Prices } from '../tech/money'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '../core/time'
import { Param } from '../params/types'
import type { Params } from '../params/Params'
import { incursFixedCost, LifecyclePhase, type PlantAsset } from '../assets/types'

export interface PeriodLedger {
  revenue: number
  /** Revenue from district heat, kept separate because it is a different business. */
  heatRevenue: number
  fuelCost: number
  carbonCost: number
  varOpex: number
  fixedOpex: number
  interest: number
  /**
   * Principal returned to lenders this period.
   *
   * On its own line and *not* in `recoverableCosts`, which is the point of separating it from
   * interest. Repaying a loan is not a cost of providing the service — the capital it bought is
   * already in the rate base and is recovered through depreciation — so a regulator does not let
   * it be charged to customers. Interest is the price of the money and is recoverable; the money
   * itself is not. Folding the two together would have let a player raise the tariff by borrowing.
   */
  debtRepaid: number
  unservedPenalty: number
  /** Capital spent on construction in this period. */
  capex: number
  decommissioningCost: number
  recyclingIncome: number
  /** What the player spent responding to events. */
  eventCost: number
  insurancePremium: number
  /** Tax on profit, charged when the year closes. */
  tax: number
  /** A levy on revenue earned above a political price threshold. */
  windfallLevy: number
  /** Payment for keeping firm capacity available, where a capacity market exists. */
  capacityIncome: number
  /**
   * What the utility paid households for the power their roofs pushed back into the network.
   *
   * Its own line rather than folded into fuel or purchases, because it is the one cost on this
   * list that grows when the player *raises* the tariff — see `sim/city/rooftop.ts` — and a
   * player who cannot see it has no way to notice that happening.
   */
  rooftopPurchases: number
  /** Energy sold, MWh. */
  energySoldMwh: number
  /** Energy not delivered, MWh. */
  energyUnservedMwh: number
  /** Heat sold, MWh thermal. */
  heatSoldMwh: number
  /** Heat not delivered, MWh thermal. */
  heatUnservedMwh: number
  /** Tonnes of CO2 emitted. */
  co2Tonnes: number
}

export function emptyLedger(): PeriodLedger {
  return {
    revenue: 0,
    heatRevenue: 0,
    rooftopPurchases: 0,
    fuelCost: 0,
    carbonCost: 0,
    varOpex: 0,
    fixedOpex: 0,
    interest: 0,
    debtRepaid: 0,
    unservedPenalty: 0,
    capex: 0,
    decommissioningCost: 0,
    recyclingIncome: 0,
    eventCost: 0,
    insurancePremium: 0,
    tax: 0,
    windfallLevy: 0,
    capacityIncome: 0,
    energySoldMwh: 0,
    energyUnservedMwh: 0,
    heatSoldMwh: 0,
    heatUnservedMwh: 0,
    co2Tonnes: 0,
  }
}

export function ledgerProfit(l: PeriodLedger): number {
  return (
    l.revenue +
    l.heatRevenue +
    l.recyclingIncome +
    l.capacityIncome -
    l.fuelCost -
    l.carbonCost -
    l.varOpex -
    l.fixedOpex -
    l.interest -
    l.debtRepaid -
    l.unservedPenalty -
    l.capex -
    l.decommissioningCost -
    l.eventCost -
    l.insurancePremium -
    l.tax -
    l.windfallLevy -
    l.rooftopPurchases
  )
}

export function addLedger(into: PeriodLedger, from: PeriodLedger): void {
  into.revenue += from.revenue
  into.heatRevenue += from.heatRevenue
  into.fuelCost += from.fuelCost
  into.carbonCost += from.carbonCost
  into.varOpex += from.varOpex
  into.fixedOpex += from.fixedOpex
  into.interest += from.interest
  into.debtRepaid += from.debtRepaid
  into.unservedPenalty += from.unservedPenalty
  into.capex += from.capex
  into.decommissioningCost += from.decommissioningCost
  into.recyclingIncome += from.recyclingIncome
  into.eventCost += from.eventCost
  into.insurancePremium += from.insurancePremium
  into.tax += from.tax
  into.windfallLevy += from.windfallLevy
  into.capacityIncome += from.capacityIncome
  into.rooftopPurchases += from.rooftopPurchases
  into.energySoldMwh += from.energySoldMwh
  into.energyUnservedMwh += from.energyUnservedMwh
  into.heatSoldMwh += from.heatSoldMwh
  into.heatUnservedMwh += from.heatUnservedMwh
  into.co2Tonnes += from.co2Tonnes
}

/**
 * One borrowing, with a term and a repayment schedule.
 *
 * Debt used to be a single number that only ever went up. `settlePeriod` covered a shortfall by
 * silently drawing on an unlimited-looking facility, interest accrued on the total for ever, and
 * the principal was never repaid by anything — so a player could not choose to borrow, could not
 * choose to clear it, and mostly did not know it had happened. That is not a decision, it is a
 * leak with a number attached.
 *
 * A loan here behaves as one: a sum drawn on a day, at a rate fixed on that day, repaid in level
 * instalments over a term. Which means borrowing early and cheaply to build something that earns
 * is a different act from being bailed out of a bad winter, and the accounts can tell them apart.
 */
export interface Loan {
  id: string
  /** What was drawn. Kept so the interface can show how far through the loan is. */
  principal: number
  /** What is still owed. */
  outstanding: number
  /**
   * Fixed for the life of the loan, at the rate on the day it was taken.
   *
   * Fixed rather than floating on purpose: it is what makes *when* you borrow a decision. A player
   * who financed a station while investor confidence was intact keeps that rate through the
   * government that wrecks it, which is exactly the asymmetry long-tenor infrastructure debt has.
   */
  ratePerYear: number
  takenTick: number
  maturesTick: number
  kind: 'planned' | 'emergency' | 'project'
  /**
   * What this facility financed. Project facilities only.
   *
   * Kept because the debt outlives the decision: a player who project-financed a station and then
   * closed it is still paying for it, and the interface has to be able to say which station. It is
   * also what the drawdown finds — a facility funds its share of *that* asset's construction and
   * nothing else, which is the difference between project finance and a loan.
   */
  assetId?: string
  /** The facility's full size. What is left to draw is this less `drawn`. */
  commitment?: number
  drawn?: number
  /**
   * When instalments begin. Absent means at once, which is every facility but a project one.
   *
   * A station under construction earns nothing, so a project facility charges no instalment until
   * the asset is in service; the interest it accrues in the meantime is rolled into the balance
   * instead. That is not a concession, it is how the money works — and it is why the debt at
   * commissioning is larger than the sum ever drawn.
   */
  repaymentsStartTick?: number
}

export interface Finances {
  cash: number
  /**
   * Total still owed, across every loan.
   *
   * Derived from `loans` and kept in step with it, rather than being the primary record. It stays
   * because a great deal reads it — the borrowing limit, the brief, the accounts, the objectives —
   * and none of that cares how the debt is structured.
   */
  debt: number
  /** Rolling 12-month revenue, used to size the borrowing limit. */
  trailingRevenue: number
  bankrupt: boolean
  /** Every loan still outstanding. */
  loans: Loan[]
  /** Serial for loan ids, so they are stable across a save. */
  loanSerial: number
}

/**
 * Fuel burnt in one hour, in MWh thermal.
 *
 * The cogeneration cases are not the electrical formula with a correction bolted on; they are
 * different formulas, and each one is the one that matches how that machine's heat was priced
 * in the merit order. Getting this wrong is the classic cogeneration accounting error — it
 * shows up as a plant that appears to make heat out of nothing, or one whose fuel bill falls
 * when it takes on more work.
 *
 *   **Extraction** (power loss method). Bleeding steam for heat does not change how much fuel
 *   goes into the boiler; it changes what comes out of the turbine. So the fuel follows the
 *   electricity the unit *would* have made, `Pel + cv·Q`, at the electrical efficiency.
 *
 *   **Backpressure.** Power and heat come out of the same steam in a fixed ratio, so the fuel
 *   follows their sum at the total efficiency.
 *
 *   **Boiler.** Heat divided by the boiler's efficiency, and nothing else.
 */
export function thermalInputMwh(
  plant: PlantAsset,
  electricMwh: number,
  heatMwh: number,
  params: Params,
): number {
  const type = PLANT_TYPES[plant.typeId]
  if (type.fuel === 'none') return 0
  const efficiency = Math.max(0.01, params.get(plant.id, Param.Efficiency))

  if (type.heatOnly) return heatMwh > 0 ? heatMwh / efficiency : 0

  if (type.chp) {
    if (type.chp.mode === 'backpressure') {
      const total = Math.max(0, electricMwh) + Math.max(0, heatMwh)
      return total / Math.max(0.01, type.chp.totalEfficiency.value)
    }
    const equivalent = Math.max(0, electricMwh) + Math.max(0, heatMwh) * type.chp.powerLossPerHeat.value
    return equivalent / efficiency
  }

  return Math.max(0, electricMwh) / efficiency
}

/**
 * Charge one hour of a plant's operation: fuel burnt, carbon emitted, variable operating cost.
 *
 * Heat and electricity are charged together because for a cogeneration unit they cannot be
 * separated — see `thermalInputMwh`. Passing only one of them would understate the fuel bill
 * of a machine that is doing both jobs.
 */
export function chargeGeneration(
  ledger: PeriodLedger,
  plant: PlantAsset,
  mwh: number,
  params: Params,
  carbonPrice: number,
  heatMwh = 0,
): void {
  if (mwh <= 0 && heatMwh <= 0) return
  const type = PLANT_TYPES[plant.typeId]
  const varOpex = params.get(plant.id, Param.VarOpexPerMwh)

  ledger.varOpex += (Math.max(0, mwh) + Math.max(0, heatMwh)) * varOpex

  if (type.fuel !== 'none') {
    const thermalMwh = thermalInputMwh(plant, mwh, heatMwh, params)
    const fuelPrice = params.get(plant.id, Param.FuelPricePerMwhThermal)
    ledger.fuelCost += thermalMwh * fuelPrice

    const co2 = thermalMwh * FUELS[type.fuel].co2PerMwhThermal.value
    ledger.co2Tonnes += co2
    ledger.carbonCost += co2 * carbonPrice
  }
}

/** Credit one hour of heat sales, which are billed separately and far more cheaply. */
export function creditHeatSales(ledger: PeriodLedger, mwh: number, tariffPerMwh: number): void {
  if (mwh <= 0) return
  ledger.heatRevenue += mwh * tariffPerMwh
  ledger.heatSoldMwh += mwh
}

/**
 * Charge one hour of failing to deliver heat. Priced far above the electrical equivalent,
 * because the consequence is not an inconvenient evening — see `valueOfLostHeatPerMwh`.
 */
export function chargeUnservedHeat(ledger: PeriodLedger, mwh: number, prices: Prices = BASE_PRICES): void {
  if (mwh <= 0) return
  ledger.heatUnservedMwh += mwh
  ledger.unservedPenalty += mwh * prices.unservedHeatPenaltyPerMwh
}

/** Credit one hour of sales. */
export function creditSales(ledger: PeriodLedger, mwh: number, tariffPerMwh: number): void {
  if (mwh <= 0) return
  ledger.revenue += mwh * tariffPerMwh
  ledger.energySoldMwh += mwh
}

/** Charge one hour of failing to supply. */
export function chargeUnserved(ledger: PeriodLedger, mwh: number, prices: Prices = BASE_PRICES): void {
  if (mwh <= 0) return
  ledger.energyUnservedMwh += mwh
  ledger.unservedPenalty += mwh * prices.unservedPenaltyPerMwh
}

/**
 * Fixed costs for a period. Charged when the period closes rather than hourly, both because
 * that is how they are really incurred and because it keeps the hourly loop cheap.
 */
export function chargeFixedCosts(
  ledger: PeriodLedger,
  plants: PlantAsset[],
  params: Params,
  ticksInPeriod: number,
  maintenanceLevel = 1,
): void {
  const yearFraction = ticksInPeriod / TICKS_PER_YEAR
  for (const plant of plants) {
    if (!incursFixedCost(plant)) continue
    const capacityKw = params.get(plant.id, Param.CapacityMw) * 1000
    const perKwYear = params.get(plant.id, Param.FixedOpexPerKwYear)
    // A mothballed unit is preserved rather than operated, which is much cheaper but not free.
    const factor = plant.phase === LifecyclePhase.Mothballed ? 0.3 : 1
    // Maintenance is a real lever and it is priced like one: cutting it saves money now and is
    // paid for later in failure rates. The saving is visible immediately, the bill is not,
    // which is exactly why it is a tempting mistake.
    ledger.fixedOpex += capacityKw * perKwYear * yearFraction * factor * maintenanceLevel
  }
}

/** What the player paid to respond to an event. */
export function chargeEventCost(ledger: PeriodLedger, amount: number): void {
  if (amount <= 0) return
  ledger.eventCost += amount
}

/** The insurance premium for a period, on the capital value of the operating fleet. */
export function chargeInsurance(
  ledger: PeriodLedger,
  plants: PlantAsset[],
  ticksInPeriod: number,
): void {
  let insuredValue = 0
  for (const plant of plants) {
    if (!incursFixedCost(plant)) continue
    insuredValue += plant.capexPaid
  }
  ledger.insurancePremium +=
    insuredValue * ECONOMICS.insurancePremiumRate.value * (ticksInPeriod / TICKS_PER_YEAR)
}

/**
 * The rate the utility actually pays, after the country's record with investors.
 *
 * `investorConfidence` is what makes tearing up a support contract cost something. `gearing` is
 * what makes the balance sheet a constraint rather than a cliff: the last euro a lender advances
 * to somebody already at their ceiling is not priced like the first to somebody with room. Before
 * gearing entered, debt was free at any level right up to a hard limit, and then unavailable —
 * which gave a player no reason to borrow early, when it is cheap, rather than late.
 */
export function effectiveInterestRate(investorConfidence: number, gearing = 0): number {
  const confidence = Math.max(0.01, Math.min(1, investorConfidence))
  const geared = Math.max(0, Math.min(1, gearing))
  return (
    ECONOMICS.loanInterestRate.value *
    (1 + (1 - confidence) * ECONOMICS.confidenceRatePenalty.value) *
    (1 + geared * ECONOMICS.gearingRatePenalty.value)
  )
}

/**
 * Debt the utility carries on its own balance sheet, rather than against a particular asset.
 *
 * The distinction is the whole point of a project facility. Corporate debt is limited by what the
 * business already earns; a facility secured on a station is limited by the station. Counting the
 * second against the first would put the reactor back out of reach, which is what this was built
 * to fix — and not counting it in `finances.debt` at all would be a lie, because the money is
 * owed either way. So it is in the total the accounts, the brief and the objectives read, and out
 * of the ceiling the corporate facility is sized against.
 */
export function corporateDebt(finances: Finances): number {
  let total = 0
  for (const loan of finances.loans) {
    if (loan.kind !== 'project') total += loan.outstanding
  }
  return total
}

/**
 * How full the balance sheet is, 0 to 1. Above one only if the limit has fallen under the debt.
 *
 * `extra` asks the question about a balance sheet that does not exist yet, which is what a lender
 * pricing a new advance is doing. It is a parameter rather than a spread copy of the finances
 * because the debt figure now comes from the loans themselves: copying the object and raising a
 * total the function no longer reads was a silent no-op, and every quote came back at the base
 * rate however much was being asked for.
 */
export function gearing(finances: Finances, extra = 0): number {
  const limit = finances.trailingRevenue * ECONOMICS.maxDebtToRevenue.value
  if (limit <= 0) return 1
  return Math.max(0, (corporateDebt(finances) + Math.max(0, extra)) / limit)
}

/** Level monthly instalment that clears `principal` over `months` at `ratePerYear`. */
export function instalment(principal: number, ratePerYear: number, months: number): number {
  if (months <= 0) return principal
  const monthly = ratePerYear / MONTHS_PER_YEAR
  if (monthly <= 0) return principal / months
  // The standard annuity. Level payments mean the early years are mostly interest, which is both
  // how such a loan really amortises and the reason an early repayment saves so much.
  return (principal * monthly) / (1 - Math.pow(1 + monthly, -months))
}

/** What a loan of this size and term would cost, without committing to it. */
export function quoteLoan(
  finances: Finances,
  amount: number,
  termYears: number,
  investorConfidence = 1,
  kind: Loan['kind'] = 'planned',
): { amount: number; ratePerYear: number; monthlyPayment: number; totalInterest: number; ok: boolean } {
  const capped = Math.max(0, Math.min(amount, borrowingHeadroom(finances)))
  // Priced on the gearing the utility will have *after* drawing, not before. Asking what the
  // balance sheet looks like once the money is on it is the question a lender actually asks.
  let rate = effectiveInterestRate(investorConfidence, gearing(finances, capped))
  if (kind === 'emergency') rate *= 1 + ECONOMICS.emergencyRatePremium.value
  const months = Math.max(1, Math.round(termYears * MONTHS_PER_YEAR))
  const monthly = instalment(capped, rate, months)
  return {
    amount: capped,
    ratePerYear: rate,
    monthlyPayment: monthly,
    totalInterest: monthly * months - capped,
    ok: capped > 0 && capped >= amount - 1,
  }
}

/** Draw a loan. The cash arrives now; the instalments start next month. */
export function takeLoan(
  finances: Finances,
  amount: number,
  termYears: number,
  tick: number,
  investorConfidence = 1,
  kind: Loan['kind'] = 'planned',
): Loan | null {
  const quote = quoteLoan(finances, amount, termYears, investorConfidence, kind)
  if (quote.amount <= 0) return null
  const loan: Loan = {
    id: `loan_${++finances.loanSerial}`,
    principal: quote.amount,
    outstanding: quote.amount,
    ratePerYear: quote.ratePerYear,
    takenTick: tick,
    maturesTick: tick + Math.round(termYears * TICKS_PER_YEAR),
    kind,
  }
  finances.loans.push(loan)
  finances.cash += quote.amount
  finances.debt += quote.amount
  return loan
}

/**
 * What a project facility would look like, without committing to it.
 *
 * The question a lender is actually being asked: not "can this business carry more debt" — which
 * is what the corporate facility beside this one answers, and which no mid-sized utility can
 * answer yes to about a reactor — but "will this asset earn enough to pay for itself". So the
 * size comes off the project's capital cost rather than off the balance sheet, and what the
 * player has to find is the rest of it, in cash. That equity share is the gate, and it is meant
 * to be: it is the difference between a decision and a formality.
 */
export function quoteProjectFinance(
  capex: number,
  buildTicks: number,
  investorConfidence = 1,
): {
  ok: boolean
  reasonKey?: string
  /** The facility's size: what the lender will advance in total. */
  commitment: number
  /** What the player has to fund themselves, in cash, over the construction. */
  equity: number
  ratePerYear: number
  termYears: number
  /**
   * What will be owed the day the asset enters service, after the interest that rolls up while
   * it is being built. An estimate: the balance ramps as the money is drawn, so the interest
   * accrues on roughly half the facility for roughly the length of the build.
   */
  balanceAtCommissioning: number
  monthlyPayment: number
} {
  const share = ECONOMICS.projectDebtShare.value
  const commitment = capex * share
  const termYears = ECONOMICS.projectTermYears.value
  const rate = effectiveInterestRate(investorConfidence) * (1 + ECONOMICS.projectRatePremium.value)
  const buildYears = buildTicks / TICKS_PER_YEAR
  const balance = commitment * (1 + (rate * buildYears) / 2)
  const monthly = instalment(balance, rate, Math.round(termYears * MONTHS_PER_YEAR))
  const tooSmall = capex < ECONOMICS.projectMinimumSize.value
  return {
    ok: !tooSmall,
    ...(tooSmall ? { reasonKey: 'build.projectTooSmall' } : {}),
    commitment,
    equity: capex - commitment,
    ratePerYear: rate,
    termYears,
    balanceAtCommissioning: balance,
    monthlyPayment: monthly,
  }
}

/**
 * Commit a lender to a project. Nothing is drawn yet and no cash moves.
 *
 * A facility is a promise to fund construction as it happens, not a lump sum handed over on the
 * day it is signed — see `drawProjectFinance`. Modelling it the other way would have let a player
 * open a facility for a reactor and spend the money on something else entirely, which is the one
 * thing project finance is specifically arranged to prevent.
 */
export function openProjectFacility(
  finances: Finances,
  assetId: string,
  capex: number,
  buildTicks: number,
  tick: number,
  investorConfidence = 1,
): Loan | null {
  const quote = quoteProjectFinance(capex, buildTicks, investorConfidence)
  if (!quote.ok || quote.commitment <= 0) return null
  const commissioning = tick + Math.max(1, buildTicks)
  const loan: Loan = {
    id: `loan_${++finances.loanSerial}`,
    principal: 0,
    outstanding: 0,
    ratePerYear: quote.ratePerYear,
    takenTick: tick,
    repaymentsStartTick: commissioning,
    maturesTick: commissioning + Math.round(quote.termYears * TICKS_PER_YEAR),
    kind: 'project',
    assetId,
    commitment: quote.commitment,
    drawn: 0,
  }
  finances.loans.push(loan)
  return loan
}

/**
 * Draw the lender's share of one instalment of construction spending.
 *
 * Called as the money is actually spent, so the facility funds building the thing and nothing
 * else. Returns the cash it put in, which the caller adds back — the net effect on the player is
 * that they pay the equity share of every euro and the lender pays the rest.
 */
export function drawProjectFinance(finances: Finances, assetId: string, spend: number): number {
  const loan = finances.loans.find((l) => l.kind === 'project' && l.assetId === assetId)
  if (!loan || loan.commitment === undefined) return 0
  const left = loan.commitment - (loan.drawn ?? 0)
  const draw = Math.max(0, Math.min(spend * ECONOMICS.projectDebtShare.value, left))
  if (draw <= 0) return 0
  loan.drawn = (loan.drawn ?? 0) + draw
  loan.outstanding += draw
  loan.principal = loan.outstanding
  finances.cash += draw
  finances.debt += draw
  return draw
}

/**
 * Pay a period's instalments: interest as a cost, principal as a repayment.
 *
 * Replaces the flat interest charge that preceded it, which accrued on a total nothing ever paid
 * down. The split between interest and principal matters beyond bookkeeping — see `debtRepaid` — and so does the fact that principal now
 * actually leaves. A player who borrows to build has years of instalments to carry afterwards,
 * which is what makes the size of the borrowing a decision rather than a formality.
 */
export function serviceLoans(
  ledger: PeriodLedger,
  finances: Finances,
  ticksInPeriod: number,
  tick: number,
): void {
  if (finances.loans.length === 0) return
  const ticksPerMonth = TICKS_PER_YEAR / MONTHS_PER_YEAR
  const share = ticksInPeriod / ticksPerMonth
  for (const loan of finances.loans) {
    const startsAt = loan.repaymentsStartTick ?? loan.takenTick
    const interest = loan.outstanding * (loan.ratePerYear / MONTHS_PER_YEAR) * share

    // A project still being built pays nothing and owes more for it. No cash leaves, because
    // there is nothing earning to pay from; the interest is rolled into the balance, which is
    // why a facility matures larger than the sum ever drawn on it. It is not charged to the
    // period either — an asset under construction capitalises its interest into what it cost.
    if (tick < startsAt) {
      loan.outstanding += interest
      loan.principal = loan.outstanding
      continue
    }

    const monthsLeft = Math.max(1, Math.round((loan.maturesTick - startsAt) / ticksPerMonth))
    const monthly = instalment(loan.principal, loan.ratePerYear, monthsLeft)
    // Never repay more than is left, and never let a rounding tail keep a cleared loan alive.
    const principal = Math.max(0, Math.min(loan.outstanding, monthly * share - interest))
    ledger.interest += interest
    ledger.debtRepaid += principal
    loan.outstanding -= principal
  }
  finances.loans = finances.loans.filter((l) => l.outstanding > 1)
  finances.debt = finances.loans.reduce((sum, l) => sum + l.outstanding, 0)
}

/** Clear a loan early, out of cash. What it saves is the interest that would have accrued. */
export function repayLoan(finances: Finances, loanId: string): number {
  const loan = finances.loans.find((l) => l.id === loanId)
  if (!loan) return 0
  const paid = Math.min(finances.cash, loan.outstanding)
  if (paid <= 0) return 0
  finances.cash -= paid
  loan.outstanding -= paid
  if (loan.outstanding <= 1) finances.loans = finances.loans.filter((l) => l.id !== loanId)
  finances.debt = finances.loans.reduce((sum, l) => sum + l.outstanding, 0)
  return paid
}

/**
 * Tax on the year's profit.
 *
 * Charged only on a positive result and with no carry-forward of losses, which is a
 * simplification worth naming: a real utility offsets a bad year against a good one, so this
 * overstates the tax burden of a volatile strategy relative to a steady one.
 */
export function chargeCorporateTax(ledger: PeriodLedger, profitBeforeTax: number, rate: number): void {
  if (profitBeforeTax <= 0 || rate <= 0) return
  ledger.tax += profitBeforeTax * rate
}

/**
 * A levy on revenue earned above a threshold price.
 *
 * Europe imposed several of these in 2022 and they are the classic political response to a
 * utility doing well out of a crisis. Note what it taxes: not profit but *revenue above a price*,
 * so it lands hardest on exactly the plant that was most valuable during the scarcity — which is
 * both what the real levies did and the reason they were argued about.
 */
export function chargeWindfallLevy(
  ledger: PeriodLedger,
  energySoldMwh: number,
  averagePricePerMwh: number,
  thresholdPerMwh: number,
  rate: number,
): void {
  if (rate <= 0 || energySoldMwh <= 0) return
  const excess = averagePricePerMwh - thresholdPerMwh
  if (excess <= 0) return
  ledger.windfallLevy += excess * energySoldMwh * rate
}

/**
 * Payment for keeping firm capacity available.
 *
 * Paid on dispatchable capacity only. A capacity market exists precisely because an
 * energy-only market pays nothing for being available in the hour it is needed, and a plant that
 * cannot be relied on in that hour is not what is being bought.
 */
export function creditCapacityPayment(
  ledger: PeriodLedger,
  firmCapacityMw: number,
  perKwYear: number,
  ticksInPeriod: number,
): void {
  if (perKwYear <= 0 || firmCapacityMw <= 0) return
  ledger.capacityIncome += firmCapacityMw * 1000 * perKwYear * (ticksInPeriod / TICKS_PER_YEAR)
}

/** How much more the utility could borrow. */
export function borrowingHeadroom(finances: Finances): number {
  const limit = finances.trailingRevenue * ECONOMICS.maxDebtToRevenue.value
  return Math.max(0, limit - corporateDebt(finances))
}

/** Everything the utility could put behind a commitment right now. */
export function spendingPower(finances: Finances): number {
  return finances.cash + borrowingHeadroom(finances)
}

/**
 * Whether a project can be committed to.
 *
 * The whole cost must be covered, not just the first instalment. A half-built power station
 * is worth nothing, so letting the player start one they cannot finish would be a way to
 * lose the game by accident rather than by decision — and the design rules that out.
 */
export function canAfford(finances: Finances, totalCost: number): boolean {
  return !finances.bankrupt && spendingPower(finances) >= totalCost
}

/**
 * Charge one instalment of construction spending.
 *
 * Capital is paid out across the build rather than in one lump, which is both how projects
 * are really financed and what makes a long build a sustained drain the player has to plan
 * around rather than a single shock.
 */
export function chargeCapex(ledger: PeriodLedger, amount: number): void {
  if (amount <= 0) return
  ledger.capex += amount
}

/** Charge one instalment of dismantling. */
export function chargeDecommissioning(ledger: PeriodLedger, amount: number): void {
  if (amount <= 0) return
  ledger.decommissioningCost += amount
}

/** Credit the scrap and material value recovered at end of life. */
export function creditRecycling(ledger: PeriodLedger, amount: number): void {
  if (amount <= 0) return
  ledger.recyclingIncome += amount
}

/**
 * Settle a period. Cash goes negative before bankruptcy: an automatic emergency facility is
 * drawn if there is headroom, because a utility that misses one bad month should not instantly
 * cease to exist.
 *
 * The facility is a *loan* now, not a silent addition to a total. It has a rate — dearer than
 * arranged borrowing, because money raised in a hurry by somebody who has run out is dearer than
 * money raised in advance by somebody who has not — a short term, and instalments that have to be
 * carried afterwards. Before that it was free relative to planning ahead, which is the same as
 * saying there was no reason to plan.
 *
 * Returns the loan if one was drawn, so the caller can report it. A player being rescued and not
 * told is how a run ends in confusion.
 */
export function settlePeriod(
  finances: Finances,
  ledger: PeriodLedger,
  tick = 0,
  investorConfidence = 1,
): Loan | null {
  const profit = ledgerProfit(ledger)
  finances.cash += profit
  if (finances.cash >= 0) return null

  const need = -finances.cash
  const loan = takeLoan(finances, need, ECONOMICS.emergencyTermYears.value, tick, investorConfidence, 'emergency')
  if (finances.cash < 0) finances.bankrupt = true
  return loan
}
