/**
 * Terrain.
 *
 * Owned by the world rather than the renderer, because it decides things: where a station
 * can stand, how good a wind site is, and how expensive a line is to string across a ridge.
 * The renderer reads it; it does not generate it.
 */

import { hashString } from '../core/rng'

export enum Tile {
  Water,
  Plain,
  Forest,
  Hill,
  Mountain,
}

export interface TerrainMap {
  width: number
  height: number
  tiles: Uint8Array
  /** Elevation 0..1, kept because it is more useful than the coarse tile class. */
  elevation: Float32Array
  /** Wind exposure 0..1, driven by elevation and openness. */
  windIndex: Float32Array
  /**
   * Flow accumulation, 0..1. Rivers are where it is high. Storing the continuous field
   * rather than a boolean lets a big river and a stream be different things: a run-of-river
   * station wants the former, a cooling tower will settle for the latter.
   */
  riverIndex: Float32Array
}

function valueNoise2D(seed: number, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)

  const at = (px: number, py: number): number => {
    let h = seed ^ Math.imul(px | 0, 0x27d4eb2d) ^ Math.imul(py | 0, 0x165667b1)
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
    return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000
  }

  const a = at(xi, yi)
  const b = at(xi + 1, yi)
  const c = at(xi, yi + 1)
  const d = at(xi + 1, yi + 1)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}

/** Several octaves of value noise, which is enough to read as landscape at this scale. */
function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(seed + o * 7919, x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

export function generateTerrain(seed: number, width: number, height: number): TerrainMap {
  const base = hashString(`terrain:${seed}`)
  const tiles = new Uint8Array(width * height)
  const elevation = new Float32Array(width * height)
  const windIndex = new Float32Array(width * height)
  const riverIndex = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const n = fbm(base, x / 11, y / 11)
      // Push the south-east corner down so the map has a coast rather than noise everywhere.
      const coast = (x / width) * 0.28 + (y / height) * 0.3
      const e = Math.max(0, Math.min(1, n * 1.25 - coast * 0.55 + 0.12))
      elevation[i] = e

      let tile: Tile
      if (e < 0.18) tile = Tile.Water
      else if (e < 0.42) tile = Tile.Plain
      else if (e < 0.58) tile = Tile.Forest
      else if (e < 0.75) tile = Tile.Hill
      else tile = Tile.Mountain
      tiles[i] = tile

      // Wind exposure is filled in below, once the whole elevation field exists.
    }
  }

  computeWindExposure(base, width, height, elevation, tiles, windIndex)
  carveRivers(width, height, elevation, tiles, riverIndex)
  return { width, height, tiles, elevation, windIndex, riverIndex }
}

/**
 * Wind exposure.
 *
 * The first version of this used absolute elevation, which was wrong and — worse — produced
 * an index so narrow (0.34 to 0.85, clustered near the middle) that no threshold could
 * separate a good site from a bad one. What matters is not how high the ground is but how
 * high it stands *relative to what surrounds it*: a ridge is exposed, and a valley floor at
 * the same altitude is sheltered by the hills on either side. Prominence captures that, and
 * it gives the contrast a siting rule needs to mean anything.
 */
function computeWindExposure(
  seed: number,
  width: number,
  height: number,
  elevation: Float32Array,
  tiles: Uint8Array,
  windIndex: Float32Array,
): void {
  const radius = 3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const here = elevation[i]!

      let sum = 0
      let n = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          sum += elevation[ny * width + nx]!
          n++
        }
      }
      const prominence = here - sum / Math.max(1, n)

      // Trees take the energy out of the lowest hundred metres of the atmosphere.
      const forestPenalty = tiles[i] === Tile.Forest ? 0.14 : 0
      // A little noise so identical terrain is not identically rated.
      const roughness = (fbm(seed + 104729, x / 19, y / 19) - 0.5) * 0.16

      windIndex[i] = Math.max(0, Math.min(1, 0.5 + prominence * 4.5 - forestPenalty + roughness))
    }
  }
}

/**
 * Water runs downhill and gathers. Each tile sends its flow to its lowest neighbour, and
 * repeating that from the highest ground down accumulates a drainage network — so rivers end
 * up in the valleys where they belong instead of being scattered noise, and they get larger
 * as they descend.
 */
function carveRivers(
  width: number,
  height: number,
  elevation: Float32Array,
  tiles: Uint8Array,
  riverIndex: Float32Array,
): void {
  const flow = new Float32Array(width * height).fill(1)

  // Highest first, so a tile's own inflow is final before it passes anything on.
  const order = Array.from({ length: width * height }, (_, i) => i).sort(
    (a, b) => elevation[b]! - elevation[a]!,
  )

  for (const i of order) {
    const x = i % width
    const y = (i / width) | 0
    if (tiles[i] === Tile.Water) continue

    let lowest = -1
    let lowestElevation = elevation[i]!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const n = ny * width + nx
        if (elevation[n]! < lowestElevation) {
          lowestElevation = elevation[n]!
          lowest = n
        }
      }
    }
    if (lowest >= 0) flow[lowest]! += flow[i]!
  }

  // Compress: drainage is extremely skewed, so a log scale is what makes it legible.
  let maxFlow = 1
  for (const f of flow) maxFlow = Math.max(maxFlow, f)
  const denominator = Math.log(1 + maxFlow)
  for (let i = 0; i < flow.length; i++) {
    riverIndex[i] = tiles[i] === Tile.Water ? 1 : Math.log(1 + flow[i]!) / denominator
  }
}

/** Drainage at a tile, 0..1. Anything above about 0.55 reads as a river. */
export function riverIndexAt(map: TerrainMap, x: number, y: number): number {
  return map.riverIndex[indexAt(map, x, y)] ?? 0
}

/** How much water is available within `radius` tiles: the best of the neighbourhood. */
export function waterAvailability(map: TerrainMap, x: number, y: number, radius = 2): number {
  let best = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.hypot(dx, dy) > radius) continue
      best = Math.max(best, riverIndexAt(map, x + dx, y + dy))
    }
  }
  return best
}

/** Flatness of the ground around a site, 0..1, where 1 is a billiard table. */
export function flatness(map: TerrainMap, x: number, y: number, radius = 1): number {
  const centre = elevationAt(map, x, y)
  let worst = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      worst = Math.max(worst, Math.abs(elevationAt(map, x + dx, y + dy) - centre))
    }
  }
  return Math.max(0, 1 - worst * 8)
}

function indexAt(map: TerrainMap, x: number, y: number): number {
  const cx = Math.max(0, Math.min(map.width - 1, Math.round(x)))
  const cy = Math.max(0, Math.min(map.height - 1, Math.round(y)))
  return cy * map.width + cx
}

export function tileAt(map: TerrainMap, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Water
  return map.tiles[y * map.width + x] as Tile
}

/** Whether a site can host a plant or substation. */
export function isBuildable(map: TerrainMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y)
  return t !== Tile.Water && t !== Tile.Mountain
}

/** Wind exposure of a site, 0..1. */
export function windIndexAt(map: TerrainMap, x: number, y: number): number {
  return map.windIndex[indexAt(map, x, y)] ?? 0.5
}

export function elevationAt(map: TerrainMap, x: number, y: number): number {
  return map.elevation[indexAt(map, x, y)] ?? 0
}

/**
 * Multiplier on a wind site's effective wind speed.
 *
 * A sheltered valley and an exposed ridge are not the same investment, and the difference is
 * large: because power goes with the cube of speed, a 20% better site produces roughly 70%
 * more energy. This is the main reason siting a wind farm is a decision rather than a
 * formality.
 */
export function windSiteFactor(map: TerrainMap, x: number, y: number): number {
  return 0.65 + 0.7 * windIndexAt(map, x, y)
}

/**
 * How much dearer a line is to build over this ground. Mountains and water crossings are
 * where transmission projects actually get expensive.
 */
export function terrainCostFactor(map: TerrainMap, x: number, y: number): number {
  switch (tileAt(map, x, y)) {
    case Tile.Water:
      return 2.6
    case Tile.Mountain:
      return 2.2
    case Tile.Hill:
      return 1.4
    case Tile.Forest:
      return 1.15
    default:
      return 1
  }
}

/** Mean cost factor along a straight route, sampled every half tile. */
export function routeCostFactor(map: TerrainMap, ax: number, ay: number, bx: number, by: number): number {
  const distance = Math.hypot(bx - ax, by - ay)
  const samples = Math.max(2, Math.ceil(distance * 2))
  let total = 0
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    total += terrainCostFactor(map, ax + (bx - ax) * t, ay + (by - ay) * t)
  }
  return total / (samples + 1)
}
