/**
 * Is a scenario's inherited fleet big enough for the load it inherits?
 *
 * Written after getting it wrong. The second scenario was sized by eye against each town's *base*
 * demand and went bankrupt in its third year with a fifth of demand undelivered — because base
 * demand is the flat part of a curve that peaks half again as high on a winter evening, and
 * because a fleet's nameplate is not what turns up. Both of those are measurable in a single
 * simulated year, so there is no reason to guess at either.
 *
 * Run: npx tsx scripts/sizeScenario.ts [scenarioId]
 */

import { buildWorld } from '@sim/scenario/build'
import { SCENARIO_LIST, scenarioById } from '@content/scenarios'
import { PLANT_TYPES } from '@content/plantTypes'
import { isDispatchable } from '@sim/assets/types'
import { Param } from '@sim/params/types'
import { TICKS_PER_YEAR } from '@sim/core/time'

const wanted = process.argv[2]
const scenarios = wanted ? [scenarioById(wanted)!] : SCENARIO_LIST

for (const content of scenarios) {
  const world = buildWorld(content)
  let nameplate = 0
  for (const plant of world.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (!type.heatOnly && type.weatherDependence === 'none') nameplate += type.capacityMw.value
  }

  let peak = 0
  let worstAvailable = Infinity
  let shortHours = 0
  let unservedMwh = 0
  let servedMwh = 0
  for (let i = 0; i < TICKS_PER_YEAR; i++) {
    world.step()
    const d = world.lastDispatch
    if (!d) continue
    const load = d.totalDemandMw + d.totalLossMw
    if (load > peak) peak = load
    let available = 0
    for (const plant of world.plants) {
      if (!isDispatchable(plant) || !plant.online) continue
      if (PLANT_TYPES[plant.typeId].heatOnly) continue
      available += world.params.get(plant.id, Param.CapacityMw) * world.params.getOr(plant.id, Param.Availability, 1)
    }
    worstAvailable = Math.min(worstAvailable, available)
    servedMwh += d.totalDemandMw - d.totalUnservedMw
    if (d.totalUnservedMw > 0.01) {
      shortHours++
      unservedMwh += d.totalUnservedMw
    }
  }

  console.log(`\n${content.id}`)
  console.log(`  nameplate firm        ${Math.round(nameplate)} MW`)
  console.log(`  worst hour's fleet    ${Math.round(worstAvailable)} MW`)
  console.log(`  peak load (with loss) ${Math.round(peak)} MW`)
  console.log(`  margin on peak        ${(worstAvailable / peak).toFixed(2)}×`)
  console.log(`  year one short        ${shortHours} h, ${Math.round(unservedMwh)} MWh` +
    ` (${((unservedMwh / (unservedMwh + servedMwh)) * 100).toFixed(2)}%)`)
  console.log(`  cash after a year     ${Math.round(world.finances.cash / 1e6)}m`)
}
