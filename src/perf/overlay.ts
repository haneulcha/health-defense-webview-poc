import type { Layout } from '../render/layout'
import type { SimCounts } from '../core/sim'
import { budgetMsForRefreshRate, HISTOGRAM_EDGES } from './metrics'

/**
 * The M0 measurement HUD, built from DOM rather than Pixi text.
 *
 * DOM keeps text crisp at device resolution instead of rendering it into the
 * 168x312 buffer, costs no draw calls, and lives in the letterbox band below
 * the playfield — the same band the real game's tower buttons will occupy, so
 * this is a rehearsal of the final layout rather than throwaway scaffolding.
 */

export interface OverlayReadout {
  layout: Layout
  counts: SimCounts
  refreshHz: number
  /** Wall-clock between frames. Shows dropped frames, not headroom. */
  frameMs: { p95: number; mean: number }
  /**
   * Time actually spent in step + sync + render.
   *
   * Frame delta alone cannot tell "used 8ms of an 8.3ms budget" apart from
   * "did 1ms of work and waited 7ms for vsync" — both read as 8.3ms. Headroom
   * is the question this PoC exists to answer, so it needs its own number.
   */
  workMs: { p95: number; p99: number }
  histogram: readonly number[]
  drawCalls: number
  /** Heap size in MB, when the browser exposes it (Chromium only). */
  heapMb: number | null
  paused: boolean
}

export interface StressControls {
  enemies: number
  towers: number
  particlesPerKill: number
}

export class PerfOverlay {
  readonly element: HTMLElement
  private readonly stats = new Map<string, HTMLElement>()
  private readonly bars: HTMLElement[] = []
  private readonly verdict: HTMLElement
  private readonly sliders: Record<keyof StressControls, SliderHandle>
  private readonly state: StressControls

  constructor(
    parent: HTMLElement,
    initial: StressControls,
    private readonly onChange: (controls: StressControls) => void,
  ) {
    this.element = document.createElement('div')
    // Not confined to the letterbox band like the game HUD. The band is 96 CSS
    // px on a short phone and this panel needs ~180, so constraining it pushed
    // the sliders off-screen — on the one device the harness exists to measure.
    this.element.className = 'hud hud-perf'

    const statGrid = document.createElement('div')
    statGrid.className = 'hud-stats'
    for (const label of [
      'fps',
      'frame p95',
      'work p95',
      'work p99',
      'draws',
      'enemies',
      'shots',
      'particles',
      'scale',
      'heap',
    ]) {
      const cell = document.createElement('div')
      cell.className = 'hud-stat'
      const name = document.createElement('span')
      name.className = 'hud-stat-label'
      name.textContent = label
      const value = document.createElement('strong')
      value.textContent = '—'
      cell.append(name, value)
      statGrid.appendChild(cell)
      this.stats.set(label, value)
    }

    const histogram = document.createElement('div')
    histogram.className = 'hud-histogram'
    histogram.title = 'frame time distribution'
    for (let i = 0; i <= HISTOGRAM_EDGES.length; i++) {
      const bar = document.createElement('div')
      bar.className = 'hud-bar'
      // Bars past the 16.7ms edge are dropped frames on a 60Hz panel.
      if (i > 2) bar.classList.add('hud-bar-over')
      histogram.appendChild(bar)
      this.bars.push(bar)
    }

    this.verdict = document.createElement('div')
    this.verdict.className = 'hud-verdict'

    const controls = document.createElement('div')
    controls.className = 'hud-controls'
    const state = { ...initial }
    const emit = (): void => this.onChange({ ...state })
    this.sliders = {
      enemies: slider('enemies', 0, 200, state.enemies, (v) => {
        state.enemies = v
        emit()
      }),
      towers: slider('towers', 0, 60, state.towers, (v) => {
        state.towers = v
        emit()
      }),
      particlesPerKill: slider('fx/kill', 0, 40, state.particlesPerKill, (v) => {
        state.particlesPerKill = v
        emit()
      }),
    }
    this.state = state
    controls.append(
      this.sliders.enemies.element,
      this.sliders.towers.element,
      this.sliders.particlesPerKill.element,
    )

    this.element.append(statGrid, histogram, this.verdict, controls)
    parent.appendChild(this.element)
  }

  /**
   * Reflects controls changed from outside the HUD (the scripted sweep).
   * A measurement tool that displays stale values is worse than one with no
   * display at all — the numbers would be attributed to the wrong settings.
   */
  syncControls(next: StressControls): void {
    Object.assign(this.state, next)
    this.sliders.enemies.set(next.enemies)
    this.sliders.towers.set(next.towers)
    this.sliders.particlesPerKill.set(next.particlesPerKill)
  }

  update(readout: OverlayReadout): void {
    const budget = budgetMsForRefreshRate(readout.refreshHz)
    const fps = readout.frameMs.mean > 0 ? 1000 / readout.frameMs.mean : 0

    this.set('fps', readout.paused ? 'paused' : fps.toFixed(0))
    this.set('frame p95', `${readout.frameMs.p95.toFixed(1)}ms`)
    this.set('work p95', `${readout.workMs.p95.toFixed(2)}ms`)
    this.set('work p99', `${readout.workMs.p99.toFixed(2)}ms`)
    this.set('draws', String(readout.drawCalls))
    this.set('enemies', String(readout.counts.enemies))
    this.set('shots', String(readout.counts.projectiles))
    this.set('particles', String(readout.counts.particles))
    this.set(
      'scale',
      `${readout.layout.physicalScale.toFixed(2)}x${readout.layout.pixelPerfect ? '' : '~'}`,
    )
    this.set('heap', readout.heapMb === null ? 'n/a' : `${readout.heapMb.toFixed(0)}MB`)

    const total = readout.histogram.reduce((a, b) => a + b, 0) || 1
    for (let i = 0; i < this.bars.length; i++) {
      const share = (readout.histogram[i] ?? 0) / total
      const bar = this.bars[i]
      if (bar) bar.style.height = `${Math.max(2, share * 100)}%`
    }

    // Judged on work, not frame delta: a vsync-locked loop always reports a
    // frame delta equal to the budget, which would make every run look marginal.
    const used = (readout.workMs.p95 / budget) * 100
    const withinBudget = readout.workMs.p95 <= budget
    this.verdict.textContent = withinBudget
      ? `${used.toFixed(0)}% of budget used · ${readout.refreshHz}Hz → ${budget.toFixed(1)}ms`
      : `OVER budget by ${(readout.workMs.p95 - budget).toFixed(2)}ms · ${readout.refreshHz}Hz → ${budget.toFixed(1)}ms`
    this.verdict.classList.toggle('hud-verdict-bad', !withinBudget)
  }

  private set(key: string, value: string): void {
    const element = this.stats.get(key)
    if (element) element.textContent = value
  }
}

interface SliderHandle {
  element: HTMLElement
  set(value: number): void
}

function slider(
  label: string,
  min: number,
  max: number,
  value: number,
  onInput: (value: number) => void,
): SliderHandle {
  const wrapper = document.createElement('label')
  wrapper.className = 'hud-slider'

  const text = document.createElement('span')
  text.textContent = `${label} ${value}`

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.value = String(value)
  input.addEventListener('input', () => {
    const next = Number(input.value)
    text.textContent = `${label} ${next}`
    onInput(next)
  })

  wrapper.append(text, input)
  return {
    element: wrapper,
    // Assigning `value` does not fire `input`, so this cannot loop back.
    set(next: number) {
      input.value = String(next)
      text.textContent = `${label} ${next}`
    },
  }
}
