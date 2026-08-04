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

import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { LINE_TYPES } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import type { World } from '@sim/world'
import type { GridEdge, GridNode } from '@sim/grid/network'
import { isDispatchable } from '@sim/assets/types'
import { isBuildable, Tile, type TerrainMap } from '@sim/map/terrain'
import { Camera } from './camera'
import { t } from '@i18n/index'

export const TILE_PX = 26

const TERRAIN_COLOURS: Record<Tile, number> = {
  [Tile.Water]: 0x1b3a4b,
  [Tile.Plain]: 0x3f5d43,
  [Tile.Forest]: 0x2f4a35,
  [Tile.Hill]: 0x5a5b3c,
  [Tile.Mountain]: 0x6b6558,
}

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
  private readonly terrainLayer = new Graphics()
  private readonly lineLayer = new Graphics()
  private readonly particleLayer = new Container()
  private readonly nodeLayer = new Container()
  private readonly labelLayer = new Container()
  private readonly buildLayer = new Graphics()

  private readonly terrain: TerrainMap
  private particles: Particle[] = []
  private nodeGraphics = new Map<string, Graphics>()
  private lastTopologyEpoch = -1
  selectedNodeId: string | null = null

  buildMode: BuildMode = null
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
    this.camera = new Camera(app.canvas.width, app.canvas.height)

    this.root.addChild(
      this.terrainLayer,
      this.lineLayer,
      this.particleLayer,
      this.buildLayer,
      this.nodeLayer,
      this.labelLayer,
    )
    app.stage.addChild(this.root)

    this.drawTerrain()
    this.buildNodes()
    this.camera.fit(world.scenario.mapWidth * TILE_PX, world.scenario.mapHeight * TILE_PX)
    this.applyCamera()
  }

  private drawTerrain(): void {
    const g = this.terrainLayer
    g.clear()

    // Open water well beyond the map bounds, so panning to the edge shows a coastline
    // rather than the abrupt rectangle where the tile array happens to stop.
    const bleed = 30
    g.rect(
      -bleed * TILE_PX,
      -bleed * TILE_PX,
      (this.terrain.width + bleed * 2) * TILE_PX,
      (this.terrain.height + bleed * 2) * TILE_PX,
    ).fill({ color: 0x14293a })

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const tile = this.terrain.tiles[y * this.terrain.width + x] as Tile
        const elevation = this.terrain.elevation[y * this.terrain.width + x]!
        // A touch of elevation shading keeps a flat colour grid from looking like a spreadsheet.
        const shade = 0.85 + elevation * 0.3
        const base = TERRAIN_COLOURS[tile]
        const shaded = lerpColour(0x000000, base, Math.min(1, shade))
        g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: shaded })
      }
    }
  }

  private buildNodes(): void {
    this.nodeLayer.removeChildren()
    this.labelLayer.removeChildren()
    this.nodeGraphics.clear()

    const labelStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      fill: 0xe8eef4,
      stroke: { color: 0x0b1015, width: 3 },
    })

    for (const node of this.world.network.allNodes()) {
      const g = new Graphics()
      g.eventMode = 'static'
      g.cursor = 'pointer'
      g.on('pointertap', () => {
        this.selectedNodeId = node.id
        this.callbacks.onSelectNode?.(node.id)
      })
      g.position.set(node.x * TILE_PX + TILE_PX / 2, node.y * TILE_PX + TILE_PX / 2)
      this.nodeLayer.addChild(g)
      this.nodeGraphics.set(node.id, g)

      const labelText = nodeLabel(node)
      if (labelText) {
        const label = new Text({ text: labelText, style: labelStyle })
        label.anchor.set(0.5, 0)
        label.position.set(node.x * TILE_PX + TILE_PX / 2, node.y * TILE_PX + TILE_PX / 2 + 14)
        this.labelLayer.addChild(label)
      }
    }
    this.lastTopologyEpoch = this.world.network.topologyEpoch
  }

  /** Redraw everything that depends on the latest dispatch. Called once per simulation tick. */
  syncToWorld(): void {
    if (this.world.network.topologyEpoch !== this.lastTopologyEpoch) {
      this.buildNodes()
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

  private edgeEndpoints(edge: GridEdge): { ax: number; ay: number; bx: number; by: number } {
    const a = this.world.network.requireNode(edge.from)
    const b = this.world.network.requireNode(edge.to)
    return {
      ax: a.x * TILE_PX + TILE_PX / 2,
      ay: a.y * TILE_PX + TILE_PX / 2,
      bx: b.x * TILE_PX + TILE_PX / 2,
      by: b.y * TILE_PX + TILE_PX / 2,
    }
  }

  private drawLines(): void {
    const g = this.lineLayer
    g.clear()
    const dispatch = this.world.lastDispatch

    for (const edge of this.world.network.allEdges()) {
      if (edge.commodity !== 'electric') continue
      const { ax, ay, bx, by } = this.edgeEndpoints(edge)
      const capacity = this.edgeCapacity(edge)
      const flow = Math.abs(dispatch?.lineFlowMw.get(edge.id) ?? 0)
      const loading = capacity > 0 ? flow / capacity : 0

      // Thicker for higher voltage: the backbone should read as the backbone.
      const width = edge.kv === 400 ? 5 : edge.kv === 220 ? 3.5 : 2.2
      const colour =
        loading < 0.5
          ? lerpColour(0x5c7a8a, 0x5fc27e, loading / 0.5)
          : loading < 0.9
            ? lerpColour(0x5fc27e, 0xe8b23a, (loading - 0.5) / 0.4)
            : lerpColour(0xe8b23a, 0xe2483d, Math.min(1, (loading - 0.9) / 0.1))

      if (!edge.energised) {
        // Under construction: a dashed ghost of the route, so progress is visible.
        drawDashed(g, ax, ay, bx, by, 10, 8, { width, color: 0x7fd4ff, alpha: 0.55 })
        continue
      }

      // A dark casing under the conductor keeps it legible over any terrain colour.
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 3, color: 0x0e1418, alpha: 0.65 })
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color: colour })
    }
  }

  private drawNodes(): void {
    const dispatch = this.world.lastDispatch

    for (const node of this.world.network.allNodes()) {
      const g = this.nodeGraphics.get(node.id)
      if (!g) continue
      g.clear()

      const selected = node.id === this.selectedNodeId
      if (node.kind === 'city') {
        const city = this.world.cities.find((c) => c.nodeId === node.id)
        const unserved = city ? (dispatch?.unservedMw.get(city.id) ?? 0) : 0
        const radius = city ? 6 + Math.sqrt(city.baseDemandMw) * 0.35 : 8
        const dark = unserved > 0.01
        g.circle(0, 0, radius).fill({ color: dark ? 0x8c2a24 : 0xd8dee6 })
        g.circle(0, 0, radius).stroke({ width: 2, color: dark ? 0xff6a5c : 0x0e1418 })
        if (dark) g.circle(0, 0, radius + 4).stroke({ width: 2, color: 0xff6a5c, alpha: 0.7 })
      } else if (node.kind === 'plant') {
        const plants = this.world.plants.filter((p) => p.nodeId === node.id)
        const first = plants[0]
        const colour = first ? (CATEGORY_COLOURS[PLANT_TYPES[first.typeId].category] ?? 0xaaaaaa) : 0x777777
        const running = plants.some((p) => isDispatchable(p) && p.outputMw > 0.5)
        const size = 8 + plants.length * 2
        g.rect(-size / 2, -size / 2, size, size).fill({ color: colour, alpha: running ? 1 : 0.45 })
        g.rect(-size / 2, -size / 2, size, size).stroke({ width: 2, color: 0x0e1418 })
        if (!running) {
          g.moveTo(-size / 2, -size / 2).lineTo(size / 2, size / 2).stroke({ width: 1.5, color: 0x0e1418 })
        }
      } else {
        g.poly([0, -7, 7, 0, 0, 7, -7, 0]).fill({ color: 0x9fb0c0 })
        g.poly([0, -7, 7, 0, 0, 7, -7, 0]).stroke({ width: 1.5, color: 0x0e1418 })
      }

      if (selected) g.circle(0, 0, 18).stroke({ width: 2, color: 0x7fd4ff, alpha: 0.9 })
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

      const { ax, ay, bx, by } = this.edgeEndpoints(edge)
      p.gfx.position.set(ax + (bx - ax) * p.t, ay + (by - ay) * p.t)
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
      // Shade the ground that cannot take a station, so the rule is visible rather than
      // discovered by having a click refused.
      for (let y = 0; y < this.terrain.height; y++) {
        for (let x = 0; x < this.terrain.width; x++) {
          if (isBuildable(this.terrain, x, y)) continue
          g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0x000000, alpha: 0.35 })
        }
      }
      const hover = this.hoverTile
      if (hover) {
        const cx = hover.x * TILE_PX + TILE_PX / 2
        const cy = hover.y * TILE_PX + TILE_PX / 2
        const colour = this.hoverValid ? 0x5fc27e : 0xe2483d
        g.rect(hover.x * TILE_PX, hover.y * TILE_PX, TILE_PX, TILE_PX).fill({ color: colour, alpha: 0.3 })
        g.circle(cx, cy, 16).stroke({ width: 2, color: colour, alpha: 0.9 })
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
        drawDashed(
          g,
          from.x * TILE_PX + TILE_PX / 2,
          from.y * TILE_PX + TILE_PX / 2,
          this.hoverTile.x * TILE_PX + TILE_PX / 2,
          this.hoverTile.y * TILE_PX + TILE_PX / 2,
          12,
          8,
          { width: mode.kv === 400 ? 5 : mode.kv === 220 ? 3.5 : 2.2, color: colour, alpha: 0.8 },
        )
      }
    }
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

/** Pixi has no dashed stroke, and a dashed line is the clearest way to say "not yet real". */
function drawDashed(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dash: number,
  gap: number,
  style: { width: number; color: number; alpha?: number },
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
  g.stroke(style)
}
