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
