/** Wind exposure on land versus at sea. A diagnostic, not a test. */
import { generateTerrain, Tile, windSiteFactor, windIndexAt } from '../src/sim/map/terrain'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'

const m = generateTerrain(FIRST_REGION.seed, FIRST_REGION.mapWidth, FIRST_REGION.mapHeight)
const land: number[] = []
const sea: number[] = []
for (let y = 0; y < m.height; y++) {
  for (let x = 0; x < m.width; x++) {
    const v = windIndexAt(m, x, y)
    ;(m.tiles[y * m.width + x] === Tile.Water ? sea : land).push(v)
  }
}
const stat = (name: string, xs: number[]) => {
  xs.sort((a, b) => a - b)
  const q = (p: number) => xs[Math.floor(p * (xs.length - 1))]!
  console.log(
    name.padEnd(6), 'n', String(xs.length).padStart(4),
    'p10', q(0.1).toFixed(2), 'med', q(0.5).toFixed(2), 'p90', q(0.9).toFixed(2), 'max', q(1).toFixed(2),
    '| site factor med', windSiteFactor(m, 0, 0) && (0.65 + 0.7 * q(0.5)).toFixed(2),
    'max', (0.65 + 0.7 * q(1)).toFixed(2),
  )
}
stat('land', land)
stat('sea', sea)
const buildable = land.filter((v) => v >= 0.5)
console.log('land tiles passing the onshore exposure test:', buildable.length, 'of', land.length)
