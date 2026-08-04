/**
 * Fail the build if anything in `dist/` would 404 on a project Pages site.
 *
 * A project site lives at `https://<user>.github.io/<repo>/`, so an asset URL beginning with
 * `/` points at the wrong place — `/assets/index.js` rather than `/<repo>/assets/index.js`.
 * The build still succeeds, the deploy still reports success, and the published page is blank.
 * That combination is worth guarding against precisely because every signal says it worked.
 *
 * The full version of this check is `scripts/verifySubpath.mjs`, which serves the build under
 * the real prefix and loads it in a browser. This one is the cheap half: it needs no browser,
 * so it can run on every deploy without adding a Chromium download to the workflow.
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname

if (!existsSync(DIST)) {
  console.error('No dist/. Run `npm run build` first.')
  process.exit(1)
}

/** Absolute references in an attribute: src="/x", href='/x'. Protocol-relative `//` is fine. */
const ABSOLUTE_REF = /\s(?:src|href)\s*=\s*["']\/(?!\/)[^"']*["']/g

const offenders = []
for (const name of await readdir(DIST)) {
  if (!name.endsWith('.html')) continue
  const html = await readFile(join(DIST, name), 'utf8')
  for (const match of html.matchAll(ABSOLUTE_REF)) offenders.push(`${name}: ${match[0].trim()}`)
}

if (offenders.length > 0) {
  console.error('These would 404 under a project Pages sub-path:')
  for (const o of offenders) console.error(`  ${o}`)
  console.error('\nSet `base: "./"` in vite.config.ts so asset URLs stay relative.')
  process.exit(1)
}

console.log('All asset references are relative; the build will work under a Pages sub-path.')
