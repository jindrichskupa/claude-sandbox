import { defineConfig } from 'vite'
import { aliases } from './vite.config'

/**
 * A build that produces exactly one JavaScript file.
 *
 * The normal build lets Pixi code-split its three renderer backends, which is right for a
 * web server and wrong for anything that has to travel as a single file. Disabling dynamic
 * import splitting costs a little download size and buys a bundle that can be inlined whole
 * into one HTML document — no second request, nothing to lose on the way.
 */
export default defineConfig({
  base: './',
  resolve: { alias: aliases },
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: 1024 * 1024,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: 'game[extname]',
      },
    },
  },
})
