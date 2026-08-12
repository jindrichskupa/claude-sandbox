/**
 * Why the nuclear archetype never builds a reactor.
 *
 * It ranks one ten thousand euros per megawatt-hour ahead of anything else, which is more than any
 * levelised cost the content can produce, so the preference is absolute. It then builds lignite.
 * Either the site search finds nowhere a reactor may stand, or the quote refuses it every time —
 * and the two have very different meanings. Nowhere to put one is a map; never affordable is the
 * content pricing a technology out of the game, which is exactly the thing the neutrality claim
 * says must not happen quietly.
 *
 * Run: npx tsx scripts/whyNoReactor.ts
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { PLANT_TYPES } from '@content/plantTypes'
import { quotePlant, quoteTargetFor } from '@sim/build/commands'
import { judgeSite } from '@sim/build/siting'
import { Param } from '@sim/params/types'
import { TICKS_PER_YEAR } from '@sim/core/time'

const world = buildWorld(FIRST_REGION)

// Every tile a reactor could stand on at all, before any question of money.
const sites: Array<{ x: number; y: number; quality: number }> = []
for (let y = 0; y < world.scenario.mapHeight; y++) {
  for (let x = 0; x < world.scenario.mapWidth; x++) {
    if (world.nodeNear(x, y, 1.5)) continue
    const verdict = judgeSite('nuclear', {
      terrain: world.terrain,
      network: world.network,
      cities: world.cities,
      x,
      y,
    })
    if (verdict.ok) sites.push({ x, y, quality: verdict.quality ?? 0 })
  }
}
console.log(`sites a reactor may stand on: ${sites.length}`)
if (sites.length) {
  const best = sites.sort((a, b) => b.quality - a.quality)[0]!
  console.log(`  best: ${best.x},${best.y} quality ${best.quality.toFixed(2)}`)
}

// And what it would cost, against what the utility has, over the years the scenario runs.
console.log('\nyear   cash      reactor capex   quote')
for (let year = 0; year < FIRST_REGION.endYear - FIRST_REGION.startYear; year += 3) {
  while (world.date.year < FIRST_REGION.startYear + year) world.step()
  const site = sites[0]
  if (!site) break
  const quote = quotePlant(world, 'nuclear', site.x, site.y)
  const capex =
    world.params.get(quoteTargetFor('nuclear'), Param.CapexPerKw) * PLANT_TYPES.nuclear.capacityMw.value * 1000
  console.log(
    `${world.date.year}   ${(Math.round(world.finances.cash / 1e6) + 'm').padStart(7)}   ` +
      `${(Math.round(capex / 1e6) + 'm').padStart(9)}       ` +
      `${quote.ok ? 'ok' : (quote.reasonKey ?? 'refused')}`,
  )
}

// The same crude levelised cost the players rank on, for the record.
const type = PLANT_TYPES.nuclear
const target = quoteTargetFor('nuclear')
const capital = (world.params.get(target, Param.CapexPerKw) * 1000) / type.designLifeYears.value
const fixed = world.params.get(target, Param.FixedOpexPerKwYear) * 1000
console.log(
  `\nnuclear at a 0.5 load factor: ` +
    `${((capital + fixed) / (0.5 * TICKS_PER_YEAR)).toFixed(1)} EUR/MWh before fuel`,
)
