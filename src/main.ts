/**
 * Entry point: the game loop and the input handling that glues the three layers together.
 *
 * The simulation runs on a fixed timestep decoupled from the frame rate, with an
 * accumulator. Changing speed changes how many ticks happen per real second, never the
 * length of a tick — so a run at 10x produces exactly the same history as the same run at
 * 1x. Without that, the fast-forward button would silently be a different game.
 */

import { Application } from 'pixi.js'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { MapView, TILE_PX } from '@render/mapView'
import { Hud, type Speed } from '@ui/hud'
import { setLocale } from '@i18n/index'

/** Simulation ticks per real second at 1x. One in-game day takes 12 seconds. */
const TICKS_PER_SECOND_AT_1X = 2
/** Never simulate more than this many ticks in one frame, or a stall becomes a freeze. */
const MAX_TICKS_PER_FRAME = 40

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

  const world = buildWorld(FIRST_REGION)

  let speed: Speed = 1
  const hud = new Hud(overlay, world, {
    onSetSpeed: (s) => {
      speed = s
      hud.setSpeed(s)
    },
  })
  hud.setSpeed(speed)

  const map = new MapView(app, world, {
    onSelectNode: (nodeId) => hud.selectNode(nodeId),
  })

  // Run one tick immediately so the first frame shows a live system rather than an empty one.
  world.step()
  map.syncToWorld()
  hud.update()

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

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    dragDistance += Math.abs(dx) + Math.abs(dy)
    lastX = e.clientX
    lastY = e.clientY
    map.camera.panByScreen(dx, dy)
    map.applyCamera()
  })

  canvas.addEventListener('pointerup', (e) => {
    canvas.classList.remove('dragging')
    if (dragging && dragDistance < 5) {
      // A click rather than a drag: select whatever is under the cursor.
      const rect = canvas.getBoundingClientRect()
      const world2 = map.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      const node = map.nodeAtWorld(world2.x, world2.y, TILE_PX)
      map.selectedNodeId = node ? node.id : null
      hud.selectNode(node ? node.id : null)
    }
    dragging = false
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
    if (e.key === 'Escape') hud.selectNode(null)
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

    if (speed > 0 && !world.finances.bankrupt) {
      accumulator += dt * TICKS_PER_SECOND_AT_1X * speed
      let stepped = 0
      while (accumulator >= 1 && stepped < MAX_TICKS_PER_FRAME) {
        world.step()
        accumulator -= 1
        stepped++
      }
      // Drop the backlog rather than trying to catch up forever on a slow machine.
      if (stepped >= MAX_TICKS_PER_FRAME) accumulator = 0
      if (stepped > 0) map.syncToWorld()
    }

    // The panels do not need refreshing at 60 Hz; the map animation does.
    uiAccumulator += dt
    if (uiAccumulator >= 0.1) {
      uiAccumulator = 0
      hud.update()
    }

    map.animate(dt, speed > 0)
  })

  // Expose the world for the smoke test and for poking at it in the console.
  ;(window as unknown as { game: unknown }).game = { world, map, hud }
}

void main()
