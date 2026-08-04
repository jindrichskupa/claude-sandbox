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
  /**
   * What it "costs" to abandon a planned storage charge. Priced above any real generator so
   * charging is dropped only when the system is genuinely short, and far below lost load so
   * a battery always goes without before a city does.
   */
  forgoneChargePricePerMwh: Sourced<number>
  /** What the utility is paid for a megawatt-hour of heat delivered to a district network. */
  baseHeatTariffPerMwh: Sourced<number>
  /**
   * What a megawatt-hour of undelivered heat costs.
   *
   * Deliberately higher than the electrical value of lost load, and that is not a balance
   * dial. A brownout is an expensive, dangerous, recoverable afternoon. A district heating
   * network that loses pressure in February freezes and bursts the pipes inside the buildings
   * it serves, and the town is uninhabitable for weeks. The asymmetry is real, and encoding it
   * is what makes "heat first, electricity second" the player's conclusion rather than a rule
   * imposed on them.
   */
  valueOfLostHeatPerMwh: Sourced<number>
  /** Regulatory penalty per MWh of heat not delivered, on top of the lost revenue. */
  unservedHeatPenaltyPerMwh: Sourced<number>
  /**
   * Annual insurance premium, as a fraction of the fleet's capital value.
   *
   * What this buys is not money but *shape*: an insured utility pays a predictable amount every
   * month instead of an unpredictable one after a failure. That is the whole point of insurance
   * and the reason it belongs in a game about surviving decades — a capital shock can end a run,
   * a slightly worse operating cost cannot.
   */
  insurancePremiumRate: Sourced<number>
  /**
   * How much the borrowing rate rises when investor confidence has collapsed entirely.
   *
   * The price a country pays for tearing up its own contracts. Set so a full loss of confidence
   * roughly doubles the cost of debt, which is the order of magnitude sovereign and regulated-
   * utility spreads actually move by after a repudiation.
   */
  confidenceRatePenalty: Sourced<number>
  /**
   * Margin the regulated retail tariff carries over the wholesale price it is reset against.
   *
   * Covers networks, supply and the allowed return. Without a tariff that tracks costs at all,
   * a carbon price would be a pure loss to the utility rather than something the market passes
   * through — which would make every decarbonisation policy a death sentence instead of a policy,
   * and would be the largest thumb on the scale in the game.
   */
  retailMarginOverWholesale: Sourced<number>
  /** The tariff reset never falls below this, so a collapse in wholesale does not bankrupt anyone. */
  tariffFloorPerMwh: Sourced<number>
}

export const ECONOMICS: EconomicsDef = {
  valueOfLostLoadPerMwh: sourced(5000, 'EUR/MWh', 'entsoe-factsheet', 2022, 'Estimates range from 2000 to 25000'),
  baseTariffPerMwh: sourced(85, 'EUR/MWh', 'iea-weo', 2023, 'Wholesale-plus-margin, not a retail bill'),
  baseCarbonPricePerTonne: sourced(0, 'EUR', 'game-design', 2024, 'Scenario dependent; zero before carbon pricing exists'),
  loanInterestRate: sourced(0.06, 'fraction', 'game-design', 2024),
  maxDebtToRevenue: sourced(4, 'fraction', 'game-design', 2024),
  wheelingTieBreakPerMwh: sourced(0.01, 'EUR/MWh', 'game-design', 2024, 'Numerical tie-break only'),
  unservedPenaltyPerMwh: sourced(300, 'EUR/MWh', 'game-design', 2024, 'Regulatory penalty for failing to supply'),
  forgoneChargePricePerMwh: sourced(600, 'EUR/MWh', 'game-design', 2024, 'Ordering only; not a real cost'),
  baseHeatTariffPerMwh: sourced(45, 'EUR/MWh_th', 'euro-chp-practice', 2021, 'District heat sells for far less than electricity'),
  valueOfLostHeatPerMwh: sourced(9000, 'EUR/MWh_th', 'euro-chp-practice', 2021, 'Frozen and burst pipes, not an inconvenient evening'),
  unservedHeatPenaltyPerMwh: sourced(550, 'EUR/MWh_th', 'game-design', 2024, 'Same share of lost value as the electrical penalty'),
  insurancePremiumRate: sourced(0.006, 'fraction', 'game-design', 2024, 'Of insured capital value, per year'),
  confidenceRatePenalty: sourced(1.0, 'fraction', 'eu-energy-policy', 2022, 'A full loss of confidence roughly doubles the cost of debt'),
  retailMarginOverWholesale: sourced(0.35, 'fraction', 'iea-weo', 2023, 'Networks, supply costs and allowed return over the wholesale price'),
  tariffFloorPerMwh: sourced(55, 'EUR/MWh', 'iea-weo', 2023, 'Regulated tariffs are sticky downwards'),
}
