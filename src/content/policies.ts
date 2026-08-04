/**
 * Political regimes.
 *
 * This is the file where the game's neutrality promise is most at risk, so it is worth being
 * explicit about how it is kept.
 *
 * The temptation in a game like this is to write one "sensible" policy and a set of deviations
 * from it. That immediately encodes an opinion: whatever the baseline favours becomes the right
 * answer, and every other regime becomes an obstacle. Instead there is no baseline. There are
 * six regimes spanning the space of things governments actually do, none of them designated
 * correct, and each one is a coherent position that somebody argues for in earnest.
 *
 * Three things keep it honest, and none of them is a promise:
 *
 * 1. **Stance is computed, not declared.** No regime carries a label saying which technologies
 *    it likes. `stanceToward()` derives that from the levers it actually pulls — the support it
 *    offers, the carbon price it sets, what it forbids, how fast it permits. A test then checks
 *    the table for balance using those derived numbers, so a regime cannot be mislabelled into
 *    looking even-handed.
 *
 * 2. **Elections follow outcomes the player caused.** A regime's appeal is a vector over four
 *    things the player is responsible for: what electricity costs, whether the lights stayed on,
 *    what was emitted, and how exposed the country is to imported fuel. No regime gets votes for
 *    being right. See `sim/policy/elections.ts`.
 *
 * 3. **Support can be withdrawn.** Every regime that grants a contract can be followed by one
 *    that tears it up, and both are in the table. This is not cynicism about politics; it is the
 *    single most important financial fact about energy investment, where assets last forty years
 *    and governments last four.
 */

import type { FuelId } from './fuels'
import type { PlantTypeId } from './plantTypes'
import { sourced, type Sourced } from './schema'

/**
 * What a regime can change. Deliberately a small closed set: each lever has one implementation
 * in `sim/policy/`, and a regime is nothing but a choice of values for these.
 */
export interface PolicyLevers {
  /** Price of a tonne of CO2. The single most powerful lever in the table. */
  carbonPricePerTonne: Sourced<number>
  /**
   * Guaranteed price offered to *newly commissioned* plant of each technology, per MWh. A plant
   * that takes one gets a contract; see `sim/policy/contracts.ts`. Absent means no offer.
   */
  supportOffers: Partial<Record<PlantTypeId, Sourced<number>>>
  /** How long a support contract runs. */
  supportTermYears: Sourced<number>
  /**
   * Whether this regime honours contracts its predecessors signed.
   *
   * The interesting half of subsidy policy. A regime that does not honour them saves the money
   * immediately and pays for it in the cost of capital afterwards, which is exactly the trade
   * real governments make and exactly the risk real investors price.
   */
  honoursContracts: boolean
  /** Tax on profit, charged at the year end. */
  corporateTaxRate: Sourced<number>
  /**
   * A levy on revenue earned above a price threshold. Europe imposed several of these in 2022,
   * and they are the classic political response to a utility doing well in a crisis.
   */
  windfallThresholdPerMwh: Sourced<number>
  windfallRate: Sourced<number>
  /** Multiplier on construction time. Permitting is a policy instrument, not a constant. */
  permittingSpeed: Sourced<number>
  /** Technologies that may not be newly built at all. */
  bans: PlantTypeId[]
  /** Annual payment per kW of firm, dispatchable capacity. */
  capacityPaymentPerKwYear: Sourced<number>
  /**
   * How hard the regime works to diversify fuel supply, 0..1. Scales down the volatility a fuel
   * inherits from its `supplyRisk`.
   */
  fuelDiversification: Sourced<number>
  /** What the regulated retail tariff does, as a fraction of the scenario's base. */
  tariffFactor: Sourced<number>
}

/**
 * How much each of the four public concerns helps this regime at an election.
 *
 * Read it as: "when this is the thing going wrong, how much does this regime gain?" Every entry
 * is a claim about which party benefits from which failure, and every failure in the list is one
 * the player produced.
 */
export interface PolicyAppeal {
  /** Electricity is expensive. */
  affordability: number
  /** The lights went out, or a town went cold. */
  reliability: number
  /** The system emits a lot. */
  emissions: number
  /** The country depends on fuel it has to import. */
  security: number
}

export interface PolicyRegimeDef {
  id: string
  nameKey: string
  descriptionKey: string
  levers: PolicyLevers
  appeal: PolicyAppeal
  /** Earliest year this position exists as a serious political force. */
  fromYear: number
}

const G = 2024

/** Shorthand for the many levers a given regime leaves alone. */
const NEUTRAL = {
  supportTermYears: sourced(15, 'years', 'eu-energy-policy', 2021, 'Typical support contract length'),
  corporateTaxRate: sourced(0.19, 'fraction', 'eu-energy-policy', 2023, 'Mid-range European corporate rate'),
  windfallThresholdPerMwh: sourced(1e9, 'EUR/MWh', 'game-design', G, 'Effectively no windfall levy'),
  windfallRate: sourced(0, 'fraction', 'game-design', G),
  permittingSpeed: sourced(1, 'fraction', 'game-design', G),
  capacityPaymentPerKwYear: sourced(0, 'EUR/kW/yr', 'game-design', G),
  fuelDiversification: sourced(0, 'fraction', 'game-design', G),
  tariffFactor: sourced(1, 'fraction', 'game-design', G),
}

export const POLICY_REGIMES: PolicyRegimeDef[] = [
  {
    id: 'market_liberal',
    nameKey: 'policy.marketLiberal.name',
    descriptionKey: 'policy.marketLiberal.description',
    fromYear: 1990,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(5, 'EUR/t', 'eu-energy-policy', 2013, 'ETS traded near this for years'),
      supportOffers: {},
      honoursContracts: true,
      corporateTaxRate: sourced(0.15, 'fraction', 'eu-energy-policy', 2023, 'Deliberately light'),
      permittingSpeed: sourced(0.8, 'fraction', 'game-design', G, 'Consenting reform, faster for everything'),
      bans: [],
    },
    // Nobody votes for a market on principle; they vote for it when everything else has become
    // expensive and heavy-handed.
    appeal: { affordability: 0.9, reliability: 0.2, emissions: -0.2, security: 0 },
  },

  {
    id: 'renewables_push',
    nameKey: 'policy.renewablesPush.name',
    descriptionKey: 'policy.renewablesPush.description',
    fromYear: 2000,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(85, 'EUR/t', 'eu-energy-policy', 2023, 'ETS settled around this in 2022-23'),
      supportOffers: {
        wind: sourced(90, 'EUR/MWh', 'eu-energy-policy', 2015, 'Onshore wind feed-in tariffs of the period'),
        solar: sourced(110, 'EUR/MWh', 'eu-energy-policy', 2010, 'Early photovoltaic tariffs were far higher still'),
        battery: sourced(20, 'EUR/MWh', 'eu-energy-policy', 2021, 'Flexibility support rather than energy support'),
      },
      honoursContracts: true,
      permittingSpeed: sourced(1.35, 'fraction', 'game-design', G, 'Harder consenting for anything that burns'),
      bans: ['coal', 'lignite'],
    },
    appeal: { affordability: -0.3, reliability: -0.2, emissions: 1.0, security: 0.4 },
  },

  {
    id: 'clean_firm',
    nameKey: 'policy.cleanFirm.name',
    descriptionKey: 'policy.cleanFirm.description',
    fromYear: 1995,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(60, 'EUR/t', 'eu-energy-policy', 2022),
      supportOffers: {
        nuclear: sourced(95, 'EUR/MWh', 'eu-energy-policy', 2013, 'Hinkley Point C strike price was of this order'),
        hydro: sourced(70, 'EUR/MWh', 'eu-energy-policy', 2015),
        gas_chp: sourced(55, 'EUR/MWh', 'euro-chp-practice', 2021, 'Cogeneration bonus schemes'),
        coal_chp: sourced(40, 'EUR/MWh', 'euro-chp-practice', 2021),
      },
      honoursContracts: true,
      supportTermYears: sourced(25, 'years', 'eu-energy-policy', 2013, 'Long contracts for long assets'),
      permittingSpeed: sourced(0.85, 'fraction', 'game-design', G, 'Fast-tracked consenting for firm low-carbon'),
      capacityPaymentPerKwYear: sourced(35, 'EUR/kW/yr', 'eu-energy-policy', 2019, 'Capacity market clearing prices'),
      bans: [],
    },
    // Wins when the lights have gone out and the emissions were still high: the position that
    // says the answer must be both clean and firm.
    appeal: { affordability: -0.2, reliability: 0.8, emissions: 0.7, security: 0.5 },
  },

  {
    id: 'energy_security',
    nameKey: 'policy.energySecurity.name',
    descriptionKey: 'policy.energySecurity.description',
    fromYear: 1990,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(10, 'EUR/t', 'eu-energy-policy', 2014, 'Suspended or cut in a supply crisis'),
      supportOffers: {
        lignite: sourced(70, 'EUR/MWh', 'eu-energy-policy', 2022, 'Domestic fuel support during the 2022 crisis; several states reopened closed mines'),
        coal: sourced(65, 'EUR/MWh', 'eu-energy-policy', 2022),
        // District heating is the load a security government worries about most, because it
        // cannot be shed and its failure is measured in burst pipes rather than lost revenue.
        coal_chp: sourced(60, 'EUR/MWh', 'euro-chp-practice', 2022, 'Domestic fuel and a heat load that cannot be interrupted'),
        nuclear: sourced(80, 'EUR/MWh', 'eu-energy-policy', 2022, 'Also domestic, also firm'),
        pumped: sourced(30, 'EUR/MWh', 'eu-energy-policy', 2022),
      },
      // The crisis regime. It keeps the lights on and tears up what it has to.
      honoursContracts: false,
      permittingSpeed: sourced(0.7, 'fraction', 'game-design', G, 'Emergency consenting'),
      capacityPaymentPerKwYear: sourced(55, 'EUR/kW/yr', 'eu-energy-policy', 2022),
      fuelDiversification: sourced(0.6, 'fraction', 'eu-energy-policy', 2022, 'Terminals, storage mandates, new suppliers'),
      bans: [],
    },
    appeal: { affordability: 0.3, reliability: 0.9, emissions: -0.4, security: 1.0 },
  },

  {
    id: 'affordability',
    nameKey: 'policy.affordability.name',
    descriptionKey: 'policy.affordability.description',
    fromYear: 1990,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(15, 'EUR/t', 'eu-energy-policy', 2018),
      supportOffers: {},
      // Support for anybody is a cost consumers are paying, so it goes.
      honoursContracts: false,
      windfallThresholdPerMwh: sourced(180, 'EUR/MWh', 'eu-energy-policy', 2022, 'European inframarginal revenue caps'),
      windfallRate: sourced(0.9, 'fraction', 'eu-energy-policy', 2022, 'Caps took most of the excess'),
      tariffFactor: sourced(0.85, 'fraction', 'eu-energy-policy', 2022, 'Regulated price cap'),
      bans: [],
    },
    appeal: { affordability: 1.0, reliability: -0.3, emissions: -0.1, security: -0.1 },
  },

  {
    id: 'fiscal_consolidation',
    nameKey: 'policy.fiscalConsolidation.name',
    descriptionKey: 'policy.fiscalConsolidation.description',
    fromYear: 1990,
    levers: {
      ...NEUTRAL,
      carbonPricePerTonne: sourced(40, 'EUR/t', 'eu-energy-policy', 2021, 'Kept because it raises revenue'),
      supportOffers: {},
      // Not out of hostility to any technology: the money simply is not there any more.
      honoursContracts: false,
      corporateTaxRate: sourced(0.32, 'fraction', 'eu-energy-policy', 2023, 'Upper end of European rates'),
      permittingSpeed: sourced(1.25, 'fraction', 'game-design', G, 'A thinner civil service consents more slowly'),
      bans: [],
    },
    appeal: { affordability: 0.2, reliability: -0.2, emissions: 0.1, security: 0 },
  },
]

export const REGIMES_BY_ID = new Map(POLICY_REGIMES.map((r) => [r.id, r]))

/** How long a government lasts before it has to face the voters. */
export const ELECTION_TERM_YEARS = sourced(4, 'years', 'eu-energy-policy', 2020, 'A typical parliamentary term')

/**
 * What a regime's levers actually do to a technology, on a signed scale where positive means
 * "this regime makes this technology more attractive to build".
 *
 * Derived rather than declared, deliberately. The neutrality test reads this, so a regime cannot
 * be made to look even-handed by describing itself that way — only by pulling levers that
 * genuinely balance out.
 *
 * `co2PerMwh` is passed in rather than imported so this stays a pure function of the levers and
 * one number about the technology, which is what makes it easy to test.
 */
export function stanceToward(
  regime: PolicyRegimeDef,
  typeId: PlantTypeId,
  co2PerMwhElectric: number,
): number {
  const levers = regime.levers
  if (levers.bans.includes(typeId)) return -100

  const support = levers.supportOffers[typeId]?.value ?? 0
  // Carbon costs money per MWh generated, so it is directly comparable with a support price.
  const carbonCost = levers.carbonPricePerTonne.value * co2PerMwhElectric
  // Slower permitting is a real deterrent; expressed in the same units by charging it against a
  // notional decade of revenue.
  const permittingPenalty = (levers.permittingSpeed.value - 1) * 25

  return support - carbonCost - permittingPenalty
}

/**
 * Volatility a fuel's price inherits from geopolitics, after whatever the regime has done to
 * diversify supply.
 *
 * The shape is the point: `supplyRisk` already says that pipeline gas is exposed and mine-mouth
 * lignite is not, so the same political shock moves them by very different amounts. A single
 * global fuel-price index would have hidden that, and hiding it would remove the main reason to
 * care what you burn.
 */
export function fuelVolatility(supplyRisk: number, diversification: number): number {
  return supplyRisk * (1 - Math.max(0, Math.min(1, diversification)))
}

/** Fuels whose supply is a political question rather than a market one. */
export const IMPORTED_FUELS: FuelId[] = ['gas', 'coal', 'uranium']
