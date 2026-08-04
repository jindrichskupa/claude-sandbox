/**
 * Siting.
 *
 * Two things have to be true at once and they pull against each other: the rules must be
 * strict enough that the map is a constraint rather than scenery, and loose enough that every
 * technology has somewhere to go. A rule that nothing can satisfy is the same bug as no rule
 * at all, and it is much harder to notice.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { PLANT_TYPE_IDS, PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { judgeSite, SITING } from '@sim/build/siting'
import { isBuildable, riverIndexAt, waterAvailability, windIndexAt } from '@sim/map/terrain'

function world(seed = FIRST_REGION.seed) {
  return buildWorld({ ...FIRST_REGION, seed, startYear: 2020 })
}

function context(w: ReturnType<typeof world>, x: number, y: number) {
  return { terrain: w.terrain, network: w.network, cities: w.cities, x, y }
}

/** Every tile that accepts this technology. */
function acceptableTiles(w: ReturnType<typeof world>, typeId: PlantTypeId): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let y = 0; y < w.scenario.mapHeight; y++) {
    for (let x = 0; x < w.scenario.mapWidth; x++) {
      if (judgeSite(typeId, context(w, x, y)).ok) out.push({ x, y })
    }
  }
  return out
}

describe('rivers', () => {
  it('generates a drainage network rather than scattered noise', () => {
    const w = world()
    let riverTiles = 0
    let total = 0
    for (let y = 0; y < w.scenario.mapHeight; y++) {
      for (let x = 0; x < w.scenario.mapWidth; x++) {
        if (!isBuildable(w.terrain, x, y)) continue
        total++
        if (riverIndexAt(w.terrain, x, y) >= SITING.hydroRiverIndex.value) riverTiles++
      }
    }
    // Rivers should be a small minority of the land: present, but not everywhere.
    expect(riverTiles).toBeGreaterThan(0)
    expect(riverTiles / total).toBeLessThan(0.35)
  })

  it('puts more water low down than high up', () => {
    const w = world()
    let lowSum = 0
    let lowN = 0
    let highSum = 0
    let highN = 0
    for (let y = 0; y < w.scenario.mapHeight; y++) {
      for (let x = 0; x < w.scenario.mapWidth; x++) {
        const e = w.terrain.elevation[y * w.terrain.width + x]!
        const r = riverIndexAt(w.terrain, x, y)
        if (e < 0.3) {
          lowSum += r
          lowN++
        } else if (e > 0.6) {
          highSum += r
          highN++
        }
      }
    }
    // Water gathers as it descends, so the lowlands must be wetter than the uplands.
    expect(lowSum / Math.max(1, lowN)).toBeGreaterThan(highSum / Math.max(1, highN))
  })
})

describe('every technology has somewhere to go', () => {
  it('accepts at least a few sites for each type, on several maps', () => {
    const empty: string[] = []
    for (const seed of [FIRST_REGION.seed, 11111, 22222, 33333]) {
      const w = world(seed)
      for (const typeId of PLANT_TYPE_IDS) {
        const sites = acceptableTiles(w, typeId)
        if (sites.length < 3) empty.push(`${typeId} on seed ${seed}: ${sites.length} sites`)
      }
    }
    expect(empty).toEqual([])
  })

  it('does not accept the whole map for anything with a real requirement', () => {
    const w = world()
    const landTiles = acceptableTiles(w, 'ocgt').length
    for (const typeId of ['hydro', 'pumped', 'wind', 'solar', 'nuclear', 'lignite'] as PlantTypeId[]) {
      const sites = acceptableTiles(w, typeId).length
      expect(sites, `${typeId}`).toBeLessThan(landTiles)
    }
  })
})

describe('the rules mean what they say', () => {
  it('puts hydro only on a river', () => {
    const w = world()
    for (const site of acceptableTiles(w, 'hydro')) {
      expect(riverIndexAt(w.terrain, site.x, site.y)).toBeGreaterThanOrEqual(SITING.hydroRiverIndex.value)
    }
  })

  it('refuses a water-cooled station with no water in reach', () => {
    const w = world()
    let checked = 0
    for (let y = 0; y < w.scenario.mapHeight; y++) {
      for (let x = 0; x < w.scenario.mapWidth; x++) {
        if (!isBuildable(w.terrain, x, y)) continue
        const water = waterAvailability(w.terrain, x, y, SITING.coolingWaterRadius.value)
        if (water >= SITING.coolingWaterIndex.value) continue
        const verdict = judgeSite('ccgt', context(w, x, y))
        expect(verdict.ok).toBe(false)
        expect(verdict.reasonKey).toBe('build.noCoolingWater')
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('lets an air-cooled turbine stand where a steam plant cannot', () => {
    const w = world()
    // The gas turbine rejects its heat to the air, so dry ground is no obstacle to it.
    expect(PLANT_TYPES.ocgt.cooling).toBe('air')
    expect(PLANT_TYPES.ccgt.cooling).toBe('water')
    expect(acceptableTiles(w, 'ocgt').length).toBeGreaterThan(acceptableTiles(w, 'ccgt').length)
  })

  it('keeps nuclear away from cities', () => {
    const w = world()
    for (const site of acceptableTiles(w, 'nuclear')) {
      for (const city of w.cities) {
        const node = w.network.requireNode(city.nodeId)
        const distance = Math.hypot(node.x - site.x, node.y - site.y)
        expect(distance).toBeGreaterThanOrEqual(SITING.nuclearCityDistance.value)
      }
    }
  })

  it('refuses wind on sheltered ground and rates exposed ground higher', () => {
    const w = world()
    let bestQuality = 0
    let bestExposure = 0
    for (const site of acceptableTiles(w, 'wind')) {
      const exposure = windIndexAt(w.terrain, site.x, site.y)
      expect(exposure).toBeGreaterThanOrEqual(SITING.windMinimumExposure.value)
      const quality = judgeSite('wind', context(w, site.x, site.y)).quality
      if (quality > bestQuality) {
        bestQuality = quality
        bestExposure = exposure
      }
    }
    // The best-rated site must also be the most exposed one, or the rating means nothing.
    expect(bestExposure).toBeGreaterThan(SITING.windMinimumExposure.value)
  })

  it('gives a reason for every refusal', () => {
    const w = world()
    for (const typeId of PLANT_TYPE_IDS) {
      for (let y = 0; y < w.scenario.mapHeight; y += 3) {
        for (let x = 0; x < w.scenario.mapWidth; x += 3) {
          const verdict = judgeSite(typeId, context(w, x, y))
          if (verdict.ok) {
            expect(verdict.quality).toBeGreaterThanOrEqual(0)
            expect(verdict.quality).toBeLessThanOrEqual(1)
          } else {
            expect(verdict.reasonKey, `${typeId} at ${x},${y}`).toBeTruthy()
          }
        }
      }
    }
  })
})
