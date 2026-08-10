import type { SpriteKey } from '../render/textures'

/**
 * Tower roster — a data table, matching `enemies.ts`. See the note there about
 * the concept still being provisional.
 */
export interface TowerDef {
  id: string
  label: string
  sprite: SpriteKey
  cost: number
  /** Playfield pixels. */
  range: number
  /** Shots per second. */
  fireRate: number
  damage: number
}

export const TOWERS: Record<string, TowerDef> = {
  cardio: {
    id: 'cardio',
    label: '유산소',
    sprite: 'tower_cardio',
    cost: 20,
    range: 52,
    fireRate: 2.4,
    damage: 8,
  },
  veggie: {
    id: 'veggie',
    label: '채소',
    sprite: 'tower_veggie',
    cost: 30,
    range: 40,
    fireRate: 1.1,
    damage: 14,
  },
  water: {
    id: 'water',
    label: '수분',
    sprite: 'tower_water',
    cost: 25,
    range: 46,
    fireRate: 1.6,
    damage: 5,
  },
  sleep: {
    id: 'sleep',
    label: '수면',
    sprite: 'tower_sleep',
    cost: 55,
    range: 62,
    fireRate: 0.6,
    damage: 40,
  },
}

export const TOWER_IDS = Object.keys(TOWERS)

/**
 * Upgrade levels, as multipliers on the base stats.
 *
 * Without upgrades the only way to get stronger is to place more towers, and
 * the board runs out of useful cells around 25 of them. Enemy health keeps
 * climbing past that, so the run flips from trivial to unwinnable within a
 * single wave. Upgrades give spending somewhere to go once the board is full,
 * which turns that cliff into a curve — and they add the decision that makes
 * the mid-game interesting: more towers, or better ones.
 */
export const MAX_TOWER_LEVEL = 3

export interface LevelStats {
  damage: number
  range: number
  /** Multiplier on the base cost to reach this level from the previous one. */
  upgradeCost: number
}

export const TOWER_LEVELS: Record<number, LevelStats> = {
  1: { damage: 1, range: 1, upgradeCost: 0 },
  2: { damage: 1.7, range: 1.12, upgradeCost: 0.8 },
  3: { damage: 3, range: 1.25, upgradeCost: 1.4 },
}

export function levelStats(level: number): LevelStats {
  return TOWER_LEVELS[Math.min(level, MAX_TOWER_LEVEL)] as LevelStats
}
