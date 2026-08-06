/**
 * Entry point: the game loop and the input handling that glues the three layers together.
 *
 * The simulation runs on a fixed timestep decoupled from the frame rate, with an
 * accumulator. Changing speed changes how many ticks happen per real second, never the
 * length of a tick — so a run at 10x produces exactly the same history as the same run at
 * 1x. Without that, the fast-forward button would silently be a different game.
 */

import { Application } from 'pixi.js'
import { buildWorld, loadWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { MapView, nodeLabel, TILE_PX, type BuildMode } from '@render/mapView'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { LINE_TYPES } from '@content/lineTypes'
import { HEAT_PIPE_TYPES } from '@content/heatPipeTypes'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'
import { Hud, type Speed } from '@ui/hud'
import type { BuildSelection } from '@ui/buildPanel'
import { formatMoney, setLocale, t } from '@i18n/index'
import { makeSaveFile, readLocalSave, writeLocalSave } from '@sim/scenario/save'
import { SKIP_LIMIT_TICKS } from '@sim/scenario/notable'
import { NewsImportance, type NewsItem } from '@sim/news/news'
import { headline } from '@ui/newsPanel'
import {
  beginHeatPipeConstruction,
  beginLineConstruction,
  beginPlantConstruction,
  beginSubstationConstruction,
  quoteSubstation,
  demolishLine,
  renewLine,
  upgradeVoltage,
  mothballPlant,
  quoteHeatPipe,
  quoteLine,
  quotePlant,
  reactivatePlant,
  refurbishPlant,
  retirePlant,
  upgradeLine,
  type Quote,
} from '@sim/build/commands'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

/** Simulation ticks per real second at 1x. One in-game day takes 12 seconds. */
const TICKS_PER_SECOND_AT_1X = 2

/**
 * How long one frame may spend inside the simulation.
 *
 * A budget in milliseconds rather than a fixed tick count, which the loop used to use. A tick
 * costs whatever it costs on the machine in front of the player — a fixed cap of forty either
 * wasted a fast machine's headroom or froze a slow one — and this way the fastest speed and the
 * skip both run as fast as the hardware allows while leaving the frame enough time to draw.
 */
const SIM_BUDGET_MS = 12

/**
 * The same, while running on to the next event.
 *
 * Larger, because the trade is different: the player has explicitly asked to be somewhere else in
 * time and is waiting for it. Thirty milliseconds a frame still leaves the page answering the
 * mouse — the stop button has to work — while spending most of the machine on getting there.
 */
const SKIP_BUDGET_MS = 30

async function main(): Promise<void> {
  setLocale('en')

  const canvas = document.getElementById('stage') as HTMLCanvasElement
  const overlay = document.getElementById('overlay') as HTMLDivElement

  const app = new Application()
  await app.init({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    background: 0x0b1015,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  })

  // Not `const`: loading a save replaces all three, and everything below reaches them through
  // these bindings rather than capturing a particular instance. That is the whole trick that
  // lets a load happen without reloading the page.
  let world = buildWorld(FIRST_REGION)
  let hud!: Hud
  let map!: MapView
  let attached = false

  let speed: Speed = 1
  /** A run-until-something-happens in progress, with where it started from and how far it has got. */
  let skip: { ticksRun: number } | null = null

  /** Set the placement mode and the instruction that goes with it. */
  const applySelection = (selection: BuildSelection): void => {
    if (!selection) {
      map.buildMode = null
      hud.setHint(null)
      return
    }
    if (selection.kind === 'plant') {
      map.buildMode = { kind: 'plant', typeId: selection.typeId }
      hud.setHint(t('ui.buildHint'))
    } else if (selection.kind === 'substation') {
      map.buildMode = { kind: 'substation', kv: selection.kv }
      hud.setHint(t('ui.substationHint'))
    } else if (selection.kind === 'pipe') {
      map.buildMode = { kind: 'pipe', dn: selection.dn, pipes: selection.pipes, fromNodeId: null }
      hud.setHint(t('ui.pipeHint'))
    } else {
      map.buildMode = { kind: 'line', kv: selection.kv, circuits: selection.circuits, fromNodeId: null }
      hud.setHint(t('ui.lineHint'))
    }
  }

  const cancelBuild = (): void => {
    map.buildMode = null
    hud.setHint(null)
    hud.buildPanel.select(null)
  }

  /**
   * Write the current run to the browser's single save slot.
   *
   * The timestamp is passed in from here rather than read inside the simulation, which has no
   * business knowing what the wall clock says: everything in there is a function of the tick.
   */
  const save = (): void => {
    const file = makeSaveFile(FIRST_REGION.id, world.toSaveData(), new Date().toISOString())
    hud.setHint(t(writeLocalSave(file) ? 'ui.saved' : 'ui.saveFailed'))
  }

  /**
   * Restore the saved run, replacing the world, the map and the overlay.
   *
   * Rebuilding the view rather than pointing the old one at the new world is the safe order:
   * the map caches node graphics, pylons and particles keyed by asset, and a plant that the
   * save does not contain would otherwise go on being drawn.
   */
  const load = (): void => {
    const file = readLocalSave()
    if (!file) {
      hud.setHint(t('ui.noSave'))
      return
    }
    try {
      world = loadWorld(FIRST_REGION, file.data)
    } catch {
      hud.setHint(t('ui.loadFailed'))
      return
    }
    // The speed carries across. Forcing a pause here was meant to be considerate and read as a
    // freeze instead: the clock stopped for no stated reason immediately after an action the
    // player took, which is exactly how a bug looks.
    attach()
    hud.setHint(t('ui.loaded'))
  }

  /** Build the overlay and the map for whatever `world` currently is. */
  const attach = (): void => {
    // Where the player was looking is not part of the saved game — it is not part of the game at
    // all — but throwing them back to a fitted view of the whole region after a load would lose
    // the one piece of context they had. So it is carried across by hand.
    let view: { x: number; y: number; zoom: number } | null = null
    if (attached) {
      view = { x: map.camera.x, y: map.camera.y, zoom: map.camera.zoom }
      hud.destroy()
      map.destroy()
    }
    attached = true
    hud = makeHud()
    map = makeMap()
    if (view) {
      map.camera.x = view.x
      map.camera.y = view.y
      map.camera.zoom = view.zoom
      map.applyCamera()
    }
    hud.setSpeed(speed)
    map.syncToWorld()
    hud.update()
  }

  const makeHud = (): Hud =>
    new Hud(overlay, world, {
      onSetSpeed: (s) => {
        // A run that has ended does not advance whatever this says, so rather than accept a
        // click that visibly does nothing, put the verdict back — the offer to carry on is on
        // it. Bankruptcy is the one ending with nothing behind the door.
        if (world.outcome !== 'playing' && !world.freePlay && !world.finances.bankrupt) {
          hud.objectivesPanel.showVerdict()
          hud.update()
          return
        }
        speed = s
        hud.setSpeed(s)
      },
      onSelectBuild: applySelection,
      onRetire: (plantId) => {
        const result = retirePlant(world, plantId)
        hud.setHint(result.ok ? t('build.retiring') : t(result.quote.reasonKey ?? 'build.notRetirable'))
        hud.update()
      },
      onRefurbish: (plantId) => {
        const result = refurbishPlant(world, plantId)
        hud.setHint(result.ok ? t('build.refurbishing') : t(result.quote.reasonKey ?? 'build.notRefurbishable'))
        hud.update()
      },
      onMothball: (plantId, mothball) => {
        if (mothball) mothballPlant(world, plantId)
        else reactivatePlant(world, plantId)
        hud.update()
      },
      onChooseEvent: (uid, choiceId) => {
        world.director.choose(uid, choiceId)
        hud.update()
      },
      onSetMaintenance: (level) => {
        world.state.maintenanceLevel = level
        hud.update()
      },
      onSetInsured: (insured) => {
        world.state.insured = insured
        hud.update()
      },
      onSave: save,
      onLoad: load,
      onSkip: () => {
        // Pressing it again while it is running means "stop here", which is the only sensible
        // second meaning and saves a separate control.
        if (skip) {
          skip = null
          hud.setHint(null)
          return
        }
        skip = { ticksRun: 0 }
      },
      // The map's highlight and the inspector are the same selection, so they are set together.
      onSelectionChanged: ({ nodeId, edgeId }, focus) => {
        map.selectedNodeId = nodeId
        map.selectedEdgeId = edgeId
        if (focus && (nodeId ?? edgeId)) map.focusOn((nodeId ?? edgeId)!)
        map.syncToWorld()
      },
      onUpgradeLine: (edgeId) => {
        const result = upgradeLine(world, edgeId)
        hud.setHint(result.ok ? t('build.upgrading') : t(result.quote.reasonKey ?? 'build.notUpgradable'))
        map.syncToWorld()
        hud.update()
      },
      onRenewLine: (edgeId) => {
        const result = renewLine(world, edgeId)
        hud.setHint(result.ok ? t('build.renewing') : t(result.quote.reasonKey ?? 'build.notUpgradable'))
        map.syncToWorld()
        hud.update()
      },
      onDemolishLine: (edgeId) => {
        const result = demolishLine(world, edgeId)
        hud.setHint(result.ok ? t('build.demolished') : t(result.quote.reasonKey ?? 'build.notUpgradable'))
        if (result.ok) hud.selectEdge(null)
        map.syncToWorld()
        hud.update()
      },
      onUpgradeVoltage: (edgeId) => {
        const result = upgradeVoltage(world, edgeId)
        hud.setHint(result.ok ? t('build.uprating') : t(result.quote.reasonKey ?? 'build.notUpgradable'))
        map.syncToWorld()
        hud.update()
      },
    })

  const makeMap = (): MapView =>
    new MapView(app, world, {
      onSelectNode: (nodeId) => {
        if (map.buildMode) return
        hud.selectNode(nodeId)
      },
    })

  // Run one tick immediately so the first frame shows a live system rather than an empty one.
  world.step()
  attach()

  // --- Input -------------------------------------------------------------

  let dragging = false
  let lastX = 0
  let lastY = 0
  let dragDistance = 0

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    dragDistance = 0
    lastX = e.clientX
    lastY = e.clientY
    canvas.classList.add('dragging')
    canvas.setPointerCapture(e.pointerId)
  })

  /**
   * What a placement would cost, as one line of text.
   *
   * This is the whole reason the hover does more than colour a square. Choosing where to run a
   * corridor is a comparison — this route against that one, from this substation or the next —
   * and until the price, the length and the lead time are on screen *before* committing, the
   * player is being asked to make the most expensive decision in the game blind. A refusal says
   * why, for the same reason: "you cannot build here" and "you cannot afford it" are different
   * pieces of news and a red square tells you neither.
   */
  const quoteText = (quote: Quote, prefix: string): string => {
    if (!quote.ok) return `${prefix} — ${t(quote.reasonKey ?? 'build.unsuitableGround', quote.reasonParams)}`
    const parts = [prefix]
    if (quote.lengthKm !== undefined) parts.push(`${quote.lengthKm.toFixed(0)} ${t('ui.kmShort')}`)
    parts.push(formatMoney(quote.totalCost))
    parts.push(`${Math.round(quote.buildTicks / TICKS_PER_MONTH)} ${t('ui.months')}`)
    if (quote.siteQuality !== undefined) parts.push(`${t('ui.siteQuality')} ${Math.round(quote.siteQuality * 100)}%`)
    return parts.join(' · ')
  }

  /** Keep the ghost in step with the cursor, and tell it what the placement would cost. */
  const updateHover = (clientX: number, clientY: number): void => {
    const mode: BuildMode = map.buildMode
    if (!mode) {
      map.hoverTile = null
      return
    }
    const rect = canvas.getBoundingClientRect()
    const tile = map.tileAtScreen(clientX - rect.left, clientY - rect.top)
    map.hoverTile = tile

    if (mode.kind === 'plant') {
      const quote = quotePlant(world, mode.typeId as never, tile.x, tile.y)
      map.hoverValid = quote.ok
      hud.setHint(quoteText(quote, t(PLANT_TYPES[mode.typeId as PlantTypeId].nameKey)))
    } else if (mode.kind === 'substation') {
      const quote = quoteSubstation(world, mode.kv as never, tile.x, tile.y)
      map.hoverValid = quote.ok
      hud.setHint(quoteText(quote, t('ui.substationAt', { kv: mode.kv })))
    } else if (mode.fromNodeId) {
      const worldPoint = map.camera.screenToWorld(clientX - rect.left, clientY - rect.top)
      const target = map.nodeAtWorld(worldPoint.x, worldPoint.y, TILE_PX)
      if (!target) {
        map.hoverValid = false
        hud.setHint(t(mode.kind === 'pipe' ? 'ui.pipeHint' : 'ui.lineHint'))
        return
      }
      const quote =
        mode.kind === 'pipe'
          ? quoteHeatPipe(world, mode.fromNodeId, target.id, mode.dn, mode.pipes)
          : quoteLine(world, mode.fromNodeId, target.id, mode.kv, mode.circuits)
      map.hoverValid = quote.ok
      const label =
        mode.kind === 'pipe' ? t(HEAT_PIPE_TYPES[mode.dn].nameKey) : t(LINE_TYPES[mode.kv].nameKey)
      hud.setHint(quoteText(quote, `${label} → ${nodeLabel(target) ?? target.id}`))
    } else {
      map.hoverValid = true
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    updateHover(e.clientX, e.clientY)
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    dragDistance += Math.abs(dx) + Math.abs(dy)
    lastX = e.clientX
    lastY = e.clientY
    map.camera.panByScreen(dx, dy)
    map.applyCamera()
  })

  /** A click while a build mode is active. Returns true if it was consumed by building. */
  const handleBuildClick = (clientX: number, clientY: number): boolean => {
    const mode: BuildMode = map.buildMode
    if (!mode) return false

    const rect = canvas.getBoundingClientRect()
    const tile = map.tileAtScreen(clientX - rect.left, clientY - rect.top)

    if (mode.kind === 'substation') {
      const result = beginSubstationConstruction(world, mode.kv as never, tile.x, tile.y)
      if (result.ok) {
        hud.setHint(t('build.placed'))
        cancelBuild()
        map.syncToWorld()
      } else {
        hud.setHint(t(result.quote.reasonKey ?? 'build.unsuitableGround'))
      }
      hud.update()
      return true
    }

    if (mode.kind === 'plant') {
      const result = beginPlantConstruction(world, mode.typeId as never, tile.x, tile.y)
      if (result.ok) {
        hud.setHint(t('build.placed'))
        // One station at a time: staying in build mode invites a row of accidental plants.
        cancelBuild()
        map.syncToWorld()
      } else {
        hud.setHint(t(result.quote.reasonKey ?? 'build.unsuitableGround'))
      }
      hud.update()
      return true
    }

    const worldPoint = map.camera.screenToWorld(clientX - rect.left, clientY - rect.top)
    const node = map.nodeAtWorld(worldPoint.x, worldPoint.y, TILE_PX)
    if (!node) {
      hud.setHint(t('build.noSuchNode'))
      return true
    }

    if (!mode.fromNodeId) {
      mode.fromNodeId = node.id
      hud.setHint(t(mode.kind === 'pipe' ? 'ui.pipeHint' : 'ui.lineHint'))
      return true
    }

    const result =
      mode.kind === 'pipe'
        ? beginHeatPipeConstruction(world, mode.fromNodeId, node.id, mode.dn, mode.pipes)
        : beginLineConstruction(world, mode.fromNodeId, node.id, mode.kv, mode.circuits)
    if (result.ok) {
      hud.setHint(t('build.placed'))
      cancelBuild()
      map.syncToWorld()
    } else {
      hud.setHint(t(result.quote.reasonKey ?? 'build.noSuchNode'))
      mode.fromNodeId = null
    }
    hud.update()
    return true
  }

  canvas.addEventListener('pointerup', (e) => {
    canvas.classList.remove('dragging')
    const wasClick = dragging && dragDistance < 5
    dragging = false
    if (!wasClick) return

    if (handleBuildClick(e.clientX, e.clientY)) return

    // A click rather than a drag: select whatever is under the cursor. The map owns the
    // arbitration between a station and the line that ends at it — see `pickAt`.
    const rect = canvas.getBoundingClientRect()
    const world2 = map.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
    const pick = map.pickAt(world2.x, world2.y)
    if (pick?.kind === 'node') hud.selectNode(pick.node.id)
    else if (pick?.kind === 'edge') hud.selectEdge(pick.edge.id)
    else hud.selectNode(null)
  })

  // Right-click abandons placement, which is what every game of this kind does.
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (map.buildMode) cancelBuild()
  })

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      map.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12)
      map.applyCamera()
    },
    { passive: false },
  )

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      speed = speed === 0 ? 1 : 0
      hud.setSpeed(speed)
    }
    if (e.key === '1') {
      speed = 1
      hud.setSpeed(speed)
    }
    if (e.key === '2') {
      speed = 3
      hud.setSpeed(speed)
    }
    if (e.key === '3') {
      speed = 10
      hud.setSpeed(speed)
    }
    if (e.key === '4') {
      speed = 50
      hud.setSpeed(speed)
    }
    // The one that skips the quiet stretches, on the key next to the speeds it replaces.
    if (e.key.toLowerCase() === 'f') hud.callbacks.onSkip()
    if (e.key === 'Escape') {
      if (map.buildMode) cancelBuild()
      else if (hud.politicsPanel.isOpen()) hud.politicsPanel.setOpen(false)
      else if (hud.objectivesPanel.isOpen()) hud.objectivesPanel.setOpen(false)
      else hud.selectNode(null)
    }
    if (e.key.toLowerCase() === 'b') hud.buildPanel.setOpen(!hud.buildPanel.isOpen())
    if (e.key.toLowerCase() === 'p') hud.politicsPanel.setOpen(!hud.politicsPanel.isOpen())
    if (e.key.toLowerCase() === 'o') hud.objectivesPanel.setOpen(!hud.objectivesPanel.isOpen())
  })

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight)
    map.resize(window.innerWidth, window.innerHeight)
  })

  // --- Loop --------------------------------------------------------------

  let accumulator = 0
  let uiAccumulator = 0

  app.ticker.add((ticker) => {
    const dt = Math.min(0.25, ticker.deltaMS / 1000)

    // A finished scenario stops the clock, unless the player has asked to carry on. The verdict
    // stands either way — this is about whether the hours keep passing, not about whether the
    // brief was met. Bankruptcy is the one ending with no "carry on": there is no utility left.
    const playable = !world.finances.bankrupt && (world.outcome === 'playing' || world.freePlay)
    if (!playable) skip = null
    hud.setRunning(playable)

    if (skip) {
      // Run as hard as this frame's budget allows, checking after every hour whether the world
      // has done something worth stopping for. The budget is what keeps the page answering the
      // mouse: without it a skip over a quiet year would lock the tab for fourteen seconds.
      //
      // What counts as "something" is now a filed headline of at least `Notable` importance,
      // which is why the hint below is a sentence naming a place rather than the old
      // "Something is happening". See `sim/news/news.ts`.
      const until = performance.now() + SKIP_BUDGET_MS
      let found: NewsItem | null = null
      while (performance.now() < until && skip.ticksRun < SKIP_LIMIT_TICKS) {
        world.step()
        skip.ticksRun++
        const posted = world.news.peekHighest()
        if (posted && posted.importance >= NewsImportance.Notable) {
          found = posted
          break
        }
      }
      if (found || skip.ticksRun >= SKIP_LIMIT_TICKS) {
        // The map is only resynchronised at the end. Nobody is reading flow arrows during a
        // fast-forward, and redrawing them every frame was costing more than the simulation.
        map.syncToWorld()
        hud.setHint(found ? headline(found) : t('notable.timeLimit'))
        skip = null
        speed = 0
        hud.setSpeed(0)
      } else {
        // Days rather than hours: at these rates the hour figure is a blur, and what the player
        // wants to know is how much of the year they have spent looking for something.
        hud.setHint(t('ui.skipping', { days: Math.floor(skip.ticksRun / 24) }))
      }
      hud.newsPanel.collect(world.news.drain())
      hud.update()
    } else if (speed > 0 && playable) {
      accumulator += dt * TICKS_PER_SECOND_AT_1X * speed
      const until = performance.now() + SIM_BUDGET_MS
      let stepped = 0
      while (accumulator >= 1 && performance.now() < until) {
        world.step()
        accumulator -= 1
        stepped++
      }
      // Drop the backlog rather than trying to catch up forever on a slow machine.
      if (accumulator > 1) accumulator = 0
      if (stepped > 0) map.syncToWorld()
    }

    // Cards are raised once per frame from whatever the simulation filed, however many hours
    // that was. Draining rather than peeking is what stops the same headline appearing twice.
    hud.newsPanel.collect(world.news.drain())
    hud.newsPanel.tickToasts(performance.now())

    // The panels do not need refreshing at 60 Hz; the map animation does.
    uiAccumulator += dt
    if (uiAccumulator >= 0.1) {
      uiAccumulator = 0
      hud.update()
    }

    map.animate(dt, speed > 0)
    map.drawBuildOverlay()
  })

  // Expose the world for the smoke test and for poking at it in the console. Getters rather
  // than fields, because loading a save replaces all three and a snapshot taken at boot would
  // quietly go on describing the game the player abandoned.
  ;(window as unknown as { game: unknown }).game = {
    get world() {
      return world
    },
    get map() {
      return map
    },
    get hud() {
      return hud
    },
    save,
    load,
    build: {
      beginPlantConstruction,
      beginLineConstruction,
      beginHeatPipeConstruction,
      beginSubstationConstruction,
      quoteSubstation,
  demolishLine,
  renewLine,
  upgradeVoltage,
      retirePlant,
      quotePlant,
      quoteLine,
      quoteHeatPipe,
    },
  }
}

void main()
