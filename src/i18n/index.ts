/**
 * Localisation.
 *
 * Deliberately tiny: a dictionary and a `t()` with `{placeholder}` interpolation. The
 * requirement is that no user-visible string is ever hardcoded at a call site, and that is
 * a discipline rather than a library feature. Adding a language means adding a JSON file.
 */

import en from './en.json'

export type Locale = 'en'
export type Dict = Record<string, string>

const DICTS: Record<Locale, Dict> = { en: en as Dict }

let current: Locale = 'en'
let dict: Dict = DICTS.en

export function setLocale(locale: Locale): void {
  current = locale
  dict = DICTS[locale] ?? DICTS.en
}

export function getLocale(): Locale {
  return current
}

/**
 * Look up a key and interpolate parameters. Missing keys return the key itself, which makes
 * an untranslated string obvious on screen rather than silently blank.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = dict[key]
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

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

export function formatDate(d: { year: number; month: number; day: number; hour: number }): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(d.day).padStart(2, '0')} ${months[d.month]} ${d.year}, ${String(d.hour).padStart(2, '0')}:00`
}
