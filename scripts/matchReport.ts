/**
 * Five utilities, one country, fifty-five years, year by year.
 *
 * The archetype comparison prints an outcome; this prints the *story* — what each strategy built
 * in each year, what that year cost, what it emitted, and what it was still standing on at the
 * end. Written for the argument rather than for the verdict, which is why it keeps the whole
 * yearbook instead of the last row of it.
 *
 * Emits JSON on stdout so a page can render it. Everything in it comes from the simulation's own
 * yearbook and build log; nothing here is computed a second way.
 *
 * Run: npx tsx scripts/matchReport.ts [scenarioId] [untilYear] > report.json
 */

import { buildWorld } from '@sim/scenario/build'
import { scenarioById } from '@content/scenarios'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { ARCHETYPES, playScenario } from '../tests/autoPlayer'
import { PLANT_TYPES } from '@content/plantTypes'
import { LifecyclePhase } from '@sim/assets/types'
import { ageYears } from '@sim/assets/aging'
import { Param } from '@sim/params/types'

const content = scenarioById(process.argv[2] ?? '') ?? FIRST_REGION
const untilYear = Number(process.argv[3]) || content.endYear

/** What a build-log line says, as data. `1998: ccgt at 67/MWh (financed)` */
function parseBuilt(line: string): { year: number; typeId: string; financed: boolean } | null {
  const m = /^(\d{4}): (\w+) at/.exec(line)
  if (!m) return null
  return { year: Number(m[1]), typeId: m[2]!, financed: line.includes('financed') }
}
function parseRetired(line: string): { year: number; what: string } | null {
  const m = /^(\d{4}): (.+)$/.exec(line)
  return m ? { year: Number(m[1]), what: m[2]! } : null
}

const report = {
  scenario: { id: content.id, startYear: content.startYear, endYear: untilYear },
  strategies: [] as unknown[],
}

for (const strategy of ARCHETYPES) {
  const world = buildWorld(content)
  const result = playScenario(world, { strategy, untilYear })

  const builtByYear = new Map<number, Record<string, number>>()
  for (const line of result.built) {
    const b = parseBuilt(line)
    if (!b) continue
    const row = builtByYear.get(b.year) ?? {}
    row[b.typeId] = (row[b.typeId] ?? 0) + 1
    builtByYear.set(b.year, row)
  }
  const retiredByYear = new Map<number, string[]>()
  for (const line of result.retired) {
    const r = parseRetired(line)
    if (!r) continue
    retiredByYear.set(r.year, [...(retiredByYear.get(r.year) ?? []), r.what])
  }

  // What is still standing on the last day, and how old it is. The difference between a utility
  // that renewed its fleet and one that merely outlived the scenario.
  const standing = world.plants
    .filter((p) => p.phase === LifecyclePhase.Operating && !PLANT_TYPES[p.typeId].heatOnly)
    .map((p) => ({
      typeId: p.typeId,
      name: p.name ?? p.id,
      mw: Math.round(world.params.get(p.id, Param.CapacityMw)),
      ageYears: Math.round(ageYears(p, world.tick)),
      designLifeYears: Math.round(p.designLifeYears),
      inherited: p.id.startsWith('p_built_') ? false : true,
    }))
    .sort((a, b) => b.mw - a.mw)

  report.strategies.push({
    id: strategy.id,
    creed: strategy.creed,
    outcome: result.bankrupt ? 'bankrupt' : result.outcome,
    endedYear: result.year,
    unservedShare: result.unservedShare,
    carbonIntensity: result.carbonIntensity,
    cash: result.cash,
    debt: result.debt,
    peakDemandMw: result.peakDemandMw,
    firmCapacityMw: result.firmCapacityMw,
    objectives: result.objectives,
    years: world.yearbook.map((y) => ({
      year: y.year,
      built: builtByYear.get(y.year) ?? {},
      retired: retiredByYear.get(y.year) ?? [],
      profit: y.profit,
      cash: y.cash,
      debt: y.debt,
      tariffPerMwh: y.tariffPerMwh,
      carbonIntensity: y.carbonIntensity,
      unservedShare: y.unservedShare,
      firmCapacityMw: y.firmCapacityMw,
      rooftopMw: y.rooftopMw,
      mixMwh: y.mixMwh,
      regimeId: y.regimeId,
    })),
    standing,
  })
  process.stderr.write(`${strategy.id}: ${result.year} ${result.bankrupt ? 'bankrupt' : result.outcome}\n`)
}

process.stdout.write(JSON.stringify(report))
