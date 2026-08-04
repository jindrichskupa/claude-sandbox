/**
 * How much does unserved energy vary between runs that differ only trivially?
 *
 * This decides whether a comparison between two worlds means anything. Forced outages are
 * seeded, but which plant runs in a given hour feeds back into wear, which feeds back into
 * outage probability — so two worlds that start almost identically can drift apart on their
 * own. If that drift is as large as the effect being measured, the measurement is worthless.
 */
import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'

function run(seed: number) {
  const world = buildWorld({ ...FIRST_REGION, startYear: 2020, seed })
  for (let i = 0; i < 24 * 30; i++) world.step()
  let unserved = 0
  for (let i = 0; i < TICKS_PER_YEAR * 2; i++) unserved += world.step().unservedMw
  return unserved
}

const seeds = [20250803, 20250804, 20250805, 11111, 22222, 33333]
const results = seeds.map((s) => ({ seed: s, unserved: run(s) }))
for (const r of results) console.log(`  seed ${String(r.seed).padStart(9)}  ${r.unserved.toFixed(0).padStart(7)} MWh`)
const values = results.map((r) => r.unserved)
const mean = values.reduce((a, b) => a + b, 0) / values.length
const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
console.log(`\nmean ${mean.toFixed(0)} MWh, standard deviation ${sd.toFixed(0)} MWh`)
console.log(`range ${Math.min(...values).toFixed(0)} .. ${Math.max(...values).toFixed(0)} MWh`)
