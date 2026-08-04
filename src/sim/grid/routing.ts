/**
 * Routing a transmission line across the map.
 *
 * Until now a line was a straight segment between two substations and its cost was the
 * straight-line distance times an average of the ground it crossed. That is a reasonable
 * approximation and a poor decision: the player could not choose to go *around* a mountain,
 * because there was no going around anything.
 *
 * A route is a path over tiles found by A*, weighted by what each tile costs to cross. The
 * result is that a corridor following a valley can genuinely be cheaper than the direct line
 * over a ridge, and the difference is something the player can see and act on.
 */

import { terrainCostFactor, type TerrainMap } from '../map/terrain'

export interface RoutePoint {
  x: number
  y: number
}

export interface Route {
  points: RoutePoint[]
  /** Length in tiles, counting diagonals properly. */
  lengthTiles: number
  /** Length weighted by what the ground costs to cross. */
  weightedLengthTiles: number
}

/** Straight line between two points, for when routing is not wanted or not possible. */
export function straightRoute(terrain: TerrainMap, ax: number, ay: number, bx: number, by: number): Route {
  const distance = Math.hypot(bx - ax, by - ay)
  const steps = Math.max(1, Math.ceil(distance))
  const points: RoutePoint[] = []
  let weighted = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = Math.round(ax + (bx - ax) * t)
    const y = Math.round(ay + (by - ay) * t)
    points.push({ x, y })
    if (i > 0) weighted += (distance / steps) * terrainCostFactor(terrain, x, y)
  }
  return { points, lengthTiles: distance, weightedLengthTiles: weighted }
}

/** Binary heap keyed by estimated total cost. */
class Heap {
  private readonly keys: number[] = []
  private readonly vals: number[] = []

  get size(): number {
    return this.vals.length
  }

  push(key: number, val: number): void {
    this.keys.push(key)
    this.vals.push(val)
    let i = this.vals.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p]! <= this.keys[i]!) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.vals[0]!
    const lastKey = this.keys.pop()!
    const lastVal = this.vals.pop()!
    if (this.vals.length > 0) {
      this.keys[0] = lastKey
      this.vals[0] = lastVal
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.vals.length && this.keys[l]! < this.keys[m]!) m = l
        if (r < this.vals.length && this.keys[r]! < this.keys[m]!) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!
    this.keys[a] = this.keys[b]!
    this.keys[b] = k
    const v = this.vals[a]!
    this.vals[a] = this.vals[b]!
    this.vals[b] = v
  }
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/**
 * Cheapest route between two tiles.
 *
 * A* with an admissible heuristic: straight-line distance times the cheapest possible ground
 * cost, which is 1. That keeps the search optimal while still pulling it toward the target
 * rather than expanding in all directions.
 *
 * A small penalty for changing direction keeps routes from zig-zagging between two equal-cost
 * diagonal steps. Real transmission corridors run straight where they can, and a wandering
 * line looks like a bug even when its cost is correct.
 */
export function routeLine(
  terrain: TerrainMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  options: { turnPenalty?: number } = {},
): Route {
  // Small enough that it only breaks ties between equally good corridors, never large enough
  // to make the route materially more expensive just to look tidy.
  const turnPenalty = options.turnPenalty ?? 0.05
  const { width, height } = terrain

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
  if (!inBounds(ax, ay) || !inBounds(bx, by)) return straightRoute(terrain, ax, ay, bx, by)

  const size = width * height
  const gScore = new Float64Array(size).fill(Infinity)
  const cameFrom = new Int32Array(size).fill(-1)
  const closed = new Uint8Array(size)
  // Direction of arrival, so a change of heading can be charged for.
  const arrivedDx = new Int8Array(size)
  const arrivedDy = new Int8Array(size)

  const start = ay * width + ax
  const goal = by * width + bx
  gScore[start] = 0

  const open = new Heap()
  open.push(Math.hypot(bx - ax, by - ay), start)

  while (open.size > 0) {
    const current = open.pop()
    if (closed[current]) continue
    closed[current] = 1
    if (current === goal) break

    const cx = current % width
    const cy = (current / width) | 0
    const pdx = arrivedDx[current]!
    const pdy = arrivedDy[current]!

    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inBounds(nx, ny)) continue
      const next = ny * width + nx
      if (closed[next]) continue

      // The cost of a step is what it costs to arrive on the new tile.
      const ground = terrainCostFactor(terrain, nx, ny)
      const turned = (pdx !== 0 || pdy !== 0) && (pdx !== dx || pdy !== dy) ? turnPenalty : 0
      const tentative = gScore[current]! + step * ground + turned

      if (tentative < gScore[next]!) {
        gScore[next] = tentative
        cameFrom[next] = current
        arrivedDx[next] = dx
        arrivedDy[next] = dy
        open.push(tentative + Math.hypot(bx - nx, by - ny), next)
      }
    }
  }

  if (cameFrom[goal] === -1 && goal !== start) return straightRoute(terrain, ax, ay, bx, by)

  const points: RoutePoint[] = []
  for (let node = goal; node !== -1; node = cameFrom[node]!) {
    points.push({ x: node % width, y: (node / width) | 0 })
    if (node === start) break
  }
  points.reverse()

  let lengthTiles = 0
  let weightedLengthTiles = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const step = Math.hypot(b.x - a.x, b.y - a.y)
    lengthTiles += step
    weightedLengthTiles += step * terrainCostFactor(terrain, b.x, b.y)
  }

  return { points, lengthTiles, weightedLengthTiles }
}

/**
 * Thin a route down to the corners, which is all the renderer needs to draw it and all a
 * save file needs to store. A straight run of twenty tiles becomes two points.
 */
export function simplifyRoute(route: Route): RoutePoint[] {
  const points = route.points
  if (points.length <= 2) return [...points]

  const out: RoutePoint[] = [points[0]!]
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!
    const here = points[i]!
    const next = points[i + 1]!
    const inDx = Math.sign(here.x - previous.x)
    const inDy = Math.sign(here.y - previous.y)
    const outDx = Math.sign(next.x - here.x)
    const outDy = Math.sign(next.y - here.y)
    if (inDx !== outDx || inDy !== outDy) out.push(here)
  }
  out.push(points[points.length - 1]!)
  return out
}
