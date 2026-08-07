/**
 * One hour that went short, in full.
 *
 * The cause histogram put all 163 of year one's short hours in "other": capacity was ample, no
 * corridor was at 98% of its rating, nothing had tripped. One of those three tests must be asking
 * the wrong question, so this dumps everything about a single hour instead of classifying it.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { LINE_TYPES } from '../src/content/lineTypes'
import { computeIslands } from '../src/sim/grid/islands'

const world = buildWorld(FIRST_REGION)
for (let i = 0; i < TICKS_PER_YEAR; i++) {
  world.step()
  const d = world.lastDispatch
  if (!d || d.totalUnservedMw <= 0.01) continue

  console.log(`=== ${world.date.day}/${world.date.month + 1} ${world.date.hour}h ===`)
  console.log('demand', d.totalDemandMw.toFixed(0), 'generated', d.totalGenerationMw.toFixed(0),
    'unserved', d.totalUnservedMw.toFixed(0), 'losses', d.totalLossMw.toFixed(1))

  console.log('short at:')
  for (const [cityId, mw] of d.unservedMw) {
    if (mw > 0.01) {
      const city = world.cities.find((c) => c.id === cityId)!
      console.log(`   ${city.name}: ${mw.toFixed(0)} MW short of ${(mw + (d.servedMw.get(cityId) ?? 0)).toFixed(0)}`)
    }
  }

  console.log('lines:')
  for (const edge of world.network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.kv === 0) continue
    const cap = LINE_TYPES[edge.kv].capacityMw.value * Math.max(1, edge.circuits)
    const flow = Math.abs(d.lineFlowMw.get(edge.id) ?? 0)
    const state = !edge.energised ? 'DEAD' : edge.faultUntilTick !== undefined ? 'FAULT' : ''
    console.log(`   ${edge.id.padEnd(24)} ${edge.kv}kV x${edge.circuits} ${flow.toFixed(0).padStart(5)}/${cap} ` +
      `${((flow / cap) * 100).toFixed(0).padStart(3)}% ${state}`)
  }

  const parts = computeIslands(world.network, 'electric')
  console.log('electric islands:', parts.count)
  for (const island of parts.members) console.log('   ', island.join(' '))

  console.log('running plants:')
  for (const p of world.plants) {
    if (Math.abs(p.outputMw) > 0.5) console.log(`   ${p.id} at ${p.nodeId}: ${p.outputMw.toFixed(0)} MW`)
  }
  break
}
