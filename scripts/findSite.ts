/** Candidate coastal land tiles for the scenario's harbour nodes. A diagnostic, not a test. */
import { generateTerrain, Tile, waterAvailability } from '../src/sim/map/terrain'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'

const m = generateTerrain(FIRST_REGION.seed, FIRST_REGION.mapWidth, FIRST_REGION.mapHeight)
const tile = (x: number, y: number) => m.tiles[y * m.width + x]!
const nodes = FIRST_REGION.nodes
const river = FIRST_REGION.nodes.find((n) => n.id === 'n_rivermouth')!

const coastal = (x: number, y: number) => {
  if (tile(x, y) === Tile.Water || tile(x, y) === Tile.Mountain) return false
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const nx = x + dx!, ny = y + dy!
    if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue
    if (tile(nx, ny) === Tile.Water) return true
  }
  return false
}

const target = process.argv[2] ?? 'n_oldharbour'
const minFromRiver = Number(process.argv[3] ?? 4.5)
const maxFromRiver = Number(process.argv[4] ?? 8)

const out: Array<{ x: number; y: number; d: number; near: number }> = []
for (let y = 0; y < m.height; y++) {
  for (let x = 0; x < m.width; x++) {
    if (!coastal(x, y)) continue
    const d = Math.hypot(x - river.x, y - river.y)
    if (d < minFromRiver || d > maxFromRiver) continue
    let near = Infinity
    for (const n of nodes) {
      if (n.id === target) continue
      near = Math.min(near, Math.hypot(n.x - x, n.y - y))
    }
    if (near < Number(process.argv[5] ?? 3.5)) continue
    out.push({ x, y, d, near })
  }
}
out.sort((a, b) => b.near - a.near)
for (const c of out.slice(0, 14)) {
  console.log(`(${c.x},${c.y})`, Tile[tile(c.x, c.y)], 'from Rivermouth', c.d.toFixed(2), 'nearest other node', c.near.toFixed(2), 'water', waterAvailability(m, c.x, c.y, 2).toFixed(2))
}
