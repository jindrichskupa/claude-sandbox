/**
 * What left the fleet, year by year, and what the lights going out was actually about.
 *
 * Written to answer "what happened between 2030 and 2035" on the Czech grid, which the annual
 * summary could only show as a number getting worse. The answer is three retirements — a reactor
 * in 2030 and a lignite unit in 2032 — and then a system that cannot follow its own load: over the
 * whole run, twenty-four thousand hours are short on *ramp* rather than on capacity, because what
 * survives to the end is a reactor and some hydro and none of it turns down and up with the
 * evening peak.
 *
 * Run: npx tsx scripts/whatDied.ts
 */
import { buildWorld } from '@sim/scenario/build'
import { CZECHIA_1995 } from '@content/scenarios/czechia1995'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { worstOf } from '@sim/reliability/shortfall'
import { PLANT_TYPES } from '@content/plantTypes'

const w = buildWorld({ ...CZECHIA_1995, endYear: 2050 })
let lastFirm = 0
for (let y = 0; y < 41; y++) {
  const before = new Set(w.plants.filter((p) => p.phase === LifecyclePhase.Operating).map((p) => p.id))
  for (let i = 0; i < TICKS_PER_YEAR; i++) w.step()
  const r = w.yearbook[w.yearbook.length - 1]!
  const lost = [...before].filter((id) => {
    const p = w.plants.find((q) => q.id === id)
    return !p || p.phase !== LifecyclePhase.Operating
  })
  if (r.year >= 2026 && r.year <= 2040) {
    const names = lost.map((id) => {
      const p = w.plants.find((q) => q.id === id)
      return `${p?.name ?? id} (${p ? PLANT_TYPES[p.typeId].nameKey.replace('plant.', '') : '?'})`
    })
    console.log(
      `${r.year}  firm ${Math.round(r.firmCapacityMw).toString().padStart(5)} MW ` +
        `(${(r.firmCapacityMw - lastFirm >= 0 ? '+' : '') + Math.round(r.firmCapacityMw - lastFirm)})  ` +
        `unserved ${(r.unservedShare * 100).toFixed(2).padStart(6)}%   lost: ${names.join(', ') || '—'}`,
    )
  }
  lastFirm = r.firmCapacityMw
}
console.log('\nwhy the lights went out, whole run:')
for (const { cause, tally } of w.shortfalls.ranked()) {
  const city = worstOf(tally.byCity)
  console.log(`  ${cause.padEnd(13)} ${String(tally.hours).padStart(6)} h  ${Math.round(tally.mwh).toString().padStart(9)} MWh  worst ${city?.id ?? '—'}`)
}
