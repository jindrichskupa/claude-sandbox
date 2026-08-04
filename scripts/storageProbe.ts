/**
 * Can the simulation actually distinguish a long-duration store from a short one?
 *
 * Diagnostic, not a test. The question is whether the arbitrage policy is good enough that
 * six hours of pumped storage beats two hours of battery when it should — because if the
 * policy cannot see duration, the whole storage choice collapses into "which is cheaper".
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { PLANT_TYPES, type PlantTypeId } from '../src/content/plantTypes'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { beginLineConstruction, beginPlantConstruction } from '../src/sim/build/commands'
import { LifecyclePhase } from '../src/sim/assets/types'
import { energyCapacityMwh, onewayEfficiency } from '../src/sim/dispatch/storage'

function trial(typeId: PlantTypeId, years: number) {
  // A modern start year so both technologies are on the menu and the comparison is fair.
  const world = buildWorld({ ...FIRST_REGION, startYear: 2020 })
  const site = { x: 26, y: 24 }
  const built = beginPlantConstruction(world, typeId, site.x, site.y)
  if (!built.ok) {
    return { typeId, error: built.quote.reasonKey }
  }
  const plant = world.getPlant(built.plantId!)!
  beginLineConstruction(world, plant.nodeId, 'n_rivermouth', 220, 1)

  // Skip past construction.
  while (plant.phase !== LifecyclePhase.Operating) world.step()
  for (let i = 0; i < 24 * 30; i++) world.step()

  let discharged = 0
  let charged = 0
  let chargingHours = 0
  let dischargingHours = 0
  let revenue = 0
  let cost = 0
  let unservedMwh = 0

  const ticks = Math.round(years * TICKS_PER_YEAR)
  for (let i = 0; i < ticks; i++) {
    const snap = world.step()
    unservedMwh += snap.unservedMw
    const mw = world.lastDispatch!.generationMw.get(plant.id) ?? 0
    if (mw > 0.01) {
      discharged += mw
      dischargingHours++
      revenue += mw * snap.pricePerMwh
    } else if (mw < -0.01) {
      charged += -mw
      chargingHours++
      cost += -mw * snap.pricePerMwh
    }
  }

  const type = PLANT_TYPES[typeId]
  const capacityMw = type.capacityMw.value
  const capex = type.capexPerKw.value * capacityMw * 1000
  const lifeYears = type.designLifeYears.value

  return {
    typeId,
    powerMw: capacityMw,
    energyMwh: energyCapacityMwh(plant),
    durationH: energyCapacityMwh(plant) / capacityMw,
    roundTrip: type.storage!.roundTripEfficiency.value,
    oneway: onewayEfficiency(plant),
    capexM: capex / 1e6,
    lifeYears,
    dischargedGwh: discharged / 1000,
    chargedGwh: charged / 1000,
    chargingHours,
    dischargingHours,
    grossMarginM: (revenue - cost) / 1e6,
    unservedMwh,
    /** Equivalent full cycles per year: the number batteries are actually rated in. */
    cyclesPerYear: discharged / Math.max(1, energyCapacityMwh(plant)) / years,
    /** Very rough: gross margin over the whole life against the capital it took. */
    lifetimeMarginPerCapex: ((revenue - cost) / years) * lifeYears / capex,
  }
}

function baseline(years: number) {
  const world = buildWorld({ ...FIRST_REGION, startYear: 2020 })
  for (let i = 0; i < 24 * 30; i++) world.step()
  let unservedMwh = 0
  const ticks = Math.round(years * TICKS_PER_YEAR)
  for (let i = 0; i < ticks; i++) unservedMwh += world.step().unservedMw
  return unservedMwh
}

const YEARS = 2
console.log(`baseline unserved over ${YEARS} years: ${baseline(YEARS).toFixed(0)} MWh`)

for (const id of ['battery', 'pumped'] as PlantTypeId[]) {
  const r = trial(id, YEARS)
  console.log(`\n=== ${id} ===`)
  for (const [k, v] of Object.entries(r)) {
    console.log(`  ${k.padEnd(22)} ${typeof v === 'number' ? v.toFixed(3) : v}`)
  }
}
