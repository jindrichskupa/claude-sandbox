/**
 * Game time.
 *
 * One tick is one hour. The calendar is a flat 365-day year with no leap years — the
 * simulation needs a stable ticks-per-year constant far more than it needs real dates,
 * and 8760 is the number every energy engineer already has in their head.
 */

export const HOURS_PER_DAY = 24
export const DAYS_PER_YEAR = 365
export const TICKS_PER_DAY = HOURS_PER_DAY
export const TICKS_PER_YEAR = HOURS_PER_DAY * DAYS_PER_YEAR // 8760

/** Cumulative day-of-year at which each month starts (non-leap). */
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
export const MONTHS_PER_YEAR = 12

export interface GameDate {
  /** Absolute year, e.g. 1995. */
  year: number
  /** 0-based month index. */
  month: number
  /** 1-based day of month. */
  day: number
  /** 0-based day of year. */
  dayOfYear: number
  /** 0..23 */
  hour: number
}

/** Convert an absolute tick into a calendar date. `startYear` is the scenario's first year. */
export function tickToDate(tick: number, startYear: number): GameDate {
  const year = startYear + Math.floor(tick / TICKS_PER_YEAR)
  const tickInYear = ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR
  const dayOfYear = Math.floor(tickInYear / HOURS_PER_DAY)
  const hour = tickInYear % HOURS_PER_DAY

  let month = MONTHS_PER_YEAR - 1
  for (let m = 1; m < MONTHS_PER_YEAR; m++) {
    if (dayOfYear < MONTH_STARTS[m]!) {
      month = m - 1
      break
    }
  }
  return { year, month, day: dayOfYear - MONTH_STARTS[month]! + 1, dayOfYear, hour }
}

/** Fraction of the way through the year, 0..1. Drives seasonal curves. */
export function yearFraction(tick: number): number {
  return (((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR) / TICKS_PER_YEAR
}

/** True on the first tick of a new month — the trigger for economic settlement. */
export function isMonthBoundary(tick: number): boolean {
  const tickInYear = ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR
  const dayOfYear = Math.floor(tickInYear / HOURS_PER_DAY)
  return tickInYear % HOURS_PER_DAY === 0 && MONTH_STARTS.includes(dayOfYear)
}

/** True on the first tick of a new year. */
export function isYearBoundary(tick: number): boolean {
  return ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR === 0
}

export function yearsBetween(fromTick: number, toTick: number): number {
  return (toTick - fromTick) / TICKS_PER_YEAR
}
