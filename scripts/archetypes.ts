/**
 * Four utilities with incompatible convictions, on the same map, in the same weather.
 *
 * The neutrality claim in this project is enforced mechanically wherever it can be: every number
 * in `content/` carries its source, no modifier can be registered without an origin that shows up
 * in the interface, and the policy table is tested for balance on both sides. What none of that
 * reaches is the *shape* of the content taken together — whether the costs, the carbon price, the
 * tariff and the weather add up to a game in which one technology is the answer and the rest are
 * decoration. That is not a property of any single number and cannot be checked by looking at one.
 *
 * It can be measured by playing. Each archetype below refuses to consider most of what the game
 * offers; each is run through the whole scenario on the same seed; and the four outcomes are put
 * side by side. What the comparison can prove is narrow and worth being precise about:
 *
 *   - If every archetype ends the same way, the archetypes are not really different and this
 *     measures nothing.
 *   - If exactly one survives, the content has an answer and the rest is decoration. That is the
 *     failure this exists to catch.
 *   - If several survive by different routes and with different failings, the scenario has more
 *     than one strategy in it, which is the most this can honestly say.
 *
 * It cannot prove the numbers are *right*. A scenario where three archetypes fail may be a
 * scenario with hard, specific, defensible constraints — the opening one is a brownfield grid with
 * an ageing lignite fleet behind a single corridor, and a utility that will build nothing that
 * burns has genuinely inherited somebody else's problem. Reading the failures is the point;
 * automatic judgement is not on offer.
 *
 * Run: npx tsx scripts/archetypes.ts [scenarioId] [untilYear]
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { scenarioById } from '@content/scenarios'
import { ARCHETYPES, playScenario, type PlayResult } from '../tests/autoPlayer'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'

// Which grid to play. There are three now, and a comparison that can only ever be run on the
// first one measures the neutrality of a third of the content.
const content = scenarioById(process.argv[2] ?? '') ?? FIRST_REGION
const untilYear = Number(process.argv[3]) || content.endYear

/** What it actually put in the ground, counted by technology, from the build log. */
function fleetAdded(result: PlayResult): string {
  const counts = new Map<string, number>()
  for (const line of result.built) {
    const typeId = line.split(': ')[1]?.split(' ')[0] ?? '?'
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }
  return [...counts].map(([id, n]) => `${id}×${n}`).join(' ') || '—'
}

const results: PlayResult[] = []
for (const strategy of ARCHETYPES) {
  const world = buildWorld(content)
  const started = Date.now()
  const result = playScenario(world, { strategy, untilYear })
  results.push(result)

  console.log(`\n=== ${strategy.id} ${'='.repeat(Math.max(0, 60 - strategy.id.length))}`)
  console.log(strategy.creed)
  console.log(
    `  ended ${result.year} ${result.outcome}${result.bankrupt ? ' (bankrupt)' : ''} ` +
      `in ${Math.round((Date.now() - started) / 1000)}s`,
  )
  console.log(`  built     ${fleetAdded(result)}`)
  console.log(`  retired   ${result.retired.length}`)
  console.log(`  cash      ${Math.round(result.cash / 1e6)}m   debt ${Math.round(result.debt / 1e6)}m`)
  console.log(`  peak      ${Math.round(result.peakDemandMw)} MW, planned ${Math.round(result.firmCapacityMw)} MW`)
  console.log(`  unserved  ${(result.unservedShare * 100).toFixed(3)}%`)
  console.log(`  carbon    ${result.carbonIntensity.toFixed(3)} t/MWh`)
  const failed = result.objectives.filter((o) => o.status === 'failed')
  console.log(`  objectives met ${result.objectives.filter((o) => o.status === 'met').length}/${result.objectives.length}` +
    (failed.length ? `, failed: ${failed.map((o) => o.id).join(', ')}` : ''))
}

// --- The comparison, which is the actual output ------------------------------
console.log(`\n${'='.repeat(70)}`)
console.log('strategy      end   outcome  unserved   carbon   cash    built')
for (const r of results) {
  console.log(
    `${r.strategy.padEnd(13)} ${String(r.year).padEnd(5)} ` +
      `${(r.bankrupt ? 'bankrupt' : r.outcome).padEnd(8)} ` +
      `${(r.unservedShare * 100).toFixed(2).padStart(6)}%  ` +
      `${r.carbonIntensity.toFixed(3).padStart(6)}  ` +
      `${(Math.round(r.cash / 1e6) + 'm').padStart(7)}  ${fleetAdded(r)}`,
  )
}

// Which technologies the content made anybody's answer, across every conviction. A technology no
// archetype ever chose is one the numbers have priced out of the game — which is a finding about
// the content, not about the players, and the neutrality test asks for exactly it.
const chosen = new Set<string>()
for (const r of results) for (const line of r.built) chosen.add(line.split(': ')[1]?.split(' ')[0] ?? '?')
const buildable = (Object.keys(PLANT_TYPES) as PlantTypeId[]).filter(
  (id) => !PLANT_TYPES[id].heatOnly && PLANT_TYPES[id].availableFromYear.value <= untilYear,
)
console.log(`\nchosen by somebody: ${[...chosen].sort().join(', ')}`)
console.log(`chosen by nobody:   ${buildable.filter((id) => !chosen.has(id)).sort().join(', ') || '—'}`)
