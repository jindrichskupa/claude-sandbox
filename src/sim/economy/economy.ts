/**
 * Money.
 *
 * Hourly costs and revenue accumulate into an open period; the period closes monthly, which
 * is when fixed costs land and the player finds out whether the month was any good. Keeping
 * hourly and periodic accounting separate is what stops fixed costs from being charged 8760
 * times a year by accident.
 */

import { ECONOMICS } from '@content/economics'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { TICKS_PER_YEAR } from '../core/time'
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
    fuelCost: 0,
    carbonCost: 0,
    varOpex: 0,
    fixedOpex: 0,
    interest: 0,
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
    l.unservedPenalty -
    l.capex -
    l.decommissioningCost -
    l.eventCost -
    l.insurancePremium -
    l.tax -
    l.windfallLevy
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
  into.unservedPenalty += from.unservedPenalty
  into.capex += from.capex
  into.decommissioningCost += from.decommissioningCost
  into.recyclingIncome += from.recyclingIncome
  into.eventCost += from.eventCost
  into.insurancePremium += from.insurancePremium
  into.tax += from.tax
  into.windfallLevy += from.windfallLevy
  into.capacityIncome += from.capacityIncome
  into.energySoldMwh += from.energySoldMwh
  into.energyUnservedMwh += from.energyUnservedMwh
  into.heatSoldMwh += from.heatSoldMwh
  into.heatUnservedMwh += from.heatUnservedMwh
  into.co2Tonnes += from.co2Tonnes
}

export interface Finances {
  cash: number
  debt: number
  /** Rolling 12-month revenue, used to size the borrowing limit. */
  trailingRevenue: number
  bankrupt: boolean
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
export function chargeUnservedHeat(ledger: PeriodLedger, mwh: number): void {
  if (mwh <= 0) return
  ledger.heatUnservedMwh += mwh
  ledger.unservedPenalty += mwh * ECONOMICS.unservedHeatPenaltyPerMwh.value
}

/** Credit one hour of sales. */
export function creditSales(ledger: PeriodLedger, mwh: number, tariffPerMwh: number): void {
  if (mwh <= 0) return
  ledger.revenue += mwh * tariffPerMwh
  ledger.energySoldMwh += mwh
}

/** Charge one hour of failing to supply. */
export function chargeUnserved(ledger: PeriodLedger, mwh: number): void {
  if (mwh <= 0) return
  ledger.energyUnservedMwh += mwh
  ledger.unservedPenalty += mwh * ECONOMICS.unservedPenaltyPerMwh.value
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
 * Interest on outstanding debt for a period.
 *
 * `investorConfidence` is what makes tearing up a support contract cost something. A country
 * that has repudiated its promises borrows more expensively for everything afterwards, including
 * projects that had nothing to do with the contract that was broken — which is precisely why the
 * decision is a hard one for a real government rather than free money.
 */
export function chargeInterest(
  ledger: PeriodLedger,
  finances: Finances,
  ticksInPeriod: number,
  investorConfidence = 1,
): void {
  if (finances.debt <= 0) return
  ledger.interest += finances.debt * effectiveInterestRate(investorConfidence) * (ticksInPeriod / TICKS_PER_YEAR)
}

/** The rate the utility actually pays, after the country's record with investors. */
export function effectiveInterestRate(investorConfidence: number): number {
  const confidence = Math.max(0.01, Math.min(1, investorConfidence))
  return ECONOMICS.loanInterestRate.value * (1 + (1 - confidence) * ECONOMICS.confidenceRatePenalty.value)
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
  return Math.max(0, limit - finances.debt)
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
 * Settle a period. Cash goes negative before bankruptcy: an automatic emergency loan is
 * taken if there is headroom, because a utility that misses one bad month should not
 * instantly cease to exist.
 */
export function settlePeriod(finances: Finances, ledger: PeriodLedger): void {
  const profit = ledgerProfit(ledger)
  finances.cash += profit

  if (finances.cash < 0) {
    const need = -finances.cash
    const available = borrowingHeadroom(finances)
    const borrowed = Math.min(need, available)
    finances.debt += borrowed
    finances.cash += borrowed
    if (finances.cash < 0) finances.bankrupt = true
  }
}
