/**
 * Localisation completeness.
 *
 * The rule is that no user-visible string is written at the call site. That is easy to state
 * and easy to break, so it is checked: every key the code and content refer to must exist in
 * the dictionary, and `t()` must behave sensibly when it does not.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import en from '../src/i18n/en.json'
import { t, setLocale } from '@i18n/index'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { LINE_TYPES, VOLTAGE_LEVELS } from '@content/lineTypes'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { EVENTS } from '@content/events'
import { HEAT_PIPE_TYPES, PIPE_SIZES } from '@content/heatPipeTypes'
import { LAYER_KEYS, PARAM_KEYS } from '@sim/params/types'
import { LIFECYCLE_KEYS } from '@sim/assets/types'

const DICT = en as Record<string, string>

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('i18n', () => {
  it('has a translation for every content name key', () => {
    const missing: string[] = []
    for (const type of Object.values(PLANT_TYPES)) if (!DICT[type.nameKey]) missing.push(type.nameKey)
    for (const fuel of Object.values(FUELS)) if (!DICT[fuel.nameKey]) missing.push(fuel.nameKey)
    for (const kv of VOLTAGE_LEVELS) if (!DICT[LINE_TYPES[kv].nameKey]) missing.push(LINE_TYPES[kv].nameKey)
    if (!DICT[FIRST_REGION.nameKey]) missing.push(FIRST_REGION.nameKey)
    for (const o of FIRST_REGION.objectives) if (!DICT[o.descriptionKey]) missing.push(o.descriptionKey)
    for (const e of EVENTS) {
      // Both halves of an event are read aloud to the player, and so is every option it
      // offers — an untranslated choice button is worse than no choice at all.
      if (!DICT[e.nameKey]) missing.push(e.nameKey)
      if (!DICT[e.descriptionKey]) missing.push(e.descriptionKey)
      for (const c of e.choices) if (!DICT[c.labelKey]) missing.push(c.labelKey)
    }
    for (const size of PIPE_SIZES) if (!DICT[HEAT_PIPE_TYPES[size].nameKey]) missing.push(HEAT_PIPE_TYPES[size].nameKey)
    expect(missing).toEqual([])
  })

  it('has a translation for every enum display key', () => {
    const missing: string[] = []
    for (const key of Object.values(PARAM_KEYS)) if (!DICT[key]) missing.push(key)
    for (const key of Object.values(LAYER_KEYS)) if (!DICT[key]) missing.push(key)
    for (const key of Object.values(LIFECYCLE_KEYS)) if (!DICT[key]) missing.push(key)
    expect(missing).toEqual([])
  })

  it('has a translation for every reason key emitted by the simulation', () => {
    // Reason keys are what the player reads in the explanation chain, so a missing one is
    // directly visible as gibberish in the panel.
    const files = sourceFiles('src/sim')
    const found = new Set<string>()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/'(reason\.[A-Za-z0-9_.]+)'/g)) found.add(m[1]!)
    }
    expect(found.size).toBeGreaterThan(5)
    const missing = [...found].filter((k) => !DICT[k])
    expect(missing).toEqual([])
  })

  it('interpolates parameters', () => {
    setLocale('en')
    expect(t('reason.windSpeed', { wind: 7.5 })).toContain('7.5')
    expect(t('ui.cash')).toBe('Cash')
  })

  it('returns the key itself when a translation is missing, so gaps are visible', () => {
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist')
  })

  it('leaves unknown placeholders alone rather than printing undefined', () => {
    expect(t('reason.windSpeed', {})).toContain('{wind}')
  })
})
