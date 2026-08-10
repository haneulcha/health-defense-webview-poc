import type { SpriteKey } from '../render/textures'

/**
 * Enemy roster — a data table, not code.
 *
 * The healthcare concept is still being refined on a separate track, so the
 * names and numbers here are provisional. Everything downstream reads this
 * table, which means a concept change edits this file and nothing else.
 */
export interface EnemyDef {
  id: string
  /** Player-facing name. */
  label: string
  sprite: SpriteKey
  maxHp: number
  /** Playfield pixels per second along the lane. */
  speed: number
  /** Health removed from the core if it gets through. */
  coreDamage: number
  /** Willpower granted on kill. */
  bounty: number
}

export const ENEMIES: Record<string, EnemyDef> = {
  calorie: {
    id: 'calorie',
    label: '초과 칼로리',
    sprite: 'enemy_calorie',
    maxHp: 30,
    speed: 34,
    coreDamage: 5,
    bounty: 2,
  },
  fat: {
    id: 'fat',
    label: '포화지방',
    sprite: 'enemy_fat',
    maxHp: 95,
    speed: 22,
    coreDamage: 10,
    bounty: 5,
  },
  snack: {
    id: 'snack',
    label: '야식',
    sprite: 'enemy_snack',
    maxHp: 18,
    speed: 60,
    coreDamage: 4,
    bounty: 2,
  },
  debt: {
    id: 'debt',
    label: '수면부채',
    sprite: 'enemy_debt',
    maxHp: 140,
    speed: 26,
    coreDamage: 15,
    bounty: 10,
  },
}

export const ENEMY_IDS = Object.keys(ENEMIES)
