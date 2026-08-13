/**
 * Whether a financed reactor is a bad investment, or whether two of them are.
 *
 * The archetype comparison, with project finance available, has the nuclear utility build two
 * reactors and go bankrupt in 2010 — eight years earlier than the same utility managed without a
 * facility at all. That reads as "the reactor does not pay", and it might be. It might equally be
 * the harness: it takes one decision a month while it is short of capacity, and a facility removes
 * the cash gate that used to stop it, so it can commit to a second three-billion project while the
 * first is still a hole in the ground and earning nothing.
 *
 * Those two have opposite consequences. The first is a fact about the content. The second is a
 * missing covenant — no lender advances a second non-recourse facility to a sponsor who has not
 * begun repaying the first — and belongs in the model rather than in a conclusion about reactors.
 *
 * So: the same strategy, played three ways. Nothing else differs.
 *
 * Run: npx tsx scripts/oneReactorOrTwo.ts
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { scenarioById } from '@content/scenarios'
import { NUCLEAR_ZEALOT, playScenario, type Strategy } from '../tests/autoPlayer'
import { PLANT_TYPES } from '@content/plantTypes'

// Which grid to ask the question about. The answer for the opening scenario is settled; the
// second was authored to see whether a different starting position changes it.
const content = scenarioById(process.argv[2] ?? '') ?? FIRST_REGION

const variants: Array<{ label: string; strategy: Strategy }> = [
  {
    label: 'no facility at all',
    strategy: { ...NUCLEAR_ZEALOT, usesProjectFinance: false },
  },
  {
    // One reactor and no more. Not a strategy anybody would write down — it is a control, to
    // separate "the reactor does not pay" from "a crude planner bought two of them for a system
    // whose peak one and a half of them would cover".
    label: 'facility, one reactor only',
    strategy: {
      ...NUCLEAR_ZEALOT,
      id: 'nuclear-single',
      rank: (world, typeId, cost) => {
        if (PLANT_TYPES[typeId].category !== 'nuclear') return cost
        const already = world.plants.some((p) => PLANT_TYPES[p.typeId].category === 'nuclear')
        return already ? cost + 10_000 : cost - 10_000
      },
    },
  },
]

console.log(`${content.id}: ${content.startYear}–${content.endYear}`)
console.log('variant                    end   outcome    unserved   carbon   cash     debt     built')
for (const { label, strategy } of variants) {
  const world = buildWorld(content)
  const result = playScenario(world, { strategy })
  const counts = new Map<string, number>()
  for (const line of result.built) {
    const typeId = line.split(': ')[1]?.split(' ')[0] ?? '?'
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }
  console.log(
    `${label.padEnd(26)} ${String(result.year).padEnd(5)} ` +
      `${(result.bankrupt ? 'bankrupt' : result.outcome).padEnd(10)} ` +
      `${(result.unservedShare * 100).toFixed(2).padStart(6)}%  ` +
      `${result.carbonIntensity.toFixed(3).padStart(6)}  ` +
      `${(Math.round(result.cash / 1e6) + 'm').padStart(7)}  ` +
      `${(Math.round(world.finances.debt / 1e6) + 'm').padStart(7)}  ` +
      [...counts].map(([id, n]) => `${id}×${n}`).join(' '),
  )
  // When it committed, and to what. The gap between the two reactors is the whole question.
  for (const line of result.built) if (line.includes('financed')) console.log(`    ${line}`)
}
