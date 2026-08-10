/**
 * Seeded PRNG (mulberry32).
 *
 * The simulation must never call Math.random: it cannot be seeded, which would
 * make the determinism test — same seed plus same inputs yields the same final
 * state — impossible to write.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    // >>> 0 keeps the state an unsigned 32-bit integer so a negative or
    // fractional seed still produces a valid, reproducible stream.
    this.state = seed >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with no items')
    return items[this.int(0, items.length - 1)] as T
  }
}
