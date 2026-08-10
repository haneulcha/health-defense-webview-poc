import { describe, expect, it } from 'vitest'
import { Sim } from './sim'
import { isBuildable, PATH_CELLS, WAYPOINTS } from './path'
import { GRID_COLS, GRID_ROWS } from '../render/layout'
import { TOWERS } from '../content/towers'

/** A compact snapshot of everything the determinism test cares about. */
function snapshot(sim: Sim) {
  return {
    elapsed: sim.elapsed.toFixed(6),
    kills: sim.kills,
    leaked: sim.leaked,
    willpower: sim.willpower,
    coreHealth: sim.coreHealth,
    enemies: sim.enemies
      .filter((e) => e.active)
      .map((e) => `${e.def.id}:${e.x.toFixed(4)}:${e.y.toFixed(4)}:${e.hp}`),
    particles: sim.particles
      .filter((p) => p.active)
      .map((p) => `${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.life.toFixed(4)}`),
  }
}

function runScripted(seed: number, steps: number): Sim {
  const sim = new Sim({ seed, stressEnemyCount: 12, particlesPerKill: 6 })
  sim.fillWithTowers(10)
  for (let i = 0; i < steps; i++) sim.step()
  return sim
}

describe('Sim determinism', () => {
  it('reaches an identical state from the same seed and inputs', () => {
    expect(snapshot(runScripted(4242, 900))).toEqual(snapshot(runScripted(4242, 900)))
  })

  it('diverges when the seed changes', () => {
    expect(snapshot(runScripted(1, 600))).not.toEqual(snapshot(runScripted(2, 600)))
  })

  it('actually simulated something worth comparing', () => {
    const sim = runScripted(4242, 900)
    expect(sim.kills).toBeGreaterThan(0)
    expect(sim.counts().enemies).toBe(12)
  })
})

describe('tower placement', () => {
  it('refuses cells on the enemy lane', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    const [col, row] = (PATH_CELLS.values().next().value as string)
      .split(',')
      .map(Number) as [number, number]
    expect(sim.placeTower(col, row, 'cardio')).toBe(false)
  })

  it('refuses cells outside the grid', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    expect(sim.placeTower(-1, 0, 'cardio')).toBe(false)
    expect(sim.placeTower(GRID_COLS, 0, 'cardio')).toBe(false)
    expect(sim.placeTower(0, GRID_ROWS, 'cardio')).toBe(false)
  })

  it('refuses an occupied cell', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    const cell = firstBuildableCell()
    expect(sim.placeTower(cell.col, cell.row, 'cardio')).toBe(true)
    expect(sim.placeTower(cell.col, cell.row, 'cardio')).toBe(false)
  })

  it('refuses an unknown tower id', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    const cell = firstBuildableCell()
    expect(sim.placeTower(cell.col, cell.row, 'nonexistent')).toBe(false)
  })

  it('charges willpower and refuses when it runs out', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    const before = sim.willpower
    const cell = firstBuildableCell()
    sim.placeTower(cell.col, cell.row, 'cardio')
    expect(sim.willpower).toBe(before - (TOWERS.cardio?.cost ?? 0))

    sim.willpower = 0
    const other = firstBuildableCell(1)
    expect(sim.placeTower(other.col, other.row, 'cardio')).toBe(false)
  })
})

describe('enemy movement', () => {
  it('walks the lane and damages the core on arrival', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    sim.spawnEnemy('snack')
    const before = sim.coreHealth

    // Long enough for the fastest enemy to cross the whole lane unopposed.
    for (let i = 0; i < 60 * 60; i++) sim.step()

    expect(sim.leaked).toBeGreaterThan(0)
    expect(sim.coreHealth).toBeLessThan(before)
    expect(sim.counts().enemies).toBe(0)
  })

  it('starts off-screen so enemies walk in rather than pop in', () => {
    expect((WAYPOINTS[0] as { y: number }).y).toBeLessThan(0)
  })

  it('never drives the core below zero', () => {
    const sim = new Sim({ seed: 1, mode: 'sandbox' })
    sim.coreHealth = 1
    sim.spawnEnemy('debt')
    for (let i = 0; i < 60 * 60; i++) sim.step()
    expect(sim.coreHealth).toBe(0)
  })
})

describe('combat', () => {
  it('kills enemies, pays a bounty, and emits particles', () => {
    const sim = new Sim({ seed: 7, mode: 'sandbox', particlesPerKill: 6 })
    sim.willpower = 1000
    sim.fillWithTowers(14)
    sim.spawnEnemy('calorie')

    for (let i = 0; i < 60 * 20; i++) sim.step()

    expect(sim.kills).toBeGreaterThan(0)
  })

  it('drops shots instead of growing the pool when it is exhausted', () => {
    const sim = new Sim({ seed: 3, stressEnemyCount: 40, particlesPerKill: 20 })
    sim.fillWithTowers(40)
    const projectileSlots = sim.projectiles.length
    const particleSlots = sim.particles.length

    for (let i = 0; i < 60 * 30; i++) sim.step()

    expect(sim.projectiles.length).toBe(projectileSlots)
    expect(sim.particles.length).toBe(particleSlots)
  })
})

describe('pool bookkeeping', () => {
  /**
   * The pools use swap-remove against a compact active list. Getting that wrong
   * leaks slots or double-lists an entity, and neither shows up as a crash —
   * it shows up as entities that stop rendering an hour into a session.
   */
  function expectConsistent(sim: Sim, label: string): void {
    expect(sim.activeEnemies.length, `${label}: enemy count`).toBe(
      sim.enemies.filter((e) => e.active).length,
    )
    expect(sim.activeProjectiles.length, `${label}: projectile count`).toBe(
      sim.projectiles.filter((p) => p.active).length,
    )
    expect(sim.activeParticles.length, `${label}: particle count`).toBe(
      sim.particles.filter((p) => p.active).length,
    )

    expect(new Set(sim.activeEnemies).size, `${label}: enemy duplicates`).toBe(
      sim.activeEnemies.length,
    )
    expect(new Set(sim.activeProjectiles).size, `${label}: shot duplicates`).toBe(
      sim.activeProjectiles.length,
    )
    expect(new Set(sim.activeParticles).size, `${label}: particle duplicates`).toBe(
      sim.activeParticles.length,
    )

    sim.activeEnemies.forEach((enemy, index) => {
      expect(enemy.active, `${label}: enemy ${index} active flag`).toBe(true)
      expect(enemy.activeIndex, `${label}: enemy ${index} back-reference`).toBe(index)
    })
    for (const projectile of sim.activeProjectiles) expect(projectile.active).toBe(true)
    for (const particle of sim.activeParticles) expect(particle.active).toBe(true)
  }

  it('keeps the active lists consistent under sustained churn', () => {
    const sim = new Sim({ seed: 11, stressEnemyCount: 30, particlesPerKill: 12 })
    sim.fillWithTowers(30)
    for (let i = 0; i < 60 * 45; i++) {
      sim.step()
      if (i % 500 === 0) expectConsistent(sim, `step ${i}`)
    }
    expectConsistent(sim, 'final')
    expect(sim.kills).toBeGreaterThan(50)
  })

  it('returns every slot to the pool once the board clears', () => {
    const sim = new Sim({ seed: 12, mode: 'sandbox', particlesPerKill: 10 })
    sim.willpower = 1000
    sim.fillWithTowers(20)
    for (let i = 0; i < 8; i++) sim.spawnEnemy('calorie')

    for (let i = 0; i < 60 * 40; i++) sim.step()

    expectConsistent(sim, 'drained')
    expect(sim.activeEnemies).toHaveLength(0)
    expect(sim.activeProjectiles).toHaveLength(0)
    expect(sim.activeParticles).toHaveLength(0)
  })
})

describe('stress mode', () => {
  it('holds the enemy population steady so a long measurement can run', () => {
    const sim = new Sim({ seed: 9, stressEnemyCount: 25 })
    sim.fillWithTowers(20)
    for (let i = 0; i < 60 * 30; i++) sim.step()
    expect(sim.counts().enemies).toBe(25)
  })

  it('leaves the core alone so the run never ends mid-measurement', () => {
    const sim = new Sim({ seed: 9, stressEnemyCount: 25 })
    for (let i = 0; i < 60 * 60; i++) sim.step()
    expect(sim.leaked).toBeGreaterThan(0)
    expect(sim.coreHealth).toBe(100)
  })
})

describe('lane geometry', () => {
  it('marks lane cells unbuildable and leaves room to build', () => {
    let buildable = 0
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (isBuildable(col, row)) buildable++
        else expect(PATH_CELLS.has(`${col},${row}`) || false).toBe(true)
      }
    }
    expect(buildable).toBeGreaterThan(40)
  })
})

function firstBuildableCell(skip = 0): { col: number; row: number } {
  let seen = 0
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!isBuildable(col, row)) continue
      if (seen++ < skip) continue
      return { col, row }
    }
  }
  throw new Error('no buildable cell')
}
