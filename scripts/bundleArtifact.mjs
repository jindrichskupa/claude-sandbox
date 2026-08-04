/**
 * Emit the game as an artifact-ready fragment.
 *
 * An artifact supplies its own document wrapper, so this strips the doctype, html, head and
 * body tags and hands over only what belongs inside them. Otherwise identical to the
 * standalone bundle: one document, no outbound requests, artwork generated at runtime.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../dist-single/powergrid-tycoon.html', import.meta.url))
const target = process.argv[2]
if (!existsSync(source)) {
  console.error('No bundle. Run `npm run bundle` first.')
  process.exit(1)
}
if (!target) {
  console.error('Usage: node scripts/bundleArtifact.mjs <output.html>')
  process.exit(1)
}

const html = await readFile(source, 'utf8')

const pick = (open, close) => {
  const start = html.indexOf(open)
  const end = html.indexOf(close)
  if (start === -1 || end === -1) throw new Error(`Could not find ${open}`)
  return html.slice(html.indexOf('>', start) + 1, end)
}

const head = pick('<head', '</head>')
const body = pick('<body', '</body>')

// Keep the title and the inlined stylesheet; drop the favicon link, which the artifact sets.
const keptHead = head
  .split('\n')
  .filter((line) => !line.includes('rel="icon"') && !line.includes('<meta charset') && !line.includes('viewport'))
  .join('\n')
  .trim()

const out = `${keptHead}\n${body.trim()}\n`
await writeFile(target, out, 'utf8')
console.log(`Wrote ${target} (${(Buffer.byteLength(out, 'utf8') / 1024 / 1024).toFixed(2)} MB)`)
