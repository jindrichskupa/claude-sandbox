/**
 * The same grid, played past the year it is judged in.
 *
 * Written to answer a specific question — what does the Czech scenario look like in 2050 rather
 * than 2025 — and it found something that changes how the scenario should be read. A utility that
 * does nothing survives comfortably to about 2028 and is bankrupt by 2039 with half the country
 * dark. The whole difficulty of an inherited fleet built inside fifteen years of itself lands in
 * the decade *after* the scenario currently stops.
 *
 * It is also a caution about carbon intensity as a measure. The figure falls to zero in the last
 * year, and it is not decarbonisation: it is a system that has stopped generating.
 *
 * Run: npx tsx scripts/horizon.ts
 */
import { buildWorld } from '@sim/scenario/build'
import { CZECHIA_1995 } from '@content/scenarios/czechia1995'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { PLANT_TYPES } from '@content/plantTypes'

const content = { ...CZECHIA_1995, endYear: 2050 }
const w = buildWorld(content)
console.log('year  govt                  carbon  tariff  t/MWh  unserved  profit   cash    firm MW  roofs')
for (let y = 0; y < 56; y++) {
  for (let i = 0; i < TICKS_PER_YEAR; i++) w.step()
  const r = w.yearbook[w.yearbook.length - 1]!
  if (r.year % 5 === 0 || r.year === 2050 || w.finances.bankrupt) {
    console.log(
      `${r.year}  ${r.regimeId.padEnd(20)}  ${w.state.carbonPricePerTonne.toFixed(0).padStart(5)}  ` +
        `${r.tariffPerMwh.toFixed(0).padStart(5)}  ${r.carbonIntensity.toFixed(3)}  ` +
        `${(r.unservedShare * 100).toFixed(2).padStart(6)}%  ` +
        `${(Math.round(r.profit / 1e6) + 'm').padStart(7)}  ` +
        `${(Math.round(r.cash / 1e6) + 'm').padStart(7)}  ` +
        `${Math.round(r.firmCapacityMw).toString().padStart(6)}  ${Math.round(r.rooftopMw)}`,
    )
  }
  if (w.finances.bankrupt) { console.log('BANKRUPT'); break }
}
console.log('\nwhat is left standing in 2050:')
const alive = new Map<string, number>()
for (const p of w.plants) {
  if (p.phase !== LifecyclePhase.Operating) continue
  alive.set(p.typeId, (alive.get(p.typeId) ?? 0) + 1)
}
for (const [id, n] of [...alive].sort()) {
  console.log(`  ${id.padEnd(16)} ×${n}  design life ${PLANT_TYPES[id as never].designLifeYears.value} yr`)
}
