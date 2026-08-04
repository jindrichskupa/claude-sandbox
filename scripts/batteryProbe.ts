import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { beginLineConstruction, beginPlantConstruction } from '../src/sim/build/commands'
import { LifecyclePhase } from '../src/sim/assets/types'

const world = buildWorld({ ...FIRST_REGION, startYear: 2020 })
const built = beginPlantConstruction(world, 'battery', 26, 24)
const plant = world.getPlant(built.plantId!)!
beginLineConstruction(world, plant.nodeId, 'n_rivermouth', 220, 1)
while (plant.phase !== LifecyclePhase.Operating) world.step()
for (let i = 0; i < 24 * 30; i++) world.step()

let shortWhileCharging = 0
let shortWhileEmpty = 0
let shortWhileHolding = 0
let shortTotal = 0
let socAtShortage = 0
let shortHours = 0

for (let i = 0; i < TICKS_PER_YEAR * 2; i++) {
  const snap = world.step()
  if (snap.unservedMw <= 0.01) continue
  shortTotal += snap.unservedMw
  shortHours++
  socAtShortage += plant.storageMwh
  const mode = world.lastStoragePlans.get(plant.id)?.mode ?? 'idle'
  if (mode === 'charging') shortWhileCharging += snap.unservedMw
  else if (plant.storageMwh < 1) shortWhileEmpty += snap.unservedMw
  else shortWhileHolding += snap.unservedMw
}

console.log(`shortage hours: ${shortHours}, total unserved ${shortTotal.toFixed(0)} MWh`)
console.log(`  while the battery was charging : ${shortWhileCharging.toFixed(0)} MWh`)
console.log(`  while it was empty             : ${shortWhileEmpty.toFixed(0)} MWh`)
console.log(`  while it still held charge     : ${shortWhileHolding.toFixed(0)} MWh`)
console.log(`mean state of charge during shortages: ${(socAtShortage / Math.max(1, shortHours)).toFixed(1)} MWh of 100`)
