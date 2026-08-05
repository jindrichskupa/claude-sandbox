/**
 * Pacing and difficulty probe. Not a test — a way to answer four questions about whether the
 * game is any *fun*, which no assertion in the suite currently asks.
 *
 *   1. How often does something happen? A tycoon game lives or dies on the gap between decisions.
 *   2. How much is there to decide? Options offered, not options taken.
 *   3. Why does a competent player lose — is the reason one they could see and act on?
 *   4. How long does a scenario take in real time at each speed?
 *
 * The third is the one that matters most. A game that is hard because the player misjudged
 * something visible is a good game; one that is hard because of a constraint they were never
 * shown is a bad one, and the difference is not in the difficulty number.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { PLANT_TYPES, PLANT_TYPE_IDS } from '../src/content/plantTypes'
import { LINE_TYPES } from '../src/content/lineTypes'
import { Param } from '../src/sim/params/types'
import { NewsImportance } from '../src/sim/news/news'
import { isDispatchable } from '../src/sim/assets/types'
import { quotePlant } from '../src/sim/build/commands'
import { playScenario } from '../tests/autoPlayer'

const world = buildWorld(FIRST_REGION)
const YEARS = 30

/** Hours with a shortfall, split by whether the megawatts existed somewhere or not at all. */
let shortHours = 0
let shortMwh = 0
let capacityShortMwh = 0
let congestionShortMwh = 0
/** Longest run of hours with no Notable news at all. */
let quietRun = 0
let worstQuiet = 0
const notableByYear = new Map<number, number>()
const majorByYear = new Map<number, number>()
const choicesByYear = new Map<number, number>()

const started = Date.now()
for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) {
  world.step()
  const year = world.date.year

  const filed = world.news.drain()
  const notable = filed.filter((n) => n.importance >= NewsImportance.Notable).length
  const major = filed.filter((n) => n.importance >= NewsImportance.Major).length
  if (notable > 0) {
    notableByYear.set(year, (notableByYear.get(year) ?? 0) + notable)
    worstQuiet = Math.max(worstQuiet, quietRun)
    quietRun = 0
  } else {
    quietRun++
  }
  if (major > 0) majorByYear.set(year, (majorByYear.get(year) ?? 0) + major)
  choicesByYear.set(year, (choicesByYear.get(year) ?? 0) + world.director.state.pending.length)

  const result = world.lastDispatch
  if (!result || result.totalUnservedMw <= 0.01) continue

  shortHours++
  shortMwh += result.totalUnservedMw

  // Was the power available anywhere on the system? If the fleet could have covered the load and
  // did not, the binding constraint was the network rather than the generation — which is the
  // single most instructive fact the game could tell a player and currently tells them nothing
  // about.
  let availableMw = 0
  for (const plant of world.plants) {
    if (!isDispatchable(plant)) continue
    availableMw += world.params.get(plant.id, Param.CapacityMw) * world.params.get(plant.id, Param.Availability)
  }
  const demandMw = result.totalDemandMw + result.totalLossMw
  if (availableMw >= demandMw) congestionShortMwh += result.totalUnservedMw
  else capacityShortMwh += result.totalUnservedMw
}
const elapsedS = (Date.now() - started) / 1000

console.log('=== pace ===')
console.log(`${(TICKS_PER_YEAR * YEARS) / elapsedS} ticks/s headless`)
const years = [...notableByYear.keys()].sort()
let totalNotable = 0
let totalMajor = 0
for (const y of years) {
  totalNotable += notableByYear.get(y) ?? 0
  totalMajor += majorByYear.get(y) ?? 0
}
console.log(`notable items: ${totalNotable} over ${YEARS} years = ${(totalNotable / YEARS).toFixed(1)}/yr`)
console.log(`major items:   ${totalMajor} over ${YEARS} years = ${(totalMajor / YEARS).toFixed(1)}/yr`)
console.log(`longest gap with nothing notable: ${worstQuiet} hours = ${(worstQuiet / 24 / 30).toFixed(1)} months`)
console.log('per year:', years.map((y) => `${y}:${notableByYear.get(y) ?? 0}`).join(' '))

console.log('\n=== how hard, and why ===')
console.log(`hours with a shortfall: ${shortHours} of ${TICKS_PER_YEAR * YEARS} = ${((shortHours / (TICKS_PER_YEAR * YEARS)) * 100).toFixed(2)}%`)
console.log(`unserved: ${Math.round(shortMwh)} MWh`)
if (shortMwh > 0) {
  console.log(`  not enough plant:      ${((capacityShortMwh / shortMwh) * 100).toFixed(1)}%`)
  console.log(`  behind a constraint:   ${((congestionShortMwh / shortMwh) * 100).toFixed(1)}%`)
}
console.log('outcome:', world.outcome, 'bankrupt:', world.finances.bankrupt)
console.log('objectives:', world.objectives.map((o) => `${o.id}:${o.status}`).join(' '))

console.log('\n=== how much is on offer ===')
const buildable = PLANT_TYPE_IDS.filter((id) => quotePlant(world, id, 0, 0).reasonKey !== 'build.notYetAvailable')
console.log(`plant types unlocked by ${world.date.year}: ${buildable.length} of ${PLANT_TYPE_IDS.length}`)
console.log(`  ${buildable.map((id) => PLANT_TYPES[id].nameKey.replace('plant.', '')).join(', ')}`)
console.log(`voltages: ${Object.keys(LINE_TYPES).length}, plus substations at each`)
const totalChoices = [...choicesByYear.values()].reduce((a, b) => a + b, 0)
console.log(`event decisions pending, summed over hours: ${totalChoices} (a proxy for how often one is open)`)

// The same split for a player who actually plays. The passive figures above are the floor — a
// fleet left to age out runs out of megawatts, and of course it does. What matters for difficulty
// is why a *competent* player still fails, because that is the reason the game will be judged on.
console.log('\n=== the same, but played ===')
{
  const played = buildWorld(FIRST_REGION)
  let capacity = 0
  let congestion = 0
  let hours = 0
  playScenario(played, {
    onTick: () => {
      const r = played.lastDispatch
      if (!r || r.totalUnservedMw <= 0.01) return
      hours++
      let availableMw = 0
      for (const plant of played.plants) {
        if (!isDispatchable(plant)) continue
        availableMw +=
          played.params.get(plant.id, Param.CapacityMw) * played.params.get(plant.id, Param.Availability)
      }
      if (availableMw >= r.totalDemandMw + r.totalLossMw) congestion += r.totalUnservedMw
      else capacity += r.totalUnservedMw
    },
  })
  const total = capacity + congestion
  console.log('outcome:', played.outcome, 'in', played.date.year, 'bankrupt:', played.finances.bankrupt)
  console.log(`hours short: ${hours}, unserved ${Math.round(total)} MWh`)
  if (total > 0) {
    console.log(`  not enough plant:    ${((capacity / total) * 100).toFixed(1)}%`)
    console.log(`  behind a constraint: ${((congestion / total) * 100).toFixed(1)}%`)
  }
}

console.log('\n=== real time ===')
for (const [speed, label] of [
  [1, '1x'],
  [3, '3x'],
  [10, '10x'],
  [50, '50x'],
] as const) {
  // The loop runs 2.4 ticks a second per unit of speed.
  const ticksPerSecond = 2.4 * speed
  const minutesPerYear = TICKS_PER_YEAR / ticksPerSecond / 60
  console.log(`${label}: ${minutesPerYear.toFixed(1)} min per game year, ${((minutesPerYear * YEARS) / 60).toFixed(1)} h for the scenario`)
}
