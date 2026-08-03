/**
 * Economy-wide constants.
 */

import { sourced, type Sourced } from './schema'

export interface EconomicsDef {
  /**
   * Value of lost load: what an unserved megawatt-hour costs society. Used as the price of
   * the last-resort arc in dispatch, so scarcity produces a very high price rather than an
   * infeasible problem. Published estimates for European systems span a wide range.
   */
  valueOfLostLoadPerMwh: Sourced<number>
  /** Retail tariff the utility receives. */
  baseTariffPerMwh: Sourced<number>
  /** Carbon price at scenario start. Later driven by policy. */
  baseCarbonPricePerTonne: Sourced<number>
  /** Annual interest on borrowed money. */
  loanInterestRate: Sourced<number>
  /** How much can be borrowed, as a multiple of annual revenue. */
  maxDebtToRevenue: Sourced<number>
  /**
   * A small per-line cost added in dispatch. It has no physical meaning; it breaks ties so
   * that equal-cost solutions prefer shorter paths, which keeps flows stable and legible
   * from tick to tick instead of flapping between equivalent routes.
   */
  wheelingTieBreakPerMwh: Sourced<number>
  /** Penalty charged per MWh of unserved energy, on top of the lost revenue. */
  unservedPenaltyPerMwh: Sourced<number>
}

export const ECONOMICS: EconomicsDef = {
  valueOfLostLoadPerMwh: sourced(5000, 'EUR/MWh', 'entsoe-factsheet', 2022, 'Estimates range from 2000 to 25000'),
  baseTariffPerMwh: sourced(85, 'EUR/MWh', 'iea-weo', 2023, 'Wholesale-plus-margin, not a retail bill'),
  baseCarbonPricePerTonne: sourced(0, 'EUR', 'game-design', 2024, 'Scenario dependent; zero before carbon pricing exists'),
  loanInterestRate: sourced(0.06, 'fraction', 'game-design', 2024),
  maxDebtToRevenue: sourced(4, 'fraction', 'game-design', 2024),
  wheelingTieBreakPerMwh: sourced(0.01, 'EUR/MWh', 'game-design', 2024, 'Numerical tie-break only'),
  unservedPenaltyPerMwh: sourced(300, 'EUR/MWh', 'game-design', 2024, 'Regulatory penalty for failing to supply'),
}
