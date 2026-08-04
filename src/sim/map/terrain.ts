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

      // Exposed high ground catches more wind; valleys and forests less.
      windIndex[i] = Math.max(0, Math.min(1, e * 0.8 + fbm(base + 104729, x / 17, y / 17) * 0.35))
    }
  }

  return { width, height, tiles, elevation, windIndex }
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

function indexAt(map: TerrainMap, x: number, y: number): number {
  const cx = Math.max(0, Math.min(map.width - 1, Math.round(x)))
  const cy = Math.max(0, Math.min(map.height - 1, Math.round(y)))
  return cy * map.width + cx
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
