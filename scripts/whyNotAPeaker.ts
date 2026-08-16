/**
 * What the auto-player's cost model sees, technology by technology.
 *
 * Written because five archetypes across four runs never once built a peaking turbine or a lignite
 * unit, and the neutrality rule says that if a technology is never a reasonable choice the numbers
 * are wrong. Before touching a number, this checks the instrument: the harness ranks candidates by
 * cost per megawatt-hour, and a peaker is not bought by the megawatt-hour.
 *
 * Prints both views. `€/MWh` is what the harness ranks on today. `€/kW-firm-yr` is the annual cost
 * of a megawatt that will answer in the worst hour of the year — which is the question a system
 * short of capacity is actually asking, and the one a peaker exists to answer.
 *
 * Run: npx tsx scripts/whyNotAPeaker.ts [scenarioId]
 */

import { buildWorld } from '@sim/scenario/build'
import { scenarioById } from '@content/scenarios'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { quoteTargetFor } from '@sim/build/commands'
import { Param } from '@sim/params/types'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { levelisedCost, screeningCostPerFirmKwYear } from '../tests/autoPlayer'

const content = scenarioById(process.argv[2] ?? '') ?? FIRST_REGION
const world = buildWorld(content)

/** The same load factors the harness assumes. Keyed on what the weather does to the plant. */
const LOAD_FACTOR: Record<string, number> = { none: 0.5, wind: 0.28, solar: 0.13, riverflow: 0.45 }
const CAPACITY_CREDIT: Record<string, number> = { none: 1, riverflow: 0.4, wind: 0.15, solar: 0.02 }

for (const year of [1995, 2010, 2025, 2040]) {
  while (world.date.year < year) for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
  console.log(`\n=== ${world.date.year}  carbon €${world.state.carbonPricePerTonne.toFixed(0)}/t  system price €${world.systemPricePerMwh.toFixed(0)}/MWh`)
  console.log('technology        €/MWh   €/kW-firm-yr   capex €/kW   assumed CF')
  const rows: Array<[string, number, number, number, number]> = []
  for (const id of Object.keys(PLANT_TYPES) as PlantTypeId[]) {
    const type = PLANT_TYPES[id]
    if (type.heatOnly) continue
    if (world.date.year < type.availableFromYear.value) continue
    const cf = LOAD_FACTOR[type.weatherDependence] ?? 0.5
    const perMwh = levelisedCost(world, id, cf)
    // What the harness now actually ranks on — the same function, not a copy of it, so this
    // table cannot drift away from the decision it is supposed to explain.
    const credit = CAPACITY_CREDIT[type.weatherDependence] ?? 1
    const perKwFirm = screeningCostPerFirmKwYear(world, id, credit)
    const capexPerKw = world.params.get(quoteTargetFor(id), Param.CapexPerKw)
    rows.push([id, perMwh, perKwFirm, capexPerKw, cf])
  }
  rows.sort((a, b) => a[1] - b[1])
  for (const [id, perMwh, perKwFirm, capex, cf] of rows) {
    const rankByFirm = [...rows].sort((a, b) => a[2] - b[2]).findIndex((r) => r[0] === id) + 1
    console.log(
      `${id.padEnd(16)} ${perMwh.toFixed(1).padStart(6)}  ${perKwFirm.toFixed(0).padStart(9)} (#${rankByFirm})  ` +
        `${capex.toFixed(0).padStart(9)}   ${(cf * 100).toFixed(0)}%`,
    )
  }
}
