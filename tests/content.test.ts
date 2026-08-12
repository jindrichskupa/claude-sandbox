/**
 * Content provenance.
 *
 * This is the test that makes the neutrality claim real. Every number the simulation reads
 * has to say where it came from; a bare number in the content tree fails the build. It is a
 * much stronger guarantee than an intention, because it cannot be quietly forgotten.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSourced, SOURCES, type SourceId } from '@content/schema'
import { PLANT_TYPES, PLANT_TYPE_IDS } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { LINE_TYPES, VOLTAGE_LEVELS } from '@content/lineTypes'
import { ECONOMICS } from '@content/economics'
import { COST_TRENDS, PRICE_TRENDS, STANDARDISATION } from '@content/costTrends'

/** Fields that are legitimately plain values rather than measurements. */
const STRUCTURAL_KEYS = new Set([
  'id',
  'kv',
  'nameKey',
  'category',
  'fuel',
  'mode',
  'weatherDependence',
  'cooling',
])

interface Finding {
  path: string
  problem: string
}

/**
 * Walk a content object and report every numeric leaf that is not wrapped in `Sourced`.
 * Objects that *are* sourced values are not descended into.
 */
function findUnsourced(value: unknown, path: string, out: Finding[]): void {
  if (value === null || value === undefined) return
  if (isSourced(value)) {
    const s = value as { source: SourceId; sourceYear: number }
    if (!(s.source in SOURCES)) out.push({ path, problem: `unknown source "${s.source}"` })
    if (s.sourceYear < 1950 || s.sourceYear > 2100) {
      out.push({ path, problem: `implausible sourceYear ${s.sourceYear}` })
    }
    return
  }
  if (typeof value === 'number') {
    out.push({ path, problem: 'bare number with no source' })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findUnsourced(v, `${path}[${i}]`, out))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (STRUCTURAL_KEYS.has(k)) continue
      findUnsourced(v, `${path}.${k}`, out)
    }
  }
}

describe('content provenance', () => {
  it('every plant type parameter carries a source', () => {
    const findings: Finding[] = []
    findUnsourced(PLANT_TYPES, 'PLANT_TYPES', findings)
    expect(findings.map((f) => `${f.path}: ${f.problem}`)).toEqual([])
  })

  it('every fuel parameter carries a source', () => {
    const findings: Finding[] = []
    findUnsourced(FUELS, 'FUELS', findings)
    expect(findings.map((f) => `${f.path}: ${f.problem}`)).toEqual([])
  })

  it('every line and economic parameter carries a source', () => {
    const findings: Finding[] = []
    findUnsourced(LINE_TYPES, 'LINE_TYPES', findings)
    findUnsourced(ECONOMICS, 'ECONOMICS', findings)
    expect(findings.map((f) => `${f.path}: ${f.problem}`)).toEqual([])
  })

  it('every cost trend carries a source', () => {
    const findings: Finding[] = []
    findUnsourced(COST_TRENDS, 'COST_TRENDS', findings)
    findUnsourced(PRICE_TRENDS, 'PRICE_TRENDS', findings)
    findUnsourced(STANDARDISATION, 'STANDARDISATION', findings)
    expect(findings.map((f) => `${f.path}: ${f.problem}`)).toEqual([])
  })

  it('every capital cost splits into exactly one whole', () => {
    // A split that does not add up would silently rescale that technology's entire capital
    // cost, and it would look like a considered number while doing it.
    for (const id of PLANT_TYPE_IDS) {
      const s = COST_TRENDS[id].structure
      const total = s.equipment.value + s.labour.value + s.civil.value
      expect(total, `${id} cost structure`).toBeCloseTo(1, 6)
      expect(s.equipment.value, `${id} equipment share`).toBeGreaterThan(0)
      expect(s.civil.value, `${id} civil share`).toBeGreaterThan(0)
    }
  })

  it('physical parameters are within plausible bounds', () => {
    for (const id of PLANT_TYPE_IDS) {
      const t = PLANT_TYPES[id]
      expect(t.efficiency.value, `${id} efficiency`).toBeGreaterThan(0)
      expect(t.efficiency.value, `${id} efficiency`).toBeLessThanOrEqual(1)
      expect(t.capacityMw.value, `${id} capacity`).toBeGreaterThan(0)
      expect(t.capexPerKw.value, `${id} capex`).toBeGreaterThan(0)
      expect(t.designLifeYears.value, `${id} life`).toBeGreaterThan(5)
      expect(t.minLoadFraction.value, `${id} min load`).toBeLessThanOrEqual(1)
      expect(t.forcedOutageRate.value, `${id} outage rate`).toBeLessThan(0.5)
    }
  })

  it('higher voltage means lower resistance and higher capacity', () => {
    for (let i = 1; i < VOLTAGE_LEVELS.length; i++) {
      const lower = LINE_TYPES[VOLTAGE_LEVELS[i - 1]!]
      const higher = LINE_TYPES[VOLTAGE_LEVELS[i]!]
      expect(higher.capacityMw.value).toBeGreaterThan(lower.capacityMw.value)
      expect(higher.resistanceOhmPerKm.value).toBeLessThan(lower.resistanceOhmPerKm.value)
      expect(higher.capexPerKm.value).toBeGreaterThan(lower.capexPerKm.value)
    }
  })
})

/**
 * Numbers the content defines that nothing ever reads.
 *
 * Twice in one week a field turned out to be complete, sourced and inert: the heat mains' standing
 * cost, which the electric corridor beside it had been paying since the network milestone, and a
 * duplicate line fault rate that disagreed with the one actually used by a factor of nine. Neither
 * was findable by reading the content — the content looked finished — and both were only caught by
 * going and looking at one subsystem on purpose. This does the looking mechanically.
 *
 * Deliberately crude: it matches a field name declared in `content/` against `.field` appearing
 * anywhere that could consume it. A number read generically — through a `Param`, a spread, or a
 * computed key — would be flagged here even though it is live, which is what `READ_INDIRECTLY` is
 * for. Adding a name to that list is a claim you have checked; leaving the list empty is the
 * default, and it is where the tree stands today.
 */
describe('content that nothing reads', () => {
  const READ_INDIRECTLY = new Set<string>([])

  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) tsFiles(full, out)
      else if (full.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('defines no sourced number that no consumer ever reads', () => {
    const declared = new Map<string, string>()
    for (const file of tsFiles('src/content')) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^\s{2}(\w+)\??:\s*Sourced</gm)) declared.set(m[1]!, file)
    }
    // Enough fields that a silent gap is plausible; too few means the scan itself broke.
    expect(declared.size).toBeGreaterThan(80)

    const consumers = [
      ...tsFiles('src/sim'),
      ...tsFiles('src/ui'),
      ...tsFiles('src/render'),
      ...tsFiles('scripts'),
    ]
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')

    const unread: string[] = []
    for (const [field, file] of declared) {
      if (READ_INDIRECTLY.has(field)) continue
      if (!new RegExp(`\\.${field}\\b`).test(consumers)) unread.push(`${field} (${file})`)
    }
    expect(unread, 'declared, sourced, and never read').toEqual([])
  })
})
