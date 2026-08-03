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
  fuelCost: number
  carbonCost: number
  varOpex: number
  fixedOpex: number
  interest: number
  unservedPenalty: number
  decommissioningCost: number
  recyclingIncome: number
  /** Energy sold, MWh. */
  energySoldMwh: number
  /** Energy not delivered, MWh. */
  energyUnservedMwh: number
  /** Tonnes of CO2 emitted. */
  co2Tonnes: number
}

export function emptyLedger(): PeriodLedger {
  return {
    revenue: 0,
    fuelCost: 0,
    carbonCost: 0,
    varOpex: 0,
    fixedOpex: 0,
    interest: 0,
    unservedPenalty: 0,
    decommissioningCost: 0,
    recyclingIncome: 0,
    energySoldMwh: 0,
    energyUnservedMwh: 0,
    co2Tonnes: 0,
  }
}

export function ledgerProfit(l: PeriodLedger): number {
  return (
    l.revenue +
    l.recyclingIncome -
    l.fuelCost -
    l.carbonCost -
    l.varOpex -
    l.fixedOpex -
    l.interest -
    l.unservedPenalty -
    l.decommissioningCost
  )
}

export function addLedger(into: PeriodLedger, from: PeriodLedger): void {
  into.revenue += from.revenue
  into.fuelCost += from.fuelCost
  into.carbonCost += from.carbonCost
  into.varOpex += from.varOpex
  into.fixedOpex += from.fixedOpex
  into.interest += from.interest
  into.unservedPenalty += from.unservedPenalty
  into.decommissioningCost += from.decommissioningCost
  into.recyclingIncome += from.recyclingIncome
  into.energySoldMwh += from.energySoldMwh
  into.energyUnservedMwh += from.energyUnservedMwh
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
 * Charge one hour of generation: fuel burnt, carbon emitted, variable operating cost.
 * Returns the emissions so the caller can also record them against policy targets.
 */
export function chargeGeneration(
  ledger: PeriodLedger,
  plant: PlantAsset,
  mwh: number,
  params: Params,
  carbonPrice: number,
): void {
  if (mwh <= 0) return
  const type = PLANT_TYPES[plant.typeId]
  const efficiency = params.get(plant.id, Param.Efficiency)
  const varOpex = params.get(plant.id, Param.VarOpexPerMwh)

  ledger.varOpex += mwh * varOpex

  if (type.fuel !== 'none') {
    const thermalMwh = mwh / Math.max(0.01, efficiency)
    const fuelPrice = params.get(plant.id, Param.FuelPricePerMwhThermal)
    ledger.fuelCost += thermalMwh * fuelPrice

    const co2 = thermalMwh * FUELS[type.fuel].co2PerMwhThermal.value
    ledger.co2Tonnes += co2
    ledger.carbonCost += co2 * carbonPrice
  }
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
): void {
  const yearFraction = ticksInPeriod / TICKS_PER_YEAR
  for (const plant of plants) {
    if (!incursFixedCost(plant)) continue
    const capacityKw = params.get(plant.id, Param.CapacityMw) * 1000
    const perKwYear = params.get(plant.id, Param.FixedOpexPerKwYear)
    // A mothballed unit is preserved rather than operated, which is much cheaper but not free.
    const factor = plant.phase === LifecyclePhase.Mothballed ? 0.3 : 1
    ledger.fixedOpex += capacityKw * perKwYear * yearFraction * factor
  }
}

/** Interest on outstanding debt for a period. */
export function chargeInterest(ledger: PeriodLedger, finances: Finances, ticksInPeriod: number): void {
  if (finances.debt <= 0) return
  ledger.interest += finances.debt * ECONOMICS.loanInterestRate.value * (ticksInPeriod / TICKS_PER_YEAR)
}

/** How much more the utility could borrow. */
export function borrowingHeadroom(finances: Finances): number {
  const limit = finances.trailingRevenue * ECONOMICS.maxDebtToRevenue.value
  return Math.max(0, limit - finances.debt)
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
