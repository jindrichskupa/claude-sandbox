/**
 * Where the undelivered energy actually comes from.
 *
 * The post-mortem probe turned up a number that does not fit the story I was about to write into
 * the interface: the opening scenario fails its reliability objective in its *first* year while
 * carrying 2530 MW of firm capacity against an average demand of 909 MW. A shortfall on a fleet
 * with that much headroom is not a capacity problem, and a post-mortem that said "your firm
 * capacity fell behind demand" would have been confidently wrong.
 *
 * So: for every hour that goes short, record what the system looked like.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { LINE_TYPES } from '../src/content/lineTypes'
import { isDispatchable } from '../src/sim/assets/types'
import { Param } from '../src/sim/params/types'
import { computeIslands } from '../src/sim/grid/islands'

const world = buildWorld(FIRST_REGION)

let shortHours = 0
let shortMwh = 0
const byCity = new Map<string, number>()
const causes = { stranded: 0, noCapacity: 0, corridor: 0, outage: 0, other: 0 }
const samples: string[] = []

for (let i = 0; i < TICKS_PER_YEAR; i++) {
  world.step()
  const d = world.lastDispatch
  if (!d || d.totalUnservedMw <= 0.01) continue
  shortHours++
  shortMwh += d.totalUnservedMw
  for (const [cityId, mw] of d.unservedMw) {
    if (mw > 0.01) byCity.set(cityId, (byCity.get(cityId) ?? 0) + mw)
  }

  // Available capacity at this hour, as the dispatch saw it.
  let available = 0
  let trippedMw = 0
  for (const plant of world.plants) {
    if (!isDispatchable(plant)) continue
    const mw = world.params.get(plant.id, Param.CapacityMw)
    if (plant.online) available += mw * world.params.getOr(plant.id, Param.Availability, 1)
    else trippedMw += mw
  }

  // Corridors at their limit.
  let saturated = 0
  for (const edge of world.network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.kv === 0 || !edge.energised) continue
    const cap = LINE_TYPES[edge.kv].capacityMw.value * Math.max(1, edge.circuits)
    if (Math.abs(d.lineFlowMw.get(edge.id) ?? 0) > cap * 0.98) saturated++
  }

  // The question the first three tests all failed to ask: is the short node even *connected* to
  // the generation? A faulted line splits the graph, and an island with 25 MW in it cannot be
  // helped by 2000 MW on the other side of the break.
  const parts = computeIslands(world.network, 'electric')
  let stranded = false
  if (parts.count > 1) {
    for (const [cityId, mw] of d.unservedMw) {
      if (mw <= 0.01) continue
      const city = world.cities.find((c) => c.id === cityId)!
      const island = parts.islandOf.get(city.nodeId)
      // Generation available inside that island only.
      let inside = 0
      for (const plant of world.plants) {
        if (!isDispatchable(plant)) continue
        if (parts.islandOf.get(plant.nodeId) !== island) continue
        inside += world.params.get(plant.id, Param.CapacityMw)
      }
      let need = 0
      for (const c of world.cities) {
        if (parts.islandOf.get(c.nodeId) !== island) continue
        need += (d.servedMw.get(c.id) ?? 0) + (d.unservedMw.get(c.id) ?? 0)
      }
      if (inside < need) stranded = true
    }
  }
  if (stranded) causes.stranded++
  else if (available < d.totalDemandMw) causes.noCapacity++
  else if (saturated > 0) causes.corridor++
  else if (trippedMw > 0) causes.outage++
  else causes.other++

  if (samples.length < 4) {
    samples.push(
      `${world.date.day}/${world.date.month} ${world.date.hour}h short=${d.totalUnservedMw.toFixed(0)}MW ` +
        `demand=${d.totalDemandMw.toFixed(0)} available=${available.toFixed(0)} tripped=${trippedMw.toFixed(0)} ` +
        `saturated=${saturated}`,
    )
  }
}

console.log('hours short in year one:', shortHours, 'of', TICKS_PER_YEAR)
console.log('undelivered MWh:', Math.round(shortMwh))
console.log('causes:', causes)
console.log('by city:', [...byCity].map(([c, mw]) => `${c}=${Math.round(mw)}`).join(' '))
console.log('samples:')
for (const s of samples) console.log('  ', s)
