/**
 * Browser smoke test.
 *
 * Starts the built game in a real browser, lets it run, clicks a node, and captures
 * screenshots. Its job is to catch the failures a headless unit test cannot see: a renderer
 * that throws on the first frame, a panel that lays out on top of the map, a game that
 * looks like an empty screen.
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const OUT = new URL('../screenshots/', import.meta.url).pathname
const PORT = 4173

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

if (!existsSync(DIST)) {
  console.error('No dist/ directory. Run `npm run build` first.')
  process.exit(1)
}
await mkdir(OUT, { recursive: true })

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0]
    const rel = url === '/' ? 'index.html' : normalize(url).replace(/^(\.\.[/\\])+/, '')
    const file = join(DIST, rel)
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

await new Promise((resolve) => server.listen(PORT, resolve))

// The container ships a pinned Chromium; point Playwright at it rather than downloading
// another copy, which the sandbox forbids anyway.
const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launchOptions = { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
if (existsSync(PINNED_CHROME)) launchOptions.executablePath = PINNED_CHROME

const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

let exitCode = 0
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })

  // Wait for the game to have booted and run some ticks.
  await page.waitForFunction(() => window.game?.world?.tick > 0, { timeout: 20_000 })
  await page.waitForTimeout(2500)

  const afterBoot = await page.evaluate(() => ({
    tick: window.game.world.tick,
    cash: window.game.world.finances.cash,
    demand: window.game.world.lastDispatch?.totalDemandMw ?? 0,
    generation: window.game.world.lastDispatch?.totalGenerationMw ?? 0,
    plants: window.game.world.plants.length,
    aborted: window.game.world.lastDispatch?.aborted,
  }))
  console.log('after boot:', afterBoot)

  if (afterBoot.tick < 2) throw new Error('Simulation did not advance')
  if (afterBoot.generation <= 0) throw new Error('Nothing is generating')
  if (afterBoot.aborted) throw new Error('Dispatch solver aborted')

  await page.screenshot({ path: join(OUT, '01-overview.png') })

  // Select a city to open the inspector, which is where the modifier chain shows up.
  await page.evaluate(() => {
    window.game.map.selectedNodeId = 'n_rivermouth'
    window.game.hud.selectNode('n_rivermouth')
  })
  await page.waitForTimeout(400)
  const inspectorVisible = await page.evaluate(
    () => document.getElementById('inspector')?.classList.contains('visible') ?? false,
  )
  if (!inspectorVisible) throw new Error('Inspector did not open')
  await page.screenshot({ path: join(OUT, '02-city-inspector.png') })

  // A plant site, to show the "why" chain on availability and efficiency.
  await page.evaluate(() => {
    window.game.map.selectedNodeId = 'n_blackridge'
    window.game.hud.selectNode('n_blackridge')
  })
  await page.waitForTimeout(400)
  const whySteps = await page.evaluate(() => document.querySelectorAll('#inspector .why-step').length)
  console.log('explanation rows rendered:', whySteps)
  if (whySteps < 3) throw new Error('Modifier explanation did not render')
  await page.screenshot({ path: join(OUT, '03-plant-inspector.png') })

  // --- District heating -------------------------------------------------
  // The heat network has to be visibly running, not merely present in the data model.
  const heat = await page.evaluate(() => {
    const h = window.game.world.lastHeat
    return {
      demand: Math.round(h.totalHeatDemandMw),
      supplied: Math.round(h.totalHeatSuppliedMw),
      standingLoss: +h.totalHeatLossMw.toFixed(2),
      unserved: +h.totalUnservedHeatMw.toFixed(2),
      pipes: window.game.world.network.allEdges().filter((e) => e.commodity === 'heat').length,
      backpressureForced: [...h.commitments.values()]
        .filter((c) => c.mode === 'backpressure')
        .map((c) => Math.round(c.forcedOutputMw)),
    }
  })
  console.log('district heating:', heat)
  if (heat.pipes === 0) throw new Error('No heat mains on the map')
  if (heat.supplied <= 0) throw new Error('The heat network is not delivering anything')
  if (heat.standingLoss <= 0) throw new Error('A buried main that loses no heat is not a buried main')

  // The cogeneration plant, where the coupling between the two commodities is on show.
  await page.evaluate(() => {
    window.game.map.selectedNodeId = 'n_ironworks'
    window.game.hud.selectNode('n_ironworks')
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, '09-cogeneration.png') })

  // Zoomed onto the heat plant, so the mains themselves are visible rather than a few pixels.
  await page.evaluate(() => {
    window.game.hud.selectNode(null)
    window.game.map.camera.zoom = 2.2
    window.game.map.camera.centerOn(13 * 32, 11 * 32)
    window.game.map.applyCamera()
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, '10-heat-main.png') })

  // --- Building ---------------------------------------------------------
  // The point of this milestone: the player can actually do something.
  await page.evaluate(() => window.game.hud.buildPanel.setOpen(true))
  await page.waitForTimeout(300)
  const buildRows = await page.evaluate(() => document.querySelectorAll('#build-panel .build-row').length)
  console.log('build options offered:', buildRows)
  if (buildRows < 5) throw new Error('Build panel did not populate')

  // A technology that does not exist in 1995 must be offered as blocked, with a reason.
  const blocked = await page.evaluate(() =>
    [...document.querySelectorAll('#build-panel .build-blocked')].map((n) => n.textContent),
  )
  console.log('blocked options:', blocked)
  if (blocked.length === 0) throw new Error('Expected some technologies to be unavailable in 1995')

  // Prices move with time, and the panel has to say which way. Without a visible trend the
  // player is making a thirty-year capital decision on today's price alone.
  const trends = await page.evaluate(() =>
    [...document.querySelectorAll('#build-panel .build-trend')].map((n) => n.textContent),
  )
  console.log('cost trends shown:', trends)
  if (trends.length === 0) throw new Error('No technology showed a cost trend')
  if (!trends.some((s) => s.startsWith('↓'))) throw new Error('Nothing is getting cheaper')
  if (!trends.some((s) => s.startsWith('↑'))) throw new Error('Nothing is getting dearer')

  await page.screenshot({ path: join(OUT, '06-build-panel.png') })

  // Place a gas turbine and wire it to the capital.
  const built = await page.evaluate(() => {
    const g = window.game
    const site = { x: 26, y: 24 }
    const plant = g.build.beginPlantConstruction(g.world, 'ccgt', site.x, site.y)
    if (!plant.ok) return { ok: false, why: plant.quote.reasonKey }
    const line = g.build.beginLineConstruction(
      g.world,
      g.world.getPlant(plant.plantId).nodeId,
      'n_rivermouth',
      220,
      1,
    )
    g.map.syncToWorld()
    return {
      ok: line.ok,
      why: line.quote.reasonKey,
      plantId: plant.plantId,
      cost: plant.quote.totalCost + line.quote.totalCost,
      months: Math.round(plant.quote.buildTicks / (8760 / 12)),
    }
  })
  console.log('placed:', built)
  if (!built.ok) throw new Error(`Could not build: ${built.why}`)

  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, '07-under-construction.png') })

  // Run fast for a while so the charts fill up and a season passes.
  await page.evaluate(() => window.game.hud.setSpeed(10))
  await page.keyboard.press('3')
  await page.waitForTimeout(6000)

  const afterFastForward = await page.evaluate(() => ({
    tick: window.game.world.tick,
    date: window.game.world.date,
    cash: window.game.world.finances.cash,
    bankrupt: window.game.world.finances.bankrupt,
  }))
  console.log('after fast-forward:', afterFastForward)
  if (afterFastForward.tick <= afterBoot.tick) throw new Error('Fast-forward did not advance the clock')

  await page.screenshot({ path: join(OUT, '04-after-fast-forward.png') })

  // Zoomed in, to check the flow particles and labels read properly.
  await page.evaluate(() => {
    window.game.map.camera.zoom = 1.6
    window.game.map.camera.centerOn(24 * 26, 20 * 26)
    window.game.map.applyCamera()
  })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, '05-zoomed.png') })

  // The placement overlay: shaded unbuildable ground and a ghost under the cursor.
  await page.evaluate(() => {
    const g = window.game
    g.map.buildMode = { kind: 'plant', typeId: 'wind' }
    g.map.hoverTile = { x: 20, y: 12 }
    g.map.hoverValid = true
    g.map.drawBuildOverlay()
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, '08-placement-overlay.png') })
  await page.evaluate(() => {
    window.game.map.buildMode = null
    window.game.map.drawBuildOverlay()
  })

  // --- Events -----------------------------------------------------------
  // Force one in, so the panel and the choice buttons are exercised rather than assumed.
  const eventPanel = await page.evaluate(() => {
    const g = window.game
    const world = g.world
    world.director.state.pending.push({
      uid: 'smoke1',
      defId: 'gas_supply_interruption',
      raisedTick: world.tick,
      landsTick: world.tick + 168,
      choiceId: null,
    })
    g.hud.update()
    const panel = document.getElementById('events')
    return {
      pendingShown: panel.querySelectorAll('.event-pending').length,
      choices: [...panel.querySelectorAll('.event-choices button')].map((b) => b.textContent),
      standingToggles: panel.querySelectorAll('.event-toggle button').length,
    }
  })
  console.log('event panel:', eventPanel)
  if (eventPanel.pendingShown !== 1) throw new Error('The pending event did not appear in the panel')
  if (eventPanel.choices.length < 3) throw new Error('Event choices did not render')
  if (eventPanel.standingToggles < 4) throw new Error('Maintenance and insurance controls missing')

  await page.screenshot({ path: join(OUT, '11-events.png') })

  // Choosing a response has to actually stick, or the panel is decoration.
  const chosen = await page.evaluate(() => {
    const g = window.game
    g.hud.callbacks?.onChooseEvent?.('smoke1', 'alternativeSupply')
    g.world.director.choose('smoke1', 'alternativeSupply')
    g.hud.update()
    return g.world.director.state.pending[0].choiceId
  })
  console.log('event choice recorded:', chosen)
  if (chosen !== 'alternativeSupply') throw new Error('Choosing an event response did not stick')

  // --- Politics ---------------------------------------------------------
  const politics = await page.evaluate(() => {
    const g = window.game
    g.hud.politicsPanel.setOpen(true)
    const panel = document.getElementById('politics-panel')
    return {
      visible: panel.classList.contains('visible'),
      regime: g.world.state.policyRegimeId,
      carbon: Math.round(g.world.state.carbonPricePerTonne),
      confidence: +g.world.state.investorConfidence.toFixed(2),
      blocks: panel.querySelectorAll('.pol-block').length,
      fuelIndices: Object.keys(g.world.state.fuelPriceIndex).length,
      tariff: Math.round(g.world.state.regulatedTariffPerMwh),
    }
  })
  console.log('politics:', politics)
  if (!politics.visible) throw new Error('The politics panel did not open')
  if (politics.blocks < 4) throw new Error('The politics panel did not populate')
  if (!politics.regime) throw new Error('No government is in office')

  await page.screenshot({ path: join(OUT, '12-politics.png') })
  await page.evaluate(() => window.game.hud.politicsPanel.setOpen(false))

  // --- Actually clicking things ------------------------------------------
  //
  // Every test above this line drives the game through its API. That left a bug in the interface
  // invisible for four milestones: the panels rebuild themselves ten times a second, a human
  // click takes eighty to a hundred and fifty milliseconds, and a browser only fires `click` when
  // the press and the release land on the same element. Buttons were being destroyed mid-press,
  // so roughly every other one did nothing — which reads as a flaky interface rather than as a
  // bug with a cause, and which no amount of calling `beginPlantConstruction` directly can catch.
  //
  // So this section uses the mouse.
  await page.evaluate(() => window.game.hud.selectNode(null))
  await page.click('#build-toggle')
  await page.waitForTimeout(200)
  if (!(await page.evaluate(() => document.getElementById('build-panel')?.classList.contains('visible')))) {
    throw new Error('Clicking the Build button did not open the panel')
  }

  // Pick a technology by clicking its row, and check the choice actually took.
  const picked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#build-panel .build-row')]
    const row = rows.find((r) => r.textContent.includes('Combined-cycle'))
    if (!row) return null
    const box = row.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  if (!picked) throw new Error('The combined-cycle row is missing from the build panel')
  await page.mouse.click(picked.x, picked.y)
  await page.waitForTimeout(200)
  const mode = await page.evaluate(() => window.game.map.buildMode)
  console.log('build mode after clicking a row:', mode)
  if (mode?.typeId !== 'ccgt') throw new Error('Clicking a build row did not select the technology')

  // And place it by clicking the map, well clear of the panels that sit over the canvas.
  const site = await page.evaluate(() => {
    const g = window.game
    const cam = g.map.camera
    for (let y = 0; y < g.world.scenario.mapHeight; y++) {
      for (let x = 0; x < g.world.scenario.mapWidth; x++) {
        if (!g.build.quotePlant(g.world, 'ccgt', x, y).ok) continue
        const sx = (x * 32 + 16 - cam.x) * cam.zoom
        const sy = (y * 32 + 16 - cam.y) * cam.zoom
        if (sx < 360 || sx > 1090 || sy < 150 || sy > 780) continue
        return { x, y, sx, sy }
      }
    }
    return null
  })
  if (!site) throw new Error('Nowhere clickable to place a station')
  const fleetBefore = await page.evaluate(() => window.game.world.plants.length)
  await page.mouse.move(site.sx, site.sy)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const fleetAfter = await page.evaluate(() => window.game.world.plants.length)
  console.log('clicked the map to build:', fleetBefore, '->', fleetAfter)
  if (fleetAfter <= fleetBefore) throw new Error('Clicking the map did not start a station')

  // A panel must not rebuild itself when nothing has changed — that churn is what ate the
  // clicks, and it is also what made the game burn a core doing nothing.
  await page.keyboard.press('Space')
  await page.evaluate(() => window.game.hud.selectNode('n_oldharbour'))
  await page.waitForTimeout(300)
  const churn = await page.evaluate(async () => {
    const counts = {}
    const observers = []
    for (const id of ['inspector', 'events', 'build-panel']) {
      const node = document.getElementById(id)
      counts[id] = 0
      const obs = new MutationObserver(() => counts[id]++)
      obs.observe(node, { childList: true, subtree: true })
      observers.push(obs)
    }
    await new Promise((r) => setTimeout(r, 1500))
    for (const o of observers) o.disconnect()
    return counts
  })
  console.log('DOM rebuilds in 1.5s with the clock stopped:', churn)
  for (const [id, n] of Object.entries(churn)) {
    if (n > 0) throw new Error(`#${id} rebuilt ${n} times while the game was paused`)
  }

  // And the buttons it holds must survive being clicked.
  const phaseBefore = await page.evaluate(() => window.game.world.getPlant('p_oldharbour').phase)
  await page.click('#inspector .asset-actions button.danger')
  await page.waitForTimeout(300)
  const phaseAfter = await page.evaluate(() => window.game.world.getPlant('p_oldharbour').phase)
  console.log('Retire clicked, phase:', phaseBefore, '->', phaseAfter)
  if (phaseAfter === phaseBefore) throw new Error('Clicking Retire did nothing')
  await page.keyboard.press('Space')

  // --- Objectives -------------------------------------------------------
  const objectives = await page.evaluate(() => {
    const g = window.game
    g.hud.objectivesPanel.setOpen(true)
    const panel = document.getElementById('objectives-panel')
    return {
      visible: panel.classList.contains('visible'),
      rows: panel.querySelectorAll('.obj').length,
      chips: [...panel.querySelectorAll('.obj-chip')].map((n) => n.textContent),
      numbers: [...panel.querySelectorAll('.obj-numbers')].map((n) => n.textContent),
      outcome: g.world.outcome,
      declared: g.world.scenario.objectives.length,
    }
  })
  console.log('objectives:', objectives)
  if (!objectives.visible) throw new Error('The objectives panel did not open')
  if (objectives.rows !== objectives.declared) throw new Error('Not every objective was listed')
  if (objectives.numbers.length === 0) throw new Error('No objective showed a measured value')
  if (objectives.outcome !== 'playing') throw new Error('The scenario ended in the first few years')

  await page.screenshot({ path: join(OUT, '13-objectives.png') })

  // --- Save and load ----------------------------------------------------
  // The property that matters is the one the unit tests prove: a loaded game continues
  // identically. What only a browser can show is that the load survives the *renderer* — that
  // the map is rebuilt against the new world rather than left pointing at the old one.
  const saved = await page.evaluate(() => {
    const g = window.game
    g.world.finances.cash = 123_456_789
    g.save()
    g.world.finances.cash = 1
    return {
      hint: document.getElementById('hint').textContent,
      stored: !!localStorage.getItem('powergrid-tycoon.save.v1'),
      tick: g.world.tick,
    }
  })
  console.log('saved:', saved)
  if (!saved.stored) throw new Error('Saving wrote nothing to storage')

  const loaded = await page.evaluate(() => {
    const g = window.game
    const before = g.world
    g.load()
    return {
      hint: document.getElementById('hint').textContent,
      swapped: g.world !== before,
      cash: Math.round(g.world.finances.cash),
      tick: g.world.tick,
      plants: g.world.plants.length,
      mapWorldIsCurrent: g.map.world === g.world,
      hudWorldIsCurrent: g.hud.world === g.world,
    }
  })
  console.log('loaded:', loaded)
  if (!loaded.swapped) throw new Error('Loading did not replace the world')
  if (loaded.cash !== 123_456_789) throw new Error(`Loaded the wrong state: cash ${loaded.cash}`)
  if (loaded.tick !== saved.tick) throw new Error('The loaded game is at a different hour')
  if (!loaded.mapWorldIsCurrent) throw new Error('The map is still drawing the old world')
  if (!loaded.hudWorldIsCurrent) throw new Error('The overlay is still reading the old world')

  // And it must go on running: a load that leaves a frozen game is not a load.
  await page.evaluate(() => window.game.hud.setSpeed(3))
  await page.keyboard.press('2')
  await page.waitForTimeout(2000)
  const resumed = await page.evaluate(() => window.game.world.tick)
  console.log('resumed at tick:', resumed)
  if (resumed <= loaded.tick) throw new Error('The loaded game did not resume')

  await page.screenshot({ path: join(OUT, '14-after-load.png') })

  // --- The end of a run -------------------------------------------------
  // Forced rather than played out: reaching 2025 honestly is thirty simulated years, and the
  // question here is only whether the screen renders and the clock stops.
  const ending = await page.evaluate(async () => {
    const g = window.game
    g.world.outcome = 'won'
    g.hud.update()
    const panel = document.getElementById('game-over')
    const tickAtEnd = g.world.tick
    await new Promise((r) => setTimeout(r, 800))
    return {
      visible: panel.classList.contains('visible'),
      heading: panel.querySelector('h2')?.textContent,
      summarised: panel.querySelectorAll('.obj-summary').length,
      clockStopped: g.world.tick === tickAtEnd,
    }
  })
  console.log('end of run:', ending)
  if (!ending.visible) throw new Error('The end-of-scenario screen did not appear')
  if (ending.summarised === 0) throw new Error('The end screen did not say why the run ended')
  if (!ending.clockStopped) throw new Error('The simulation kept running after the scenario ended')

  await page.screenshot({ path: join(OUT, '15-scenario-complete.png') })
  await page.evaluate(() => {
    window.game.world.outcome = 'playing'
    window.game.hud.update()
  })

  const finalState = await page.evaluate(() => {
    const plants = window.game.world.plants
    return {
      plants: plants.length,
      building: plants.filter((p) => p.phase === 1).length,
      operating: plants.filter((p) => p.phase === 2).length,
      committed: Math.round(window.game.world.committedSpend() / 1e6),
    }
  })
  console.log('fleet:', finalState)
  if (finalState.plants < 7) throw new Error('The built plant is missing from the fleet')

  if (errors.length > 0) {
    console.error('\nBrowser reported errors:')
    for (const e of errors) console.error('  ' + e)
    exitCode = 1
  } else {
    console.log('\nNo console or page errors.')
  }
} catch (e) {
  console.error('Smoke test failed:', e)
  exitCode = 1
} finally {
  await browser.close()
  server.close()
}

process.exit(exitCode)
