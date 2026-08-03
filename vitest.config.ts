import { defineConfig } from 'vitest/config'
import { aliases } from './vite.config'

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
