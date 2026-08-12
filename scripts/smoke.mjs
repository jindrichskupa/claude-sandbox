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

  // A new run opens paused behind the opening brief, which is the point of it — so the first
  // thing this does is what a player does: read it and press Begin. Everything after this point
  // is the game running, and the brief gets its own checks further down.
  await page.waitForFunction(() => document.getElementById('brief-begin') !== null, { timeout: 20_000 })
  const openedPaused = await page.evaluate(() => ({
    tick: window.game.world.tick,
    briefUp: document.getElementById('briefing').classList.contains('visible'),
  }))
  console.log('opened paused:', openedPaused)
  if (!openedPaused.briefUp) throw new Error('A new run did not open with the brief')
  if (openedPaused.tick > 2) throw new Error('The clock ran while the brief was still up')
  await page.evaluate(() => document.getElementById('brief-begin').click())

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

  // --- Every button in the inspector can actually be pressed ---------------
  // A node with four units makes the inspector taller than the screen, which is fine — it scrolls.
  // What was not fine is that it ran further down the screen than the other left-hand panels and
  // so passed *under* the line legend and the standing concern line, both of which sit above it in
  // the stacking order and swallowed the clicks. The last unit's Refurbish and Mothball were
  // visible and dead. Nothing about that is visible in a screenshot, which is why it is asserted.
  const reach = await page.evaluate(() => {
    const g = window.game
    const counts = new Map()
    for (const p of g.world.plants) counts.set(p.nodeId, (counts.get(p.nodeId) ?? 0) + 1)
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    g.hud.selectNode(busiest[0], true)
    const inspector = document.getElementById('inspector')
    const blocked = []
    for (const button of inspector.querySelectorAll('button')) {
      // Scroll it into view first: below the fold is not the same as covered, and conflating the
      // two makes this check pass or fail for the wrong reason.
      button.scrollIntoView({ block: 'center' })
      const r = button.getBoundingClientRect()
      const over = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (over && over !== button && !button.contains(over)) {
        blocked.push(`${button.textContent.trim()} under ${over.closest('[id]')?.id ?? over.tagName}`)
      }
    }
    return { node: busiest[0], units: busiest[1], buttons: inspector.querySelectorAll('button').length, blocked }
  })
  console.log('inspector reachability:', reach)
  if (reach.units < 2) throw new Error('No node with more than one unit; this check proves nothing')
  if (reach.blocked.length) throw new Error(`Inspector buttons are covered: ${reach.blocked.join(', ')}`)

  // --- Naming ------------------------------------------------------------
  // Typed for real rather than driven through the model, because everything that can go wrong
  // here is in the event path: the field has to survive the inspector's once-a-tick rebuild while
  // it is open, and the keystrokes must not reach the shortcuts on the document — which would
  // otherwise pan the map and change the game speed under a player typing a name.
  //
  // Paused for the press itself. Not to dodge a bug — the field is opened on mousedown for that
  // reason — but because Playwright refuses to click an element that is replaced twice a second,
  // and pausing to rename something is what a player does anyway. The clock is started again
  // immediately, which is the half that matters.
  const speedButton = (i) => document.querySelectorAll('.speed-controls button')[i].click()
  await page.evaluate(() => window.game.hud.selectNode('n_blackridge', true))
  await page.evaluate(speedButton, 0)
  await page.waitForTimeout(200)
  const beforeRename = await page.evaluate(() => ({
    shown: document.querySelector('#inspector .asset-name').textContent,
    tick: window.game.world.tick,
  }))
  // The name the scenario author wrote, which for years reached no screen: the plant had nowhere
  // to keep a name, so both units at Blackridge answered to the site and the panel printed the id.
  if (beforeRename.shown !== 'Blackridge I') {
    throw new Error(`The unit is not called what the scenario calls it: ${beforeRename.shown}`)
  }

  await page.click('#inspector .asset-name')
  await page.evaluate(speedButton, 1)
  await page.keyboard.press('Control+A')
  // Contains a digit and a space on purpose: '3' is a speed shortcut and space is pause.
  await page.type('#inspector .name-input', 'Stara 3 dama', { delay: 40 })
  // Long enough that an unguarded rebuild would have cleared the field under the typing.
  await page.waitForTimeout(1500)
  const midEdit = await page.evaluate(() => ({
    value: document.querySelector('#inspector .name-input')?.value ?? null,
    tick: window.game.world.tick,
  }))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const renamed = await page.evaluate(() => ({
    shown: document.querySelector('#inspector .asset-name').textContent,
    model: window.game.world.plants.find((p) => p.id === 'p_blackridge1').name,
    stillEditing: document.querySelector('#inspector .name-input') !== null,
  }))
  console.log('renaming:', { was: beforeRename.shown, midEdit, ...renamed })
  if (midEdit.tick <= beforeRename.tick) throw new Error('The clock never restarted; the test proves nothing')
  if (midEdit.value !== 'Stara 3 dama') throw new Error(`The field was cleared while typing: ${midEdit.value}`)
  if (renamed.shown !== 'Stara 3 dama') throw new Error(`Rename did not stick: ${renamed.shown}`)
  if (renamed.model !== 'Stara 3 dama') throw new Error('The name never reached the model')
  if (renamed.stillEditing) throw new Error('Enter did not close the field')
  // The other unit on the same site is untouched, which is the whole reason a name lives on the
  // machine rather than on the ground it stands on.
  const sibling = await page.evaluate(
    () => window.game.world.plantDisplayName('p_blackridge2'),
  )
  if (sibling !== 'Blackridge II') throw new Error(`Renaming one unit renamed another: ${sibling}`)
  await page.screenshot({ path: join(OUT, '03b-renamed.png') })

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

  // --- A junction of the player's own -------------------------------------
  // Before this existed a line could only join nodes the scenario had placed, so the player
  // could wire up what they were given and nothing else.
  await page.evaluate(() => window.game.hud.buildPanel.setOpen(true))
  await page.waitForTimeout(200)
  // The panel has sections now, because the substations used to sit below eleven kinds of power
  // station and a player looking for one concluded they did not exist. Lines and substations
  // share the "Network" section, which is where anybody would look for either.
  const sectioned = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#build-panel .acct-tabs button')]
    const network = tabs.find((b) => b.textContent === 'Network')
    if (!network) return false
    network.click()
    return true
  })
  if (!sectioned) throw new Error('The build panel has no Network section')
  await page.waitForTimeout(150)
  const subRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#build-panel .build-row')].find((r) =>
      r.textContent.includes('220 kV substation'),
    )
    if (!row) return null
    row.scrollIntoView({ block: 'center' })
    const b = row.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await page.waitForTimeout(150)
  if (!subRow) throw new Error('No substation offered in the build panel')
  await page.mouse.click(subRow.x, subRow.y)
  await page.waitForTimeout(200)
  const subMode = await page.evaluate(() => window.game.map.buildMode)
  console.log('build mode after clicking the substation row:', subMode)
  if (subMode?.kind !== 'substation') throw new Error('Clicking the substation row did not arm it')

  const subSite = await page.evaluate(() => {
    const g = window.game
    const cam = g.map.camera
    for (let y = 0; y < g.world.scenario.mapHeight; y++) {
      for (let x = 0; x < g.world.scenario.mapWidth; x++) {
        if (!g.build.quoteSubstation(g.world, 220, x, y).ok) continue
        const sx = (x * 32 + 16 - cam.x) * cam.zoom
        const sy = (y * 32 + 16 - cam.y) * cam.zoom
        if (sx < 360 || sx > 1090 || sy < 150 || sy > 780) continue
        return { sx, sy }
      }
    }
    return null
  })
  if (!subSite) throw new Error('Nowhere clickable to put a substation')
  const nodesBefore = await page.evaluate(() => window.game.world.network.allNodes().length)
  await page.mouse.move(subSite.sx, subSite.sy)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const nodesAfter = await page.evaluate(() => ({
    count: window.game.world.network.allNodes().length,
    subs: window.game.world.network.allNodes().filter((n) => n.id.startsWith('n_sub_')).length,
  }))
  console.log('substation placed by clicking the map:', nodesBefore, '->', nodesAfter)
  if (nodesAfter.subs < 1) throw new Error('Clicking the map did not place a substation')

  // ...and it is a compound being dug, not a finished one. It used to arrive the instant it was
  // paid for, the one asset in the game with no lead time. A corridor may still be run to it —
  // that is how the work is really sequenced — and waits for the compound before it is switched in,
  // so the date the inspector counts down to has to be the later of the two.
  const station = await page.evaluate(() => {
    const g = window.game
    const node = g.world.network.allNodes().find((n) => n.id.startsWith('n_sub_'))
    const other = g.world.network.getNode('n_central')
    const quote = g.build.quoteLine(g.world, other.id, node.id, 220, 1)
    const line = g.build.beginLineConstruction(g.world, other.id, node.id, 220, 1)
    const edgeId = g.world.network.edgesOf(node.id)[0]
    g.hud.selectNode(node.id, false)
    return {
      kvLevels: node.kvLevels,
      monthsOut: Math.round((node.inServiceTick - g.world.tick) / (8760 / 12)),
      lineQuoted: quote.ok,
      lineStarted: line.ok,
      energised: edgeId ? g.world.network.getEdge(edgeId).energised : null,
      energisesAt: edgeId ? g.world.energisingTick(edgeId) : null,
      stationReadyAt: node.inServiceTick,
      inspectorText: document.getElementById('inspector').textContent,
    }
  })
  console.log('station under construction:', station)
  if (!(station.monthsOut > 0)) throw new Error('The station was in service the hour it was ordered')
  if (!station.lineQuoted || !station.lineStarted) {
    throw new Error('A line could not be run to a station that is still being built')
  }
  if (station.energised !== false) throw new Error('The line went live before its station did')
  if (!(station.energisesAt >= station.stationReadyAt)) {
    throw new Error('The energising date ignores the station it is waiting for')
  }
  if (!station.inspectorText.includes('In service in')) {
    throw new Error('The inspector did not say when the station would be finished')
  }

  // --- An event says what it has hold of ----------------------------------
  // "Construction blockade" with no site is a headline about somebody else's problem: the player's
  // first question is which of their projects has stopped. The event used to carry a world-wide
  // build-time modifier and name nothing — and the modifier could not even do its job, because a
  // project's finish date is fixed the hour it is committed.
  const blockade = await page.evaluate(() => {
    const g = window.game
    let site = null
    for (let y = 0; y < g.world.scenario.mapHeight && !site; y++) {
      for (let x = 0; x < g.world.scenario.mapWidth; x++) {
        if (g.build.quotePlant(g.world, 'ccgt', x, y).ok) { site = { x, y }; break }
      }
    }
    if (!site) return { skipped: 'nowhere to build' }
    g.build.beginPlantConstruction(g.world, 'ccgt', site.x, site.y)

    // Record every project under way, because the director picks one of them and it need not be
    // the one just started — the smoke test has built things before reaching here.
    const before = new Map(
      g.world.plants.filter((p) => p.phase === 1).map((p) => [p.id, p.phaseEndsTick]),
    )

    g.world.director.state.pending.push({
      uid: 'smoke-blockade', defId: 'construction_blockade',
      raisedTick: g.world.tick, landsTick: g.world.tick, choiceId: 'accept',
    })
    for (let i = 0; i < 3; i++) g.world.step()
    g.hud.update()

    const active = g.world.director.state.active.find((a) => a.uid === 'smoke-blockade')
    const hit = active?.delayedPlantId ? g.world.getPlant(active.delayedPlantId) : null
    const row = document.querySelector('#events .event-subject')
    return {
      delayedPlantId: active?.delayedPlantId,
      moved: hit ? hit.phaseEndsTick - (before.get(hit.id) ?? hit.phaseEndsTick) : 0,
      commissionsWithIt: hit ? hit.commissionedTick === hit.phaseEndsTick : false,
      subjectText: row?.textContent ?? null,
      filed: g.world.news.all().some((n) => n.titleKey === 'news.buildDelayed'),
    }
  })
  console.log('construction blockade:', blockade)
  if (!blockade.skipped) {
    if (!blockade.delayedPlantId) throw new Error('The blockade fell on no site at all')
    if (!(blockade.moved > 0)) throw new Error('The blockade did not move the finish date')
    if (!blockade.commissionsWithIt) throw new Error('A delayed plant would arrive late and already old')
    if (!blockade.subjectText) throw new Error('The events panel does not say what is held up')
    // The raw key would read "plant.ccgt#1" — the name convention has to be expanded for display.
    if (/[#]|plant\./.test(blockade.subjectText)) {
      throw new Error(`The panel shows a raw name key: ${blockade.subjectText}`)
    }
    if (!blockade.filed) throw new Error('Nothing was filed in the news about the delay')
  }

  // --- The language switch keeps the run ---------------------------------
  // A reload is what rebuilds the overlay in the new language, and a reload is also what would
  // normally throw away the game in progress. The run is parked and picked up, so the clock, the
  // money and the fleet have to come back — and the opening brief must *not*, because the player
  // has already read it and being made to dismiss it again would punish them for using a setting.
  const parked = await page.evaluate(() => ({
    tick: window.game.world.tick,
    cash: Math.round(window.game.world.finances.cash),
    plants: window.game.world.plants.length,
  }))
  await page.click('#locale-cs')
  await page.waitForFunction(() => window.game !== undefined, null, { timeout: 60000 })
  await page.waitForTimeout(500)
  const switched = await page.evaluate(() => ({
    tick: window.game.world.tick,
    cash: Math.round(window.game.world.finances.cash),
    plants: window.game.world.plants.length,
    briefingVisible: document.getElementById('briefing')?.classList.contains('visible') ?? false,
    active: document.querySelector('.tab-languages button.active')?.id,
    tabs: [...document.querySelectorAll('#panel-tabs > button')].map((b) => b.textContent),
    clock: document.getElementById('clock')?.textContent,
  }))
  console.log('language switch:', { parked, switched })
  if (switched.active !== 'locale-cs') throw new Error('The switch did not mark Czech as current')
  if (switched.tick < parked.tick) throw new Error('The run went backwards across a language change')
  if (switched.plants !== parked.plants) throw new Error('The fleet did not survive a language change')
  if (switched.briefingVisible) throw new Error('The opening brief came back after a language change')
  if (switched.tabs.includes('Build')) throw new Error('The interface is still in English')
  // Dates are built from dictionary months, so an English month here means a hardcoded one.
  if (/Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(switched.clock ?? '')) {
    throw new Error(`The clock still shows an English month: ${switched.clock}`)
  }
  await page.click('#locale-en')
  await page.waitForFunction(() => window.game !== undefined, null, { timeout: 60000 })
  await page.waitForTimeout(500)

  // --- Borrowing is a decision now ---------------------------------------
  // It used to happen to the player: a shortfall drew silently on a facility nobody chose, the
  // principal was never repaid by anything, and no screen anywhere said so. The accounts panel is
  // now where that lives, so the buttons have to be there and the money has to arrive.
  const financing = await page.evaluate(() => {
    const g = window.game
    g.hud.accountsPanel.setOpen(true)
    const panel = document.getElementById('accounts-panel')
    const box = panel.querySelector('.acct-financing')
    const offers = [...box.querySelectorAll('.acct-offers button')]
    const before = { cash: g.world.finances.cash, debt: g.world.finances.debt, loans: g.world.finances.loans.length }
    offers[0]?.click()
    const after = { cash: g.world.finances.cash, debt: g.world.finances.debt, loans: g.world.finances.loans.length }
    return {
      text: box.textContent,
      offers: offers.map((b) => b.textContent),
      quoteTitle: offers[0]?.title ?? null,
      before,
      after,
      inheritedLoans: before.loans,
    }
  })
  console.log('financing:', financing)
  if (financing.inheritedLoans < 1) throw new Error('The inherited debt is not a loan')
  if (financing.offers.length === 0) throw new Error('No way to borrow in the accounts panel')
  if (!/%/.test(financing.quoteTitle ?? '')) throw new Error('A borrowing offer does not quote its rate')
  if (!(financing.after.cash > financing.before.cash)) throw new Error('Borrowing did not deliver any money')
  if (!(financing.after.loans > financing.before.loans)) throw new Error('Borrowing created no loan')
  await page.evaluate(() => window.game.hud.accountsPanel.setOpen(false))

  // --- Lines are things you can ask about --------------------------------
  // Clock stopped, so the panel is not rebuilding under the automation between locating a
  // button and pressing it. A person does not need this — a press freezes the rebuild for its
  // own duration — but Playwright resolves the element and clicks it as two separate steps.
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
  // Every other asset on the map could be clicked; lines could not, so the one whose behaviour
  // most needs explaining was the one you could learn least about.
  const lineClick = await page.evaluate(() => {
    const g = window.game
    const cam = g.map.camera
    for (const edge of g.world.network.allEdges()) {
      if (edge.commodity !== 'electric' || !edge.energised) continue
      // Only a single-circuit corridor can be reinforced, which is what this section is about.
      if (edge.circuits >= 2) continue
      // Walk the routed corridor rather than the straight line between endpoints — after the
      // routing milestone those are frequently nowhere near each other — and take a point that
      // is not also within grabbing distance of a substation, since nodes win ties by design.
      const route = edge.route ?? [g.world.network.getNode(edge.from), g.world.network.getNode(edge.to)]
      for (const frac of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const i = Math.min(route.length - 1, Math.max(0, Math.round(frac * (route.length - 1))))
        const mx = route[i].x * 32 + 16
        const my = route[i].y * 32 + 16
        if (g.map.nodeAtWorld(mx, my, 32)) continue
        if (g.map.edgeAtWorld(mx, my)?.id !== edge.id) continue
        const sx = (mx - cam.x) * cam.zoom
        const sy = (my - cam.y) * cam.zoom
        if (sx < 360 || sx > 1090 || sy < 150 || sy > 780) continue
        return { id: edge.id, sx, sy }
      }
    }
    return null
  })
  if (!lineClick) throw new Error('No line on screen to click')
  await page.mouse.click(lineClick.sx, lineClick.sy)
  await page.waitForTimeout(300)
  const lineInspector = await page.evaluate(() => {
    const panel = document.getElementById('inspector')
    return {
      visible: panel.classList.contains('visible'),
      heading: panel.querySelector('h2')?.textContent,
      rows: [...panel.querySelectorAll('.kv')].map((n) => n.textContent),
      action: panel.querySelector('.asset-actions button')?.textContent,
    }
  })
  console.log('clicked a line:', lineInspector)
  if (!lineInspector.visible) throw new Error('Clicking a line did not open the inspector')
  if (!lineInspector.rows.some((r) => r.includes('Length'))) throw new Error('The line inspector shows no length')
  if (lineInspector.action !== 'Add a second circuit') throw new Error('No way to reinforce a corridor')

  // Reinforcing a corridor rather than drawing a second one on top of it.
  const circuitsBefore = await page.evaluate(
    (id) => window.game.world.network.getEdge(id).circuits,
    lineClick.id,
  )
  await page.click('#inspector .asset-actions button')
  await page.waitForTimeout(300)
  const upgrade = await page.evaluate((id) => {
    const e = window.game.world.network.getEdge(id)
    return { circuits: e.circuits, pending: e.upgradeToCircuits ?? null, at: e.upgradeAtTick ?? null }
  }, lineClick.id)
  console.log('after Add a second circuit:', { circuitsBefore, ...upgrade })
  if (upgrade.pending !== circuitsBefore + 1) throw new Error('The second circuit was not ordered')
  // And it must not arrive before the crews have finished.
  if (upgrade.circuits !== circuitsBefore) throw new Error('The second circuit arrived instantly')

  await page.screenshot({ path: join(OUT, '16-line-inspector.png') })
  await page.evaluate(() => window.game.hud.selectEdge(null))
  await page.keyboard.press('Space')

  // --- Running on to the next thing that matters -------------------------
  // At ten times speed a quiet game year is seven minutes of watching a load curve breathe.
  const before = await page.evaluate(() => window.game.world.tick)
  const t0 = Date.now()
  await page.click('#skip-button')
  await page.waitForFunction(
    (t) => window.game.world.tick > t + 24 || !document.getElementById('hint')?.textContent?.includes('Running on'),
    before,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(1500)
  const skipped = await page.evaluate(() => ({
    tick: window.game.world.tick,
    hint: document.getElementById('hint')?.textContent,
  }))
  const elapsed = (Date.now() - t0) / 1000
  const hours = skipped.tick - before
  console.log(`skip ran ${hours} game hours in ${elapsed.toFixed(1)}s (${Math.round(hours / elapsed)} ticks/s):`, skipped.hint)
  if (hours <= 0) throw new Error('The skip did not advance the clock')
  if (!skipped.hint) throw new Error('The skip did not say why it stopped')

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

  // --- Accounts ---------------------------------------------------------
  // The panel that answers "which of these is losing the money?". Two things only a browser can
  // check: that a ranked list actually appears with both valuations on it, and that clicking a
  // row takes you to the asset — the shortest path from a number to the thing it describes.
  const accounts = await page.evaluate(() => {
    const g = window.game
    g.hud.accountsPanel.setOpen(true)
    const panel = document.getElementById('accounts-panel')
    const rows = [...panel.querySelectorAll('.acct-row')]
    return {
      visible: panel.classList.contains('visible'),
      rows: rows.length,
      tabs: [...panel.querySelectorAll('.acct-tabs button')].map((n) => n.textContent),
      first: rows[0]?.querySelector('.acct-name')?.textContent,
      firstValue: rows[0]?.querySelector('.acct-value')?.textContent,
      total: panel.querySelector('.acct-summary b')?.textContent,
      // The firm's own P&L above the assets, which is the only place it appears at all.
      firm: panel.querySelector('.acct-detail .why-step.total .delta')?.textContent,
      // Worst first: the top row must not be better than the bottom one.
      sorted: rows.length > 1 ? rows[0].classList.contains('acct-bad') : true,
    }
  })
  console.log('accounts:', accounts)
  if (!accounts.visible) throw new Error('The accounts panel did not open')
  if (accounts.rows === 0) throw new Error('The accounts panel ranked nothing')
  if (!accounts.total) throw new Error('The accounts panel showed no total')

  if (!accounts.firm) throw new Error('The accounts panel did not show the utility\'s own profit and loss')

  await page.screenshot({ path: join(OUT, '17-accounts.png') })

  // Switch to the market basis: the same assets, valued at the price of the hour rather than at
  // the tariff. The numbers must move, or the second column is decoration.
  const marketView = await page.evaluate(() => {
    const panel = document.getElementById('accounts-panel')
    const bases = panel.querySelectorAll('.acct-bases button')
    bases[1].click()
    const rows = [...panel.querySelectorAll('.acct-row')]
    return {
      first: rows[0]?.querySelector('.acct-name')?.textContent,
      firstValue: rows[0]?.querySelector('.acct-value')?.textContent,
      total: panel.querySelector('.acct-summary b')?.textContent,
    }
  })
  console.log('accounts at market prices:', marketView)
  if (marketView.total === accounts.total) {
    throw new Error('The market basis showed the same total as the tariff basis')
  }
  await page.screenshot({ path: join(OUT, '18-accounts-market.png') })

  // A row is a place on the map.
  const followed = await page.evaluate(() => {
    const panel = document.getElementById('accounts-panel')
    panel.querySelector('.acct-row').click()
    const inspector = document.getElementById('inspector')
    return {
      inspectorOpen: inspector.classList.contains('visible'),
      panelClosed: !panel.classList.contains('visible'),
      title: inspector.querySelector('h2')?.textContent,
    }
  })
  console.log('followed a row:', followed)
  if (!followed.inspectorOpen) throw new Error('Clicking an account did not open the inspector')
  if (!followed.panelClosed) throw new Error('The accounts panel stayed open over the inspector')
  await page.screenshot({ path: join(OUT, '19-account-followed.png') })

  // --- What you can do to a corridor ------------------------------------
  // Three different decisions on the same asset, and until this milestone there was one. A line
  // with work already pending shows its countdown instead, which is why this picks a clean one.
  const lineActions = await page.evaluate(() => {
    const g = window.game
    const edge = g.world.network
      .allEdges()
      .find((e) => e.commodity === 'electric' && e.kv !== 0 && e.energised && e.upgradeAtTick === undefined)
    if (!edge) return null
    g.hud.selectEdge(edge.id)
    const panel = document.getElementById('inspector')
    return {
      kv: edge.kv,
      condition: edge.conditionPct,
      rows: [...panel.querySelectorAll('.kv')].map((r) => r.textContent),
      actions: [...panel.querySelectorAll('.asset-actions button')].map((b) => ({
        label: b.textContent,
        disabled: b.classList.contains('disabled'),
        title: b.title,
      })),
    }
  })
  console.log('line actions:', lineActions)
  if (!lineActions) throw new Error('No clean corridor to inspect')
  if (lineActions.actions.length < 3) throw new Error('The line inspector offers fewer than three decisions')
  if (!lineActions.rows.some((r) => r.includes('Condition'))) throw new Error('The line inspector shows no condition')
  // A refused option is shown with its reason rather than hidden — "too new to be worth
  // re-conductoring" is more useful than an option that simply is not there.
  if (lineActions.actions.some((a) => !a.title)) throw new Error('A line action carried no explanation')

  await page.screenshot({ path: join(OUT, '23-line-actions.png') })

  // --- News -------------------------------------------------------------
  // The thing that replaced "Something is happening". Two properties only a browser can check:
  // that headlines are real sentences with the parameters filled in, and that the forecast tab
  // shows dates and probabilities as different things.
  const news = await page.evaluate(() => {
    const g = window.game
    g.hud.newsPanel.setOpen(true)
    const panel = document.getElementById('news-panel')
    const rows = [...panel.querySelectorAll('.news-row')]
    return {
      visible: panel.classList.contains('visible'),
      rows: rows.length,
      headlines: rows.slice(0, 4).map((r) => r.querySelector('.news-title')?.textContent),
      // A headline still carrying a raw key is a translation bug that ships silently.
      rawKeys: rows.filter((r) => /^[a-z]+\.[A-Za-z.]+$/.test(r.querySelector('.news-title')?.textContent ?? ''))
        .length,
    }
  })
  console.log('news:', news)
  if (!news.visible) throw new Error('The news panel did not open')
  if (news.rows === 0) throw new Error('The news panel filed nothing at all')
  if (news.rawKeys > 0) throw new Error('A headline was shown as an untranslated key')

  await page.screenshot({ path: join(OUT, '20-news.png') })

  const coming = await page.evaluate(() => {
    const panel = document.getElementById('news-panel')
    panel.querySelectorAll('.acct-tabs button')[1].click()
    const rows = [...panel.querySelectorAll('.news-row')]
    return {
      rows: rows.length,
      dated: rows.filter((r) => r.querySelector('.news-when')).length,
      risks: rows.filter((r) => r.querySelector('.news-chance')).length,
      first: rows[0]?.textContent?.trim().slice(0, 80),
    }
  })
  console.log('coming up:', coming)
  if (coming.rows === 0) throw new Error('The forecast tab showed nothing at all')
  if (coming.dated === 0) throw new Error('The forecast showed no dated item')

  await page.screenshot({ path: join(OUT, '21-news-coming.png') })

  // A card over the map, raised from the simulation rather than by the panel.
  const toast = await page.evaluate(() => {
    const g = window.game
    g.hud.newsPanel.setOpen(false)
    g.world.reportNews({
      category: 'grid',
      importance: 2,
      titleKey: 'news.lineEnergised',
      params: { from: 'Central', to: 'Eastfield', kv: 220 },
    })
    g.hud.newsPanel.collect(g.world.news.drain())
    const cards = [...document.querySelectorAll('.news-toast')]
    return { count: cards.length, text: cards[0]?.querySelector('.news-toast-title')?.textContent }
  })
  console.log('card:', toast)
  if (toast.count === 0) throw new Error('An important item raised no card')

  await page.screenshot({ path: join(OUT, '22-news-card.png') })

  // --- History ----------------------------------------------------------
  // Four charts of the whole run. The unit tests prove the numbers; what only a browser can
  // show is that the canvases were actually drawn on and that each caption says something —
  // a chart panel whose captions are blank is how an empty yearbook used to look, and it
  // looked exactly like a working one.
  const history = await page.evaluate(() => {
    const g = window.game
    // Run to the first year end. The panel has nothing to say before one closes, which is
    // correct behaviour and useless as a test.
    const guard = Date.now() + 60_000
    while (g.world.yearbook.length === 0 && Date.now() < guard) g.world.step()
    g.hud.historyPanel.setOpen(true)
    const panel = document.getElementById('history-panel')
    const canvases = [...panel.querySelectorAll('canvas')]
    // Counting non-transparent pixels would only prove the background was filled, which it is
    // even on an empty chart. Each chart is asked for its own series colour instead.
    const series = [
      [0xc8, 0x6a, 0x3a], // emissions
      [0x6b, 0x3a, 0x24], // lignite — the mix band this fleet certainly has
      [0xe2, 0x48, 0x3d], // unserved
      [0x5f, 0xc2, 0x7e], // cash
    ]
    const painted = canvases.map((c, i) => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const [r, g, b] = series[i]
      let ink = 0
      for (let j = 0; j < data.length; j += 4) {
        if (data[j] === r && data[j + 1] === g && data[j + 2] === b) ink++
      }
      return ink
    })
    return {
      years: g.world.yearbook.length,
      visible: panel.classList.contains('visible'),
      canvases: canvases.length,
      painted,
      captions: [...panel.querySelectorAll('.hist-caption')].map((d) => d.textContent),
    }
  })
  console.log('history:', history)
  if (history.years === 0) throw new Error('No year closed within the time allowed')
  if (!history.visible) throw new Error('The history panel did not open')
  if (history.canvases !== 4) throw new Error(`Expected four charts, found ${history.canvases}`)
  if (history.painted.some((n) => n < 20)) throw new Error(`A history chart drew no series: ${history.painted}`)
  if (history.captions.some((c) => !c)) throw new Error('A history chart carried no caption')

  await page.screenshot({ path: join(OUT, '24-history.png') })
  await page.evaluate(() => window.game.hud.historyPanel.setOpen(false))

  // --- The opening brief ------------------------------------------------
  // The first thing a new player sees. Checked in a browser because two of its properties are
  // only true on screen: that it holds the clock while it is up, and that every line has its
  // numbers substituted rather than showing a raw placeholder at somebody's first impression.
  const brief = await page.evaluate(() => {
    const g = window.game
    g.hud.briefingPanel.open()
    const panel = document.getElementById('briefing')
    const lines = [...panel.querySelectorAll('.brief-line')].map((d) => d.textContent)
    return {
      visible: panel.classList.contains('visible'),
      lines,
      unfilled: lines.filter((l) => /[{}]/.test(l)).length,
      empty: lines.filter((l) => !l.trim()).length,
      hasBegin: !!document.getElementById('brief-begin'),
      reopenable: !!document.getElementById('brief-reopen'),
    }
  })
  console.log('brief:', brief)
  if (!brief.visible) throw new Error('The opening brief did not open')
  if (brief.lines.length < 4) throw new Error(`The brief said almost nothing: ${brief.lines.length} lines`)
  if (brief.unfilled > 0) throw new Error(`A brief line still has a placeholder in it: ${brief.lines}`)
  if (brief.empty > 0) throw new Error('A brief line rendered empty')
  if (!brief.hasBegin || !brief.reopenable) throw new Error('The brief cannot be dismissed or reopened')

  await page.screenshot({ path: join(OUT, '27-brief.png') })

  // Closing it hands the clock back.
  const afterBrief = await page.evaluate(async () => {
    const g = window.game
    document.getElementById('brief-begin').click()
    const before = g.world.tick
    await new Promise((r) => setTimeout(r, 700))
    return {
      hidden: !document.getElementById('briefing').classList.contains('visible'),
      advanced: g.world.tick > before,
    }
  })
  console.log('after brief:', afterBrief)
  if (!afterBrief.hidden) throw new Error('The brief did not close')
  if (!afterBrief.advanced) throw new Error('Closing the brief did not start the clock')

  // And the standing line names the thing this scenario is about, with a place to click.
  const concern = await page.evaluate(() => {
    const line = document.getElementById('concern')
    return {
      visible: line.classList.contains('visible'),
      text: line.textContent,
      clickable: line.classList.contains('clickable'),
    }
  })
  console.log('concern:', concern)
  if (!concern.visible) throw new Error('Nothing was raised as needing attention')
  if (/[{}]/.test(concern.text)) throw new Error(`The concern line has a placeholder in it: ${concern.text}`)

  // --- The tab row ------------------------------------------------------
  // Six toggles and the save controls in one flex row. Worth a browser check because the thing
  // that broke it was a *measured* property: the toggles were positioned individually at
  // hand-written offsets, and an unread badge on one of them pushed it over its neighbour. The
  // test is therefore geometric — no two toggles may overlap, and the gaps must be equal.
  const tabs = await page.evaluate(() => {
    const row = document.getElementById('panel-tabs')
    const buttons = [...row.querySelectorAll(':scope > button')]
    const boxes = buttons.map((b) => b.getBoundingClientRect())
    const gaps = []
    for (let i = 1; i < boxes.length; i++) gaps.push(Math.round(boxes[i].left - boxes[i - 1].right))
    return {
      count: buttons.length,
      labels: buttons.map((b) => b.textContent.trim()),
      gaps,
      tops: [...new Set(boxes.map((b) => Math.round(b.top)))],
      saveVisible: !!document.getElementById('save-button')?.getBoundingClientRect().width,
      loadVisible: !!document.getElementById('load-button')?.getBoundingClientRect().width,
    }
  })
  console.log('tabs:', tabs)
  if (tabs.count !== 6) throw new Error(`Expected six panel toggles, found ${tabs.count}`)
  if (tabs.tops.length !== 1) throw new Error(`The toggles are not on one line: tops ${tabs.tops}`)
  if (new Set(tabs.gaps).size !== 1) throw new Error(`Uneven gaps between toggles: ${tabs.gaps}`)
  if (tabs.gaps.some((g) => g < 1)) throw new Error(`Toggles are touching or overlapping: ${tabs.gaps}`)
  if (!tabs.saveVisible || !tabs.loadVisible) throw new Error('Save and load are not on the tab row')

  // And the same must hold once News is carrying an unread badge, which is what broke it.
  const tabsWithBadge = await page.evaluate(() => {
    const g = window.game
    for (let i = 0; i < 3; i++) {
      g.world.reportNews({ category: 'grid', importance: 2, titleKey: 'news.lineEnergised', params: { from: 'A', to: 'B', kv: 220 } })
    }
    g.hud.newsPanel.collect(g.world.news.drain())
    const row = document.getElementById('panel-tabs')
    const boxes = [...row.querySelectorAll(':scope > button')].map((b) => b.getBoundingClientRect())
    const gaps = []
    for (let i = 1; i < boxes.length; i++) gaps.push(Math.round(boxes[i].left - boxes[i - 1].right))
    return { gaps, badge: document.querySelector('.news-badge')?.textContent }
  })
  console.log('tabs with badge:', tabsWithBadge)
  if (new Set(tabsWithBadge.gaps).size !== 1) {
    throw new Error(`The unread badge broke the row: ${tabsWithBadge.gaps}`)
  }

  await page.screenshot({ path: join(OUT, '25-tabs.png') })

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

  // --- A run that ended, and did not say so ------------------------------
  // The worst bug this game has had. When a run ends the clock stops, and dismissing the
  // verdict panel used to be a one-way door: no panel, no hours passing, speed buttons that
  // did nothing, and nothing anywhere saying why. Saving and reloading produced the same state
  // from a clean start, because the decision to carry on was not in the save file.
  const frozen = await page.evaluate(async () => {
    const g = window.game
    g.world.outcome = 'lost'
    g.world.freePlay = false
    g.hud.update()
    // Dismiss the verdict the way a player would — the Close button specifically, not every
    // button that is not "keep playing": the panel also offers Load, and clicking that restored
    // a save whose run had not ended, which made this check pass for the wrong reason.
    document.getElementById('dismiss-verdict').click()
    const before = g.world.tick
    g.hud.setSpeed(3)
    document.querySelectorAll('.speed-controls button')[2].click()
    await new Promise((r) => setTimeout(r, 600))
    return {
      stalled: g.world.tick === before,
      verdictBack: document.getElementById('game-over').classList.contains('visible'),
      inert: document.querySelectorAll('.speed-controls button.inert').length,
      canCarryOn: !!document.getElementById('keep-playing'),
    }
  })
  console.log('ended run:', frozen)
  if (!frozen.stalled) throw new Error('A finished run kept running')
  if (!frozen.verdictBack) throw new Error('A dead speed click left the player with no explanation')
  if (frozen.inert === 0) throw new Error('The speed controls do not show that the clock has stopped')
  if (!frozen.canCarryOn) throw new Error('There is no way back into the run')

  await page.screenshot({ path: join(OUT, '26-ended.png') })

  // Carrying on must survive a save and a reload, which is what it did not do.
  const carried = await page.evaluate(() => {
    const g = window.game
    document.getElementById('keep-playing').click()
    g.save()
    g.load()
    return { freePlay: g.world.freePlay, outcome: g.world.outcome }
  })
  console.log('carried on:', carried)
  if (!carried.freePlay) throw new Error('Carrying on did not survive the save')

  await page.evaluate(() => {
    const g = window.game
    g.world.outcome = 'playing'
    g.world.freePlay = false
  })

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

  // --- The post-mortem --------------------------------------------------
  // The panel has to name the cause the simulation actually recorded, not a plausible one. This
  // run is short, so it may genuinely have gone short in no hour at all — in which case the panel
  // says so, and saying so is the correct behaviour rather than a skipped check.
  const postMortem = await page.evaluate(() => {
    const g = window.game
    const ranked = g.world.shortfalls.ranked('electric')
    const panel = document.getElementById('game-over')
    return {
      recorded: ranked.map((r) => `${r.cause}:${Math.round(r.tally.mwh)}`),
      dominant: ranked[0]?.cause ?? null,
      chips: [...panel.querySelectorAll('.pm-chip')].map((c) => c.textContent),
      links: [...panel.querySelectorAll('.pm-link')].map((c) => c.textContent),
      none: panel.textContent.includes('never went unserved'),
      // The one thing a report must never do: overflow its own panel and hide the buttons under
      // it. The end screen is fixed width and the post-mortem is the longest thing in it.
      overflows: panel.scrollWidth > panel.clientWidth + 1,
      // Scrolled into view first, and an element that still cannot be hit-tested counts as
      // unreachable rather than as fine. The first version treated a null from elementFromPoint
      // as a pass, which is exactly backwards: null means the point is off-screen, and it duly
      // reported "reachable" for a Close button that had fallen off the bottom of the display.
      buttonsReachable: [...panel.querySelectorAll('button')].every((b) => {
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        if (r.bottom <= 0 || r.top >= window.innerHeight) return false
        const over = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return over !== null && (over === b || b.contains(over))
      }),
    }
  })
  console.log('post-mortem:', postMortem)
  if (postMortem.overflows) throw new Error('The post-mortem overflows the end screen')
  if (!postMortem.buttonsReachable) throw new Error('The post-mortem covers the end screen buttons')
  if (postMortem.dominant) {
    if (!postMortem.chips.length) throw new Error('Shortfalls were recorded and the panel showed none')
    if (!postMortem.links.length) throw new Error('The post-mortem named nothing to go and look at')
  } else if (!postMortem.none) {
    throw new Error('Nothing went short and the panel did not say so')
  }
  await page.screenshot({ path: join(OUT, '15b-post-mortem.png') })

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
