import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { isBuildable, windIndexAt } from '../src/sim/map/terrain'

const w = buildWorld(FIRST_REGION)
const values: number[] = []
for (let y = 0; y < w.scenario.mapHeight; y++)
  for (let x = 0; x < w.scenario.mapWidth; x++)
    if (isBuildable(w.terrain, x, y)) values.push(windIndexAt(w.terrain, x, y))

values.sort((a, b) => a - b)
const pct = (p: number) => values[Math.round(p * (values.length - 1))]!
console.log(`buildable tiles: ${values.length}`)
console.log(`wind index  min ${pct(0).toFixed(3)}  p10 ${pct(0.1).toFixed(3)}  p25 ${pct(0.25).toFixed(3)}  p50 ${pct(0.5).toFixed(3)}  p75 ${pct(0.75).toFixed(3)}  max ${pct(1).toFixed(3)}`)
for (const t of [0.3, 0.4, 0.45, 0.5, 0.55, 0.6]) {
  const n = values.filter((v) => v >= t).length
  console.log(`  threshold ${t.toFixed(2)} -> ${n} sites (${((n / values.length) * 100).toFixed(0)}%)`)
}
