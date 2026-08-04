/**
 * Neutrality.
 *
 * The design promise is that no technology has a thumb on the scale. That is partly a claim
 * about provenance, which `content.test.ts` checks, and partly a claim about the shape of
 * the numbers, which is what this file checks.
 *
 * A note on what is and is not tested here. A tempting test would be "every technology is
 * the cheapest option in some scenario", computed from levelised cost. That test would be
 * misleading: levelised cost deliberately ignores *when* the energy arrives, so it makes
 * solar look like a good peaking plant and a battery look like a bad one. The honest
 * property at this milestone is weaker and actually meaningful: **no technology is beaten by
 * another on every dimension at once**. A technology that were would be one the player
 * should never build, and that would be a content bug rather than a balance choice.
 *
 * The stronger claim — that each technology is the right answer in some scenario — becomes
 * testable once scenarios and policy regimes exist, and belongs with them.
 *
 * Heat and electricity are compared **separately**, and that matters. A peak boiler and a
 * combined-cycle station are not competing for the same job, and scoring them on one set of
 * axes says only that thermal megawatts are cheaper than electrical ones — which is true,
 * irrelevant, and would swamp every real comparison in the table. Cogeneration units appear in
 * both fields, because they genuinely compete in both.
 */

import { describe, expect, it } from 'vitest'
import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeDef } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { RandomSource } from '@sim/core/rng'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { TEMPERATE_CLIMATE, WeatherModel } from '@sim/weather/weather'
import { hydroPowerFraction, solarPowerFraction, thermalDerate, windPowerFraction } from '@sim/weather/effects'

/**
 * Mean annual capacity factor of each weather-dependent resource, measured by running the
 * actual weather model for a year rather than asserted as a constant. This is the axis on
 * which wind earns its higher cost over solar in a temperate climate: it blows at night and
 * in winter, which is when the demand is.
 */
function measuredCapacityFactors(): Record<string, number> {
  const weather = new WeatherModel(new RandomSource(4242), TEMPERATE_CLIMATE)
  let snowpack = 0
  let wind = 0
  let solar = 0
  let river = 0
  let waterCooledThermal = 0

  for (let tick = 0; tick < TICKS_PER_YEAR; tick++) {
    const w = weather.generate(tick, snowpack)
    snowpack = w.snowpackMm
    wind += windPowerFraction(w.windMs)
    solar += solarPowerFraction(w.irradiance, w.tempC)
    river += hydroPowerFraction(w.riverFlowIndex)
    waterCooledThermal += 1 + thermalDerate('water', w.tempC, w.riverFlowIndex)
  }

  return {
    wind: wind / TICKS_PER_YEAR,
    solar: solar / TICKS_PER_YEAR,
    riverflow: river / TICKS_PER_YEAR,
    none: waterCooledThermal / TICKS_PER_YEAR,
  }
}

const CAPACITY_FACTORS = measuredCapacityFactors()

/** Types that put electricity on the grid. */
const ELECTRIC_IDS = PLANT_TYPE_IDS.filter((id) => PLANT_TYPES[id].heatOnly === null)
/** Types that put heat into a district network. */
const HEAT_IDS = PLANT_TYPE_IDS.filter((id) => PLANT_TYPES[id].chp !== null || PLANT_TYPES[id].heatOnly !== null)

/**
 * Fuel burnt per MWh of heat delivered, by the same rule the economy uses — see
 * `thermalInputMwh`. An extraction unit comes out very low because most of its fuel is
 * charged to the electricity it is also making, which is exactly the real accounting and
 * exactly why cogeneration heat is cheap.
 */
function thermalPerHeat(t: PlantTypeDef): number {
  if (t.heatOnly) return t.heatOnly.kind === 'accumulator' ? 0 : 1 / t.heatOnly.thermalEfficiency.value
  if (!t.chp) return Infinity
  if (t.chp.mode === 'backpressure') return (1 + t.chp.powerPerHeat.value) / t.chp.totalEfficiency.value
  return t.chp.powerLossPerHeat.value / t.efficiency.value
}

/** Capital cost per kilowatt of *heat*, so the two kinds of heat plant are comparable. */
function capexPerKwth(t: PlantTypeDef): number {
  if (t.heatOnly) return t.capexPerKw.value
  if (!t.chp) return Infinity
  return (t.capexPerKw.value * t.capacityMw.value) / t.chp.heatCapacityMwth.value
}

function fixedOpexPerKwthYear(t: PlantTypeDef): number {
  if (t.heatOnly) return t.fixedOpexPerKwYear.value
  if (!t.chp) return Infinity
  return (t.fixedOpexPerKwYear.value * t.capacityMw.value) / t.chp.heatCapacityMwth.value
}

/** Axes for the heat market. Higher is always better, as above. */
const HEAT_AXES: Record<string, (t: PlantTypeDef) => number> = {
  /** A tank makes no heat; it gives back heat somebody else made. The heat analogue of
   *  `netEnergyProducer`, and for the same reason. */
  netHeatProducer: (t) => (t.heatOnly?.kind === 'accumulator' ? 0 : 1),
  cheapToBuild: (t) => -capexPerKwth(t),
  cheapToRun: (t) => -fixedOpexPerKwthYear(t),
  cheapFuel: (t) => -thermalPerHeat(t) * FUELS[t.fuel].pricePerMwhThermal.value,
  lowEmissions: (t) => -thermalPerHeat(t) * FUELS[t.fuel].co2PerMwhThermal.value,
  /** Selling electricity as well is the whole economic case for cogeneration. */
  makesElectricityToo: (t) => (t.chp ? 1 : 0),
  /** A boiler decides its own output. A backpressure set cannot make heat without also making
   *  electricity somebody has to take, which is a real operational cost of using it. */
  independentOfTheGrid: (t) => (t.heatOnly ? 1 : 0),
  keepsHeatForLater: (t) => (t.heatOnly?.storageMwhth ? 1 : 0),
  quickToBuild: (t) => -t.buildTimeMonths.value,
  longLived: (t) => t.designLifeYears.value,
  reliable: (t) => -t.forcedOutageRate.value,
  cheapToRetire: (t) => -t.decommissionCostPerKw.value,
  secureFuel: (t) => -FUELS[t.fuel].supplyRisk.value,
}

/** Each axis, expressed so that a higher score is always better. */
const AXES: Record<string, (t: PlantTypeDef) => number> = {
  /**
   * Whether the thing makes energy at all. Storage returns energy that was put in, at a
   * loss; leaving this out would make a battery look strictly better than a power station
   * on every other axis, which is exactly the sort of nonsense this test exists to catch.
   */
  netEnergyProducer: (t) => (t.storage ? 0 : 1),
  /** How much of its rated output the resource actually delivers over a year. */
  resourceAvailability: (t) => CAPACITY_FACTORS[t.weatherDependence] ?? 1,
  cheapToBuild: (t) => -t.capexPerKw.value,
  cheapToRun: (t) => -t.fixedOpexPerKwYear.value,
  efficient: (t) => t.efficiency.value,
  lowEmissions: (t) => -FUELS[t.fuel].co2PerMwhThermal.value / Math.max(0.01, t.efficiency.value),
  cheapFuel: (t) => -FUELS[t.fuel].pricePerMwhThermal.value / Math.max(0.01, t.efficiency.value),
  flexible: (t) => t.rampRatePerHour.value,
  lowMinimumLoad: (t) => -t.minLoadFraction.value,
  quickToBuild: (t) => -t.buildTimeMonths.value,
  longLived: (t) => t.designLifeYears.value,
  reliable: (t) => -t.forcedOutageRate.value,
  cheapToRetire: (t) => -t.decommissionCostPerKw.value,
  weatherIndependent: (t) => (t.weatherDependence === 'none' ? 1 : 0),
  secureFuel: (t) => -FUELS[t.fuel].supplyRisk.value,
  /** A station that can also sell heat has a second income the others do not. */
  cogenerates: (t) => (t.chp ? 1 : 0),
}

const AXIS_NAMES = Object.keys(AXES)

/** True if `a` is at least as good as `b` everywhere and strictly better somewhere. */
function dominates(
  a: PlantTypeDef,
  b: PlantTypeDef,
  axes: Record<string, (t: PlantTypeDef) => number> = AXES,
): boolean {
  let strictlyBetterSomewhere = false
  for (const name of Object.keys(axes)) {
    const score = axes[name]!
    const sa = score(a)
    const sb = score(b)
    if (sa < sb - 1e-9) return false
    if (sa > sb + 1e-9) strictlyBetterSomewhere = true
  }
  return strictlyBetterSomewhere
}

describe('technology neutrality', () => {
  it('has no dominated technology: every option is best at something relative to every other', () => {
    const dominated: string[] = []
    for (const victim of ELECTRIC_IDS) {
      for (const rival of ELECTRIC_IDS) {
        if (victim === rival) continue
        if (dominates(PLANT_TYPES[rival], PLANT_TYPES[victim])) {
          dominated.push(`${victim} is dominated by ${rival}`)
        }
      }
    }
    expect(dominated).toEqual([])
  })

  it('has no dominated heat technology either', () => {
    const dominated: string[] = []
    for (const victim of HEAT_IDS) {
      for (const rival of HEAT_IDS) {
        if (victim === rival) continue
        if (dominates(PLANT_TYPES[rival], PLANT_TYPES[victim], HEAT_AXES)) {
          dominated.push(`${victim} is dominated by ${rival}`)
        }
      }
    }
    expect(dominated).toEqual([])
  })

  it('gives every technology at least one axis where it leads the field', () => {
    // A weaker but complementary check: every technology should be somewhere near the top
    // of at least one axis, so it has a recognisable reason to exist.
    const withoutAStrength: string[] = []
    for (const id of ELECTRIC_IDS) {
      const type = PLANT_TYPES[id]
      const hasStrength = AXIS_NAMES.some((name) => {
        const score = AXES[name]!
        const mine = score(type)
        const best = Math.max(...ELECTRIC_IDS.map((other) => score(PLANT_TYPES[other])))
        const worst = Math.min(...ELECTRIC_IDS.map((other) => score(PLANT_TYPES[other])))
        if (best === worst) return false
        // Within the top quarter of the range counts as a strength.
        return mine >= best - (best - worst) * 0.25
      })
      if (!hasStrength) withoutAStrength.push(id)
    }
    expect(withoutAStrength).toEqual([])
  })

  it('makes no technology both cheapest to build and cheapest to run', () => {
    // The capital-versus-fuel trade-off is the spine of the whole genre. If one option won
    // both ends of it, every scenario would have the same answer.
    const cheapestCapex = ELECTRIC_IDS.reduce((a, b) =>
      PLANT_TYPES[a].capexPerKw.value <= PLANT_TYPES[b].capexPerKw.value ? a : b,
    )
    const cheapestFuel = ELECTRIC_IDS.filter((id) => PLANT_TYPES[id].fuel !== 'none').reduce((a, b) => {
      const cost = (id: typeof a) =>
        FUELS[PLANT_TYPES[id].fuel].pricePerMwhThermal.value / PLANT_TYPES[id].efficiency.value
      return cost(a) <= cost(b) ? a : b
    })
    expect(cheapestCapex).not.toBe(cheapestFuel)
  })

  it('prices emissions purely through fuel and efficiency, with no per-technology adjustment', () => {
    // Emissions must be a physical consequence, never a per-technology dial. If a plant
    // burns no carbon it emits none; if it burns carbon, its emissions follow entirely from
    // the fuel and how efficiently it is used.
    for (const id of ELECTRIC_IDS) {
      const type = PLANT_TYPES[id]
      const fuel = FUELS[type.fuel]
      const perMwhElectric = fuel.co2PerMwhThermal.value / type.efficiency.value
      if (fuel.co2PerMwhThermal.value === 0) {
        expect(perMwhElectric, `${id}`).toBe(0)
      } else {
        expect(perMwhElectric, `${id}`).toBeGreaterThan(0)
        // Sanity: no plausible fossil plant emits more than 1.5 t/MWh of electricity.
        expect(perMwhElectric, `${id}`).toBeLessThan(1.5)
      }
    }
  })
})
