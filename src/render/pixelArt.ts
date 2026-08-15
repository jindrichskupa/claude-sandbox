/**
 * The pixel-art tileset.
 *
 * There is no artist and no asset pipeline here, so the tiles are drawn programmatically into
 * an offscreen canvas at 16×16 and handed to Pixi as textures. That constraint turns out to
 * suit the style: pixel art is mostly discipline rather than draughtsmanship — a small fixed
 * palette, one light direction, no anti-aliasing, and detail placed deliberately rather than
 * smeared. All of that is easier to enforce in code than by hand.
 *
 * Two rules make the difference between "low resolution" and "pixel art":
 *
 *   Every colour comes from `PALETTE`. Nothing is blended, faded or alpha-composited into an
 *   intermediate shade, because a stray in-between colour is what makes pixel art look muddy.
 *
 *   Textures are sampled with nearest-neighbour and drawn at integer scale, so a source pixel
 *   is always a crisp square of screen pixels rather than a blurred one.
 */

import { Texture } from 'pixi.js'
import { Tile } from '@sim/map/terrain'

/** Source resolution of one tile. */
export const TILE_SOURCE_PX = 16
/** How many variants of each terrain tile are generated. */
// Enough that the eye stops noticing the repeat. Four was visibly not.
const VARIANTS = 8

/**
 * A deliberately small palette. Each terrain family gets a dark, a mid and a light shade, so
 * everything can be shaded with the same light direction — from the north-west, as is
 * traditional and as makes height read correctly.
 */
export const PALETTE = {
  deepWater: '#12293d',
  water: '#1b3f5c',
  waterLight: '#2a5f7f',
  foam: '#5f97b0',

  sand: '#8a7c52',

  grassDark: '#2f4a2c',
  grass: '#3e6138',
  grassLight: '#4e7742',

  forestDark: '#1e3520',
  forest: '#2a4a2b',
  forestLight: '#38603a',

  hillDark: '#4a4a2e',
  hill: '#5f5d38',
  hillLight: '#767244',

  rockDark: '#45423c',
  rock: '#5c584f',
  rockLight: '#787264',
  snow: '#c8ccc4',

  riverDark: '#20455e',
  river: '#2d5f7d',

  steel: '#7d8794',
  steelDark: '#4a525c',
  steelLight: '#a8b2bd',
  concrete: '#8e8c85',
  concreteDark: '#5e5c57',

  ember: '#c8622f',
  emberLight: '#e8944a',
  smoke: '#6a6a6a',
  window: '#e8c96a',
  windowDim: '#7a6a3a',
} as const

type Painter = (ctx: CanvasRenderingContext2D, rng: () => number) => void

/** Deterministic little generator, so a tileset is identical every run. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  ctx.fillStyle = colour
  ctx.fillRect(x, y, 1, 1)
}

function fill(ctx: CanvasRenderingContext2D, colour: string): void {
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, TILE_SOURCE_PX, TILE_SOURCE_PX)
}

/** Scatter `count` single pixels of a colour, avoiding the outermost ring. */
function speckle(ctx: CanvasRenderingContext2D, rng: () => number, colour: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(rng() * (TILE_SOURCE_PX - 2))
    const y = 1 + Math.floor(rng() * (TILE_SOURCE_PX - 2))
    px(ctx, x, y, colour)
  }
}

/** A two-pixel tuft of grass, which is what stops a green square looking like a green square. */
function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, light: string, dark: string): void {
  px(ctx, x, y, light)
  px(ctx, x, y + 1, dark)
  px(ctx, x + 1, y + 1, dark)
}

/** A conifer, drawn as a triangle with a shaded right side and a trunk. */
function conifer(ctx: CanvasRenderingContext2D, cx: number, cy: number, height: number): void {
  for (let row = 0; row < height; row++) {
    const halfWidth = Math.floor(row / 2)
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      px(ctx, cx + dx, cy + row, dx > 0 ? PALETTE.forestDark : PALETTE.forestLight)
    }
  }
  px(ctx, cx, cy + height, PALETTE.rockDark)
}

const PAINTERS: Record<Tile, Painter> = {
  [Tile.Water]: (ctx, rng) => {
    fill(ctx, PALETTE.water)
    // Horizontal ripples, spaced irregularly so the sea does not look like corduroy.
    for (let y = 1; y < TILE_SOURCE_PX; y += 3) {
      const offset = Math.floor(rng() * 6)
      const length = 3 + Math.floor(rng() * 4)
      for (let i = 0; i < length; i++) {
        px(ctx, (offset + i) % TILE_SOURCE_PX, y, PALETTE.waterLight)
      }
    }
    speckle(ctx, rng, PALETTE.deepWater, 6)
  },

  [Tile.Plain]: (ctx, rng) => {
    fill(ctx, PALETTE.grass)
    speckle(ctx, rng, PALETTE.grassDark, 20)
    speckle(ctx, rng, PALETTE.grassLight, 14)
    // Occasional bare earth, so farmland is not a uniform green.
    if (rng() < 0.4) {
      const x = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 6))
      const y = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 4))
      for (let d = 0; d < 4; d++) px(ctx, x + d, y, PALETTE.sand)
    }
    for (let i = 0; i < 6; i++) {
      tuft(
        ctx,
        1 + Math.floor(rng() * (TILE_SOURCE_PX - 3)),
        1 + Math.floor(rng() * (TILE_SOURCE_PX - 3)),
        PALETTE.grassLight,
        PALETTE.grassDark,
      )
    }
  },

  [Tile.Forest]: (ctx, rng) => {
    fill(ctx, PALETTE.forest)
    speckle(ctx, rng, PALETTE.forestDark, 12)
    // Trees are one of the few motifs that tile happily, because a wood really is a
    // repetition of the same shape. Even so, vary the count and the sizes.
    const count = 3 + Math.floor(rng() * 3)
    for (let i = 0; i < count; i++) {
      const cx = 3 + Math.floor(rng() * (TILE_SOURCE_PX - 6))
      const cy = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 9))
      conifer(ctx, cx, cy, 5 + Math.floor(rng() * 2))
    }
  },

  [Tile.Hill]: (ctx, rng) => {
    // Rough upland *texture*, not a picture of a hill. A tile is ground seen from above and
    // repeats hundreds of times; anything with a strong silhouette turns the map into
    // wallpaper, which is exactly what a single repeated peak did.
    fill(ctx, PALETTE.hill)
    speckle(ctx, rng, PALETTE.hillDark, 22)
    speckle(ctx, rng, PALETTE.hillLight, 16)
    // Short contour strokes suggesting slope, lit from the north-west.
    for (let i = 0; i < 4; i++) {
      const x = 1 + Math.floor(rng() * (TILE_SOURCE_PX - 6))
      const y = 1 + Math.floor(rng() * (TILE_SOURCE_PX - 2))
      const length = 3 + Math.floor(rng() * 4)
      for (let d = 0; d < length; d++) {
        px(ctx, x + d, y, PALETTE.hillLight)
        px(ctx, x + d, y + 1, PALETTE.hillDark)
      }
    }
    // A few boulders.
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 4))
      const y = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 4))
      px(ctx, x, y, PALETTE.rockLight)
      px(ctx, x + 1, y, PALETTE.rock)
      px(ctx, x, y + 1, PALETTE.rockDark)
      px(ctx, x + 1, y + 1, PALETTE.rockDark)
    }
  },

  [Tile.Mountain]: (ctx, rng) => {
    fill(ctx, PALETTE.rock)
    speckle(ctx, rng, PALETTE.rockDark, 26)
    speckle(ctx, rng, PALETTE.rockLight, 18)

    // Crags: short diagonal fractures with a lit and a shadowed side. Repeating rock texture
    // reads as one continuous massif; a repeating peak icon reads as a tiling error.
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 6))
      const y = 2 + Math.floor(rng() * (TILE_SOURCE_PX - 6))
      const length = 3 + Math.floor(rng() * 4)
      const slope = rng() < 0.5 ? 1 : -1
      for (let d = 0; d < length; d++) {
        px(ctx, x + d, y + d * slope, PALETTE.rockLight)
        px(ctx, x + d, y + d * slope + 1, PALETTE.rockDark)
      }
    }

    // Snow gathers in the hollows on about a third of tiles.
    if (rng() < 0.35) {
      const x = 3 + Math.floor(rng() * (TILE_SOURCE_PX - 7))
      const y = 3 + Math.floor(rng() * (TILE_SOURCE_PX - 7))
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 4 - dy; dx++) px(ctx, x + dx, y + dy, PALETTE.snow)
      }
    }
  },
}

export interface Tileset {
  terrain: Record<Tile, Texture[]>
  /** Shoreline overlays, indexed by a 4-bit mask of which sides face water. */
  shoreline: Texture[]
  /**
   * Corner overlays, indexed by a 4-bit mask of which *diagonals* face water.
   *
   * Separate from the edge strips rather than folded into one 256-entry table, because the two
   * are independent: a tile can have any combination of straight edges and any combination of
   * corners, and the eight-bit product would be sixteen times the textures to say the same thing.
   *
   * Without these a coastline running diagonally is a staircase of square steps, and a tile whose
   * only water neighbour is diagonal gets a mask of zero and no shoreline at all — a hard square
   * corner sitting in the sea.
   */
  shoreCorner: Texture[]
  /** River overlays, indexed by a 4-bit mask of which sides the water continues toward. */
  river: Texture[]
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_SOURCE_PX
  canvas.height = TILE_SOURCE_PX
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas)
  // Nearest-neighbour is the whole difference between pixel art and a blurry mess.
  texture.source.scaleMode = 'nearest'
  return texture
}

/** North, east, south, west, as bits of the edge mask. */
export const EDGE_N = 1
export const EDGE_E = 2
export const EDGE_S = 4
export const EDGE_W = 8

/** The four diagonals, for the corner overlays. */
export const CORNER_NE = 1
export const CORNER_SE = 2
export const CORNER_SW = 4
export const CORNER_NW = 8

/**
 * A strip of foam along whichever edges face open water.
 *
 * This is what makes a coastline read as a coastline rather than as two flat colours meeting
 * at a hard grid line, and it is far cheaper than a full autotiling set: sixteen small
 * overlays instead of forty-seven distinct corner tiles.
 */
function paintShoreline(ctx: CanvasRenderingContext2D, mask: number, rng: () => number): void {
  ctx.clearRect(0, 0, TILE_SOURCE_PX, TILE_SOURCE_PX)
  const edge = (horizontal: boolean, atStart: boolean) => {
    for (let i = 0; i < TILE_SOURCE_PX; i++) {
      const depth = 1 + (rng() < 0.35 ? 1 : 0)
      for (let d = 0; d < depth; d++) {
        const near = atStart ? d : TILE_SOURCE_PX - 1 - d
        const x = horizontal ? i : near
        const y = horizontal ? near : i
        px(ctx, x, y, d === 0 ? PALETTE.foam : PALETTE.sand)
      }
    }
  }
  if (mask & EDGE_N) edge(true, true)
  if (mask & EDGE_S) edge(true, false)
  if (mask & EDGE_W) edge(false, true)
  if (mask & EDGE_E) edge(false, false)

  // Where two of those strips meet, the land is chamfered rather than left at ninety degrees.
  //
  // This is what a diagonal coastline is actually made of: not diagonal tiles, but a staircase of
  // tiles each with water on two adjoining sides. Strips alone leave every one of those steps a
  // hard square corner, and a run of them reads as masonry rather than as a shore. Taking a few
  // pixels off the outside of the corner is enough for the eye to join them into a line.
  const chamfer = (atRight: boolean, atBottom: boolean) => {
    const depth = 4
    for (let dy = 0; dy < depth; dy++) {
      for (let dx = 0; dx < depth; dx++) {
        const r = dx + dy
        if (r >= depth) continue
        if (r === depth - 1 && rng() < 0.5) continue
        const x = atRight ? TILE_SOURCE_PX - 1 - dx : dx
        const y = atBottom ? TILE_SOURCE_PX - 1 - dy : dy
        px(ctx, x, y, r <= 1 ? PALETTE.foam : PALETTE.sand)
      }
    }
  }
  if (mask & EDGE_N && mask & EDGE_E) chamfer(true, false)
  if (mask & EDGE_S && mask & EDGE_E) chamfer(true, true)
  if (mask & EDGE_S && mask & EDGE_W) chamfer(false, true)
  if (mask & EDGE_N && mask & EDGE_W) chamfer(false, false)
}

/**
 * The rounded-off corner where the coast turns.
 *
 * A quarter-disc of foam and sand bitten out of the corner of the tile, drawn wherever the water
 * lies diagonally. Bitten out rather than added: the land tile underneath is already painted, so
 * what this contributes is the beach that softens the ninety-degree step the tile grid would
 * otherwise leave there.
 */
function paintShoreCorner(ctx: CanvasRenderingContext2D, mask: number, rng: () => number): void {
  ctx.clearRect(0, 0, TILE_SOURCE_PX, TILE_SOURCE_PX)
  const corner = (atRight: boolean, atBottom: boolean) => {
    // Three pixels deep, ragged, so a run of corners along a diagonal coast does not read as a
    // row of identical stamps.
    const depth = 3
    for (let dy = 0; dy < depth; dy++) {
      for (let dx = 0; dx < depth; dx++) {
        // Inside the quarter-disc only, and the outermost ring is foam.
        const r = dx + dy
        if (r >= depth) continue
        if (r === depth - 1 && rng() < 0.4) continue
        const x = atRight ? TILE_SOURCE_PX - 1 - dx : dx
        const y = atBottom ? TILE_SOURCE_PX - 1 - dy : dy
        px(ctx, x, y, r === 0 ? PALETTE.foam : PALETTE.sand)
      }
    }
  }
  if (mask & CORNER_NE) corner(true, false)
  if (mask & CORNER_SE) corner(true, true)
  if (mask & CORNER_SW) corner(false, true)
  if (mask & CORNER_NW) corner(false, false)
}

/** A river running through the tile, entering and leaving on whichever sides the mask says. */
function paintRiver(ctx: CanvasRenderingContext2D, mask: number, rng: () => number): void {
  ctx.clearRect(0, 0, TILE_SOURCE_PX, TILE_SOURCE_PX)
  const mid = TILE_SOURCE_PX / 2

  const arm = (dx: number, dy: number) => {
    for (let i = 0; i <= mid; i++) {
      const x = Math.round(mid + dx * i)
      const y = Math.round(mid + dy * i)
      // Two pixels wide, with the bank on one side only — a narrow channel reads as a river,
      // a wide one reads as a canal.
      const side = rng() < 0.5 ? 1 : -1
      px(ctx, x, y, PALETTE.river)
      const bx = dy !== 0 ? x + side : x
      const by = dx !== 0 ? y + side : y
      px(ctx, bx, by, PALETTE.riverDark)
    }
  }

  if (mask & EDGE_N) arm(0, -1)
  if (mask & EDGE_S) arm(0, 1)
  if (mask & EDGE_W) arm(-1, 0)
  if (mask & EDGE_E) arm(1, 0)
  // An isolated stretch still needs a pool, or a source tile is invisible.
  if (mask === 0) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) px(ctx, mid + dx, mid + dy, PALETTE.river)
  }
}

/** Build the whole tileset. Called once at start-up. */
export function buildTileset(seed = 1): Tileset {
  const rng = makeRng(seed)

  const terrain = {} as Record<Tile, Texture[]>
  for (const tile of [Tile.Water, Tile.Plain, Tile.Forest, Tile.Hill, Tile.Mountain]) {
    const variants: Texture[] = []
    for (let v = 0; v < VARIANTS; v++) {
      const { canvas, ctx } = makeCanvas()
      PAINTERS[tile](ctx, rng)
      variants.push(toTexture(canvas))
    }
    terrain[tile] = variants
  }

  const shoreline: Texture[] = []
  const shoreCorner: Texture[] = []
  const river: Texture[] = []
  for (let mask = 0; mask < 16; mask++) {
    const shore = makeCanvas()
    paintShoreline(shore.ctx, mask, rng)
    shoreline.push(toTexture(shore.canvas))

    const corner = makeCanvas()
    paintShoreCorner(corner.ctx, mask, rng)
    shoreCorner.push(toTexture(corner.canvas))

    const stream = makeCanvas()
    paintRiver(stream.ctx, mask, rng)
    river.push(toTexture(stream.canvas))
  }

  return { terrain, shoreline, shoreCorner, river }
}

/** Pick a variant deterministically from tile coordinates, so the map does not shimmer. */
export function variantFor(x: number, y: number): number {
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) % VARIANTS
}
