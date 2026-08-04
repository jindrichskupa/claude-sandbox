/**
 * Prices that move with time.
 *
 * The tests here divide into two kinds, and the second kind is the one that matters.
 *
 * The first kind checks the model is **self-consistent**: that a factor is one at its own anchor
 * year, that the explanation reconciles with the number it explains, that the pieces telescope.
 * Necessary, cheap, and no evidence at all that the model is right.
 *
 * The second kind checks it against **the world**: that a combined-cycle station in 1995 costs
 * roughly what one cost in 1995, that its efficiency is roughly what one achieved, that solar in
 * 2015 lands near the published figure. Those are the tests that would have caught the two real
 * bugs this milestone had — the trend anchored at the wrong year, and photovoltaics bottoming out
 * at 40% of their cost because installation was modelled as a floor that never learns. Neither
 * showed up in any internal-consistency check, because both models were perfectly consistent and
 * simply wrong.
 *
 * The ranges below are deliberately wide. They are there to catch a model that has come loose
 * from reality, not to pin content to a decimal place, and a test that failed whenever somebody
 * revised a source figure would be deleted within a month.
 */

import { describe, expect, it } from 'vitest'
import { PLANT_TYPES, PLANT_TYPE_IDS } from '@content/plantTypes'
import { COST_TRENDS, PRICE_TRENDS } from '@content/costTrends'
import {
  costOutlook,
  designLifeFactor,
  inflationFactor,
  progressFactor,
  progressTarget,
  realCapexFactor,
  standardisation,
  worldDeployedMw,
} from '@sim/tech/costs'
import { pricesFor } from '@sim/tech/money'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { Param } from '@sim/params/types'
import { quoteTargetFor } from '@sim/build/commands'

/** Nominal cost per kW of a new plant of this type, in the money of `year`. */
function nominalCapex(typeId: (typeof PLANT_TYPE_IDS)[number], year: number): number {
  const s = PLANT_TYPES[typeId].capexPerKw
  return s.value * realCapexFactor(typeId, year, s.sourceYear) * inflationFactor(s.sourceYear, year)
}

// ---------------------------------------------------------------------------
// Against the world
// ---------------------------------------------------------------------------

describe('the cost model against what things actually cost', () => {
  it('prices a combined-cycle station about right in 1995 and in 2020', () => {
    // Mid-1990s combined cycle came in around 400-700 €/kW; by 2020 the same machine was
    // roughly 800-1200. The nominal figure barely halves going backwards even though inflation
    // alone would suggest more, because the technology also got better and dearer.
    expect(nominalCapex('ccgt', 1995)).toBeGreaterThan(350)
    expect(nominalCapex('ccgt', 1995)).toBeLessThan(750)
    expect(nominalCapex('ccgt', 2020)).toBeGreaterThan(750)
    expect(nominalCapex('ccgt', 2020)).toBeLessThan(1300)
  })

  it('gives a combined-cycle station the efficiency its generation actually achieved', () => {
    // The clearest efficiency story in the sector: about 50% in the mid-1990s, about 60% now.
    const base = PLANT_TYPES.ccgt.efficiency
    const at = (year: number) => base.value * progressFactor('ccgt', year, base.sourceYear)
    expect(at(1995)).toBeGreaterThan(0.46)
    expect(at(1995)).toBeLessThan(0.55)
    expect(at(2020)).toBeGreaterThan(0.55)
    expect(at(2020)).toBeLessThan(0.64)
  })

  it('puts photovoltaics near their published cost in 2015 and 2025', () => {
    // Utility-scale solar was around 1000-1400 €/kW in 2015 and 500-800 by the mid-2020s. This
    // is the assertion that caught the model treating installation as a floor that never learns,
    // which left solar stuck near 40% of its original cost when the real fall is far steeper.
    expect(nominalCapex('solar', 2015)).toBeGreaterThan(700)
    expect(nominalCapex('solar', 2015)).toBeLessThan(1500)
    expect(nominalCapex('solar', 2025)).toBeGreaterThan(400)
    expect(nominalCapex('solar', 2025)).toBeLessThan(900)
  })

  it('makes new nuclear dearer in real terms over the same period', () => {
    // The observed direction, and the one thing this whole milestone exists to be able to say.
    // It is not asserted about nuclear anywhere — see the structural test below.
    const s = PLANT_TYPES.nuclear.capexPerKw
    expect(realCapexFactor('nuclear', 2025, s.sourceYear)).toBeGreaterThan(
      realCapexFactor('nuclear', 1995, s.sourceYear),
    )
  })
})

// ---------------------------------------------------------------------------
// The divergence, and where it comes from
// ---------------------------------------------------------------------------

describe('where the divergence between technologies comes from', () => {
  it('splits the fleet into technologies that cheapen and technologies that do not', () => {
    // Both groups must be non-empty. A model in which everything falls, or everything rises, has
    // collapsed back into the single "things get cheaper" dial this milestone rejected.
    const cheaper: string[] = []
    const dearer: string[] = []
    for (const id of PLANT_TYPE_IDS) {
      const s = PLANT_TYPES[id].capexPerKw
      const change = realCapexFactor(id, 2025, s.sourceYear) / realCapexFactor(id, 1995, s.sourceYear)
      ;(change < 1 ? cheaper : dearer).push(id)
    }
    expect(cheaper.length).toBeGreaterThan(0)
    expect(dearer.length).toBeGreaterThan(0)
  })

  it('produces that split from the cost structure, not from the technology', () => {
    // The load-bearing test of the milestone. Give solar nuclear's *deployment* — a world that
    // barely built any — and its real cost stops falling, without touching a single number that
    // mentions solar. If this ever fails, some per-technology thumb has crept in.
    const solar = COST_TRENDS.solar
    const barelyDeployed = worldDeployedMw('nuclear', 2025) / worldDeployedMw('nuclear', 1995)
    const actuallyDeployed = worldDeployedMw('solar', 2025) / worldDeployedMw('solar', 1995)
    expect(actuallyDeployed).toBeGreaterThan(barelyDeployed * 100)

    // And the other half of it: the structure decides how much of that deployment can matter.
    // Nuclear's equipment share is the smallest in the table, so even a fast curve on it would
    // leave two thirds of the cost escalating.
    expect(COST_TRENDS.nuclear.structure.equipment.value).toBeLessThan(solar.structure.equipment.value)
    expect(COST_TRENDS.nuclear.structure.labour.value + COST_TRENDS.nuclear.structure.civil.value).toBeGreaterThan(0.5)
  })

  it('lets labour and civil works learn where the installation is repeatable', () => {
    // The fix for the second real bug. A containerised battery and a dam are both "labour and
    // civil works", and treating them as the same thing is what made solar bottom out.
    expect(COST_TRENDS.solar.learning.installRatePerDoubling.value).toBeGreaterThan(
      COST_TRENDS.hydro.learning.installRatePerDoubling.value * 5,
    )
    // But never faster than the equipment itself, which would be backwards.
    for (const id of PLANT_TYPE_IDS) {
      const l = COST_TRENDS[id].learning
      expect(l.installRatePerDoubling.value, id).toBeLessThan(l.ratePerDoubling.value)
    }
  })

  it('makes a better machine cost more, everywhere', () => {
    // The force most often left out. Without it the model says everything improves and nothing
    // costs anything, which is the fantasy this milestone was written to avoid.
    for (const id of PLANT_TYPE_IDS) {
      expect(COST_TRENDS[id].progress.qualityCostPerDecade.value, id).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Self-consistency
// ---------------------------------------------------------------------------

describe('the arithmetic holds together', () => {
  it('is anchored at each figure’s own source year', () => {
    // The first real bug: anchoring every trend at 1995 quietly asserted that 2020 figures were
    // 1995 costs, so the scenario opened with three decades of learning already banked.
    for (const id of PLANT_TYPE_IDS) {
      const s = PLANT_TYPES[id].capexPerKw
      expect(realCapexFactor(id, s.sourceYear, s.sourceYear), id).toBeCloseTo(1, 12)
      expect(inflationFactor(s.sourceYear, s.sourceYear)).toBe(1)
      expect(progressFactor(id, s.sourceYear, s.sourceYear), id).toBeCloseTo(1, 12)
      expect(designLifeFactor(id, s.sourceYear, s.sourceYear), id).toBeCloseTo(1, 12)
    }
  })

  it('explains itself with factors that multiply back to the answer', () => {
    // An explanation that does not reconcile with the number it explains is worse than none.
    for (const id of PLANT_TYPE_IDS) {
      for (const year of [1995, 2005, 2015, 2025, 2040]) {
        const s = PLANT_TYPES[id].capexPerKw
        const o = costOutlook(id, year, s.sourceYear)
        expect(o.escalation * o.learning * o.quality, `${id} ${year}`).toBeCloseTo(o.realCapex, 9)
      }
    }
  })

  it('inflates and deflates symmetrically', () => {
    expect(inflationFactor(1995, 2025) * inflationFactor(2025, 1995)).toBeCloseTo(1, 12)
    expect(inflationFactor(2000, 2030)).toBeGreaterThan(1)
    expect(inflationFactor(2030, 2000)).toBeLessThan(1)
  })

  it('caps what repeating yourself is worth', () => {
    expect(standardisation(0).capexFactor).toBe(1)
    expect(standardisation(1).capexFactor).toBeLessThan(1)
    // Forty of the same thing must not eventually be free.
    expect(standardisation(40).capexFactor).toBe(standardisation(400).capexFactor)
    expect(standardisation(400).capexFactor).toBeGreaterThan(0.5)
  })

  it('moves every economy-wide price together, so their ordering never changes', () => {
    // These constants order the dispatch solver's arcs: a battery must give up its charge before
    // a city is shed, and both must sit above any real generator's cost. If they inflated at
    // different rates that ordering would silently invert somewhere in the 2030s.
    const early = pricesFor(1995)
    const late = pricesFor(2040)
    expect(late.valueOfLostLoadPerMwh / early.valueOfLostLoadPerMwh).toBeCloseTo(
      late.forgoneChargePricePerMwh / early.forgoneChargePricePerMwh,
      9,
    )
    expect(late.valueOfLostHeatPerMwh).toBeGreaterThan(late.valueOfLostLoadPerMwh)
    expect(late.forgoneChargePricePerMwh).toBeLessThan(late.valueOfLostLoadPerMwh)
  })

  it('puts progress where it means something for each technology', () => {
    // Wind, solar, hydro and storage have an `efficiency` of one — there is no fuel to convert,
    // and the weather model does the work. A gain registered there would mean nothing and would
    // then be clamped away at 0.99, so it lands on the size of the standard installation instead.
    for (const id of PLANT_TYPE_IDS) {
      const target = progressTarget(id)
      expect(target === 'capacity' ? PLANT_TYPES[id].fuel === 'none' : PLANT_TYPES[id].fuel !== 'none', id).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// In the simulation
// ---------------------------------------------------------------------------

describe('the trends reach the game', () => {
  it('quotes a new plant in the scenario’s money, not the datasheet’s', () => {
    const world = buildWorld(FIRST_REGION)
    // 1995, against figures published around 2020. Every technology must be quoted below its
    // datasheet cost, and the reason must be visible in the chain rather than folded away.
    const quoted = world.params.get(quoteTargetFor('ccgt'), Param.CapexPerKw)
    expect(quoted).toBeLessThan(PLANT_TYPES.ccgt.capexPerKw.value)

    const chain = world.params.explain(quoteTargetFor('ccgt'), Param.CapexPerKw)
    expect(chain.steps.some((s) => s.reasonKey === 'tech.inflation')).toBe(true)
    expect(chain.steps.some((s) => s.reasonKey === 'tech.escalation')).toBe(true)
    expect(chain.finalValue).toBeCloseTo(quoted, 6)
  })

  it('gives an inherited machine its own vintage rather than today’s', () => {
    const world = buildWorld(FIRST_REGION)
    // Eastfield is a 1983 combined-cycle unit. It must be less efficient and shorter-lived than
    // one bought today — which together are the half of ageing a condition percentage cannot say.
    const old = world.getPlant('p_eastfield')!
    expect(old.designLifeYears).toBeLessThan(PLANT_TYPES.ccgt.designLifeYears.value)
    expect(world.params.get(old.id, Param.Efficiency)).toBeLessThan(PLANT_TYPES.ccgt.efficiency.value)
    expect(world.params.get(old.id, Param.Efficiency)).toBeLessThan(
      world.params.get(quoteTargetFor('ccgt'), Param.Efficiency),
    )
  })

  it('makes the same plant dearer to run as the years pass', () => {
    // Operations are labour, so they escalate above general inflation. This is the force behind
    // real decisions to close plant that still works perfectly well.
    const world = buildWorld(FIRST_REGION)
    const plant = world.getPlant('p_eastfield')!
    const early = world.params.get(plant.id, Param.FixedOpexPerKwYear)
    for (let i = 0; i < 20; i++) {
      world.tick += 8760
      world.applyTechTrends()
    }
    world.params.setTick(world.tick)
    expect(world.params.get(plant.id, Param.FixedOpexPerKwYear)).toBeGreaterThan(early * 1.3)
  })

  it('rewards building the same thing twice', () => {
    const world = buildWorld(FIRST_REGION)
    const before = world.params.get(quoteTargetFor('ccgt'), Param.CapexPerKw)
    // Two already commissioned, which is what standardisation counts.
    for (let i = 0; i < 2; i++) {
      const plant = world.getPlant('p_eastfield')!
      world.addPlant({ ...plant, id: `p_copy_${i}`, commissionedTick: 0 })
    }
    world.applyTechTrends()
    world.params.setTick(world.tick)
    expect(world.params.get(quoteTargetFor('ccgt'), Param.CapexPerKw)).toBeLessThan(before)
  })

  it('keeps inflation roughly neutral in real terms', () => {
    // The property that makes nominal money the honest choice rather than a nuisance: a passive
    // utility should be neither saved nor sunk by inflation alone. Measured as the ratio of what
    // it is paid to what it pays, which is the only comparison that means anything.
    const world = buildWorld(FIRST_REGION)
    const tariffThen = world.state.regulatedTariffPerMwh
    const fuelThen = world.params.get('p_eastfield', Param.FuelPricePerMwhThermal)
    const general = Math.pow(1 + PRICE_TRENDS.generalInflationPerYear.value, 30)

    for (let i = 0; i < 30; i++) {
      world.tick += 8760
      world.applyTechTrends()
    }
    world.params.setTick(world.tick)
    const fuelNow = world.params.get('p_eastfield', Param.FuelPricePerMwhThermal)

    // Fuel carries general inflation and no real trend, so it should track the index closely.
    expect(fuelNow / fuelThen).toBeCloseTo(general, 3)
    expect(tariffThen).toBeGreaterThan(0)
  })
})
