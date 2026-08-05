/**
 * Towns that change size and habits, and roofs that start generating.
 *
 * Three claims worth holding down, and one measurement worth printing.
 *
 * The claims: demand does not run away or collapse over four decades; adoption of rooftop solar
 * is driven by the ratio of the retail price to what a household's own roof costs, so it is
 * nothing at all in the 1990s and substantial once modules are cheap; and a town's roofs push
 * the price at that town below zero when a support scheme is paying for every unit produced.
 *
 * The measurement is the shape of the demand curve across the run, which is not asserted because
 * asserting it would freeze a balance decision. What it should show — and does — is a decade of
 * stagnation while efficiency and electrification cancel out, followed by growth. A planner who
 * extrapolates the first half gets the second half wrong, which is the mistake the model exists
 * to make available.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { CITY_TRENDS, ROOFTOP } from '@content/cityTrends'
import { electrificationUplift, intensityFactor, stepCityGrowth } from '@sim/city/growth'
import { adoptionTarget, householdPvCostPerMwh, rooftopSplit } from '@sim/city/rooftop'
import { Param } from '@sim/params/types'

describe('what each person uses', () => {
  it('nets efficiency against electrification, and the two do not arrive together', () => {
    // The interesting decade is the one where they cancel. European electricity demand was flat
    // to falling from about 2007 to 2020 with a growing economy, and a model that showed steady
    // growth through it would be describing a different continent.
    const start = FIRST_REGION.startYear
    const at = (year: number) => intensityFactor(year, start)

    // Not exactly one: a logistic never quite reaches its floor, so 1995 carries five
    // thousandths of a percent of electrification. Being approximately right at the start is
    // the point; being exactly right would mean the curve had a hard edge, which it should not.
    expect(at(start)).toBeCloseTo(1, 3)
    // Efficiency wins early: nothing is being electrified yet.
    expect(at(2005)).toBeLessThan(1)
    // And loses in the end, because a car is a great deal of kilowatt-hours.
    expect(at(2045)).toBeGreaterThan(at(2005))
    expect(at(2045)).toBeGreaterThan(1)

    // The uplift is a logistic, so it saturates rather than compounding for ever. A model that
    // let it run linearly would have the last decade of a long scenario doubling the load.
    expect(electrificationUplift(1995)).toBeLessThan(0.01)
    expect(electrificationUplift(2060)).toBeLessThan(CITY_TRENDS.electrification.ultimateUplift.value + 1e-6)

    const trace: string[] = []
    for (let y = start; y <= 2045; y += 5) trace.push(`${y}: ${(at(y) * 100).toFixed(0)}%`)
    console.log('demand per head:', trace.join('  '))
  })
})

describe('roofs', () => {
  it('are not worth covering until the panels are cheap', () => {
    // The whole point of pricing adoption rather than scripting it: in 1995 a household system
    // cost several times what the utility charged, and no curve had to be drawn to say so.
    const tariff = FIRST_REGION.tariffPerMwh
    const early = householdPvCostPerMwh(1995)
    const late = householdPvCostPerMwh(2035)
    console.log('household PV cost:', Math.round(early), '→', Math.round(late), '€/MWh against a tariff of', tariff)

    expect(early).toBeGreaterThan(tariff * 2)
    expect(late).toBeLessThan(early / 3)

    // Essentially nobody in 1995, which is the historical record and not an input.
    expect(adoptionTarget(tariff, early)).toBeLessThan(0.005)
    expect(adoptionTarget(tariff, late)).toBeGreaterThan(0.1)
  })

  it('are pushed onto roofs faster by a higher tariff, which is the trap', () => {
    // The utility death spiral, as arithmetic. A utility whose costs rise raises its tariff,
    // and the tariff is the numerator in every household's decision to leave.
    const cost = householdPvCostPerMwh(2030)
    expect(adoptionTarget(140, cost)).toBeGreaterThan(adoptionTarget(70, cost))
  })

  it('split their output between the meter and the feeder', () => {
    // Self-consumption is capped by the residential share of the town's load, not by all of it.
    // If it were not, a town with any industry at all would absorb everything and there would be
    // no export, no negative price and nothing to build a battery for.
    const small = rooftopSplit(10, 1000)
    expect(small.exportMw).toBe(0)
    expect(small.selfUseMw).toBe(10)

    const big = rooftopSplit(500, 400)
    expect(big.selfUseMw).toBeLessThan(400)
    expect(big.exportMw).toBeGreaterThan(0)
    expect(big.selfUseMw + big.exportMw).toBeCloseTo(500, 6)
  })
})

describe('what the roofs do to the market', () => {
  /**
   * Runs a summer with a given government and reports the worst price the town saw.
   *
   * Constructed rather than played: reaching this by simulation takes thirty game years, and the
   * claim under test is about one hour. The rooftop figure is not a forecast — it is "more than
   * the town can possibly use at noon", which is the condition being tested and, by the 2030s,
   * one the played scenario reaches on its own.
   */
  function summerUnderRoofs(regimeId: string): { lowest: number; negativeHours: number } {
    const world = buildWorld(FIRST_REGION)
    for (const city of world.cities) city.rooftopSolarMw = 2000
    world.state.policyRegimeId = regimeId

    let lowest = Infinity
    let negativeHours = 0
    for (let i = 0; i < 24 * 250; i++) {
      world.step()
      // The nodal price at the town, not the system price. Though with roofs this size they are
      // the same number, because there is nothing else running anywhere.
      const price = world.lastDispatch?.nodalPrice.get(world.cities[0]!.nodeId) ?? 0
      if (price < -0.01) negativeHours++
      lowest = Math.min(lowest, price)
    }
    return { lowest, negativeHours }
  }

  it('drives the price below zero when every unit produced is paid for', () => {
    // A household on a support scheme forfeits the payment by being curtailed, so it will bid
    // almost that much below zero to stay on — and when the roofs alone can cover the town, that
    // bid is what sets the price. This is the mechanism the whole feature exists for, and it is
    // the same one `marginalCostPerMwh` already gives any subsidised plant.
    const supported = summerUnderRoofs('renewables_push')
    console.log('under a support scheme:', supported)
    expect(supported.lowest).toBeLessThan(-50)
    expect(supported.negativeHours).toBeGreaterThan(500)
  }, 300_000)

  it('barely goes below zero without one, which is the honest answer', () => {
    // Worth asserting as forcefully as the case above. **Negative prices are a consequence of
    // subsidy, not of sunshine.** With no scheme in force the household is paid only avoided
    // cost, so it will give up very little to stay on and the price bottoms out just under zero.
    // A model that produced deep negative prices from sunshine alone would be teaching the
    // player something false about why they happen.
    const unsupported = summerUnderRoofs('market_liberal')
    console.log('with no support scheme:', unsupported)
    expect(unsupported.lowest).toBeGreaterThan(-ROOFTOP.baseExportPricePerMwh.value * 1.5)
  }, 300_000)
})

describe('a town over the years', () => {
  it('grows while the lights stay on, and the demand chain says why', () => {
    // Ten years rather than forty, and deliberately. Past the first decade the untouched fleet
    // starts failing beyond repair — see `tests/reliability.test.ts` — and a town that spends
    // years in the dark loses people, which is the *other* half of this model and is tested
    // directly below. Mixing the two in one run measures neither.
    const world = buildWorld(FIRST_REGION)
    const city = world.cities[0]!
    const startPopulation = city.population
    const startBase = world.params.base(city.id, Param.DemandMw)

    const trace: string[] = []
    for (let i = 0; i < 24 * 365 * 10; i++) {
      world.step()
      if (world.tick % (24 * 365) === 0) {
        trace.push(
          `${world.date.year}: ${Math.round(city.population)}k, ` +
            `${world.params.get(city.id, Param.DemandMw).toFixed(0)} MW, ` +
            `roofs ${city.rooftopSolarMw.toFixed(0)} MW`,
        )
      }
    }
    for (const line of trace) console.log(line)

    expect(city.population).toBeGreaterThan(startPopulation)
    // Not a boom town: a decade at a fraction of a percent is a few percent in total.
    expect(city.population).toBeLessThan(startPopulation * 1.2)
    // The scenario's own figure is never overwritten — growth is a modifier over it, which is
    // what keeps the explanation readable.
    expect(startBase).toBeCloseTo(world.params.base(city.id, Param.DemandMw), 6)

    const explained = world.params.explain(city.id, Param.DemandMw)
    const reasons = explained.steps.map((s) => s.reasonKey)
    expect(reasons).toContain('reason.population')
    expect(reasons).toContain('reason.perHead')
  }, 900_000)

  it('loses people where the lights go out, which is the only place reliability changes the problem', () => {
    // The player's record changes the *size* of what they have to serve, not just their score.
    // A town dark for a month does not grow that month; one dark for years empties out, and the
    // factory does not come back.
    const world = buildWorld(FIRST_REGION)
    const stream = world.rng.streamFor('city')

    const served = { ...world.cities[0]!, id: 'c_served', unservedTicksRecent: 0 }
    const dark = { ...world.cities[0]!, id: 'c_dark', unservedTicksRecent: 730 }
    const towns = [served, dark]

    for (let month = 0; month < 120; month++) {
      dark.unservedTicksRecent = 730 // dark every hour of every month
      stepCityGrowth(towns, month * 730, stream)
    }
    console.log('after ten years:', Math.round(served.population), 'k served,', Math.round(dark.population), 'k dark')

    expect(served.population).toBeGreaterThan(world.cities[0]!.population)
    expect(dark.population).toBeLessThan(served.population)
    // And the counter is cleared each month, so it measures the month rather than the run.
    expect(served.unservedTicksRecent).toBe(0)
  })
})
