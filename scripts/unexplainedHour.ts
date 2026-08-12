/**
 * One hour the post-mortem cannot explain, in full.
 *
 * Thirty-six failing hours of the opening year come out `unexplained`: no island, enough plant on
 * the system, no corridor at its limit, and a town short anyway. "We do not know" is a bad thing
 * to tell a player, so this dumps everything about such an hour until it is one of those things
 * or a fourth thing worth naming.
 *
 * Run: npx tsx scripts/unexplainedHour.ts
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LINE_TYPES } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { isDispatchable } from '@sim/assets/types'
import { Param } from '@sim/params/types'

const world = buildWorld(FIRST_REGION)
let dumped = 0

for (let i = 0; i < TICKS_PER_YEAR && dumped < 2; i++) {
  const before = world.shortfalls.ranked().find((r) => r.cause === 'unexplained')?.tally.hours ?? 0
  world.step()
  const after = world.shortfalls.ranked().find((r) => r.cause === 'unexplained')?.tally.hours ?? 0
  if (after === before) continue

  const d = world.lastDispatch!
  const islands = world.electricIslands.get()
  dumped++
  console.log(`\n=== ${world.date.day}/${world.date.month + 1} ${world.date.hour}h, islands ${islands.count} ===`)
  console.log(
    `demand ${d.totalDemandMw.toFixed(0)} loss ${d.totalLossMw.toFixed(0)} aux ${d.totalAuxDemandMw.toFixed(0)} ` +
      `charge ${d.totalStorageChargeMw.toFixed(0)} generation ${d.totalGenerationMw.toFixed(0)} ` +
      `unserved ${d.totalUnservedMw.toFixed(1)}`,
  )

  console.log('short towns:')
  for (const [cityId, mw] of d.unservedMw) {
    if (mw <= 0.01) continue
    const city = world.cities.find((c) => c.id === cityId)!
    console.log(
      `  ${cityId} short ${mw.toFixed(1)} of ${((d.servedMw.get(cityId) ?? 0) + mw).toFixed(0)} MW ` +
        `island ${islands.islandOf.get(city.nodeId)}`,
    )
  }

  console.log('plant:')
  for (const plant of world.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (type.heatOnly) continue
    const out = d.generationMw.get(plant.id) ?? 0
    const cap = world.params.get(plant.id, Param.CapacityMw)
    const avail = world.params.getOr(plant.id, Param.Availability, 1)
    const usable = cap * avail
    if (!isDispatchable(plant)) continue
    console.log(
      `  ${plant.id.padEnd(16)} ${plant.typeId.padEnd(9)} out ${out.toFixed(0).padStart(5)} / ${usable.toFixed(0).padStart(5)} ` +
        `(nameplate ${cap.toFixed(0)}, avail ${(avail * 100).toFixed(0)}%) ` +
        `${plant.online ? '' : 'TRIPPED '}island ${islands.islandOf.get(plant.nodeId)}` +
        (out > 0.01 && out < usable * 0.99 ? '  <- held back' : ''),
    )
  }

  console.log('lines at or near their limit:')
  for (const edge of world.network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.kv === 0) continue
    const cap = LINE_TYPES[edge.kv].capacityMw.value * Math.max(1, edge.circuits)
    const flow = Math.abs(d.lineFlowMw.get(edge.id) ?? 0)
    const share = flow / cap
    if (!edge.energised) {
      console.log(`  ${edge.id.padEnd(24)} DE-ENERGISED${edge.faultUntilTick !== undefined ? ' (faulted)' : ''}`)
    } else if (share > 0.8) {
      console.log(`  ${edge.id.padEnd(24)} ${flow.toFixed(0)} / ${cap.toFixed(0)} MW = ${(share * 100).toFixed(1)}%`)
    }
  }
}
