import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The RN WebView loads the game as a single bundled asset, so the production
// build must inline everything into one HTML file. See docs/plan M0 (번들 로딩).
export default defineConfig({
  plugins: [viteSingleFile()],
  server: {
    // Needed so a phone on the same network can open the dev server.
    host: true,
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
  },
})
