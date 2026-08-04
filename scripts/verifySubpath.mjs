/**
 * Serve the built site under a sub-path and check it still works.
 *
 * A project GitHub Pages site is published at `https://<user>.github.io/<repo>/`, not at the
 * root of a domain. A build whose asset URLs start with `/` loads perfectly from `npm run
 * preview` and shows a blank page once deployed, because `/assets/index.js` is not where the
 * file is. It is the single most common way a Pages deploy succeeds and the site does not
 * work, and "the workflow was green" is no evidence against it.
 *
 * So this serves `dist/` under exactly the prefix Pages will use and loads it in a real
 * browser, failing on any request that 404s.
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const PREFIX = process.argv[2] ?? '/claude-sandbox/'
const PORT = 4174

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

if (!existsSync(DIST)) {
  console.error('No dist/. Run `npm run build` first.')
  process.exit(1)
}

const missing = []

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  if (!url.startsWith(PREFIX)) {
    // Anything asked for outside the prefix is precisely the failure this script exists to
    // catch: an absolute asset path that would 404 on the real site.
    missing.push(url)
    res.writeHead(404)
    res.end('outside the published prefix')
    return
  }
  const rel = url.slice(PREFIX.length) || 'index.html'
  try {
    const body = await readFile(join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, '')))
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    missing.push(url)
    res.writeHead(404)
    res.end('not found')
  }
})

await new Promise((resolve) => server.listen(PORT, resolve))

const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launchOptions = { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
if (existsSync(PINNED_CHROME)) launchOptions.executablePath = PINNED_CHROME

const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`))

let exitCode = 0
try {
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.game?.world?.tick > 0, { timeout: 20_000 })
  await page.waitForTimeout(2000)

  const state = await page.evaluate(() => ({
    tick: window.game.world.tick,
    generation: Math.round(window.game.world.lastDispatch?.totalGenerationMw ?? 0),
    heatSupplied: Math.round(window.game.world.lastHeat?.totalHeatSuppliedMw ?? 0),
    plants: window.game.world.plants.length,
  }))
  console.log(`served under ${PREFIX} —`, state)

  if (state.tick < 2) throw new Error('The simulation did not advance')
  if (state.generation <= 0) throw new Error('Nothing is generating')
  if (missing.length > 0) throw new Error(`Requests that would 404 on Pages: ${missing.join(', ')}`)
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(' | ')}`)

  console.log('No 404s and no console errors under the published sub-path.')
} catch (e) {
  console.error('Sub-path check failed:', e.message ?? e)
  exitCode = 1
} finally {
  await browser.close()
  server.close()
}

process.exit(exitCode)
