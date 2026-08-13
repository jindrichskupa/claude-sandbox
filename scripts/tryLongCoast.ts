/**
 * Does the second scenario play at all, and does a reactor make sense in it?
 *
 * The one question it was authored to answer. `scripts/oneReactorOrTwo.ts` showed a financed
 * reactor makes the *opening* scenario worse; this grid was built to give a seventy-seven-month
 * build somewhere to go. If the answer here is the same, the scenario has not done its job and
 * saying so is the point of running it.
 *
 * Run: npx tsx scripts/tryLongCoast.ts
 */

import { buildWorld } from '@sim/scenario/build'
import { LONG_COAST } from '@content/scenarios/longCoast'
import { ARCHETYPES, playScenario } from '../tests/autoPlayer'

console.log('strategy      end   outcome    unserved   carbon   cash      built')
for (const strategy of ARCHETYPES) {
  const world = buildWorld(LONG_COAST)
  const started = Date.now()
  const result = playScenario(world, { strategy })
  const counts = new Map<string, number>()
  for (const line of result.built) {
    const typeId = line.split(': ')[1]?.split(' ')[0] ?? '?'
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }
  const failed = result.objectives.filter((o) => o.status === 'failed').map((o) => o.id)
  // What the load grew to, which is the number the capacity objective has to be set against.
  const peak = Math.round(result.peakDemandMw)
  console.log(
    `${result.strategy.padEnd(13)} ${String(result.year).padEnd(5)} ` +
      `${(result.bankrupt ? 'bankrupt' : result.outcome).padEnd(10)} ` +
      `${(result.unservedShare * 100).toFixed(2).padStart(6)}%  ` +
      `${result.carbonIntensity.toFixed(3).padStart(6)}  ` +
      `${(Math.round(result.cash / 1e6) + 'm').padStart(8)}  ` +
      `peak ${String(peak).padStart(4)} MW  ` +
      `${[...counts].map(([id, n]) => `${id}×${n}`).join(' ') || '—'}` +
      `   [${Math.round((Date.now() - started) / 1000)}s]` +
      (failed.length ? `  failed: ${failed.join(', ')}` : ''),
  )
}
