#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the web game and inlines it into the Expo shell as a string module.
 *
 * The WebView is handed the markup directly (`source={{ html }}`) rather than a
 * bundled asset file. Asset loading is where WebView ports usually lose days:
 * Android resolves against `file:///android_asset/...`, iOS against a different
 * bundle path, and both need file-access flags that differ again between dev
 * and release. Passing a string has none of that, and it is only possible
 * because the production build is one self-contained HTML file with no external
 * references — the reason `vite-plugin-singlefile` and code-generated textures
 * were chosen in the first place.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const buildOutput = join(repoRoot, 'dist', 'index.html')
const target = join(repoRoot, 'shell', 'game-html.ts')

console.log('building the web game…')
execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })

const html = readFileSync(buildOutput, 'utf8')
if (/(src|href)="(?!data:)/.test(html)) {
  // A single external reference would silently break the WebView, where there
  // is no server to resolve it against. Fail loudly at build time instead.
  throw new Error(
    'dist/index.html references an external file; the WebView cannot resolve one',
  )
}

writeFileSync(
  target,
  [
    '// GENERATED FILE — do not edit.',
    '// Regenerate with `npm run sync` in shell/, or `node scripts/sync-game-html.mjs`.',
    '',
    `export const GAME_HTML = ${JSON.stringify(html)}`,
    '',
  ].join('\n'),
)

const kb = Math.round(html.length / 1024)
console.log(`wrote shell/game-html.ts (${kb} KB of inlined markup)`)
