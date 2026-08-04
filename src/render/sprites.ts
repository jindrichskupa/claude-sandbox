/**
 * Pixel-art sprites for the things on the map.
 *
 * Same discipline as the tileset: fixed palette, light from the north-west, no blending. The
 * sprites are 16×16 like the tiles but each is drawn to be recognisable at a glance from its
 * silhouette alone, because at this size that is all the player really reads — a cooling
 * tower's waist, a turbine's three blades, a pylon's lattice.
 */

import { Texture } from 'pixi.js'
import type { PlantCategory, PlantTypeId } from '@content/plantTypes'
import { PALETTE, TILE_SOURCE_PX } from './pixelArt'

function makeCanvas(size = TILE_SOURCE_PX): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas)
  texture.source.scaleMode = 'nearest'
  return texture
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  ctx.fillStyle = colour
  ctx.fillRect(x, y, 1, 1)
}

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
): void {
  ctx.fillStyle = colour
  ctx.fillRect(x, y, w, h)
}

/** A box with a lit left edge and a shadowed right edge. The workhorse of the whole set. */
function shadedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  light: string,
  mid: string,
  dark: string,
): void {
  rect(ctx, x, y, w, h, mid)
  rect(ctx, x, y, 1, h, light)
  rect(ctx, x, y, w, 1, light)
  rect(ctx, x + w - 1, y, 1, h, dark)
  rect(ctx, x, y + h - 1, w, 1, dark)
}

/** A hyperbolic cooling tower: wide base, pinched waist, flared lip, with a plume. */
function coolingTower(ctx: CanvasRenderingContext2D, cx: number, baseY: number, height: number): void {
  for (let row = 0; row < height; row++) {
    const t = row / Math.max(1, height - 1)
    // Wide at both ends and narrow in the middle is what makes the shape unmistakable.
    const halfWidth = Math.round(3 - 1.6 * Math.sin(Math.PI * t))
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      px(ctx, cx + dx, baseY - row, dx > 0 ? PALETTE.concreteDark : PALETTE.concrete)
    }
  }
  const top = baseY - height
  for (let dx = -3; dx <= 3; dx++) px(ctx, cx + dx, top, PALETTE.concrete)
  // Plume, drifting north-east.
  px(ctx, cx, top - 1, PALETTE.smoke)
  px(ctx, cx + 1, top - 2, PALETTE.smoke)
  px(ctx, cx + 1, top - 3, PALETTE.smoke)
}

/** A chimney with a banded top. */
function chimney(ctx: CanvasRenderingContext2D, x: number, baseY: number, height: number): void {
  for (let row = 0; row < height; row++) {
    px(ctx, x, baseY - row, PALETTE.concrete)
    px(ctx, x + 1, baseY - row, PALETTE.concreteDark)
  }
  px(ctx, x, baseY - height, PALETTE.ember)
  px(ctx, x + 1, baseY - height, PALETTE.ember)
}

type SpritePainter = (ctx: CanvasRenderingContext2D) => void

const PLANT_PAINTERS: Partial<Record<PlantTypeId, SpritePainter>> = {
  coal: (ctx) => {
    shadedBox(ctx, 2, 9, 12, 6, PALETTE.concrete, PALETTE.concreteDark, PALETTE.rockDark)
    chimney(ctx, 4, 9, 7)
    chimney(ctx, 7, 9, 5)
    coolingTower(ctx, 11, 9, 6)
    px(ctx, 3, 12, PALETTE.window)
    px(ctx, 6, 12, PALETTE.window)
  },

  lignite: (ctx) => {
    shadedBox(ctx, 1, 9, 13, 6, PALETTE.concrete, PALETTE.concreteDark, PALETTE.rockDark)
    coolingTower(ctx, 4, 9, 7)
    coolingTower(ctx, 10, 9, 7)
    chimney(ctx, 7, 9, 8)
    px(ctx, 2, 13, PALETTE.windowDim)
    px(ctx, 12, 13, PALETTE.windowDim)
  },

  ccgt: (ctx) => {
    shadedBox(ctx, 2, 8, 11, 7, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    // Heat-recovery boiler: a tall thin box beside the turbine hall.
    shadedBox(ctx, 10, 4, 4, 11, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    chimney(ctx, 12, 4, 3)
    for (let x = 3; x <= 8; x += 2) px(ctx, x, 11, PALETTE.window)
  },

  ocgt: (ctx) => {
    shadedBox(ctx, 3, 10, 10, 5, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    chimney(ctx, 5, 10, 5)
    chimney(ctx, 9, 10, 5)
    px(ctx, 4, 12, PALETTE.window)
  },

  nuclear: (ctx) => {
    // The containment dome is the whole silhouette.
    const cx = 5
    const cy = 10
    for (let dy = -4; dy <= 0; dy++) {
      const halfWidth = Math.round(Math.sqrt(Math.max(0, 16 - dy * dy)))
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        px(ctx, cx + dx, cy + dy, dx > 1 ? PALETTE.concreteDark : PALETTE.concrete)
      }
    }
    rect(ctx, cx - 4, 11, 9, 4, PALETTE.concreteDark)
    coolingTower(ctx, 12, 11, 7)
    px(ctx, cx, 6, PALETTE.steelLight)
  },

  hydro: (ctx) => {
    // Water above, dam wall, spillway below.
    rect(ctx, 0, 2, TILE_SOURCE_PX, 5, PALETTE.river)
    rect(ctx, 0, 2, TILE_SOURCE_PX, 1, PALETTE.riverDark)
    rect(ctx, 1, 7, 14, 4, PALETTE.concrete)
    rect(ctx, 1, 7, 14, 1, PALETTE.steelLight)
    rect(ctx, 1, 10, 14, 1, PALETTE.concreteDark)
    for (let x = 3; x < 13; x += 3) {
      rect(ctx, x, 11, 2, 3, PALETTE.waterLight)
    }
    rect(ctx, 0, 14, TILE_SOURCE_PX, 2, PALETTE.riverDark)
  },

  pumped: (ctx) => {
    rect(ctx, 2, 1, 12, 4, PALETTE.river)
    rect(ctx, 2, 1, 12, 1, PALETTE.riverDark)
    rect(ctx, 1, 5, 14, 2, PALETTE.concrete)
    // Penstock running down the hillside.
    for (let i = 0; i < 6; i++) px(ctx, 7 + Math.floor(i / 3), 7 + i, PALETTE.steel)
    rect(ctx, 0, 12, TILE_SOURCE_PX, 4, PALETTE.river)
    rect(ctx, 0, 12, TILE_SOURCE_PX, 1, PALETTE.riverDark)
    shadedBox(ctx, 9, 11, 5, 4, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
  },

  wind: (ctx) => {
    // Two turbines at different scales, to suggest a farm rather than one machine.
    const turbine = (cx: number, baseY: number, height: number) => {
      for (let i = 0; i < height; i++) px(ctx, cx, baseY - i, PALETTE.steelLight)
      const hub = baseY - height
      px(ctx, cx, hub, PALETTE.steelDark)
      // Three blades at 120 degrees, drawn as short runs.
      for (let i = 1; i <= 3; i++) {
        px(ctx, cx, hub - i, PALETTE.steelLight)
        px(ctx, cx + i, hub + Math.floor(i / 2), PALETTE.steelLight)
        px(ctx, cx - i, hub + Math.floor(i / 2), PALETTE.steelLight)
      }
    }
    turbine(5, 14, 8)
    turbine(11, 15, 5)
  },

  solar: (ctx) => {
    // Rows of panels, tilted, in perspective — darker at the back.
    for (let row = 0; row < 4; row++) {
      const y = 4 + row * 3
      const shade = row < 2 ? PALETTE.steelDark : PALETTE.steel
      for (let x = 2; x < 14; x++) {
        px(ctx, x, y, shade)
        px(ctx, x, y + 1, PALETTE.rockDark)
      }
      // A glint on the leading edge of each row.
      px(ctx, 3 + row, y, PALETTE.steelLight)
    }
  },

  battery: (ctx) => {
    // A row of containers, one with a charge indicator.
    shadedBox(ctx, 1, 6, 6, 5, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    shadedBox(ctx, 8, 6, 6, 5, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    shadedBox(ctx, 4, 11, 8, 4, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    for (let x = 2; x <= 5; x++) px(ctx, x, 8, PALETTE.window)
    px(ctx, 10, 8, PALETTE.windowDim)
  },

  gas_chp: (ctx) => {
    shadedBox(ctx, 2, 8, 10, 7, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
    chimney(ctx, 4, 8, 6)
    // Heat accumulator: the fat cylinder that marks a cogeneration plant.
    shadedBox(ctx, 11, 5, 4, 10, PALETTE.concrete, PALETTE.concreteDark, PALETTE.rockDark)
    px(ctx, 12, 7, PALETTE.ember)
    px(ctx, 3, 11, PALETTE.window)
    px(ctx, 6, 11, PALETTE.window)
  },
}

/** A town: a cluster of buildings whose windows light up at night. */
function paintCity(ctx: CanvasRenderingContext2D, size: 'small' | 'large', lit: boolean): void {
  const windows = lit ? PALETTE.window : PALETTE.windowDim
  const blocks: Array<[number, number, number, number]> =
    size === 'large'
      ? [
          [1, 7, 4, 8],
          [6, 4, 4, 11],
          [11, 8, 4, 7],
          [4, 10, 3, 5],
        ]
      : [
          [3, 9, 4, 6],
          [8, 7, 4, 8],
        ]

  for (const [x, y, w, h] of blocks) {
    shadedBox(ctx, x, y, w, h, PALETTE.concrete, PALETTE.concreteDark, PALETTE.rockDark)
    for (let wy = y + 2; wy < y + h - 1; wy += 2) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) px(ctx, wx, wy, windows)
    }
  }
}

/** A switching station: a fenced compound of transformers and busbars. */
function paintSubstation(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 2, 5, 12, 9, PALETTE.rockDark)
  rect(ctx, 3, 6, 10, 7, PALETTE.hillDark)
  // Transformers.
  shadedBox(ctx, 4, 8, 3, 4, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
  shadedBox(ctx, 9, 8, 3, 4, PALETTE.steelLight, PALETTE.steel, PALETTE.steelDark)
  // Busbar gantry across the top.
  for (let x = 3; x < 13; x++) px(ctx, x, 6, PALETTE.steelLight)
  px(ctx, 5, 7, PALETTE.steelDark)
  px(ctx, 10, 7, PALETTE.steelDark)
}

/**
 * A lattice pylon, seen head on.
 *
 * Drawn as its own sprite rather than as lines, so it keeps crisp pixel edges at every zoom
 * instead of turning into a grey smudge the way a vector-drawn lattice would.
 */
function paintPylon(ctx: CanvasRenderingContext2D, tall: boolean): void {
  const size = 16
  const baseY = size - 1
  const height = tall ? 13 : 9
  const topY = baseY - height
  const halfBase = tall ? 4 : 3

  // Two splayed legs meeting at the waist.
  for (let i = 0; i <= height; i++) {
    const t = i / height
    const half = Math.round(halfBase * (1 - t * 0.75))
    px(ctx, 8 - half, baseY - i, PALETTE.steel)
    px(ctx, 8 + half, baseY - i, PALETTE.steelDark)
  }
  // Cross-bracing, every other row, alternating direction.
  for (let i = 1; i < height; i += 2) {
    const t = i / height
    const half = Math.round(halfBase * (1 - t * 0.75))
    for (let dx = -half; dx <= half; dx++) px(ctx, 8 + dx, baseY - i, PALETTE.steelDark)
  }
  // Cross-arms, where the conductors hang.
  const arms = tall ? [topY + 1, topY + 4] : [topY + 2]
  for (const armY of arms) {
    for (let dx = -5; dx <= 5; dx++) px(ctx, 8 + dx, armY, PALETTE.steelLight)
    px(ctx, 3, armY + 1, PALETTE.steelDark)
    px(ctx, 13, armY + 1, PALETTE.steelDark)
  }
  px(ctx, 8, topY, PALETTE.steelLight)
}

export interface SpriteSet {
  plants: Partial<Record<PlantTypeId, Texture>>
  /** Fallback per category, for any technology without its own drawing. */
  categories: Partial<Record<PlantCategory, Texture>>
  cityLarge: Texture
  cityLargeLit: Texture
  citySmall: Texture
  citySmallLit: Texture
  substation: Texture
  pylonTall: Texture
  pylonShort: Texture
}

export function buildSprites(): SpriteSet {
  const plants: Partial<Record<PlantTypeId, Texture>> = {}
  for (const [id, painter] of Object.entries(PLANT_PAINTERS)) {
    const { canvas, ctx } = makeCanvas()
    painter(ctx)
    plants[id as PlantTypeId] = toTexture(canvas)
  }

  const categories: Partial<Record<PlantCategory, Texture>> = {}
  const fallbacks: Array<[PlantCategory, PlantTypeId]> = [
    ['thermal', 'ccgt'],
    ['nuclear', 'nuclear'],
    ['hydro', 'hydro'],
    ['wind', 'wind'],
    ['solar', 'solar'],
    ['storage', 'battery'],
  ]
  for (const [category, typeId] of fallbacks) {
    const texture = plants[typeId]
    if (texture) categories[category] = texture
  }

  const city = (size: 'small' | 'large', lit: boolean) => {
    const { canvas, ctx } = makeCanvas()
    paintCity(ctx, size, lit)
    return toTexture(canvas)
  }

  const substationCanvas = makeCanvas()
  paintSubstation(substationCanvas.ctx)

  const tall = makeCanvas()
  paintPylon(tall.ctx, true)
  const short = makeCanvas()
  paintPylon(short.ctx, false)

  return {
    plants,
    categories,
    cityLarge: city('large', false),
    cityLargeLit: city('large', true),
    citySmall: city('small', false),
    citySmallLit: city('small', true),
    substation: toTexture(substationCanvas.canvas),
    pylonTall: toTexture(tall.canvas),
    pylonShort: toTexture(short.canvas),
  }
}
