import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export const aliases = {
  '@sim': r('./src/sim'),
  '@content': r('./src/content'),
  '@render': r('./src/render'),
  '@ui': r('./src/ui'),
  '@i18n': r('./src/i18n'),
}

export default defineConfig({
  base: './',
  resolve: { alias: aliases },
})
