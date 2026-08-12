/**
 * What the heat business costs and what it earns.
 *
 * The content has carried `fixedOpexPerKmYear` for heat mains since they were written and nothing
 * has ever read it — the electric equivalent is charged monthly in `world.ts`, the heat one is
 * not. So a buried main is the one asset in the game that is free to own. This measures the size
 * of the hole, and whether the heat business is actually paying for itself once it is filled.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { HEAT_PIPE_TYPES } from '../src/content/heatPipeTypes'
import { PLANT_TYPES } from '../src/content/plantTypes'
import { TICKS_PER_YEAR } from '../src/sim/core/time'

const world = buildWorld(FIRST_REGION)

let uncharged = 0
let km = 0
for (const edge of world.network.allEdges()) {
  if (edge.commodity !== 'heat' || edge.dn === undefined) continue
  km += edge.lengthKm * Math.max(1, edge.circuits)
  uncharged += HEAT_PIPE_TYPES[edge.dn].fixedOpexPerKmYear.value * edge.lengthKm * Math.max(1, edge.circuits)
}
console.log(`heat mains: ${km.toFixed(0)} km, unbilled standing cost ${(uncharged / 1e6).toFixed(2)}m/yr`)

for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
const year = world.yearbook[0]
if (!year) throw new Error('no year closed')

// What the heat side earns, and what can be attributed to it. The plants that make heat are
// mostly cogeneration, so their fuel is shared — the honest figure here is the heat-only kit.
let heatOnlyFuel = 0
let heatOnlyFixed = 0
for (const plant of world.plants) {
  const type = PLANT_TYPES[plant.typeId]
  if (!type.heatOnly) continue
  const book = world.books.window(plant.id, 'lifetime')
  heatOnlyFuel += book.fuelCost + book.carbonCost + book.varOpex
  heatOnlyFixed += book.fixedOpex
}

console.log(`heat sold: ${(year.heatSoldMwh / 1000).toFixed(0)} GWh`)
console.log(`heat revenue: ${(year.heatSoldMwh * world.scenario.heatTariffPerMwh / 1e6).toFixed(1)}m`)
console.log(`heat-only plant, fuel and running: ${(heatOnlyFuel / 1e6).toFixed(1)}m, standing ${(heatOnlyFixed / 1e6).toFixed(1)}m`)
// What the mains were actually charged, out of their own books.
let charged = 0
for (const edge of world.network.allEdges()) {
  if (edge.commodity !== 'heat') continue
  charged += world.books.window(edge.id, 'lifetime').fixedOpex
}
// The two differ by the price level: the content is sourced at 2021 and the scenario opens in
// 1995, so what is charged is the deflated figure — the same treatment the electric corridor gets.
console.log(
  `mains standing cost: ${(uncharged / 1e6).toFixed(2)}m at 2021 prices, ` +
    `${(charged / 1e6).toFixed(2)}m charged at ${FIRST_REGION.startYear} prices ` +
    `(x${(charged / uncharged).toFixed(2)})`,
)

// And the pumping: real electricity, already modelled. Worth knowing how big it is beside it.
let pumping = 0
for (const mw of world.lastHeat?.pumpingDemandMw.values() ?? []) pumping += mw
console.log(`pumping right now: ${pumping.toFixed(2)} MW`)

// Which plants actually make the heat, and whether their books show anything at all.
console.log('heat producers:')
for (const plant of world.plants) {
  const type = PLANT_TYPES[plant.typeId]
  if (!type.heatOnly && !type.chp) continue
  const book = world.books.window(plant.id, 'lifetime')
  console.log(
    `   ${plant.id.padEnd(22)} ${type.heatOnly ? 'heat-only' : 'chp'} ` +
      `rev=${(book.revenue / 1e6).toFixed(1)}m fuel=${(book.fuelCost / 1e6).toFixed(1)}m ` +
      `fixed=${(book.fixedOpex / 1e6).toFixed(1)}m heatOut=${plant.heatOutputMw.toFixed(0)}MWth`,
  )
}
