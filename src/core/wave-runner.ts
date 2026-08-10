import { PREPARE_SECONDS, WAVES, type WaveDef } from '../content/waves'

/**
 * Drives the prepare → wave → clear cycle.
 *
 * Kept out of `Sim` so the pacing rules stay readable on their own: this file
 * answers "when does the next enemy appear" and nothing else. It spawns through
 * a callback, so it never needs to know what an enemy is.
 */

export type Phase = 'prepare' | 'wave' | 'won' | 'lost'

export class WaveRunner {
  phase: Phase = 'prepare'
  /** Index of the wave being prepared for or currently running. */
  waveIndex = 0
  prepareRemaining = PREPARE_SECONDS

  /** Seconds since the current wave started. */
  private clock = 0
  /** Spawns already emitted, per group of the current wave. */
  private emitted: number[] = []

  constructor(
    private readonly spawn: (enemyId: string) => void,
    private readonly waves: readonly WaveDef[] = WAVES,
  ) {}

  get totalWaves(): number {
    return this.waves.length
  }

  get currentWave(): WaveDef | undefined {
    return this.waves[this.waveIndex]
  }

  /** True once every enemy of the current wave has been spawned. */
  get spawningFinished(): boolean {
    const wave = this.currentWave
    if (!wave) return true
    return wave.groups.every((group, i) => (this.emitted[i] ?? 0) >= group.count)
  }

  /** Skips the remaining preparation time. Ignored outside the prepare phase. */
  startWave(): void {
    if (this.phase !== 'prepare') return
    this.phase = 'wave'
    this.clock = 0
    this.emitted = new Array<number>(this.currentWave?.groups.length ?? 0).fill(0)
  }

  /**
   * @param activeEnemyCount live enemies, used to detect a cleared wave.
   * @returns the reward when a wave was just cleared, otherwise null.
   */
  step(stepSeconds: number, activeEnemyCount: number): number | null {
    if (this.phase === 'prepare') {
      this.prepareRemaining -= stepSeconds
      if (this.prepareRemaining <= 0) this.startWave()
      return null
    }
    if (this.phase !== 'wave') return null

    this.clock += stepSeconds
    const wave = this.currentWave
    if (!wave) return null

    for (let i = 0; i < wave.groups.length; i++) {
      const group = wave.groups[i] as (typeof wave.groups)[number]
      let emitted = this.emitted[i] ?? 0
      while (
        emitted < group.count &&
        this.clock >= group.delay + emitted * group.interval
      ) {
        this.spawn(group.enemy)
        emitted++
      }
      this.emitted[i] = emitted
    }

    if (!this.spawningFinished || activeEnemyCount > 0) return null
    return this.completeWave(wave.reward)
  }

  private completeWave(reward: number): number {
    this.waveIndex++
    if (this.waveIndex >= this.waves.length) {
      this.phase = 'won'
    } else {
      this.phase = 'prepare'
      this.prepareRemaining = PREPARE_SECONDS
    }
    return reward
  }

  lose(): void {
    this.phase = 'lost'
  }
}
