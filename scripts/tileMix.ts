import { generateTerrain, Tile } from '../src/sim/map/terrain'
const names = ['Water','Plain','Forest','Hill','Mountain']
for (const seed of [20250803, 11111, 22222]) {
  const t = generateTerrain(seed, 40, 30)
  const counts = new Array(5).fill(0)
  for (const v of t.tiles) counts[v]++
  const total = t.tiles.length
  console.log(`seed ${seed}: ` + counts.map((c,i)=>`${names[i]} ${((c/total)*100).toFixed(0)}%`).join('  '))
}
