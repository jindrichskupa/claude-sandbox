/**
 * Why the system price sits at zero.
 *
 * A clearing price of nothing means the marginal unit — the last one dispatched — bid nothing.
 * That is right when the wind is free and demand is already covered, and it is wrong if it happens
 * every day in a fleet of lignite, coal and gas. This dumps the hours as they are, with the unit
 * that set the price in each one.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { PLANT_TYPES } from '../src/content/plantTypes'

const world = buildWorld(FIRST_REGION)

let zeroHours = 0
const setters = new Map<string, number>()
const byHour: number[][] = Array.from({ length: 24 }, () => [])
const samples: string[] = []

for (let i = 0; i < 8760 * 6; i++) {
  world.step()
  const d = world.lastDispatch
  if (!d) continue
  const price = world.systemPricePerMwh
  byHour[world.date.hour]!.push(price)
  if (price > 0.01) continue
  zeroHours++

  // Who was running, and what each would have bid.
  const running: string[] = []
  for (const plant of world.plants) {
    const mw = d.generationMw.get(plant.id) ?? 0
    if (mw <= 0.5) continue
    const type = PLANT_TYPES[plant.typeId]
    running.push(`${plant.id}(${type.fuel},${mw.toFixed(0)}MW)`)
    setters.set(plant.typeId, (setters.get(plant.typeId) ?? 0) + 1)
  }
  if (samples.length < 8) {
    samples.push(
      `${world.date.year}-${world.date.month + 1}-${world.date.day} ${world.date.hour}h ` +
        `demand=${d.totalDemandMw.toFixed(0)} gen=${d.totalGenerationMw.toFixed(0)} ` +
        `unserved=${d.totalUnservedMw.toFixed(0)} aborted=${d.aborted ?? false} | ${running.join(' ') || 'NOTHING RUNNING'}`,
    )
  }
}

console.log(`hours at zero: ${zeroHours} of ${8760 * 6}`)
// Median rather than mean: a handful of scarcity hours at thousands of euros drags an average
// into saying the evening is dearer than it typically is, which is the opposite of describing
// the shape.
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0 }
console.log('median price by hour of day:')
console.log(byHour.map((xs, h) => `${h}:${median(xs).toFixed(0)}`).join(' '))
const lows = byHour.map(median).filter((v) => v > 0)
console.log(`peak/trough on medians: ${(Math.max(...lows) / Math.min(...lows)).toFixed(1)}x`)
console.log('running when price was zero:', [...setters].map(([k, n]) => `${k}=${n}`).join(' '))
console.log('samples:')
for (const s of samples) console.log('  ', s)

// And what demand does over a day, which is the other half of the claim.
const demandByHour = new Array<number>(24).fill(0)
const counts = new Array<number>(24).fill(0)
for (const snap of world.recentHistory(24 * 7)) {
  demandByHour[snap.date.hour] += snap.demandMw
  counts[snap.date.hour]++
}
console.log('average demand by hour:')
console.log(demandByHour.map((sum, h) => `${h}:${(sum / Math.max(1, counts[h]!)).toFixed(0)}`).join(' '))
