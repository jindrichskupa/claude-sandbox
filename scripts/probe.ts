/**
 * Diagnostic run. Not a test — a way to look at whether the opening scenario is actually
 * an interesting situation rather than merely a working one.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { PLANT_TYPES } from '../src/content/plantTypes'
import { LINE_TYPES } from '../src/content/lineTypes'
import { Param } from '../src/sim/params/types'

const world = buildWorld(FIRST_REGION)

let peakDemand = 0
let minDemand = Infinity
let unservedTicks = 0
let totalUnserved = 0
let totalDemand = 0
let totalLoss = 0
const genByPlant = new Map<string, number>()
const congestedTicks = new Map<string, number>()
let priceSum = 0
let priceMax = 0

const YEARS = 3
for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) {
  const s = world.step()
  const d = world.lastDispatch!
  peakDemand = Math.max(peakDemand, s.demandMw)
  minDemand = Math.min(minDemand, s.demandMw)
  totalDemand += s.demandMw
  totalLoss += s.lossMw
  if (s.unservedMw > 0.01) {
    unservedTicks++
    totalUnserved += s.unservedMw
  }
  priceSum += s.pricePerMwh
  priceMax = Math.max(priceMax, s.pricePerMwh)

  for (const [id, mw] of d.generationMw) genByPlant.set(id, (genByPlant.get(id) ?? 0) + mw)

  for (const edge of world.network.allEdges()) {
    const flow = Math.abs(d.lineFlowMw.get(edge.id) ?? 0)
    const cap = edge.kv === 0 ? 0 : LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
    if (cap > 0 && flow > cap * 0.97) congestedTicks.set(edge.id, (congestedTicks.get(edge.id) ?? 0) + 1)
  }
}

const ticks = TICKS_PER_YEAR * YEARS
const fmtEur = (x: number) => `€${(x / 1e6).toFixed(1)}m`

console.log(`=== ${FIRST_REGION.id}: ${YEARS} years ===\n`)
console.log(`Demand      peak ${peakDemand.toFixed(0)} MW / mean ${(totalDemand / ticks).toFixed(0)} MW / min ${minDemand.toFixed(0)} MW`)
console.log(`Peak/mean   ${(peakDemand / (totalDemand / ticks)).toFixed(2)}`)
console.log(`Losses      ${((totalLoss / totalDemand) * 100).toFixed(2)}% of demand`)
console.log(`Unserved    ${unservedTicks} h (${((unservedTicks / ticks) * 100).toFixed(2)}% of hours), ${(totalUnserved / 1000).toFixed(1)} GWh`)
console.log(`Price       mean €${(priceSum / ticks).toFixed(1)}/MWh, max €${priceMax.toFixed(0)}/MWh`)
console.log(`\nCash        ${fmtEur(world.finances.cash)}   Debt ${fmtEur(world.finances.debt)}   Bankrupt: ${world.finances.bankrupt}`)
console.log(`Opinion     ${(world.state.publicOpinion * 100).toFixed(0)}%`)

console.log(`\nCapacity factors:`)
for (const plant of world.plants) {
  const type = PLANT_TYPES[plant.typeId]
  const cap = type.capacityMw.value
  const cf = (genByPlant.get(plant.id) ?? 0) / (cap * ticks)
  const age = ((world.tick - plant.commissionedTick) / TICKS_PER_YEAR).toFixed(0)
  console.log(
    `  ${plant.id.padEnd(16)} ${type.id.padEnd(8)} ${String(cap).padStart(5)} MW  CF ${(cf * 100).toFixed(1).padStart(5)}%  age ${age}y  cond ${(plant.conditionPct * 100).toFixed(0)}%`,
  )
}

console.log(`\nCongested lines (>97% loaded):`)
if (congestedTicks.size === 0) console.log('  none')
for (const [id, n] of [...congestedTicks].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(26)} ${((n / ticks) * 100).toFixed(1)}% of hours`)
}

console.log(`\nNodal price spread (last tick):`)
const d = world.lastDispatch!
const prices = [...d.nodalPrice.entries()].sort((a, b) => b[1] - a[1])
for (const [node, p] of prices.slice(0, 4)) console.log(`  ${node.padEnd(16)} €${p.toFixed(2)}/MWh`)
console.log(`  ...`)
for (const [node, p] of prices.slice(-2)) console.log(`  ${node.padEnd(16)} €${p.toFixed(2)}/MWh`)

console.log(`\nAvailable capacity now: ${world.availableCapacityMw().toFixed(0)} MW`)
console.log(`Efficiency of Old Harbour: base ${PLANT_TYPES.coal.efficiency.value} -> effective ${world.params.get('p_oldharbour', Param.Efficiency).toFixed(4)}`)
