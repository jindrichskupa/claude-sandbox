import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { routeLine, straightRoute, simplifyRoute } from '../src/sim/grid/routing'
import { terrainCostFactor } from '../src/sim/map/terrain'

const w = buildWorld(FIRST_REGION)
console.log('route vs straight line, over the scenario network.')
console.log('A small negative saving is expected on uniform ground: the route is constrained to')
console.log('whole tiles and pays a small penalty for turning, neither of which the ideal straight')
console.log('line does. What matters is the saving where the terrain actually varies.\n')
console.log('line                        tiles  straight  cost x  saving')
for (const spec of FIRST_REGION.lines) {
  const a = w.network.requireNode(spec.from)
  const b = w.network.requireNode(spec.to)
  const routed = routeLine(w.terrain, a.x, a.y, b.x, b.y)
  const direct = straightRoute(w.terrain, a.x, a.y, b.x, b.y)
  const saving = (1 - routed.weightedLengthTiles / direct.weightedLengthTiles) * 100
  console.log(
    `${spec.id.padEnd(26)} ${routed.lengthTiles.toFixed(1).padStart(5)} ${direct.lengthTiles.toFixed(1).padStart(9)} ` +
      `${(routed.weightedLengthTiles / routed.lengthTiles).toFixed(2).padStart(6)} ${saving.toFixed(1).padStart(6)}%`,
  )
}
const a = w.network.requireNode('n_blackridge')
const b = w.network.requireNode('n_rivermouth')
const r = routeLine(w.terrain, a.x, a.y, b.x, b.y)
console.log(`\nlongest corridor: ${r.points.length} tiles, simplified to ${simplifyRoute(r).length} corners`)
console.log(`terrain cost along it: ${r.points.map((p) => terrainCostFactor(w.terrain, p.x, p.y).toFixed(1)).join(' ')}`)
