import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { Param } from '../src/sim/params/types'
import { isDispatchable, LifecyclePhase } from '../src/sim/assets/types'
import { PLANT_TYPES } from '../src/content/plantTypes'

const w = buildWorld(FIRST_REGION)
console.log('year peak(MW) firm(MW) alive unserved%  retiringSoon')
let peak = 0
let unserved = 0
let served = 0
for (let y = 0; y < 31; y++) {
  peak = 0; unserved = 0; served = 0
  for (let i = 0; i < TICKS_PER_YEAR; i++) {
    w.step()
    const r = w.lastDispatch!
    peak = Math.max(peak, r.totalDemandMw)
    unserved += r.totalUnservedMw
    served += r.totalDemandMw - r.totalUnservedMw
  }
  let firm = 0, alive = 0, soon = 0
  for (const p of w.plants) {
    if (!isDispatchable(p)) continue
    alive++
    if (PLANT_TYPES[p.typeId].weatherDependence === 'none') firm += w.params.get(p.id, Param.CapacityMw)
    const age = (w.tick - p.commissionedTick) / TICKS_PER_YEAR
    if (age > p.designLifeYears * (1 + p.lifeExtension) - 5) soon++
  }
  console.log(
    `${w.date.year} ${peak.toFixed(0).padStart(7)} ${firm.toFixed(0).padStart(7)} ${String(alive).padStart(5)} ` +
    `${((unserved / Math.max(1, served + unserved)) * 100).toFixed(2).padStart(8)}  ${soon}`)
}
