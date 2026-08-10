/**
 * Localisation.
 *
 * Deliberately tiny: a dictionary and a `t()` with `{placeholder}` interpolation. The
 * requirement is that no user-visible string is ever hardcoded at a call site, and that is
 * a discipline rather than a library feature. Adding a language means adding a JSON file.
 */

import en from './en.json'
import cs from './cs.json'

export type Locale = 'en' | 'cs'
export type Dict = Record<string, string>

const DICTS: Record<Locale, Dict> = { en: en as Dict, cs: cs as Dict }

/** Languages the player can pick, in the order the switch shows them. */
export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'cs', label: 'Čeština' },
]

const STORAGE_KEY = 'powergrid-tycoon.locale'

/**
 * The language to open in.
 *
 * A stored choice wins, then the browser's own preference, then English. Guessing from the browser
 * rather than always starting in English matters more here than in most games: a player whose
 * system is Czech and who is shown an English interface has no reason to suspect a switch exists.
 */
export function preferredLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (stored && stored in DICTS) return stored as Locale
  } catch {
    // Private browsing, a full quota, an embedded webview. Not a reason to fail to start.
  }
  const languages = globalThis.navigator?.languages ?? []
  for (const tag of languages) {
    const base = tag.split('-')[0]?.toLowerCase()
    if (base && base in DICTS) return base as Locale
  }
  return 'en'
}

let current: Locale = 'en'
let dict: Dict = DICTS.en

/** `remember` is false for the initial load, which is applying a choice rather than making one. */
export function setLocale(locale: Locale, remember = true): void {
  current = DICTS[locale] ? locale : 'en'
  dict = DICTS[current] ?? DICTS.en
  if (!remember) return
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, current)
  } catch {
    // As above: the game runs, the choice simply does not survive a reload.
  }
}

export function getLocale(): Locale {
  return current
}

/**
 * Look up a key and interpolate parameters. Missing keys return the key itself, which makes
 * an untranslated string obvious on screen rather than silently blank.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // English before the key itself. A translation with a hole in it should read as a sentence in
  // the wrong language, which a player can still act on; `ui.stationBays` on screen is a bug they
  // can only report. The test suite is what stops the holes existing, not this.
  const template = dict[key] ?? DICTS.en[key]
  if (template === undefined) return key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** Formats used by the UI. Locale-aware so translations get sensible separators. */
export function formatMoney(eur: number): string {
  const abs = Math.abs(eur)
  const sign = eur < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}€${(abs / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `${sign}€${(abs / 1e6).toFixed(1)}m`
  if (abs >= 1e3) return `${sign}€${(abs / 1e3).toFixed(0)}k`
  return `${sign}€${abs.toFixed(0)}`
}

export function formatMw(mw: number): string {
  if (Math.abs(mw) >= 1000) return `${(mw / 1000).toFixed(2)} GW`
  return `${mw.toFixed(0)} MW`
}

/**
 * Thermal megawatts, always labelled as such.
 *
 * A separate formatter rather than a parameter, because the whole point is that the suffix can
 * never be left off by accident. Electrical and thermal megawatts are the same unit measuring
 * two things that cost, behave and sell completely differently, and a figure without the `th`
 * invites the reader to compare them directly.
 */
export function formatMwth(mw: number): string {
  if (Math.abs(mw) >= 1000) return `${(mw / 1000).toFixed(2)} GWth`
  return `${mw.toFixed(0)} MWth`
}

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

export function formatDate(d: { year: number; month: number; day: number; hour: number }): string {
  return `${String(d.day).padStart(2, '0')} ${t(`month.${d.month}`)} ${d.year}, ${String(d.hour).padStart(2, '0')}:00`
}

/**
 * The same date without the hour, for anything historical.
 *
 * A news archive that stamped every headline to the hour would be reporting a precision nobody
 * needs and making a column of dates twice as wide as the column of headlines.
 */
export function formatShortDate(d: { year: number; month: number; day: number }): string {
  return `${String(d.day).padStart(2, '0')} ${t(`month.${d.month}`)} ${d.year}`
}
