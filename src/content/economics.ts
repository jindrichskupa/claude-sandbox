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
  /** Annual interest on borrowed money. */
  loanInterestRate: Sourced<number>
  /**
   * What share of a project's capital cost a lender will advance against the project itself.
   *
   * The whole difference between this and the ordinary facility beside it. Corporate debt is
   * sized on the balance sheet — trailing revenue times a multiple — which means a utility can
   * never borrow to build something larger than the business it already has. That is a real
   * constraint on a real company and it is also why the opening scenario's reactor, at seven and
   * a half times the utility's opening cash, was a technology in the catalogue that nobody could
   * ever build. Infrastructure is not financed that way: the lender looks at the asset, takes
   * security over it, and advances against what it will earn.
   *
   * Seventy per cent is the ordinary gearing for a merchant power project. Contracted or
   * regulated assets reach eighty and more, because the revenue is certain; a plant selling into
   * a market gets less, because it might not.
   */
  projectDebtShare: Sourced<number>
  /**
   * How much more a project facility costs than corporate debt, as a fraction of the rate.
   *
   * A margin for construction risk, which is the risk that the thing is late, over budget, or
   * never finishes at all — and until it does finish there is no asset to take security over
   * and nothing earning to pay anybody. It is the price of the money arriving before the
   * revenue does.
   */
  projectRatePremium: Sourced<number>
  /** How long a project facility runs for, once the asset it financed is earning. */
  projectTermYears: Sourced<number>
  /**
   * Below this, a project facility is not on offer.
   *
   * Arranging one is months of lawyers, technical advisers and due diligence, and those costs
   * barely move with the size of the deal — which is why nobody project-finances a substation.
   * The threshold is what keeps this a decision about the two or three largest things a player
   * will ever build rather than the default way to buy anything.
   */
  projectMinimumSize: Sourced<number>
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
  /** The tariff reset never falls below this, so a collapse in wholesale does not bankrupt anyone. */
  tariffFloorPerMwh: Sourced<number>
  /**
   * How much of the allowed return on capital the owner takes out each year.
   *
   * One means the shareholder takes exactly what the regulator allowed them and no more, which is
   * the neutral setting: the utility keeps every euro it earns *beyond* the allowed return, and
   * keeps nothing it did not earn. Below one it would be retaining part of its owner's money to
   * fund itself, which is a decision a board makes and not a constant.
   */
  dividendPayoutRatio: Sourced<number>
  /**
   * How much of a technology's civil-works cost an existing site has already paid.
   *
   * Applied to the `civil` share in `costTrends`, which is defined as land, groundworks, concrete
   * and grid connection — so this says what fraction of *that* a station standing on the site
   * already provides. Half: the land, the switchyard, the access and the consent are there; the
   * foundations under the new machine are not, and neither is its own connection into the yard.
   */
  existingSiteCivilSaving: Sourced<number>
  /**
   * How long a loan for network or generation capital runs.
   *
   * Long, and deliberately shorter than what it buys. Infrastructure debt is tenored against the
   * asset's revenue rather than its physical life: nobody lends for forty years against a station
   * whose regulatory settlement is reviewed every five, so the plant outlives its own financing and
   * has to be refinanced or paid off out of what it earns. That gap is the whole of the pressure
   * this models.
   */
  loanTermYears: Sourced<number>
  /**
   * How much dearer debt becomes as the balance sheet fills up.
   *
   * The lender's price for the last euro is not the price of the first. A utility already at its
   * ceiling is a worse credit than one with room, and charging both the same rate is what let debt
   * be a free resource up to a cliff edge and then nothing at all. Applied on gearing — debt
   * against the limit — so the cost rises smoothly and the decision to borrow again is a real one.
   */
  gearingRatePenalty: Sourced<number>
  /**
   * What an unplanned overdraft costs on top of a planned loan.
   *
   * Money raised in a hurry by somebody who has run out is dearer than money raised in advance by
   * somebody who has not. Without this, letting the automatic facility cover a bad month was free
   * relative to arranging finance properly, so there was no reason ever to plan.
   */
  emergencyRatePremium: Sourced<number>
  /** How long the emergency facility runs before it must be repaid. Short, as such lending is. */
  emergencyTermYears: Sourced<number>
}

export const ECONOMICS: EconomicsDef = {
  valueOfLostLoadPerMwh: sourced(5000, 'EUR/MWh', 'entsoe-factsheet', 2022, 'Estimates range from 2000 to 25000'),
  loanInterestRate: sourced(0.06, 'fraction', 'game-design', 2024),
  projectDebtShare: sourced(0.70, 'fraction', 'project-finance', 2023, 'Merchant power; contracted assets gear higher'),
  projectRatePremium: sourced(0.35, 'fraction', 'project-finance', 2023, 'Construction-risk margin over corporate debt'),
  projectTermYears: sourced(25, 'years', 'project-finance', 2023, 'Tenor matched to a long-lived asset'),
  projectMinimumSize: sourced(200_000_000, 'EUR', 'project-finance', 2023, 'Below this the arrangement costs swamp the deal'),
  maxDebtToRevenue: sourced(4, 'fraction', 'game-design', 2024),
  wheelingTieBreakPerMwh: sourced(0.01, 'EUR/MWh', 'game-design', 2024, 'Numerical tie-break only'),
  unservedPenaltyPerMwh: sourced(300, 'EUR/MWh', 'game-design', 2024, 'Regulatory penalty for failing to supply'),
  forgoneChargePricePerMwh: sourced(600, 'EUR/MWh', 'game-design', 2024, 'Ordering only; not a real cost'),
  valueOfLostHeatPerMwh: sourced(9000, 'EUR/MWh_th', 'euro-chp-practice', 2021, 'Frozen and burst pipes, not an inconvenient evening'),
  unservedHeatPenaltyPerMwh: sourced(550, 'EUR/MWh_th', 'game-design', 2024, 'Same share of lost value as the electrical penalty'),
  insurancePremiumRate: sourced(0.006, 'fraction', 'game-design', 2024, 'Of insured capital value, per year'),
  confidenceRatePenalty: sourced(1.0, 'fraction', 'eu-energy-policy', 2022, 'A full loss of confidence roughly doubles the cost of debt'),
  tariffFloorPerMwh: sourced(55, 'EUR/MWh', 'iea-weo', 2023, 'Regulated tariffs are sticky downwards'),
  dividendPayoutRatio: sourced(1, 'fraction', 'eu-energy-policy', 2022, 'European regulated utilities distribute the allowed return; CEZ paid out 60-100% of earnings through the 2010s'),
  existingSiteCivilSaving: sourced(0.5, 'fraction', 'engineering-standard', 2023, 'Land, grid connection and consent are in place; new foundations are not'),
  loanTermYears: sourced(15, 'years', 'eu-energy-policy', 2022, 'Typical tenor of European utility infrastructure debt'),
  gearingRatePenalty: sourced(0.5, 'fraction', 'eu-energy-policy', 2022, 'Spread widens by about half again at full gearing'),
  emergencyRatePremium: sourced(0.75, 'fraction', 'game-design', 2024, 'Distressed borrowing is far dearer than arranged'),
  emergencyTermYears: sourced(5, 'years', 'game-design', 2024, 'A rescue facility is repaid quickly, not carried'),
}
