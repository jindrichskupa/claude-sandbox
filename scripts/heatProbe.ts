/** How loaded the heat mains actually get over a year. A diagnostic, not a test. */
import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { HEAT_PIPE_TYPES } from '../src/content/heatPipeTypes'

const w = buildWorld(FIRST_REGION)
const buckets = new Map<string, number[]>()
for (let i = 0; i < 8760; i++) {
  w.step()
  const heat = w.lastHeat
  if (!heat) continue
  for (const e of w.network.allEdges()) {
    if (e.commodity !== 'heat' || e.dn === undefined) continue
    const cap = HEAT_PIPE_TYPES[e.dn].capacityMwth.value * Math.max(1, e.circuits)
    const load = Math.abs(heat.pipeFlowMw.get(e.id) ?? 0) / cap
    if (!buckets.has(e.id)) buckets.set(e.id, [])
    buckets.get(e.id)!.push(load)
  }
}
for (const [id, xs] of buckets) {
  xs.sort((a, b) => a - b)
  const q = (p: number) => xs[Math.floor(p * (xs.length - 1))]!.toFixed(3)
  console.log(id.padEnd(24), 'min', q(0), 'p25', q(0.25), 'med', q(0.5), 'p75', q(0.75), 'max', q(1))
}
