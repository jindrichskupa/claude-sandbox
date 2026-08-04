/**
 * The map.
 *
 * Layers, from the bottom: terrain (drawn once), transmission lines (redrawn when flows
 * change), power-flow particles (moved every frame), and nodes with their labels.
 *
 * The flow animation is the main thing carrying information here. Particle speed and
 * spacing follow the line's loading, and the colour goes from calm to hot as it approaches
 * its limit, so a saturated corridor is obvious at a glance without reading a single number.
 */

import { Application, Container, Graphics, Sprite, Text, TextStyle, TilingSprite } from 'pixi.js'
import { LINE_TYPES } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import type { World } from '@sim/world'
import type { GridEdge, GridNode } from '@sim/grid/network'
import { isDispatchable } from '@sim/assets/types'
import { Tile, type TerrainMap } from '@sim/map/terrain'
import { judgeSite } from '@sim/build/siting'
import type { PlantTypeId } from '@content/plantTypes'
import { Camera } from './camera'
import { t } from '@i18n/index'
import { buildTileset, EDGE_E, EDGE_N, EDGE_S, EDGE_W, TILE_SOURCE_PX, variantFor, type Tileset } from './pixelArt'
import { buildSprites, type SpriteSet } from './sprites'
import { routeLine, simplifyRoute } from '@sim/grid/routing'

/**
 * Screen size of a tile. An exact multiple of the source resolution, so every source pixel
 * lands on a whole number of screen pixels — the difference between pixel art and a blur.
 */
export const TILE_SCALE = 2
export const TILE_PX = TILE_SOURCE_PX * TILE_SCALE

const CATEGORY_COLOURS: Record<string, number> = {
  thermal: 0xc86a3a,
  nuclear: 0xb455c8,
  hydro: 0x3f9fd0,
  wind: 0x63c8a8,
  solar: 0xe0c04a,
  storage: 0x9aa3b0,
}

function lerpColour(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}

interface Particle {
  edgeId: string
  /** Position along the line, 0..1. */
  t: number
  gfx: Graphics
}

export interface MapViewCallbacks {
  onSelectNode?: (nodeId: string) => void
}

/** What the player is currently placing, if anything. */
export type BuildMode =
  | { kind: 'plant'; typeId: string }
  | { kind: 'line'; kv: 110 | 220 | 400; circuits: number; fromNodeId: string | null }
  | null

export class MapView {
  readonly camera: Camera
  private readonly root = new Container()
  private readonly terrainLayer = new Container()
  private readonly lineLayer = new Graphics()
  private readonly particleLayer = new Container()
  private readonly pylonLayer = new Container()
  private readonly nodeLayer = new Container()
  private readonly labelLayer = new Container()
  private readonly buildLayer = new Graphics()

  private readonly terrain: TerrainMap
  private readonly tileset: Tileset
  private readonly sprites: SpriteSet
  private particles: Particle[] = []
  private nodeGraphics = new Map<string, Graphics>()
  private nodeSprites = new Map<string, Sprite>()
  private lastTopologyEpoch = -1
  selectedNodeId: string | null = null

  buildMode: BuildMode = null
  /** Per-tile suitability for whatever is being placed. Recomputed only when that changes. */
  private siteMask: Float32Array | null = null
  private siteMaskFor: string | null = null
  /** Tile under the cursor, in tile coordinates. */
  hoverTile: { x: number; y: number } | null = null
  /** Set by the UI so the ghost can show whether the placement would be accepted. */
  hoverValid = true

  constructor(
    app: Application,
    private readonly world: World,
    private readonly callbacks: MapViewCallbacks = {},
  ) {
    // Terrain belongs to the world — it decides siting, not just colour.
    this.terrain = world.terrain
    this.tileset = buildTileset(world.scenario.seed)
    this.sprites = buildSprites()
    this.camera = new Camera(app.canvas.width, app.canvas.height)

    this.root.addChild(
      this.terrainLayer,
      this.lineLayer,
      this.pylonLayer,
      this.particleLayer,
      this.buildLayer,
      this.nodeLayer,
      this.labelLayer,
    )
    app.stage.addChild(this.root)

    this.drawTerrain()
    this.buildNodes()
    this.rebuildPylons()
    this.camera.fit(world.scenario.mapWidth * TILE_PX, world.scenario.mapHeight * TILE_PX)
    this.applyCamera()
  }

  /**
   * Lay out the terrain once, as sprites rather than rectangles.
   *
   * A shoreline overlay is added wherever land meets water and a river overlay wherever the
   * drainage is high enough to see, which together do most of the work of making a grid of
   * squares read as landscape.
   */
  private drawTerrain(): void {
    const layer = this.terrainLayer
    layer.removeChildren()

    // Open water well beyond the map bounds, so panning to the edge shows a coastline
    // rather than the abrupt rectangle where the tile array happens to stop.
    // A tiling sprite rather than a flat rectangle: six thousand individual water sprites
    // would be absurd, and a plain fill makes the world stop at a hard rectangle.
    const bleed = 24
    const openSea = new TilingSprite({
      texture: this.tileset.terrain[Tile.Water][0]!,
      width: (this.terrain.width + bleed * 2) * TILE_SOURCE_PX,
      height: (this.terrain.height + bleed * 2) * TILE_SOURCE_PX,
    })
    openSea.scale.set(TILE_SCALE)
    openSea.position.set(-bleed * TILE_PX, -bleed * TILE_PX)
    layer.addChild(openSea)

    const tileAtSafe = (x: number, y: number): Tile => {
      if (x < 0 || y < 0 || x >= this.terrain.width || y >= this.terrain.height) return Tile.Water
      return this.terrain.tiles[y * this.terrain.width + x] as Tile
    }
    const riverAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= this.terrain.width || y >= this.terrain.height) return 0
      return this.terrain.riverIndex[y * this.terrain.width + x] ?? 0
    }

    // Only real rivers are drawn. Lower thresholds pick up every minor gully, and because
    // the drainage is four-connected the result reads as a grid of irrigation canals rather
    // than as a river system.
    const RIVER_VISIBLE = 0.66

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const tile = tileAtSafe(x, y)
        const variants = this.tileset.terrain[tile]
        const sprite = new Sprite(variants[variantFor(x, y) % variants.length])
        sprite.position.set(x * TILE_PX, y * TILE_PX)
        sprite.scale.set(TILE_SCALE)
        layer.addChild(sprite)

        if (tile !== Tile.Water) {
          let mask = 0
          if (tileAtSafe(x, y - 1) === Tile.Water) mask |= EDGE_N
          if (tileAtSafe(x + 1, y) === Tile.Water) mask |= EDGE_E
          if (tileAtSafe(x, y + 1) === Tile.Water) mask |= EDGE_S
          if (tileAtSafe(x - 1, y) === Tile.Water) mask |= EDGE_W
          if (mask !== 0) {
            const shore = new Sprite(this.tileset.shoreline[mask]!)
            shore.position.set(x * TILE_PX, y * TILE_PX)
            shore.scale.set(TILE_SCALE)
            layer.addChild(shore)
          }

          if (riverAt(x, y) >= RIVER_VISIBLE) {
            // The arms point wherever the water continues, so a river joins up across tiles.
            let flow = 0
            if (riverAt(x, y - 1) >= RIVER_VISIBLE || tileAtSafe(x, y - 1) === Tile.Water) flow |= EDGE_N
            if (riverAt(x + 1, y) >= RIVER_VISIBLE || tileAtSafe(x + 1, y) === Tile.Water) flow |= EDGE_E
            if (riverAt(x, y + 1) >= RIVER_VISIBLE || tileAtSafe(x, y + 1) === Tile.Water) flow |= EDGE_S
            if (riverAt(x - 1, y) >= RIVER_VISIBLE || tileAtSafe(x - 1, y) === Tile.Water) flow |= EDGE_W
            const river = new Sprite(this.tileset.river[flow]!)
            river.position.set(x * TILE_PX, y * TILE_PX)
            river.scale.set(TILE_SCALE)
            layer.addChild(river)
          }
        }
      }
    }

    // Baked into one texture: twelve hundred sprites are fine to build once and hopeless to
    // re-traverse every frame.
    layer.cacheAsTexture(true)
  }

  private buildNodes(): void {
    this.nodeLayer.removeChildren()
    this.labelLayer.removeChildren()
    this.nodeGraphics.clear()
    this.nodeSprites.clear()

    const labelStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      fill: 0xe8eef4,
      stroke: { color: 0x0b1015, width: 3 },
    })

    for (const node of this.world.network.allNodes()) {
      const holder = new Container()
      holder.position.set(node.x * TILE_PX + TILE_PX / 2, node.y * TILE_PX + TILE_PX / 2)

      const sprite = new Sprite(this.textureForNode(node))
      sprite.anchor.set(0.5, 0.5)
      sprite.scale.set(TILE_SCALE)
      holder.addChild(sprite)
      this.nodeSprites.set(node.id, sprite)

      // The status ring sits under the sprite so it never hides the artwork.
      const ring = new Graphics()
      holder.addChildAt(ring, 0)
      this.nodeGraphics.set(node.id, ring)

      holder.eventMode = 'static'
      holder.cursor = 'pointer'
      holder.hitArea = { contains: (x: number, y: number) => Math.abs(x) < TILE_PX / 2 && Math.abs(y) < TILE_PX / 2 }
      holder.on('pointertap', () => {
        this.selectedNodeId = node.id
        this.callbacks.onSelectNode?.(node.id)
      })
      this.nodeLayer.addChild(holder)

      const labelText = nodeLabel(node)
      if (labelText) {
        const label = new Text({ text: labelText, style: labelStyle })
        label.anchor.set(0.5, 0)
        label.position.set(node.x * TILE_PX + TILE_PX / 2, node.y * TILE_PX + TILE_PX)
        this.labelLayer.addChild(label)
      }
    }
    this.lastTopologyEpoch = this.world.network.topologyEpoch
  }

  /** Which sprite a node wears: its technology, its size as a town, or a switching yard. */
  private textureForNode(node: GridNode) {
    if (node.kind === 'city') {
      const city = this.world.cities.find((c) => c.nodeId === node.id)
      const large = (city?.baseDemandMw ?? 0) >= 200
      return large ? this.sprites.cityLarge : this.sprites.citySmall
    }
    if (node.kind === 'plant') {
      const plant = this.world.plants.find((p) => p.nodeId === node.id)
      if (plant) {
        return (
          this.sprites.plants[plant.typeId] ??
          this.sprites.categories[PLANT_TYPES[plant.typeId].category] ??
          this.sprites.substation
        )
      }
    }
    return this.sprites.substation
  }

  /** Redraw everything that depends on the latest dispatch. Called once per simulation tick. */
  syncToWorld(): void {
    if (this.world.network.topologyEpoch !== this.lastTopologyEpoch) {
      this.buildNodes()
      this.rebuildPylons()
      this.particles = []
      this.particleLayer.removeChildren()
    }
    this.drawLines()
    this.drawNodes()
    this.syncParticles()
  }

  private edgeCapacity(edge: GridEdge): number {
    return edge.kv === 0 ? 0 : LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
  }

  /** The corridor a line follows, in world pixels. Straight for anything without a route. */
  private edgePath(edge: GridEdge): Array<{ x: number; y: number }> {
    const centre = (p: { x: number; y: number }) => ({
      x: p.x * TILE_PX + TILE_PX / 2,
      y: p.y * TILE_PX + TILE_PX / 2,
    })
    if (edge.route && edge.route.length >= 2) return edge.route.map(centre)
    return [centre(this.world.network.requireNode(edge.from)), centre(this.world.network.requireNode(edge.to))]
  }

  /** Total length of a path, so particles can be placed evenly along a bent route. */
  private pathLength(path: Array<{ x: number; y: number }>): number {
    let total = 0
    for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y)
    return total
  }

  /** Point a given fraction of the way along a path. */
  private pointAlong(path: Array<{ x: number; y: number }>, t: number): { x: number; y: number } {
    const total = this.pathLength(path)
    if (total <= 0) return path[0] ?? { x: 0, y: 0 }
    let remaining = Math.max(0, Math.min(1, t)) * total
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      const segment = Math.hypot(b.x - a.x, b.y - a.y)
      if (remaining <= segment || i === path.length - 1) {
        const f = segment > 0 ? remaining / segment : 0
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      }
      remaining -= segment
    }
    return path[path.length - 1]!
  }

  private drawLines(): void {
    const g = this.lineLayer
    g.clear()
    const dispatch = this.world.lastDispatch

    for (const edge of this.world.network.allEdges()) {
      if (edge.commodity !== 'electric') continue
      const path = this.edgePath(edge)
      const capacity = this.edgeCapacity(edge)
      const flow = Math.abs(dispatch?.lineFlowMw.get(edge.id) ?? 0)
      const loading = capacity > 0 ? flow / capacity : 0

      // Thicker for higher voltage: the backbone should read as the backbone.
      const width = edge.kv === 400 ? 3 : edge.kv === 220 ? 2 : 1.5
      const colour =
        loading < 0.5
          ? lerpColour(0x6d7a84, 0x5fc27e, loading / 0.5)
          : loading < 0.9
            ? lerpColour(0x5fc27e, 0xe8b23a, (loading - 0.5) / 0.4)
            : lerpColour(0xe8b23a, 0xe2483d, Math.min(1, (loading - 0.9) / 0.1))

      const stroke = (style: { width: number; color: number; alpha?: number }) => {
        g.moveTo(path[0]!.x, path[0]!.y)
        for (let i = 1; i < path.length; i++) g.lineTo(path[i]!.x, path[i]!.y)
        g.stroke(style)
      }

      if (!edge.energised) {
        drawDashedPath(g, path, 8, 6, { width, color: 0x7fd4ff, alpha: 0.6 })
        continue
      }

      // A dark casing under the conductor keeps it legible over any terrain colour.
      stroke({ width: width + 2, color: 0x0e1418, alpha: 0.7 })
      stroke({ width, color: colour })
    }
  }

  /**
   * Pylons along each corridor.
   *
   * Spaced by distance rather than one per tile, so a long line does not turn into a solid
   * hedge of steel. Rebuilt only when the network changes, since they never move.
   */
  private rebuildPylons(): void {
    this.pylonLayer.removeChildren()
    const spacingPx = TILE_PX * 1.5

    for (const edge of this.world.network.allEdges()) {
      if (edge.commodity !== 'electric') continue
      const path = this.edgePath(edge)
      const total = this.pathLength(path)
      if (total < spacingPx) continue

      const texture = edge.kv === 110 ? this.sprites.pylonShort : this.sprites.pylonTall
      const count = Math.floor(total / spacingPx)
      for (let i = 1; i < count; i++) {
        const at = this.pointAlong(path, i / count)
        const pylon = new Sprite(texture)
        // Anchored at the foot, so a pylon stands on the ground rather than floating over it.
        pylon.anchor.set(0.5, 1)
        pylon.scale.set(TILE_SCALE * 0.75)
        pylon.position.set(at.x, at.y + TILE_PX * 0.35)
        pylon.alpha = edge.energised ? 1 : 0.5
        this.pylonLayer.addChild(pylon)
      }
    }
  }

  /**
   * Update what the sprites say about their own state.
   *
   * The artwork itself never changes; what changes is a status ring behind it, whether the
   * sprite is dimmed, and — for towns — whether the windows are lit. City lights going out
   * during a blackout is the clearest possible way to show one.
   */
  private drawNodes(): void {
    const dispatch = this.world.lastDispatch
    const hour = this.world.date.hour
    const isNight = hour < 6 || hour >= 19

    for (const node of this.world.network.allNodes()) {
      const ring = this.nodeGraphics.get(node.id)
      const sprite = this.nodeSprites.get(node.id)
      if (!ring || !sprite) continue
      ring.clear()

      if (node.kind === 'city') {
        const city = this.world.cities.find((c) => c.nodeId === node.id)
        const unserved = city ? (dispatch?.unservedMw.get(city.id) ?? 0) : 0
        const dark = unserved > 0.01
        const large = (city?.baseDemandMw ?? 0) >= 200

        // Lights on at night, unless the supply has failed.
        const lit = isNight && !dark
        sprite.texture = large
          ? lit
            ? this.sprites.cityLargeLit
            : this.sprites.cityLarge
          : lit
            ? this.sprites.citySmallLit
            : this.sprites.citySmall
        sprite.tint = dark ? 0xd08078 : 0xffffff

        if (dark) {
          ring.circle(0, 0, TILE_PX * 0.55).stroke({ width: 2, color: 0xff6a5c, alpha: 0.85 })
        }
      } else if (node.kind === 'plant') {
        const plants = this.world.plants.filter((p) => p.nodeId === node.id)
        const running = plants.some((p) => isDispatchable(p) && Math.abs(p.outputMw) > 0.5)
        const building = plants.some((p) => !isDispatchable(p))
        sprite.alpha = running ? 1 : 0.55
        sprite.tint = running ? 0xffffff : 0x9aa4ae

        if (running) {
          const category = plants[0] ? PLANT_TYPES[plants[0].typeId].category : 'thermal'
          ring
            .circle(0, 0, TILE_PX * 0.5)
            .stroke({ width: 2, color: CATEGORY_COLOURS[category] ?? 0xaaaaaa, alpha: 0.5 })
        } else if (building) {
          ring.circle(0, 0, TILE_PX * 0.5).stroke({ width: 2, color: 0x7fd4ff, alpha: 0.5 })
        }
      }

      if (node.id === this.selectedNodeId) {
        ring.circle(0, 0, TILE_PX * 0.62).stroke({ width: 2, color: 0x7fd4ff, alpha: 0.95 })
      }
    }
  }

  /** Keep one particle per ~60 MW on each line, so the animation reads as quantity. */
  private syncParticles(): void {
    const dispatch = this.world.lastDispatch
    if (!dispatch) return

    const wanted = new Map<string, number>()
    for (const edge of this.world.network.allEdges()) {
      if (edge.commodity !== 'electric' || !edge.energised) continue
      const flow = Math.abs(dispatch.lineFlowMw.get(edge.id) ?? 0)
      wanted.set(edge.id, Math.min(14, Math.floor(flow / 60)))
    }

    const have = new Map<string, number>()
    for (const p of this.particles) have.set(p.edgeId, (have.get(p.edgeId) ?? 0) + 1)

    // Remove surplus.
    this.particles = this.particles.filter((p) => {
      const need = wanted.get(p.edgeId) ?? 0
      const count = have.get(p.edgeId) ?? 0
      if (count > need) {
        have.set(p.edgeId, count - 1)
        p.gfx.destroy()
        return false
      }
      return true
    })

    // Add missing.
    for (const [edgeId, need] of wanted) {
      let count = have.get(edgeId) ?? 0
      while (count < need) {
        const gfx = new Graphics()
        gfx.circle(0, 0, 2.4).fill({ color: 0xffffff })
        this.particleLayer.addChild(gfx)
        this.particles.push({ edgeId, t: count / Math.max(1, need), gfx })
        count++
      }
    }
  }

  /** Move the flow particles. Called every rendered frame. */
  animate(deltaSeconds: number, simulationRunning: boolean): void {
    const dispatch = this.world.lastDispatch
    if (!dispatch) return

    for (const p of this.particles) {
      const edge = this.world.network.getEdge(p.edgeId)
      if (!edge) continue
      const signed = dispatch.lineFlowMw.get(p.edgeId) ?? 0
      const capacity = this.edgeCapacity(edge)
      const loading = capacity > 0 ? Math.abs(signed) / capacity : 0
      // Speed tracks loading, so a busy line visibly hurries.
      const speed = (0.06 + loading * 0.22) * (simulationRunning ? 1 : 0.25)
      p.t += speed * deltaSeconds * Math.sign(signed || 1)
      if (p.t > 1) p.t -= 1
      if (p.t < 0) p.t += 1

      const at = this.pointAlong(this.edgePath(edge), p.t)
      p.gfx.position.set(at.x, at.y)
      p.gfx.alpha = 0.55 + 0.45 * Math.sin(p.t * Math.PI)
    }
  }

  applyCamera(): void {
    this.root.scale.set(this.camera.zoom)
    this.root.position.set(-this.camera.x * this.camera.zoom, -this.camera.y * this.camera.zoom)
  }

  resize(width: number, height: number): void {
    this.camera.resize(width, height)
    this.applyCamera()
  }

  /**
   * The placement overlay: where you may build, and what the thing you are placing would
   * look like. Drawn every frame while a build mode is active, and nothing at all otherwise.
   */
  drawBuildOverlay(): void {
    const g = this.buildLayer
    g.clear()
    const mode = this.buildMode
    if (!mode) return

    if (mode.kind === 'plant') {
      // Shade what this particular technology cannot use, and tint what it can by how well it
      // suits — a legal site and a good site are different things, and the player should be
      // able to see which is which before committing eight years and a billion euros.
      const mask = this.siteMaskForType(mode.typeId as PlantTypeId)
      for (let y = 0; y < this.terrain.height; y++) {
        for (let x = 0; x < this.terrain.width; x++) {
          const quality = mask[y * this.terrain.width + x]!
          if (quality < 0) {
            g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0x000000, alpha: 0.45 })
          } else if (quality > 0.05) {
            g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({
              color: 0x5fc27e,
              alpha: 0.08 + quality * 0.28,
            })
          }
        }
      }
      const hover = this.hoverTile
      if (hover) {
        const cx = hover.x * TILE_PX + TILE_PX / 2
        const cy = hover.y * TILE_PX + TILE_PX / 2
        const colour = this.hoverValid ? 0x5fc27e : 0xe2483d
        g.rect(hover.x * TILE_PX, hover.y * TILE_PX, TILE_PX, TILE_PX).fill({ color: colour, alpha: 0.35 })
        g.circle(cx, cy, 16).stroke({ width: 2, color: colour, alpha: 0.95 })
      }
      return
    }

    // Line mode: highlight the nodes that can be connected, and rubber-band from the one
    // already chosen to the cursor.
    for (const node of this.world.network.allNodes()) {
      const cx = node.x * TILE_PX + TILE_PX / 2
      const cy = node.y * TILE_PX + TILE_PX / 2
      const chosen = node.id === mode.fromNodeId
      g.circle(cx, cy, chosen ? 20 : 15).stroke({
        width: 2,
        color: chosen ? 0x7fd4ff : 0x9fb0c0,
        alpha: chosen ? 1 : 0.45,
      })
    }

    if (mode.fromNodeId && this.hoverTile) {
      const from = this.world.network.getNode(mode.fromNodeId)
      if (from) {
        const colour = this.hoverValid ? 0x7fd4ff : 0xe2483d
        // Preview the corridor the line would actually take, not a straight rubber band —
        // otherwise the price quoted and the route drawn would disagree with each other.
        const route = routeLine(this.terrain, from.x, from.y, this.hoverTile.x, this.hoverTile.y)
        const path = simplifyRoute(route).map((p) => ({
          x: p.x * TILE_PX + TILE_PX / 2,
          y: p.y * TILE_PX + TILE_PX / 2,
        }))
        drawDashedPath(g, path, 10, 7, {
          width: mode.kv === 400 ? 3 : mode.kv === 220 ? 2 : 1.5,
          color: colour,
          alpha: 0.85,
        })
      }
    }
  }

  /**
   * Suitability of every tile for a technology: negative where it cannot be built, otherwise
   * the site quality. Cached, because judging twelve hundred tiles every frame would be
   * wasteful when the answer only changes when the player picks a different technology or
   * builds something.
   */
  private siteMaskForType(typeId: PlantTypeId): Float32Array {
    const key = `${typeId}|${this.world.network.topologyEpoch}`
    if (this.siteMask && this.siteMaskFor === key) return this.siteMask

    const mask = new Float32Array(this.terrain.width * this.terrain.height)
    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const verdict = judgeSite(typeId, {
          terrain: this.terrain,
          network: this.world.network,
          cities: this.world.cities,
          x,
          y,
        })
        mask[y * this.terrain.width + x] = verdict.ok ? verdict.quality : -1
      }
    }
    this.siteMask = mask
    this.siteMaskFor = key
    return mask
  }

  /** Tile coordinates under a screen point. */
  tileAtScreen(screenX: number, screenY: number): { x: number; y: number } {
    const w = this.camera.screenToWorld(screenX, screenY)
    return { x: Math.floor(w.x / TILE_PX), y: Math.floor(w.y / TILE_PX) }
  }

  /** Nearest node to a world-space point, for click handling on empty ground. */
  nodeAtWorld(wx: number, wy: number, maxDistancePx = 22): GridNode | null {
    let best: GridNode | null = null
    let bestDist = maxDistancePx
    for (const node of this.world.network.allNodes()) {
      const nx = node.x * TILE_PX + TILE_PX / 2
      const ny = node.y * TILE_PX + TILE_PX / 2
      const d = Math.hypot(nx - wx, ny - wy)
      if (d < bestDist) {
        bestDist = d
        best = node
      }
    }
    return best
  }
}

/** A node's display name: either a place name or a localised technology plus its number. */
export function nodeLabel(node: GridNode): string | null {
  if (node.name) return node.name
  if (node.nameKey) return node.nameIndex === undefined ? t(node.nameKey) : `${t(node.nameKey)} ${node.nameIndex}`
  return null
}

/** Dashes along a multi-segment path. */
function drawDashedPath(
  g: Graphics,
  path: Array<{ x: number; y: number }>,
  dash: number,
  gap: number,
  style: { width: number; color: number; alpha?: number },
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    dashSegment(g, a.x, a.y, b.x, b.y, dash, gap)
  }
  g.stroke(style)
}

/** Queue the dashes of one segment without stroking, so a whole path can be stroked at once. */
function dashSegment(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dash: number,
  gap: number,
): void {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  if (length < 0.5) return
  const ux = dx / length
  const uy = dy / length
  let travelled = 0
  while (travelled < length) {
    const end = Math.min(length, travelled + dash)
    g.moveTo(ax + ux * travelled, ay + uy * travelled).lineTo(ax + ux * end, ay + uy * end)
    travelled = end + gap
  }
}

