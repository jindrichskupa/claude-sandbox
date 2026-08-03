/**
 * Terrain.
 *
 * Cosmetic in this milestone, but generated in the simulation rather than the renderer
 * because later milestones need it: hydro wants rivers, wind wants exposed high ground,
 * lines cost more over mountains, and cooling water is only where the water is.
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
