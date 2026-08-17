/**
 * When the inherited fleet runs out, unit by unit.
 *
 * Written while authoring the second Czech date, to answer a question the scenario file can only
 * assert: given the real commissioning years and the overhauls each unit has had, in what year does
 * each machine reach the end of its life — and do those years land where the file claims they do?
 *
 * The claim in `czechia2015.ts` is that the coal comes due between 2028 and 2044 as a *consequence*
 * of real dates plus one overhaul each, rather than as a schedule somebody wrote. This is how that
 * claim is checked. It reads the same `designLifeYears` and `lifeExtension` the simulation ages the
 * plant by, so it cannot politely agree with a comment the code disagrees with.
 *
 * Run: npx tsx scripts/fleetDates.ts [scenarioId]
 */
import { buildWorld } from '@sim/scenario/build'
import { scenarioById } from '@content/scenarios/index'
import { LifecyclePhase } from '@sim/assets/types'
import { PLANT_TYPES } from '@content/plantTypes'
import { TICKS_PER_YEAR } from '@sim/core/time'

const id = process.argv[2] ?? 'czechia-2015'
const content = scenarioById(id)
if (!content) throw new Error(`no scenario ${id}`)
const w = buildWorld(content)

type Row = { name: string; type: string; mw: number; due: number; age: number; overhauls: number }
const rows: Row[] = []

for (const p of w.plants) {
  const type = PLANT_TYPES[p.typeId]
  const life = p.designLifeYears * (1 + p.lifeExtension)
  const commissionedYear = content.startYear + p.commissionedTick / TICKS_PER_YEAR
  rows.push({
    name: p.name ?? p.id,
    type: type.nameKey.replace('plant.', ''),
    mw: Math.round(type.capacityMw.value * (1 + p.capacityUplift)),
    due: Math.round(commissionedYear + life),
    age: Math.round(content.startYear - commissionedYear),
    overhauls: p.refurbishments,
  })
}

rows.sort((a, b) => a.due - b.due)

console.log(`${id}: ${content.startYear}-${content.endYear}, ${rows.length} units\n`)
console.log('due    unit                       type          MW  age  overhauls')
for (const r of rows) {
  const inRun = r.due <= content.endYear ? ' ' : '·'
  console.log(
    `${inRun}${r.due}  ${r.name.padEnd(24)}  ${r.type.padEnd(12)}  ${String(r.mw).padStart(4)}  ` +
      `${String(r.age).padStart(3)}  ${r.overhauls}`,
  )
}

// The two headline figures a scenario author actually needs: how much of the opening fleet is gone
// by the end, and what the electrical capacity is on day one against the peak it has to cover.
const inside = rows.filter((r) => r.due <= content.endYear)
const electricMw = w.plants
  .filter((p) => p.phase !== LifecyclePhase.Decommissioned && !PLANT_TYPES[p.typeId].heatOnly)
  .reduce((sum, p) => sum + PLANT_TYPES[p.typeId].capacityMw.value * (1 + p.capacityUplift), 0)
const baseMw = content.cities.reduce((s, c) => s + c.baseDemandMw, 0)

console.log(
  `\n${inside.length} of ${rows.length} units come due inside the run ` +
    `(${inside[0]?.due}-${inside[inside.length - 1]?.due}).`,
)
console.log(`Electrical capacity on day one: ${Math.round(electricMw)} MW against ${baseMw} MW of base load.`)
