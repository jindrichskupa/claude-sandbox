/**
 * The generation the player does not own, cannot dispatch, and has to pay for.
 *
 * Rooftop photovoltaics are modelled on the city rather than as a plant, and that is a design
 * decision rather than a shortcut. A `PlantAsset` is something the player built, can retire, can
 * refurbish, appears in their capacity headline and carries their capital. None of that is true
 * of four thousand households' panels. What they are is a property of the town: it consumes less
 * in the middle of the day and, past a certain point, stops consuming at all and starts sending
 * power back up the feeder.
 *
 * ## Why adoption is driven by the tariff and not by the year
 *
 * `adoptionTarget` compares the retail price a household pays with what the same household would
 * pay for its own roof, and adoption follows that ratio through a logistic. The household's cost
 * comes from the same learning curve that prices the player's own solar farms, with a premium for
 * being small, a household's discount rate rather than a utility's, and the yield of a temperate
 * latitude.
 *
 * This gets the history right for the right reason. In 1995 a rooftop system was several times
 * the retail price and nobody installed one; parity arrives in the 2010s as modules collapse in
 * price; and a wave follows, limited by how fast installers can physically work rather than by
 * how much anybody wants.
 *
 * It also creates the mechanism that makes this worth simulating at all. **The tariff is in the
 * numerator.** A utility whose costs rise, and whose regulated tariff rises with them, is paying
 * its customers to leave — and every household that leaves takes its revenue with it while
 * leaving the network it still depends on to be paid for by whoever is left. That is the utility
 * death spiral, and here it is a division rather than a scripted event.
 *
 * ## What it does to the market
 *
 * Two effects, and they are not the same effect.
 *
 * **Self-consumption** removes demand. It is netted off the meter before the utility sees it, so
 * the sale simply does not happen. This is the revenue problem.
 *
 * **Export** is generation the system has to absorb. It is offered into the dispatch at
 * `varOpex − exportPrice`, which under a support scheme is a long way below zero, because a
 * household paid per kilowatt-hour produced forfeits that payment by being curtailed and would
 * rather pay to stay on. That is the real and only mechanism behind negative prices, it is the
 * same one `marginalCostPerMwh` already implements for subsidised plant, and it is the operating
 * problem: at noon in June the system is being paid to take power it does not want, the thermal
 * fleet is being pushed off, and the player needs somewhere to put it. Which is what batteries
 * and pumped storage are for, and why they only start to make sense at this point in the story.
 */

import { ROOFTOP } from '@content/cityTrends'
import type { CityAsset } from '../assets/types'
import { realCapexFactor } from '../tech/costs'
import { nominal } from '../tech/money'
import { PLANT_TYPES } from '@content/plantTypes'
import { solarPowerFraction } from '../weather/effects'
import type { Weather } from '../weather/weather'

/**
 * What one kilowatt-hour off a household's own roof costs them, in the money of `year`.
 *
 * A levelised cost with a household's assumptions: their discount rate, the life of the panels,
 * the yield of this latitude, and the price of a small system. Deliberately *not* the utility's
 * LCOE for the same technology — the two differ by a factor of two or more, which is exactly why
 * rooftop adoption and utility-scale build-out happen at different times.
 */
export function householdPvCostPerMwh(year: number): number {
  const solar = PLANT_TYPES.solar
  const capexPerKw =
    nominal(solar.capexPerKw, year) *
    realCapexFactor('solar', year, solar.capexPerKw.sourceYear) *
    ROOFTOP.capexPremium.value

  const r = ROOFTOP.householdDiscountRate.value
  const n = ROOFTOP.householdLifeYears.value
  const annuity = r / (1 - Math.pow(1 + r, -n))

  const annualCostPerKw = capexPerKw * (annuity + ROOFTOP.householdOpexFraction.value)
  const yieldMwhPerKw = ROOFTOP.yieldKwhPerKwYear.value / 1000
  return annualCostPerKw / yieldMwhPerKw
}

/**
 * The share of a town's suitable roof that households eventually want covered, given today's
 * prices.
 *
 * Two shapes matter here and both are deliberate.
 *
 * The curve is centred *above* parity, because a household is not indifferent when its own
 * levelised cost equals the tariff — it is being asked for several thousand euros today against
 * savings spread over a quarter of a century, and the threshold observed in every European
 * market has been a payback of under about a decade. Centring on parity would put panels on
 * roofs years before anybody bought one.
 *
 * And it saturates below one, because even at very favourable prices a large share of roofs are
 * rented, shaded, north-facing, listed, or owned by somebody who is not interested. A model that
 * drove adoption to 100% would produce a fantasy at exactly the point where it matters most.
 */
export function adoptionTarget(retailPricePerMwh: number, ownCostPerMwh: number): number {
  if (ownCostPerMwh <= 0) return 0
  const ratio = retailPricePerMwh / ownCostPerMwh
  const k = ROOFTOP.adoptionSteepness.value
  return 0.75 / (1 + Math.exp(-k * (ratio - ROOFTOP.adoptionThresholdRatio.value)))
}

/** Roof worth covering in a town, in MW, from its population. */
export function rooftopPotentialMw(city: CityAsset): number {
  return (city.population * 1000 * ROOFTOP.potentialKwPerPerson.value) / 1000
}

/**
 * Move every town's installed rooftop capacity one month closer to what it wants.
 *
 * Rate-limited, because the constraint on a solar boom has never been demand. Installers,
 * scaffolders, electricians and inverters are finite, and the lag between "this is now obviously
 * worth doing" and "it is done" is what gives the player a couple of years' warning — if they are
 * looking at the right number.
 *
 * Nothing is ever removed. Panels on a roof stay there whatever the tariff does afterwards, which
 * is the awkward part for a utility that raised prices once and would like to take it back.
 */
export function stepRooftop(
  cities: CityAsset[],
  retailPricePerMwh: number,
  year: number,
  supportPerMwh: number,
): void {
  // Support cuts what the household pays for its own energy, so it belongs in the comparison
  // rather than being bolted on afterwards. A feed-in tariff is not a subsidy on the panel; it
  // is a subsidy on every hour the panel runs.
  const ownCost = Math.max(1, householdPvCostPerMwh(year) - supportPerMwh)
  const share = adoptionTarget(retailPricePerMwh, ownCost)
  const step = ROOFTOP.maxBuildSharePerYear.value / 12

  for (const city of cities) {
    const potential = rooftopPotentialMw(city)
    const target = potential * share
    if (target <= city.rooftopSolarMw) continue
    city.rooftopSolarMw = Math.min(target, city.rooftopSolarMw + potential * step)
  }
}

/** What a town's roofs are producing right now, in MW. */
export function rooftopOutputMw(city: CityAsset, weather: Weather): number {
  if (city.rooftopSolarMw <= 0) return 0
  return city.rooftopSolarMw * solarPowerFraction(weather.irradiance, weather.tempC)
}

/**
 * How this hour's rooftop output splits between the meter and the feeder.
 *
 * Self-consumption is capped by the residential share of the town's load, not by the whole of it.
 * The panels are on houses; the aluminium smelter's demand is not available to soak them up, and
 * pretending otherwise would remove the export — and with it the entire point.
 */
export function rooftopSplit(
  outputMw: number,
  grossDemandMw: number,
): { selfUseMw: number; exportMw: number } {
  const residential = Math.max(0, grossDemandMw) * ROOFTOP.residentialCoincidentShare.value
  const selfUseMw = Math.min(outputMw, residential)
  return { selfUseMw, exportMw: Math.max(0, outputMw - selfUseMw) }
}
