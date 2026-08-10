/**
 * Frame-time statistics for the M0 perf harness.
 *
 * We report percentiles, not averages. A frame log of 59 good frames and one
 * 200ms GC pause averages to a healthy-looking 19ms while feeling broken; p95
 * and p99 are what a player actually perceives as stutter.
 */

/** Samples kept for percentile reads — 10 seconds at 60Hz. */
const DEFAULT_CAPACITY = 600

/** Upper edges in ms. The last bucket is open-ended. */
export const HISTOGRAM_EDGES = [8, 12, 16.7, 25, 33.4, 50, 100] as const

export class FrameMetrics {
  private readonly samples: Float64Array
  private writeIndex = 0
  private filled = 0
  private readonly scratch: Float64Array

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    this.samples = new Float64Array(capacity)
    this.scratch = new Float64Array(capacity)
  }

  push(frameMs: number): void {
    this.samples[this.writeIndex] = frameMs
    this.writeIndex = (this.writeIndex + 1) % this.capacity
    if (this.filled < this.capacity) this.filled++
  }

  get count(): number {
    return this.filled
  }

  reset(): void {
    this.writeIndex = 0
    this.filled = 0
  }

  /** @param p fraction in [0, 1]. Returns 0 when no samples have been pushed. */
  percentile(p: number): number {
    if (this.filled === 0) return 0
    const view = this.scratch.subarray(0, this.filled)
    view.set(this.samples.subarray(0, this.filled))
    view.sort()
    const index = Math.min(
      this.filled - 1,
      Math.max(0, Math.ceil(p * this.filled) - 1),
    )
    return view[index] ?? 0
  }

  mean(): number {
    if (this.filled === 0) return 0
    let total = 0
    for (let i = 0; i < this.filled; i++) total += this.samples[i] ?? 0
    return total / this.filled
  }

  /** Bucket counts against HISTOGRAM_EDGES, plus one open-ended overflow bucket. */
  histogram(): number[] {
    const buckets = new Array<number>(HISTOGRAM_EDGES.length + 1).fill(0)
    for (let i = 0; i < this.filled; i++) {
      const value = this.samples[i] ?? 0
      let bucket: number = HISTOGRAM_EDGES.length
      for (let e = 0; e < HISTOGRAM_EDGES.length; e++) {
        if (value < (HISTOGRAM_EDGES[e] as number)) {
          bucket = e
          break
        }
      }
      buckets[bucket] = (buckets[bucket] ?? 0) + 1
    }
    return buckets
  }
}

/**
 * Frame budget derived from the panel's real refresh rate.
 *
 * A hardcoded 16.7ms target is wrong on the 90Hz and 120Hz panels that are now
 * common even on budget Android phones: rAF fires at panel rate, so the render
 * path runs twice as often as a 60Hz assumption implies and a "passing" 16.7ms
 * p95 can still be a dropped frame every single vsync.
 */
export function budgetMsForRefreshRate(refreshHz: number): number {
  if (!Number.isFinite(refreshHz) || refreshHz <= 0) return 1000 / 60
  return 1000 / refreshHz
}

/**
 * Estimates panel refresh rate from observed frame intervals.
 * Uses the median so a few long frames don't drag the estimate down.
 */
export function estimateRefreshHz(intervalsMs: readonly number[]): number {
  const usable = intervalsMs.filter((ms) => ms > 0.5 && ms < 100)
  if (usable.length === 0) return 60
  const sorted = [...usable].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] as number
  // Snap to the rates real panels actually run at.
  const candidates = [60, 90, 120, 144]
  let best = candidates[0] as number
  for (const hz of candidates) {
    if (Math.abs(1000 / hz - median) < Math.abs(1000 / best - median)) best = hz
  }
  return best
}
