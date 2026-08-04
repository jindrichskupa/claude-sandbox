/**
 * Fold the single-file build into one self-contained HTML document.
 *
 * Everything — script, stylesheet, favicon — ends up inline, so the result runs from a
 * `file://` URL, from a chat attachment, or from anywhere else that will not serve a second
 * request. The game generates all its own artwork at runtime, so there are no images to
 * worry about.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist-single')
const output = process.argv[2] ?? join(root, 'dist-single', 'powergrid-tycoon.html')

if (!existsSync(dist)) {
  console.error('No dist-single/. Run `npm run build:single` first.')
  process.exit(1)
}

const html = await readFile(join(dist, 'index.html'), 'utf8')
const js = await readFile(join(dist, 'game.js'), 'utf8')

let css = ''
try {
  css = await readFile(join(dist, 'game.css'), 'utf8')
} catch {
  // A build with no separate stylesheet is fine; Vite may have inlined it already.
}

/**
 * `$` is special in a replacement string, and a bundle is full of them. A function
 * replacement sidesteps that entirely — worth doing deliberately, because the failure would
 * be a silently corrupted bundle rather than an error.
 */
const replaceLiteral = (haystack, pattern, replacement) => haystack.replace(pattern, () => replacement)

let out = html

// Swap the stylesheet link for the stylesheet itself.
out = replaceLiteral(out, /<link[^>]+rel="stylesheet"[^>]*>/, css ? `<style>\n${css}\n</style>` : '')

// Swap the module script for the module itself.
out = replaceLiteral(out, /<script[^>]+src="[^"]*game\.js"[^>]*><\/script>/, `<script type="module">\n${js}\n</script>`)

if (out.includes('game.js') || out.includes('game.css')) {
  console.error('Inlining failed: the document still refers to an external asset.')
  process.exit(1)
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, out, 'utf8')

const bytes = Buffer.byteLength(out, 'utf8')
console.log(`Wrote ${output}`)
console.log(`Single file: ${(bytes / 1024 / 1024).toFixed(2)} MB`)
