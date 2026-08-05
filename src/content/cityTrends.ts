/**
 * How a town changes underneath the player, and when its roofs start generating.
 *
 * Until now a city was a constant with weather on top. It had a base demand fixed in 1995 and it
 * still had the same base demand in 2035, which quietly made the game a question about supply
 * only: the load was a fact, and the whole problem was what to build against it. Real utility
 * planning is not like that in either direction — the load grows, its shape changes, and after
 * about 2010 a growing part of it stops being load at all and starts being a generator the
 * utility does not own and cannot dispatch.
 *
 * ## Three separate forces, because they point different ways
 *
 * **People.** More of them, slowly, and fewer where the lights keep going out. A town that has
 * been dark for a fortnight loses a factory, and the factory does not come back the following
 * year. This is the only place in the game where the player's reliability record changes the size
 * of the problem rather than the score.
 *
 * **What each of them uses.** Two opposed trends that a single "demand growth" number would
 * collapse into a lie. Appliance efficiency has taken about half a percent a year off per-capita
 * consumption for decades — lighting, motors, standby, insulation — and European electricity
 * demand was consequently *flat to falling* from about 2007 to 2020 despite growing economies.
 * Electrification pushes the other way and arrives later and much harder: transport and heat
 * moving onto the wires is the single largest change to electricity demand since rural
 * electrification, and it is a logistic in time, not a straight line.
 *
 * Netting them is what produces the real shape — a decade of stagnation followed by growth that
 * catches a planner who extrapolated the stagnation. Which is exactly the mistake that is worth
 * being able to make in a game about this.
 *
 * ## Rooftop solar, and why it is driven by the tariff
 *
 * The adoption model here deliberately does **not** take a year and return a curve. It compares
 * what a household pays the utility with what a household would pay for its own roof, using the
 * same learning curve that prices the player's own solar farms, and adoption follows the ratio.
 *
 * That produces the right history for the right reason — nothing in the 1990s, when a rooftop
 * system cost several times the retail price of electricity; a slow start in the late 2000s;
 * a wave once module prices collapse — without any of it being asserted. And it produces the
 * thing that makes it a game mechanic rather than a scripted event: **the tariff is one of the
 * two numbers in the ratio.** A utility whose costs rise, and whose regulated tariff rises with
 * them, is paying its customers to leave. That is the utility death spiral, it is the central
 * strategic problem of the 2010s European power sector, and here it falls out of a division
 * rather than being written in as a rule.
 *
 * What the roofs then do to the market is in `sim/city/rooftop.ts`.
 */

import { sourced, type Sourced } from './schema'

const Y = 2024

export interface CityTrends {
  populationGrowthPerYear: Sourced<number>
  /** Per-capita consumption change from efficiency alone. Negative, and remarkably steady. */
  applianceEfficiencyPerYear: Sourced<number>
  electrification: {
    /** Year at which half the eventual uplift has arrived. */
    midpointYear: Sourced<number>
    /** Years from a tenth to a half of the uplift; sets how abruptly it lands. */
    steepnessYears: Sourced<number>
    /** Where per-capita demand ends up, as a fraction above the pre-electrification level. */
    ultimateUplift: Sourced<number>
  }
  /**
   * How much a year of failing to supply costs a town in growth.
   *
   * Applied to the *year's* unserved share, so a bad hour is nothing and a bad decade empties
   * the place. The number is a game-design judgement rather than a measurement: the historical
   * record of towns that lost their power supply is a record of wars and collapses, and
   * calibrating from it would be both grim and wrong.
   */
  reliabilityGrowthPenalty: Sourced<number>
  /** Spread between towns in a given year, so they do not all grow in lockstep. */
  growthSpreadPerYear: Sourced<number>
}

export const CITY_TRENDS: CityTrends = {
  populationGrowthPerYear: sourced(0.004, 'fraction/yr', 'eurostat', 2023, 'European urban population growth, mid-range'),
  applianceEfficiencyPerYear: sourced(
    -0.006,
    'fraction/yr',
    'iea-efficiency',
    2023,
    'Per-capita electricity intensity from appliance and lighting efficiency, EU average trend',
  ),
  electrification: {
    midpointYear: sourced(2033, 'count', 'iea-electrification', 2023, 'Halfway point of transport and heat electrification in stated policies'),
    steepnessYears: sourced(9, 'years', 'iea-electrification', 2023),
    ultimateUplift: sourced(
      0.55,
      'fraction',
      'iea-electrification',
      2023,
      'Electricity demand uplift from electrified transport and heat at full adoption',
    ),
  },
  reliabilityGrowthPenalty: sourced(6, 'fraction', 'game-design', Y, 'A year at 1% unserved costs about 6% of a year of growth'),
  growthSpreadPerYear: sourced(0.004, 'fraction/yr', 'game-design', Y),
}

export interface RooftopTrends {
  /** Roof area worth covering, per head of population. */
  potentialKwPerPerson: Sourced<number>
  /** What a small rooftop system costs per kW against a utility-scale farm. */
  capexPremium: Sourced<number>
  /** Annual yield of one installed kW at this latitude, before shading and orientation. */
  yieldKwhPerKwYear: Sourced<number>
  /** What a household discounts its own money at, which is not what a utility does. */
  householdDiscountRate: Sourced<number>
  householdLifeYears: Sourced<number>
  /** Operating and inverter-replacement cost, as a fraction of capex per year. */
  householdOpexFraction: Sourced<number>
  /**
   * How sharply adoption responds to the ratio of retail price to own-generation cost.
   */
  adoptionSteepness: Sourced<number>
  /**
   * How far past parity the ratio has to get before half the interested roofs are covered.
   *
   * Above one, and that is not a fudge. A household is not indifferent at parity: it is being
   * asked for several thousand euros today against savings spread over twenty-five years, and
   * the observed threshold in every European market has been a payback under about ten years
   * rather than a levelised cost merely below the tariff. Centring the curve on parity would
   * have put panels on roofs a decade before anybody actually bought them.
   */
  adoptionThresholdRatio: Sourced<number>
  /** Share of the eventual potential that can physically be installed in one year. */
  maxBuildSharePerYear: Sourced<number>
  /**
   * The share of a city's electrical demand that sits behind the meters the panels are on.
   *
   * Matters because it caps self-consumption: rooftop output beyond what those households are
   * using at that moment has to go somewhere, and where it goes is the whole story.
   */
  residentialCoincidentShare: Sourced<number>
  /**
   * What the utility pays for exported energy where no support scheme exists.
   *
   * Small but not zero, which is the modern arrangement almost everywhere: the household is
   * paid something like the avoided wholesale cost rather than the retail price.
   */
  baseExportPricePerMwh: Sourced<number>
}

export const ROOFTOP: RooftopTrends = {
  potentialKwPerPerson: sourced(1.2, 'kW/person', 'pvgis', 2022, 'Suitable roof area per head in European towns'),
  capexPremium: sourced(1.9, 'fraction', 'irena-costs', 2022, 'Residential systems against utility-scale, per kW'),
  yieldKwhPerKwYear: sourced(950, 'kWh/kW/yr', 'pvgis', 2022, 'Temperate central-European yield, mixed orientation'),
  householdDiscountRate: sourced(0.05, 'fraction', 'game-design', Y, 'A household is not a project financier'),
  householdLifeYears: sourced(25, 'years', 'irena-costs', 2022),
  householdOpexFraction: sourced(0.015, 'fraction/yr', 'irena-costs', 2022, 'Mostly one inverter replacement, annualised'),
  adoptionSteepness: sourced(7, 'count', 'game-design', Y),
  adoptionThresholdRatio: sourced(
    1.3,
    'fraction',
    'game-design',
    Y,
    'Households buy at a payback under about ten years, not at levelised parity',
  ),
  maxBuildSharePerYear: sourced(0.05, 'fraction/yr', 'game-design', Y, 'Installers, scaffolding and electricians are finite'),
  residentialCoincidentShare: sourced(0.35, 'fraction', 'eurostat', 2022, 'Household share of electricity consumption'),
  baseExportPricePerMwh: sourced(25, 'EUR/MWh', 'game-design', 2022, 'Avoided-cost export payment where no support scheme exists'),
}
