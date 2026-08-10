/**
 * Wave schedule — a data table, like `enemies.ts` and `towers.ts`.
 *
 * Ten waves at roughly 20 seconds each, plus preparation time, lands a run
 * around three and a half minutes. That is deliberately short: the first thing
 * the fun test measures is whether someone retries after losing, and a
 * twelve-minute run makes retrying feel expensive.
 */

export interface SpawnGroup {
  enemy: string
  count: number
  /** Seconds before this group's first spawn, measured from the wave start. */
  delay: number
  /** Seconds between spawns within the group. */
  interval: number
}

export interface WaveDef {
  groups: SpawnGroup[]
  /** Willpower granted for clearing the wave, on top of per-kill bounties. */
  reward: number
  /**
   * Multiplier on enemy health for this wave.
   *
   * Without it the roster's fixed health values mean wave 10 is no harder than
   * wave 4 once the board fills up — a scripted greedy player finished every
   * seed at full health. Scaling health is the genre-standard lever: the same
   * creatures, tougher, rather than five more enemy types nobody asked for.
   */
  hpScale: number
}

export const PREPARE_SECONDS = 8

/**
 * Towers unlock over the first few waves rather than all at once.
 *
 * Three choices is about the ceiling for someone who has never played a tower
 * defense; opening the full set immediately turns the first decision into a
 * menu-reading exercise instead of a game.
 */
export const TOWER_UNLOCK_WAVE: Record<string, number> = {
  cardio: 0,
  veggie: 0,
  water: 1,
  sleep: 3,
}

export function unlockedTowers(waveIndex: number): string[] {
  return Object.entries(TOWER_UNLOCK_WAVE)
    .filter(([, wave]) => waveIndex >= wave)
    .map(([id]) => id)
}

export const WAVES: WaveDef[] = [
  // 1 — one enemy type, slow trickle. The player has time to look around.
  {
    groups: [{ enemy: 'calorie', count: 6, delay: 0, interval: 1.6 }],
    reward: 12,
    hpScale: 1,
  },
  // 2 — same enemy, denser. Teaches that one tower is not enough.
  {
    groups: [{ enemy: 'calorie', count: 10, delay: 0, interval: 1.1 }],
    reward: 14,
    hpScale: 1.5,
  },
  // 3 — speed shows up.
  {
    groups: [
      { enemy: 'calorie', count: 8, delay: 0, interval: 1.2 },
      { enemy: 'snack', count: 4, delay: 4, interval: 1.4 },
    ],
    reward: 16,
    hpScale: 2.1,
  },
  // 4 — the first tank. Single-target damage starts to matter.
  {
    groups: [
      { enemy: 'calorie', count: 10, delay: 0, interval: 1 },
      { enemy: 'fat', count: 3, delay: 3, interval: 3 },
    ],
    reward: 18,
    hpScale: 2.7,
  },
  // 5 — a speed rush, right after the sleep tower unlocks.
  {
    groups: [{ enemy: 'snack', count: 14, delay: 0, interval: 0.7 }],
    reward: 21,
    hpScale: 3.3,
  },
  {
    groups: [
      { enemy: 'fat', count: 8, delay: 0, interval: 1.8 },
      { enemy: 'calorie', count: 10, delay: 2, interval: 1 },
    ],
    reward: 24,
    hpScale: 3.9,
  },
  {
    groups: [
      { enemy: 'snack', count: 12, delay: 0, interval: 0.6 },
      { enemy: 'fat', count: 6, delay: 5, interval: 2 },
    ],
    reward: 27,
    hpScale: 4.5,
  },
  // 8 — first sleep debt: high health, high damage if it gets through.
  {
    groups: [
      { enemy: 'calorie', count: 14, delay: 0, interval: 0.8 },
      { enemy: 'debt', count: 1, delay: 6, interval: 1 },
    ],
    reward: 31,
    hpScale: 5.1,
  },
  {
    groups: [
      { enemy: 'fat', count: 10, delay: 0, interval: 1.4 },
      { enemy: 'debt', count: 2, delay: 5, interval: 6 },
    ],
    reward: 36,
    hpScale: 5.7,
  },
  // 10 — everything at once.
  {
    groups: [
      { enemy: 'snack', count: 16, delay: 0, interval: 0.5 },
      { enemy: 'fat', count: 10, delay: 4, interval: 1.2 },
      { enemy: 'debt', count: 3, delay: 8, interval: 4 },
    ],
    reward: 60,
    hpScale: 6.4,
  },
]
