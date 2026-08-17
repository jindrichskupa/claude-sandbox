/**
 * One archetype, one scenario, one line per year.
 *
 * `archetypes.ts` plays all five convictions and prints a table at the end, which is the right
 * output for "does this scenario have more than one strategy in it" and the wrong one for "when
 * does the money turn". Five runs over thirty-five years of a fifty-eight unit fleet is also long
 * enough to be killed before it prints anything, and a comparison that dies at the ninety-ninth
 * per cent tells you nothing at all.
 *
 * So: one strategy per invocation, streaming. The output is `playScenario`'s own yearly line —
 * capacity, peak, cash, debt, tariff, carbon price, government — which is the record needed to
 * answer whether a scenario's opening position is too comfortable and, if it is, in which year it
 * stops being so.
 *
 * ## What it found the first time it was run
 *
 * The question was whether the Czech 2015 scenario's inherited solar, on a real 490 EUR/MWh
 * feed-in tariff, made the opening position too rich. It does not: the same six years played with
 * `feedInTariffs: {}` end on the same euro. The player owns both sides of the contract, so revenue
 * is the tariff times energy delivered and the guaranteed price never appears in it.
 *
 * What is too rich is the regulated tariff, in every scenario. `least-cost` on czechia-2015 goes
 * from 950m cash against 2600m debt to 30.8bn cash against none by 2037, and all five archetypes
 * are debt-free with between 12 and 31bn by the middle of the 2030s. The revenue requirement pays
 * out depreciation on a modern-equivalent rate base as free cash flow, so profit is depreciation
 * plus the allowed return, guaranteed, every year. See the finding for what to do about it.
 *
 * Run: npx tsx scripts/cashLine.ts [scenarioId] [strategy] [untilYear]
 */
import { buildWorld } from '@sim/scenario/build'
import { scenarioById } from '@content/scenarios'
import { ARCHETYPES, playScenario } from '../tests/autoPlayer'

const scenarioId = process.argv[2] ?? 'czechia-2015'
const strategyName = process.argv[3] ?? 'least-cost'
const content = scenarioById(scenarioId)
if (!content) throw new Error(`no scenario ${scenarioId}`)
const untilYear = Number(process.argv[4]) || content.endYear

const strategy = ARCHETYPES.find((a) => a.id === strategyName)
if (!strategy) throw new Error(`no archetype ${strategyName}; have ${ARCHETYPES.map((a) => a.id).join(', ')}`)

console.log(`${scenarioId} / ${strategyName} / to ${untilYear}`)
const world = buildWorld(content)
const result = playScenario(world, {
  strategy,
  untilYear,
  onYear: (line) => console.log(line),
})

console.log(
  `\nend ${result.year} ${result.bankrupt ? 'BANKRUPT' : result.outcome}  ` +
    `cash ${Math.round(result.cash / 1e6)}m  debt ${Math.round(result.debt / 1e6)}m  ` +
    `unserved ${(result.unservedShare * 100).toFixed(2)}%  carbon ${result.carbonIntensity.toFixed(3)}`,
)
console.log(`objectives met ${result.objectives.filter((o) => o.status === 'met').length}/${result.objectives.length}`)
console.log(`built: ${result.built.length ? result.built.join('; ') : '—'}`)
