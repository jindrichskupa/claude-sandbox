/**
 * What the price actually does, and what sets it.
 *
 * Two complaints to test. That the price reaches zero while a lignite fleet is running — which
 * cannot be right, because the fuel is being bought and burnt in that hour. And that the daily
 * shape is too sharp for a system with a 24-hour industrial base.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { PLANT_TYPES } from '../src/content/plantTypes'
import { availableRange, marginalCostPerMwh } from '../src/sim/dispatch/dispatch'
import { isDispatchable } from '../src/sim/assets/types'

const world = buildWorld(FIRST_REGION)
const prices: number[] = []
let mustRunHours = 0
let floorSum = 0
let demandSum = 0
const hours = 8760

for (let i = 0; i < hours; i++) {
  world.step()
  const d = world.lastDispatch
  if (!d) continue
  prices.push(world.systemPricePerMwh)

  // Sum of the technical minima of everything that is running, against demand.
  let floor = 0
  let cheapest = Infinity
  for (const plant of world.plants) {
    if (!isDispatchable(plant)) continue
    if ((d.generationMw.get(plant.id) ?? 0) <= 0.5) continue
    const range = availableRange(plant, world.params, world.lastHeat?.commitments.get(plant.id))
    floor += range.floor
    cheapest = Math.min(cheapest, marginalCostPerMwh(plant, world.params, world.carbonPriceInForce()))
  }
  floorSum += floor
  demandSum += d.totalDemandMw
  if (floor >= d.totalDemandMw) mustRunHours++
}

prices.sort((a, b) => a - b)
const pct = (p: number) => prices[Math.floor((prices.length - 1) * p)]!.toFixed(1)
console.log(`hours measured: ${prices.length}`)
console.log(`price percentiles: min=${pct(0)} p5=${pct(0.05)} p25=${pct(0.25)} median=${pct(0.5)} ` +
  `p75=${pct(0.75)} p95=${pct(0.95)} max=${pct(1)}`)
console.log(`hours at or below zero: ${prices.filter((p) => p <= 0.01).length}`)
console.log(`hours where technical minima alone cover demand: ${mustRunHours}`)
console.log(`average of those minima: ${(floorSum / prices.length).toFixed(0)} MW against demand ${(demandSum / prices.length).toFixed(0)} MW`)
