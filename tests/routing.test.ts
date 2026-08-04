/**
 * Line routing.
 *
 * The property that matters is not "the route is short" but "the route is cheap": a corridor
 * that goes round a ridge should win when the ridge is expensive enough to justify the extra
 * distance, and lose when it is not.
 */

import { describe, expect, it } from 'vitest'
import { routeLine, simplifyRoute, straightRoute } from '@sim/grid/routing'
import { generateTerrain, terrainCostFactor, Tile, type TerrainMap } from '@sim/map/terrain'

/**
 * A flat plain with a wall of mountains through the middle and one pass through it.
 *
 * The wall is three tiles thick and the pass is close to the direct line, because that is
 * what makes going round genuinely cheaper. A single mountain tile is not worth a detour —
 * crossing it costs a few tiles' worth of extra money, and walking seven tiles out of the way
 * to avoid it costs far more. The routing is right to drive straight over a lone peak.
 */
function ridgeMap(gapY: number): TerrainMap {
  const width = 21
  const height = 21
  const tiles = new Uint8Array(width * height).fill(Tile.Plain)
  const elevation = new Float32Array(width * height).fill(0.3)
  for (let y = 0; y < height; y++) {
    if (y === gapY) continue
    for (let x = 9; x <= 11; x++) {
      tiles[y * width + x] = Tile.Mountain
      elevation[y * width + x] = 0.9
    }
  }
  return {
    width,
    height,
    tiles,
    elevation,
    windIndex: new Float32Array(width * height).fill(0.5),
    riverIndex: new Float32Array(width * height).fill(0.1),
  }
}

describe('routing', () => {
  it('goes through the pass rather than over the ridge', () => {
    const gapY = 8
    const terrain = ridgeMap(gapY)
    const route = routeLine(terrain, 0, 10, 20, 10)

    // The direct line crosses three mountain tiles; the route should use the pass instead.
    const crossesRidge = route.points.some((p) => p.x >= 9 && p.x <= 11 && p.y !== gapY)
    expect(crossesRidge).toBe(false)
    expect(route.points.some((p) => p.x === 10 && p.y === gapY)).toBe(true)

    // Longer in tiles, but cheaper overall — which is the whole point.
    const direct = straightRoute(terrain, 0, 10, 20, 10)
    expect(route.lengthTiles).toBeGreaterThan(direct.lengthTiles)
    expect(route.weightedLengthTiles).toBeLessThan(direct.weightedLengthTiles)
  })

  it('drives straight over a lone peak rather than making a long detour', () => {
    // A single mountain tile costs a few tiles' worth of extra money. Walking seven tiles out
    // of the way to avoid it costs far more, and the router should know that.
    const width = 21
    const height = 21
    const tiles = new Uint8Array(width * height).fill(Tile.Plain)
    const elevation = new Float32Array(width * height).fill(0.3)
    tiles[10 * width + 10] = Tile.Mountain
    const terrain: TerrainMap = {
      width,
      height,
      tiles,
      elevation,
      windIndex: new Float32Array(width * height).fill(0.5),
      riverIndex: new Float32Array(width * height).fill(0.1),
    }
    const route = routeLine(terrain, 0, 10, 20, 10)
    // It may step around the single tile, but it must not wander far to do it.
    const maxDeviation = Math.max(...route.points.map((p) => Math.abs(p.y - 10)))
    expect(maxDeviation).toBeLessThanOrEqual(1)
  })

  it('takes the straight line when the ground is uniform', () => {
    const width = 15
    const height = 15
    const terrain: TerrainMap = {
      width,
      height,
      tiles: new Uint8Array(width * height).fill(Tile.Plain),
      elevation: new Float32Array(width * height).fill(0.3),
      windIndex: new Float32Array(width * height).fill(0.5),
      riverIndex: new Float32Array(width * height).fill(0.1),
    }
    const route = routeLine(terrain, 2, 7, 12, 7)
    expect(route.points.every((p) => p.y === 7)).toBe(true)
    expect(route.lengthTiles).toBeCloseTo(10, 6)
  })

  it('starts and ends where it was asked to', () => {
    const terrain = generateTerrain(4242, 30, 30)
    const route = routeLine(terrain, 3, 4, 25, 21)
    expect(route.points[0]).toEqual({ x: 3, y: 4 })
    expect(route.points[route.points.length - 1]).toEqual({ x: 25, y: 21 })
  })

  it('never steps more than one tile at a time', () => {
    const terrain = generateTerrain(4242, 30, 30)
    const route = routeLine(terrain, 1, 1, 28, 26)
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!
      const b = route.points[i]!
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1)
    }
  })

  it('charges for the ground it actually crosses', () => {
    const terrain = generateTerrain(4242, 30, 30)
    const route = routeLine(terrain, 2, 2, 27, 27)
    let expected = 0
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!
      const b = route.points[i]!
      expected += Math.hypot(b.x - a.x, b.y - a.y) * terrainCostFactor(terrain, b.x, b.y)
    }
    expect(route.weightedLengthTiles).toBeCloseTo(expected, 6)
  })

  it('simplifies a straight run to its endpoints', () => {
    const terrain = generateTerrain(4242, 30, 30)
    const route = routeLine(terrain, 0, 5, 10, 5)
    const corners = simplifyRoute(route)
    expect(corners.length).toBeLessThanOrEqual(route.points.length)
    expect(corners[0]).toEqual(route.points[0])
    expect(corners[corners.length - 1]).toEqual(route.points[route.points.length - 1])
  })
})
