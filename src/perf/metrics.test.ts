import { describe, expect, it } from 'vitest'
import {
  budgetMsForRefreshRate,
  estimateRefreshHz,
  FrameMetrics,
  HISTOGRAM_EDGES,
} from './metrics'

describe('FrameMetrics', () => {
  it('reports zero before any samples', () => {
    const metrics = new FrameMetrics()
    expect(metrics.percentile(0.95)).toBe(0)
    expect(metrics.mean()).toBe(0)
    expect(metrics.count).toBe(0)
  })

  it('exposes the tail that an average would hide', () => {
    // 97 healthy frames and 3 GC pauses — the shape of real WebView stutter.
    const metrics = new FrameMetrics(100)
    for (let i = 0; i < 97; i++) metrics.push(14)
    for (let i = 0; i < 3; i++) metrics.push(120)

    // The average reads as a comfortable ~58fps and hides the hitching...
    expect(metrics.mean()).toBeLessThan(18)
    // ...while p99 shows the 120ms stalls a player actually feels.
    expect(metrics.percentile(0.99)).toBe(120)
  })

  it('computes percentiles over a known distribution', () => {
    const metrics = new FrameMetrics(100)
    for (let i = 1; i <= 100; i++) metrics.push(i)

    expect(metrics.percentile(0.5)).toBe(50)
    expect(metrics.percentile(0.95)).toBe(95)
    expect(metrics.percentile(1)).toBe(100)
    expect(metrics.percentile(0)).toBe(1)
  })

  it('evicts the oldest samples once the ring buffer is full', () => {
    const metrics = new FrameMetrics(10)
    for (let i = 0; i < 10; i++) metrics.push(100)
    for (let i = 0; i < 10; i++) metrics.push(5)

    expect(metrics.count).toBe(10)
    expect(metrics.percentile(1)).toBe(5)
  })

  it('buckets frame times, with an open-ended overflow bucket', () => {
    const metrics = new FrameMetrics(10)
    metrics.push(5) // < 8
    metrics.push(15) // < 16.7
    metrics.push(999) // overflow

    const buckets = metrics.histogram()
    expect(buckets).toHaveLength(HISTOGRAM_EDGES.length + 1)
    expect(buckets[0]).toBe(1)
    expect(buckets[2]).toBe(1)
    expect(buckets[HISTOGRAM_EDGES.length]).toBe(1)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('clears its samples on reset', () => {
    const metrics = new FrameMetrics(10)
    metrics.push(16)
    metrics.reset()
    expect(metrics.count).toBe(0)
    expect(metrics.percentile(0.95)).toBe(0)
  })
})

describe('budgetMsForRefreshRate', () => {
  it('tightens the budget on high refresh panels', () => {
    expect(budgetMsForRefreshRate(60)).toBeCloseTo(16.67, 1)
    expect(budgetMsForRefreshRate(120)).toBeCloseTo(8.33, 1)
  })

  it('falls back to 60Hz for nonsense input', () => {
    expect(budgetMsForRefreshRate(0)).toBeCloseTo(16.67, 1)
    expect(budgetMsForRefreshRate(Number.NaN)).toBeCloseTo(16.67, 1)
  })
})

describe('estimateRefreshHz', () => {
  it('recognises the rates real panels run at', () => {
    expect(estimateRefreshHz(Array(20).fill(16.7))).toBe(60)
    expect(estimateRefreshHz(Array(20).fill(11.1))).toBe(90)
    expect(estimateRefreshHz(Array(20).fill(8.3))).toBe(120)
  })

  it('ignores stalls from background tabs and long pauses', () => {
    const intervals = [...Array(20).fill(8.3), 4000, 5000]
    expect(estimateRefreshHz(intervals)).toBe(120)
  })

  it('defaults to 60Hz with no usable samples', () => {
    expect(estimateRefreshHz([])).toBe(60)
    expect(estimateRefreshHz([5000])).toBe(60)
  })
})
