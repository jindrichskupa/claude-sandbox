/** Prints the scenario terrain with node positions on it. A diagnostic, not a test. */
import { generateTerrain, Tile, riverIndexAt } from '../src/sim/map/terrain'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'

const m = generateTerrain(FIRST_REGION.seed, FIRST_REGION.mapWidth, FIRST_REGION.mapHeight)
const glyph = ['~', '.', 'f', 'h', 'M']
const marks = new Map<string, string>()
for (const n of FIRST_REGION.nodes) {
  marks.set(`${n.x},${n.y}`, n.kind === 'city' ? 'C' : n.kind === 'plant' ? 'P' : 'S')
}
let head = '    '
for (let x = 0; x < m.width; x++) head += x % 10 === 0 ? String(Math.floor(x / 10)) : x % 5 === 0 ? '+' : ' '
console.log(head)
for (let y = 0; y < m.height; y++) {
  let row = String(y).padStart(3) + ' '
  for (let x = 0; x < m.width; x++) {
    const k = marks.get(`${x},${y}`)
    if (k) { row += k; continue }
    const r = riverIndexAt(m, x, y)
    row += r > 0.35 ? 'r' : glyph[m.tiles[y * m.width + x]!]
  }
  console.log(row)
}
console.log('\nnodes:')
for (const n of FIRST_REGION.nodes) {
  console.log(n.id.padEnd(14), n.x, n.y, Tile[m.tiles[n.y * m.width + n.x]!], 'river', riverIndexAt(m, n.x, n.y).toFixed(2))
}
console.log('\nline lengths (tiles):')
const at = new Map(FIRST_REGION.nodes.map((n) => [n.id, n]))
for (const l of [...FIRST_REGION.lines, ...FIRST_REGION.heatPipes]) {
  const a = at.get(l.from)!, b = at.get(l.to)!
  console.log(l.id.padEnd(26), Math.hypot(a.x - b.x, a.y - b.y).toFixed(2))
}
