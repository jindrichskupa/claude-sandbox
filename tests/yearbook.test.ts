/**
 * The record of a whole run.
 *
 * Two things are worth testing here and nothing else is. First, that the yearbook agrees with the
 * accounts it is taken from — it exists to be read instead of the ledgers, so the moment it says
 * something the ledgers do not, it is worse than having no chart at all. Second, that the turning
 * point is honest: it must find a real reversal and must refuse to invent one, because it is the
 * only editorial claim the history panel makes.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { turningPoint, type YearRecord } from '@sim/economy/yearbook'
import { MIX_BANDS } from '@content/plantTypes'
import en from '@i18n/en.json'

const HOURS_PER_YEAR = 8760

function series(values: number[]): YearRecord[] {
  return values.map((v, i) => ({ year: 1995 + i, carbonIntensity: v }) as YearRecord)
}

describe('the yearbook', () => {
  it('writes one honest line per closed year', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < HOURS_PER_YEAR * 2; i++) world.step()

    expect(world.yearbook.length).toBe(2)
    const [first, second] = world.yearbook
    expect(first!.year).toBe(FIRST_REGION.startYear)
    expect(second!.year).toBe(FIRST_REGION.startYear + 1)

    for (const year of world.yearbook) {
      // Intensity and unserved share are ratios of figures recorded beside them; a chart drawn
      // from one and a number read from the other must never disagree.
      expect(year.carbonIntensity).toBeCloseTo(year.co2Tonnes / year.energySoldMwh, 9)
      const demand = year.energySoldMwh + year.energyUnservedMwh
      expect(year.unservedShare).toBeCloseTo(year.energyUnservedMwh / demand, 9)

      expect(year.energySoldMwh).toBeGreaterThan(0)
      expect(year.firmCapacityMw).toBeGreaterThan(0)
      // Firm capacity is dispatchable capacity, so it can equal the total but never exceed it.
      expect(year.firmCapacityMw).toBeLessThanOrEqual(year.totalCapacityMw + 1e-9)
      expect(Object.values(year.mixMwh).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
      expect(year.regimeId).toBeTruthy()

      // The mix is split by fuel where the fuel is the decision. One "thermal" band lumped lignite,
      // hard coal and gas together — the three things the opening scenario is entirely about, with
      // wildly different carbon and marginal cost — so the chart could not say whether the lignite
      // had come off or merely been turned down.
      expect(Object.keys(year.mixMwh)).not.toContain('thermal')
      expect(year.mixMwh.lignite).toBeGreaterThan(0)
      expect(year.mixMwh.coal).toBeGreaterThan(0)
      // And every band the recorder emits is one the chart knows how to draw and label.
      for (const band of Object.keys(year.mixMwh)) {
        expect(MIX_BANDS, band).toContain(band)
        expect((en as Record<string, string>)[`category.${band}`], band).toBeTruthy()
      }
    }
  })

  it('survives a save and reload with its history intact', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < HOURS_PER_YEAR + 100; i++) world.step()
    const saved = JSON.parse(JSON.stringify(world.toSaveData()))
    expect(saved.yearbook).toHaveLength(1)
    expect(saved.yearbook[0].year).toBe(FIRST_REGION.startYear)
  })

  it('finds the year a series turned', () => {
    // Down for five years, then up for five. The turn is at the bottom, in 1999.
    const turned = turningPoint(series([10, 8, 6, 4, 2, 4, 6, 8, 10, 12]), (y) => y.carbonIntensity)
    expect(turned).toBe(1999)
  })

  it('refuses to invent one on a series that only ever went one way', () => {
    expect(turningPoint(series([10, 9, 8, 7, 6, 5, 4, 3]), (y) => y.carbonIntensity)).toBeNull()
    // Too short to have a shape at all.
    expect(turningPoint(series([10, 4, 9]), (y) => y.carbonIntensity)).toBeNull()
  })
})
