/**
 * What the post-mortem would say, for a run nobody played.
 *
 * The classification it reports has to agree with `scripts/whereUnserved.ts`, which measured the
 * same year from outside the simulation and produced the finding this whole feature exists for:
 * 129 of 163 failing hours in year one are a network failure, not a generation one. If the version
 * recorded inside the tick disagrees with the version measured outside it, one of them is wrong
 * and the post-mortem is the one the player will read.
 *
 * Run: npx tsx scripts/postMortem.ts [years]
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { worstOf } from '@sim/reliability/shortfall'

const years = Number(process.argv[2]) || 1
const world = buildWorld(FIRST_REGION)
for (let i = 0; i < TICKS_PER_YEAR * years; i++) world.step()

for (const side of ['electric', 'heat'] as const) {
  const ranked = world.shortfalls.ranked(side)
  console.log(`\n${side}: ${Math.round(world.shortfalls.totalMwh(side))} MWh undelivered over ${years}y`)
  if (!ranked.length) {
    console.log('  nothing went short')
    continue
  }
  for (const { cause, tally } of ranked) {
    const city = worstOf(tally.byCity)
    console.log(
      `  ${cause.padEnd(13)} ${String(tally.hours).padStart(5)} h  ` +
        `${String(Math.round(tally.mwh)).padStart(7)} MWh  ` +
        `worst ${city ? `${city.id} (${Math.round(city.mwh)})` : '—'}`,
    )
    const lines = Object.entries(tally.byMissingLine).sort((a, b) => b[1] - a[1])
    for (const [edgeId, mwh] of lines) console.log(`      down: ${edgeId.padEnd(26)} ${Math.round(mwh)} MWh`)
  }
}
