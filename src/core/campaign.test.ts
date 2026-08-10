import { describe, expect, it } from 'vitest'
import {
  Sim,
  SELL_REFUND,
  STEP_SECONDS,
  towerDamage,
  towerRange,
  upgradeCost,
  type Tower,
} from './sim'
import { spendGreedily } from './balance-report.test'
import { MAX_TOWER_LEVEL, TOWERS, type TowerDef } from '../content/towers'
import { PREPARE_SECONDS, WAVES } from '../content/waves'

/**
 * A scripted player that buys the most expensive tower it can afford and puts
 * it where it covers the most lane.
 *
 * This is the balance instrument. A run is tuned when a naive-but-sensible
 * player wins and an idle player loses — if the greedy bot loses, the waves are
 * too harsh for a first-time player; if an idle run survives, they are pointless.
 */
function playGreedy(seed: number, maxSeconds = 600, wideEnough = 16): Sim {
  const sim = new Sim({ seed })
  const steps = Math.round(maxSeconds / STEP_SECONDS)
  for (let i = 0; i < steps && !sim.isOver; i++) {
    if (i % 30 === 0) spendGreedily(sim, wideEnough)
    sim.step()
  }
  return sim
}

function playIdle(seed: number, maxSeconds = 600): Sim {
  const sim = new Sim({ seed })
  const steps = Math.round(maxSeconds / STEP_SECONDS)
  for (let i = 0; i < steps && !sim.isOver; i++) sim.step()
  return sim
}

describe('campaign balance', () => {
  it('is winnable by a player who just buys and places sensibly', () => {
    const sim = playGreedy(2026)
    expect(sim.phase).toBe('won')
    expect(sim.coreHealth).toBeGreaterThan(0)
  })

  it('is lost by a player who never builds anything', () => {
    const sim = playIdle(2026)
    expect(sim.phase).toBe('lost')
    expect(sim.coreHealth).toBe(0)
  })

  it('is not trivially won — the late waves cost real health', () => {
    const sim = playGreedy(2026)
    // The first version of this table let the scripted player finish at full
    // health without ever leaking, which passed a weaker assertion than this
    // one and hid the fact that the game had no difficulty curve at all.
    expect(sim.coreHealth).toBeLessThan(100)
    expect(sim.leaked).toBeGreaterThan(0)
  })

  it('rewards going tall over going wide', () => {
    // Upgrading early should beat covering every cell. If these ever invert,
    // upgrades have become a trap and the mid-game decision is fake.
    const tall = playGreedy(2026, 600, 16)
    const wide = playGreedy(2026, 600, 40)
    expect(tall.phase).toBe('won')
    expect(wide.phase).toBe('won')
    expect(tall.coreHealth).toBeGreaterThan(wide.coreHealth)
  })
})

describe('wave progression', () => {
  it('starts in preparation and runs the first wave when the timer expires', () => {
    const sim = new Sim({ seed: 5 })
    expect(sim.phase).toBe('prepare')
    expect(sim.waves.waveIndex).toBe(0)

    for (let i = 0; i < Math.round(PREPARE_SECONDS / STEP_SECONDS) + 1; i++) sim.step()
    expect(sim.phase).toBe('wave')
  })

  it('lets the player skip preparation', () => {
    const sim = new Sim({ seed: 5 })
    sim.waves.startWave()
    expect(sim.phase).toBe('wave')
    expect(sim.waves.prepareRemaining).toBeGreaterThan(0) // untouched, just bypassed
  })

  it('pays the wave reward and returns to preparation after a clear', () => {
    const sim = playGreedy(2026, 60)
    expect(sim.waves.waveIndex).toBeGreaterThan(0)
    expect(sim.willpower).toBeGreaterThan(0)
  })

  it('declares victory only after the last wave', () => {
    const sim = playGreedy(2026)
    expect(sim.waves.waveIndex).toBe(WAVES.length)
  })

  it('stops simulating once the run is over', () => {
    const sim = playIdle(2026)
    const frozen = sim.elapsed
    for (let i = 0; i < 600; i++) sim.step()
    expect(sim.elapsed).toBe(frozen)
  })
})

describe('tower unlocks', () => {
  it('opens with a small set and adds the rest later', () => {
    const sim = new Sim({ seed: 5 })
    const opening = sim.availableTowers()
    expect(opening).toContain('cardio')
    expect(opening).toContain('veggie')
    expect(opening).not.toContain('sleep')
    expect(opening.length).toBeLessThanOrEqual(3)

    sim.waves.waveIndex = 3
    expect(sim.availableTowers()).toContain('sleep')
  })

  it('refuses to place a tower that is still locked', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 1000
    const cell = { col: 0, row: 0 }
    expect(sim.canPlace(cell.col, cell.row, 'sleep')).toBe(false)
    expect(sim.placeTower(cell.col, cell.row, 'sleep')).toBe(false)
  })
})

describe('selling', () => {
  it('refunds part of the cost and frees the cell', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 100
    expect(sim.placeTower(0, 0, 'cardio')).toBe(true)
    const afterBuy = sim.willpower

    const refund = sim.sellTower(0, 0)
    expect(refund).toBe(Math.floor((TOWERS.cardio as TowerDef).cost * SELL_REFUND))
    expect(sim.willpower).toBe(afterBuy + refund)
    expect(sim.towerAt(0, 0)).toBeNull()
    expect(sim.towers).toHaveLength(0)
    expect(sim.placeTower(0, 0, 'veggie')).toBe(true)
  })

  it('is a no-op on an empty cell', () => {
    const sim = new Sim({ seed: 5 })
    const before = sim.willpower
    expect(sim.sellTower(0, 0)).toBe(0)
    expect(sim.willpower).toBe(before)
  })

  it('never refunds more than the tower cost', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 1000
    for (const id of ['cardio', 'veggie']) {
      const def = TOWERS[id] as TowerDef
      sim.placeTower(1, 1, id)
      expect(sim.sellTower(1, 1)).toBeLessThan(def.cost)
    }
  })
})

describe('upgrades', () => {
  it('raises damage and range, and costs willpower', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 1000
    sim.placeTower(0, 0, 'cardio')
    const tower = sim.towerAt(0, 0) as Tower

    const baseDamage = towerDamage(tower)
    const baseRange = towerRange(tower)
    const cost = upgradeCost(tower) as number
    const before = sim.willpower

    expect(sim.upgradeTower(0, 0)).toBe(true)
    expect(tower.level).toBe(2)
    expect(sim.willpower).toBe(before - cost)
    expect(towerDamage(tower)).toBeGreaterThan(baseDamage)
    expect(towerRange(tower)).toBeGreaterThan(baseRange)
  })

  it('stops at the maximum level', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 10_000
    sim.placeTower(0, 0, 'cardio')
    while (sim.upgradeTower(0, 0)) {
      /* climb to the cap */
    }
    const tower = sim.towerAt(0, 0) as Tower
    expect(tower.level).toBe(MAX_TOWER_LEVEL)
    expect(upgradeCost(tower)).toBeNull()
  })

  it('refuses when willpower is short', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 100
    sim.placeTower(0, 0, 'cardio')
    sim.willpower = 0
    expect(sim.upgradeTower(0, 0)).toBe(false)
    expect((sim.towerAt(0, 0) as Tower).level).toBe(1)
  })

  it('refunds the upgrade investment on sale, not just the base cost', () => {
    const sim = new Sim({ seed: 5 })
    sim.willpower = 1000
    sim.placeTower(0, 0, 'cardio')
    sim.upgradeTower(0, 0)

    const base = (TOWERS.cardio as TowerDef).cost
    expect(sim.sellTower(0, 0)).toBeGreaterThan(Math.floor(base * SELL_REFUND))
  })

  it('is a no-op on an empty cell', () => {
    expect(new Sim({ seed: 5 }).upgradeTower(4, 4)).toBe(false)
  })
})
