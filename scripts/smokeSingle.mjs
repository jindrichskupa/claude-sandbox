/**
 * Verify the single-file bundle really is self-contained.
 *
 * Loaded from file:// with every network request blocked, so anything the document still
 * expects to fetch fails the test rather than quietly working because a dev server happened
 * to be there.
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../dist-single/powergrid-tycoon.html', import.meta.url))
if (!existsSync(file)) {
  console.error('No bundle. Run `npm run bundle` first.')
  process.exit(1)
}

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const options = { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
if (existsSync(PINNED)) options.executablePath = PINNED

const browser = await chromium.launch(options)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
const blocked = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

// Nothing may leave the document.
await page.route('**', (route) => {
  const url = route.request().url()
  if (url.startsWith('file://')) return route.continue()
  blocked.push(url)
  return route.abort()
})

let code = 0
try {
  await page.goto(`file://${file}`)
  await page.waitForFunction(() => window.game?.world?.tick > 0, { timeout: 20_000 })
  await page.waitForTimeout(2500)

  const state = await page.evaluate(() => ({
    tick: window.game.world.tick,
    generation: Math.round(window.game.world.lastDispatch?.totalGenerationMw ?? 0),
    plants: window.game.world.plants.length,
  }))
  console.log('running from a single file:', state)
  if (state.tick < 2 || state.generation <= 0) throw new Error('The bundle did not start')

  await page.screenshot({ path: fileURLToPath(new URL('../screenshots/09-single-file.png', import.meta.url)) })

  if (blocked.length > 0) throw new Error(`Bundle is not self-contained: ${blocked.join(', ')}`)
  if (errors.length > 0) throw new Error(`Errors: ${errors.join(' | ')}`)
  console.log('No outbound requests, no errors.')
} catch (e) {
  console.error(String(e))
  code = 1
} finally {
  await browser.close()
}
process.exit(code)
