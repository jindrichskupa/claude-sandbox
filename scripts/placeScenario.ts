/**
 * Ground that will actually take what a scenario wants to put on it.
 *
 * Authoring a scenario means writing tile coordinates into a file, and the terrain is generated
 * from a seed rather than drawn — so every coordinate is a guess until something checks it. The
 * first attempt at this was reading an ASCII dump and counting columns by eye, which is exactly
 * as reliable as it sounds.
 *
 * This asks the game instead. For each kind of site it walks the map, applies the same
 * `judgeSite` the build command applies, and reports the best few placements with their quality —
 * so the scenario is written against ground that has already agreed to hold it.
 *
 * Run: npx tsx scripts/placeScenario.ts <seed> [width] [height]
 */

import { generateTerrain, isBuildable, Tile, riverIndexAt } from '@sim/map/terrain'
import { judgeSite } from '@sim/build/siting'
import { PLANT_TYPE_IDS, PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { Network } from '@sim/grid/network'
import type { CityAsset } from '@sim/assets/types'

const seed = Number(process.argv[2]) || 19900101
const width = Number(process.argv[3]) || 44
const height = Number(process.argv[4]) || 32

const terrain = generateTerrain(seed, width, height)
// An empty network and no towns: what is being asked is what the *ground* allows, before
// anything has been placed on it. Siting rules that depend on what is already there — distance
// to demand, room around a station — are the scenario author's judgement, not the map's.
const network = new Network()
const cities: CityAsset[] = []

console.log(`seed ${seed}, ${width}×${height}`)

/** How much of the map each technology could stand on at all, which is the first thing to know. */
console.log('\nsites available, by technology')
for (const typeId of PLANT_TYPE_IDS) {
  const found: Array<{ x: number; y: number; quality: number }> = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const verdict = judgeSite(typeId, { terrain, network, cities, x, y })
      if (verdict.ok) found.push({ x, y, quality: verdict.quality ?? 0 })
    }
  }
  found.sort((a, b) => b.quality - a.quality)
  const best = found
    .slice(0, 6)
    .map((s) => `${s.x},${s.y}@${s.quality.toFixed(2)}`)
    .join('  ')
  console.log(`  ${typeId.padEnd(17)} ${String(found.length).padStart(4)} sites   ${best}`)
}

/**
 * Where a town could sit.
 *
 * Not a `judgeSite` question — nothing sites a city, the scenario places it — so the test is the
 * one a person would apply: buildable ground, not in the mountains, and near enough to water or
 * a river that a settlement there makes sense.
 */
console.log('\nplaces a town would plausibly be')
const townish: Array<{ x: number; y: number; note: string }> = []
for (let y = 1; y < height - 1; y++) {
  for (let x = 1; x < width - 1; x++) {
    if (!isBuildable(terrain, x, y)) continue
    const tile = terrain.tiles[y * width + x]!
    if (tile === Tile.Mountain || tile === Tile.Hill) continue
    let coast = false
    for (let dy = -2; dy <= 2 && !coast; dy++) {
      for (let dx = -2; dx <= 2 && !coast; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (terrain.tiles[ny * width + nx] === Tile.Water) coast = true
      }
    }
    const river = riverIndexAt(terrain, x, y) > 0.4
    if (coast || river) townish.push({ x, y, note: coast ? 'coast' : 'river' })
  }
}
// Thinned to a readable list: neighbouring tiles are all equally good and printing four hundred
// of them helps nobody.
const kept: Array<{ x: number; y: number; note: string }> = []
for (const site of townish) {
  if (kept.some((k) => Math.abs(k.x - site.x) < 5 && Math.abs(k.y - site.y) < 5)) continue
  kept.push(site)
}
for (const site of kept) console.log(`  ${String(site.x).padStart(2)},${String(site.y).padStart(2)}  ${site.note}`)

/** And the map itself, for a human to sanity-check the coordinates above against. */
console.log('\nterrain  (~ water, . plain, f forest, h hill, M mountain, R river)')
let head = '    '
for (let x = 0; x < width; x++) head += x % 10 === 0 ? String(Math.floor(x / 10)) : x % 5 === 0 ? '+' : ' '
console.log(head)
const glyph = ['~', '.', 'f', 'h', 'M']
for (let y = 0; y < height; y++) {
  let row = String(y).padStart(3) + ' '
  for (let x = 0; x < width; x++) {
    const tile = terrain.tiles[y * width + x]!
    if (tile === Tile.Water) row += '~'
    else if (riverIndexAt(terrain, x, y) > 0.5) row += 'R'
    else row += glyph[tile]
  }
  console.log(row)
}

/** What the catalogue says these cost, so a scenario can be sized against a real budget. */
console.log('\nwhat a unit of each costs today')
for (const typeId of PLANT_TYPE_IDS as PlantTypeId[]) {
  const type = PLANT_TYPES[typeId]
  const capex = type.capexPerKw.value * type.capacityMw.value * 1000
  console.log(
    `  ${typeId.padEnd(17)} ${String(Math.round(type.capacityMw.value)).padStart(5)} MW  ` +
      `${(Math.round(capex / 1e6) + 'm').padStart(7)}  ${String(Math.round(type.buildTimeMonths.value)).padStart(3)} months` +
      `  from ${type.availableFromYear.value}`,
  )
}
