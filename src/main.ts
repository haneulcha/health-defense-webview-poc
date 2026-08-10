import { Game } from './game'
import { Scene } from './render/scene'
import { createStage } from './render/stage'
import { bootPerfHarness } from './perf/harness'
import { WebViewPlatform } from './platform/webview'

/**
 * Boots either the game or the M0 perf harness (`?perf`).
 *
 * The harness stays in the shipped bundle deliberately. It measures the real
 * render path, so keeping it one query parameter away means the perf numbers
 * can be re-taken on any device the game itself runs on — including inside the
 * React Native WebView, where no desktop profiler reaches.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app missing from the document')

  const playfield = document.createElement('div')
  playfield.className = 'playfield'
  root.appendChild(playfield)

  const stage = await createStage(playfield)
  const scene = new Scene(stage.app)

  const banner = document.createElement('div')
  banner.className = 'banner'
  banner.hidden = true
  banner.addEventListener('pointerdown', () => location.reload())
  root.appendChild(banner)

  const platform = new WebViewPlatform(stage.canvas, {
    onPause: () => showBanner(banner, '일시정지'),
    onResume: () => (banner.hidden = true),
    onContextLost: () =>
      showBanner(banner, 'GPU 컨텍스트가 해제됐습니다 — 탭하여 다시 시작'),
  })
  platform.postToHost({ type: 'ready' })

  window.addEventListener('resize', () => stage.applyLayout())
  window.addEventListener('orientationchange', () => stage.applyLayout())

  if (new URLSearchParams(location.search).has('perf')) {
    bootPerfHarness({ stage, scene, root, platform })
    return
  }

  const game = new Game(stage, scene, root)
  let previous = performance.now()
  const frame = (now: number): void => {
    requestAnimationFrame(frame)
    const deltaMs = now - previous
    previous = now
    if (platform.isPaused) return

    game.advance(deltaMs)
    stage.app.renderer.render(stage.app.stage)
  }
  requestAnimationFrame(frame)
}

function showBanner(banner: HTMLElement, text: string): void {
  banner.textContent = text
  banner.hidden = false
}

void boot()
