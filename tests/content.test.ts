/**
 * Content provenance.
 *
 * This is the test that makes the neutrality claim real. Every number the simulation reads
 * has to say where it came from; a bare number in the content tree fails the build. It is a
 * much stronger guarantee than an intention, because it cannot be quietly forgotten.
 */

import { describe, expect, it } from 'vitest'
import { isSourced, SOURCES, type SourceId } from '@content/schema'
import { PLANT_TYPES, PLANT_TYPE_IDS } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { LINE_TYPES, VOLTAGE_LEVELS } from '@content/lineTypes'
import { ECONOMICS } from '@content/economics'

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
