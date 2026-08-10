import { MAX_CATCHUP_STEPS, Sim, STEP_SECONDS } from '../core/sim'
import type { Scene } from '../render/scene'
import type { Stage } from '../render/stage'
import type { WebViewPlatform } from '../platform/webview'
import { instrumentDrawCalls } from './drawcalls'
import { estimateRefreshHz, FrameMetrics } from './metrics'
import { PerfOverlay, type StressControls } from './overlay'

/**
 * M0 measurement mode, reachable at `?perf`.
 *
 * It drives the real render path — real entities, the real atlas — rather than
 * a synthetic sprite benchmark. Bunnymark numbers do not transfer to a game
 * with a different draw order, texture mix, and per-frame logic; these do,
 * because this is the same code the game runs.
 */

const INITIAL: StressControls = { enemies: 40, towers: 18, particlesPerKill: 8 }

/** Scripting surface for automated sweeps. Exposed on `window.__harness`. */
export interface Harness {
  setControls(next: Partial<StressControls>): void
  resetMetrics(): void
  read(): {
    controls: StressControls
    counts: ReturnType<Sim['counts']>
    refreshHz: number
    frameP95: number
    workP95: number
    workP99: number
    drawCalls: number
    heapMb: number | null
    samples: number
  }
}

export interface HarnessDeps {
  stage: Stage
  scene: Scene
  root: HTMLElement
  platform: WebViewPlatform
}

export function bootPerfHarness({ stage, scene, root, platform }: HarnessDeps): void {
  let sim = buildSim(INITIAL)
  const controls = { ...INITIAL }

  const applyControls = (next: StressControls): void => {
    Object.assign(controls, next)
    // Tower count is structural, so a change rebuilds the world; the other two
    // are live knobs the simulation can absorb without a reset.
    if (next.towers !== sim.towers.length) {
      sim = buildSim(next)
      scene.reset()
    } else {
      sim.stressEnemyCount = next.enemies
      sim.particlesPerKill = next.particlesPerKill
    }
  }

  const overlay = new PerfOverlay(root, INITIAL, applyControls)
  const drawCalls = instrumentDrawCalls(stage.gl)
  const frameMetrics = new FrameMetrics()
  const workMetrics = new FrameMetrics()
  const intervals: number[] = []
  let refreshHz = 60

  const harness: Harness = {
    setControls(next) {
      const merged = { ...controls, ...next }
      applyControls(merged)
      overlay.syncControls(merged)
    },
    resetMetrics() {
      frameMetrics.reset()
      workMetrics.reset()
    },
    read: () => ({
      controls: { ...controls },
      counts: sim.counts(),
      refreshHz,
      frameP95: frameMetrics.percentile(0.95),
      workP95: workMetrics.percentile(0.95),
      workP99: workMetrics.percentile(0.99),
      drawCalls: drawCalls.lastFrame,
      heapMb: readHeapMb(),
      samples: workMetrics.count,
    }),
  }
  ;(window as unknown as { __harness?: Harness }).__harness = harness

  let previous = performance.now()
  let accumulator = 0
  let sinceOverlayUpdate = 0

  const frame = (now: number): void => {
    requestAnimationFrame(frame)
    const deltaMs = now - previous
    previous = now
    if (platform.isPaused) return

    frameMetrics.push(deltaMs)
    if (intervals.length < 120) {
      intervals.push(deltaMs)
      if (intervals.length === 120) refreshHz = estimateRefreshHz(intervals)
    }

    const workStart = performance.now()

    accumulator += deltaMs / 1000
    let steps = 0
    while (accumulator >= STEP_SECONDS && steps < MAX_CATCHUP_STEPS) {
      sim.step()
      accumulator -= STEP_SECONDS
      steps++
    }
    if (accumulator > STEP_SECONDS * MAX_CATCHUP_STEPS) accumulator = 0

    scene.sync(sim)
    stage.app.renderer.render(stage.app.stage)
    drawCalls.nextFrame()

    // CPU-side only. GPU work is issued here but completes asynchronously, so a
    // fill-rate bound shows up as a rising frame delta with flat work time —
    // which is why both numbers are reported side by side.
    workMetrics.push(performance.now() - workStart)

    sinceOverlayUpdate += deltaMs
    if (sinceOverlayUpdate >= 250) {
      sinceOverlayUpdate = 0
      overlay.update({
        layout: stage.layout,
        counts: sim.counts(),
        refreshHz,
        frameMs: { p95: frameMetrics.percentile(0.95), mean: frameMetrics.mean() },
        workMs: { p95: workMetrics.percentile(0.95), p99: workMetrics.percentile(0.99) },
        histogram: frameMetrics.histogram(),
        drawCalls: drawCalls.lastFrame,
        heapMb: readHeapMb(),
        paused: platform.isPaused,
      })
    }
  }
  requestAnimationFrame(frame)
}

function buildSim(controls: StressControls): Sim {
  const sim = new Sim({
    seed: 20260810,
    mode: 'sandbox',
    stressEnemyCount: controls.enemies,
    particlesPerKill: controls.particlesPerKill,
  })
  sim.fillWithTowers(controls.towers)
  return sim
}

/** Chromium-only; absent in WKWebView, so the HUD shows n/a there. */
function readHeapMb(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } })
    .memory
  return memory ? memory.usedJSHeapSize / 1024 / 1024 : null
}
