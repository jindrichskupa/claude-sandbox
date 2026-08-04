/**
 * Where each technology can stand.
 *
 * Until now there was one rule for everything — no water, no mountains — which made the map
 * scenery rather than a constraint. A power station is sited by what it physically needs, and
 * those needs differ enough that the same tile is excellent for one technology and useless
 * for another. That is what turns the map into a set of decisions.
 *
 * Each rule returns either acceptance or a reason, and the reason is what the build panel
 * shows. A refusal the player cannot understand is worse than no rule at all.
 */

import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { sourced, type Sourced } from '@content/schema'
import { flatness, isBuildable, riverIndexAt, waterAvailability, windIndexAt, type TerrainMap } from '../map/terrain'
import type { CityAsset } from '../assets/types'
import type { Network } from '../grid/network'

export interface SiteVerdict {
  ok: boolean
  reasonKey?: string
  reasonParams?: Record<string, string | number>
  /**
   * How good the site is for this technology, 0..1, when it is acceptable at all. Shown to
   * the player so a merely legal site can be told apart from a good one.
   */
  quality: number
}

export interface SiteContext {
  terrain: TerrainMap
  network: Network
  cities: CityAsset[]
  x: number
  y: number
}

/** Thresholds, gathered so they are visible and sourced rather than sprinkled through code. */
export const SITING = {
  /** Drainage a run-of-river station needs. Below this there is not enough water to turn a turbine. */
  hydroRiverIndex: sourced(0.62, 'fraction', 'engineering-standard', 2023, 'Needs a real river, not a stream'),
  /** Drainage within reach that a water-cooled thermal station needs. */
  coolingWaterIndex: sourced(0.35, 'fraction', 'engineering-standard', 2023, 'A river or lake within a few km'),
  /** How far a thermal station may be from its cooling water, in tiles. */
  coolingWaterRadius: sourced(2, 'count', 'engineering-standard', 2023),
  /** Minimum distance from a city centre for a nuclear station, in tiles. */
  nuclearCityDistance: sourced(3, 'count', 'game-design', 2024, 'Stands in for the planning-inquiry reality'),
  /** Flatness a solar farm needs; panels on a slope shade each other and cost more to mount. */
  solarFlatness: sourced(0.55, 'fraction', 'irena-costs', 2022),
  /** Wind exposure below which a farm is not worth building. */
  windMinimumExposure: sourced(0.5, 'fraction', 'irena-costs', 2022, 'Below this the annual mean wind speed does not pay for the turbine'),
  /** Elevation difference a pumped station needs between its two reservoirs. */
  pumpedHeadDrop: sourced(0.18, 'fraction', 'engineering-standard', 2023, 'Needs a hill and somewhere below it'),
  /** Drainage a lignite station needs nearby, standing in for a mine. */
  ligniteFuelRadius: sourced(4, 'count', 'game-design', 2024, 'Lignite is not transportable; it burns at its mine'),
  /**
   * How far a heat plant may stand from the town it heats, in tiles.
   *
   * This is the sharpest siting rule in the game, and it comes straight from the physics in
   * `heatPipeTypes.ts`: a buried main loses heat per kilometre whether it is carrying anything
   * or not, so distance costs energy continuously rather than only under load. Electricity can
   * be sent two hundred kilometres and arrive; heat cannot. A power station picks its site from
   * the whole map, a heat plant from the edge of one town.
   */
  heatSourceCityDistance: sourced(3, 'count', 'euro-chp-practice', 2021, 'Around 30 km; the longest real transmission mains reach about this'),
} as const satisfies Record<string, Sourced<number>>

function distanceToNearestCity(context: SiteContext): number {
  let best = Infinity
  for (const city of context.cities) {
    const node = context.network.getNode(city.nodeId)
    if (!node) continue
    best = Math.min(best, Math.hypot(node.x - context.x, node.y - context.y))
  }
  return best
}

/** Largest elevation drop from this tile to anywhere within `radius`. */
function headDrop(terrain: TerrainMap, x: number, y: number, radius = 3): number {
  const here = terrain.elevation[Math.max(0, Math.min(terrain.height - 1, y)) * terrain.width + Math.max(0, Math.min(terrain.width - 1, x))] ?? 0
  let lowest = here
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= terrain.width || ny >= terrain.height) continue
      lowest = Math.min(lowest, terrain.elevation[ny * terrain.width + nx]!)
    }
  }
  return here - lowest
}

function accept(quality: number): SiteVerdict {
  return { ok: true, quality: Math.max(0, Math.min(1, quality)) }
}

function reject(reasonKey: string, reasonParams?: Record<string, string | number>): SiteVerdict {
  const v: SiteVerdict = { ok: false, reasonKey, quality: 0 }
  if (reasonParams) v.reasonParams = reasonParams
  return v
}

/**
 * Judge a site for a technology.
 *
 * The general ground rule still applies first — nothing is built in water or on a mountain
 * top — and then each technology adds what it actually needs.
 */
export function judgeSite(typeId: PlantTypeId, context: SiteContext): SiteVerdict {
  const { terrain, x, y } = context
  if (!isBuildable(terrain, x, y)) return reject('build.unsuitableGround')

  const type = PLANT_TYPES[typeId]

  // Anything that raises steam has to reject the heat somewhere.
  if (type.cooling === 'water') {
    const water = waterAvailability(terrain, x, y, SITING.coolingWaterRadius.value)
    if (water < SITING.coolingWaterIndex.value) return reject('build.noCoolingWater')
  }

  switch (typeId) {
    case 'hydro': {
      const river = riverIndexAt(terrain, x, y)
      if (river < SITING.hydroRiverIndex.value) return reject('build.noRiver')
      // A bigger river and a steeper drop both mean more power from the same machine.
      return accept(0.4 + river * 0.4 + Math.min(0.2, headDrop(terrain, x, y, 2) * 2))
    }

    case 'pumped': {
      const drop = headDrop(terrain, x, y, 3)
      if (drop < SITING.pumpedHeadDrop.value) return reject('build.noHead')
      const water = waterAvailability(terrain, x, y, 3)
      if (water < 0.25) return reject('build.noWaterToFill')
      return accept(0.3 + Math.min(0.7, drop * 2))
    }

    case 'wind': {
      const exposure = windIndexAt(terrain, x, y)
      if (exposure < SITING.windMinimumExposure.value) return reject('build.tooSheltered')
      return accept(exposure)
    }

    case 'solar': {
      const flat = flatness(terrain, x, y)
      if (flat < SITING.solarFlatness.value) return reject('build.groundTooSteep')
      return accept(flat)
    }

    case 'nuclear': {
      const distance = distanceToNearestCity(context)
      if (distance < SITING.nuclearCityDistance.value) {
        return reject('build.tooNearPopulation', { tiles: SITING.nuclearCityDistance.value })
      }
      return accept(Math.min(1, distance / 10))
    }

    case 'lignite': {
      // Lignite is not worth transporting, so a station is built on top of its own mine.
      // The seam is modelled as thick, low-grade ground: hills away from the water.
      const seam = 1 - waterAvailability(terrain, x, y, SITING.ligniteFuelRadius.value)
      if (seam < 0.35) return reject('build.noLigniteSeam')
      return accept(seam)
    }

    case 'coal_chp':
    case 'gas_chp':
    case 'heat_boiler':
    case 'heat_accumulator': {
      const distance = distanceToNearestCity(context)
      const limit = SITING.heatSourceCityDistance.value
      if (distance > limit) return reject('build.tooFarFromHeatLoad', { tiles: limit })
      // Closer is strictly better: less pipe to buy and less heat left in the ground.
      return accept(1 - distance / (limit + 1))
    }

    default:
      return accept(0.6)
  }
}

/** Convenience for the renderer: is this tile legal for the technology being placed? */
export function siteAcceptable(typeId: PlantTypeId, context: SiteContext): boolean {
  return judgeSite(typeId, context).ok
}
