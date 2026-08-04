import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'

const world = buildWorld(FIRST_REGION)
const prices: number[] = []
for (let i = 0; i < 24 * 90; i++) prices.push(world.step().pricePerMwh)

const counts = new Map<string, number>()
for (const p of prices) {
  const key = p.toFixed(1)
  counts.set(key, (counts.get(key) ?? 0) + 1)
}
console.log('distinct price levels:', counts.size)
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  €${k.padStart(8)}/MWh  ${((v / prices.length) * 100).toFixed(1)}% of hours`)
}
const sorted = [...prices].sort((a, b) => a - b)
const pct = (p: number) => sorted[Math.round(p * (sorted.length - 1))]!
console.log(`\np20 €${pct(0.2).toFixed(2)}  p30 €${pct(0.3).toFixed(2)}  p50 €${pct(0.5).toFixed(2)}  p70 €${pct(0.7).toFixed(2)}  p85 €${pct(0.85).toFixed(2)}`)
console.log(`p70 / p30 = ${(pct(0.7) / Math.max(0.01, pct(0.3))).toFixed(3)}   (policy needed >= 1.25 to act at all)`)
