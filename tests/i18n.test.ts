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
import cs from '../src/i18n/cs.json'
import { LOCALES, t, setLocale } from '@i18n/index'
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

  it('has a translation for every literal key the interface asks for', () => {
    // The panels are the one place a missing key is silently ugly rather than loud: `t()` returns
    // the key itself, so a typo ships as `ui.acctMargn` sitting in the middle of a table and
    // nothing fails. Only literal keys can be checked this way — `t(type.nameKey)` and the
    // template-built ones are covered by the content tests above — and that is most of them.
    const files = [...sourceFiles('src/ui'), ...sourceFiles('src/render')]
    const found = new Set<string>()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) found.add(m[1]!)
    }
    expect(found.size).toBeGreaterThan(50)
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
    setLocale('en')
    expect(t('reason.windSpeed', {})).toContain('{wind}')
  })
})

/**
 * The two dictionaries, against each other.
 *
 * A translation does not rot by being wrong — somebody notices that. It rots by falling behind:
 * a key added to English and forgotten in Czech shows up as one English sentence in the middle of
 * a Czech panel, which is easy to ship and easy to miss. And a placeholder dropped in translation
 * is worse, because the sentence still reads fine while the number it was supposed to carry has
 * silently vanished.
 */
describe('every language says the same things', () => {
  const dicts: Array<[string, Record<string, string>]> = [['cs', cs as Record<string, string>]]

  it('offers exactly the dictionaries it ships', () => {
    expect(LOCALES.map((l) => l.id).sort()).toEqual(['cs', 'en'])
    // Labelled in itself, so the switch is findable by somebody who cannot read the rest.
    expect(LOCALES.find((l) => l.id === 'cs')?.label).toBe('Čeština')
  })

  for (const [id, dict] of dicts) {
    it(`${id} has every key English has, and no others`, () => {
      const missing = Object.keys(en).filter((k) => !(k in dict))
      const extra = Object.keys(dict).filter((k) => !(k in (en as Record<string, string>)))
      expect(missing, `missing from ${id}`).toEqual([])
      expect(extra, `not in English`).toEqual([])
    })

    it(`${id} carries the same placeholders`, () => {
      const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const wrong: string[] = []
      for (const [key, english] of Object.entries(en as Record<string, string>)) {
        const a = placeholders(english).join(',')
        const b = placeholders(dict[key]!).join(',')
        if (a !== b) wrong.push(`${key}: en(${a}) ${id}(${b})`)
      }
      expect(wrong).toEqual([])
    })

    it(`${id} actually translated something`, () => {
      // A file copied from English would pass both checks above. Most of it has to differ.
      const same = Object.keys(en).filter((k) => dict[k] === (en as Record<string, string>)[k])
      expect(same.length).toBeLessThan(Object.keys(en).length * 0.2)
    })

    it(`${id} names the months, because dates are built from them`, () => {
      setLocale(id as 'cs')
      for (let month = 0; month < 12; month++) {
        expect(t(`month.${month}`)).not.toBe(`month.${month}`)
      }
      setLocale('en')
    })
  }
})
