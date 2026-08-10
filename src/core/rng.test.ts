import { describe, expect, it } from 'vitest'
import { Rng } from './rng'

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = new Rng(12345)
    const b = new Rng(12345)
    const streamA = Array.from({ length: 50 }, () => a.next())
    const streamB = Array.from({ length: 50 }, () => b.next())
    expect(streamA).toEqual(streamB)
  })

  it('produces different streams for different seeds', () => {
    const a = new Rng(1)
    const b = new Rng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('stays within [0, 1)', () => {
    const rng = new Rng(7)
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('accepts negative and fractional seeds without breaking determinism', () => {
    expect(new Rng(-1).next()).toBe(new Rng(-1).next())
    expect(new Rng(1.5).next()).toBe(new Rng(1.5).next())
  })

  it('keeps int() inclusive on both ends and within range', () => {
    const rng = new Rng(99)
    const seen = new Set<number>()
    for (let i = 0; i < 5_000; i++) {
      const value = rng.int(3, 6)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(6)
      seen.add(value)
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6])
  })

  it('keeps range() within bounds', () => {
    const rng = new Rng(4)
    for (let i = 0; i < 1_000; i++) {
      const value = rng.range(-5, 5)
      expect(value).toBeGreaterThanOrEqual(-5)
      expect(value).toBeLessThan(5)
    }
  })

  it('throws rather than returning undefined when picking from nothing', () => {
    expect(() => new Rng(1).pick([])).toThrow()
  })
})
