import { ENEMIES, ENEMY_IDS, type EnemyDef } from '../content/enemies'
import { levelStats, MAX_TOWER_LEVEL, TOWERS, type TowerDef } from '../content/towers'
import { unlockedTowers } from '../content/waves'
import { GRID_COLS, GRID_ROWS, TILE } from '../render/layout'
import { isBuildable, WAYPOINTS, type Point } from './path'
import { Rng } from './rng'
import { WaveRunner, type Phase } from './wave-runner'

/**
 * The simulation. Knows nothing about PixiJS, the DOM, or how anything looks.
 *
 * It advances on a fixed 60Hz timestep so that a dropped frame slows the
 * animation but never the game — without this, balance tuned on a desktop would
 * be wrong on every phone that misses budget. Combined with the seeded PRNG it
 * also makes the whole run reproducible, which is what the determinism test
 * relies on.
 */

/** Seconds per simulation step. Never varies, regardless of frame rate. */
export const STEP_SECONDS = 1 / 60

/**
 * Ceiling on steps caught up in one frame. Without it, returning from the
 * background (where rAF is suspended) would hand the sim a multi-second delta
 * and spiral into a freeze while it simulated the whole gap.
 */
export const MAX_CATCHUP_STEPS = 5

export interface Enemy {
  active: boolean
  def: EnemyDef
  x: number
  y: number
  hp: number
  /** `def.maxHp` times the current wave's scaling. Kept per instance so the
   * damage tint stays correct when later waves send tougher versions. */
  maxHp: number
  /** Index of the waypoint currently being walked toward. */
  waypoint: number
  /** Own slot in `activeEnemies`, so a projectile can retire its target in O(1). */
  activeIndex: number
}

export interface Tower {
  def: TowerDef
  col: number
  row: number
  x: number
  y: number
  /** 1 to MAX_TOWER_LEVEL. Scales damage and range via `TOWER_LEVELS`. */
  level: number
  /** Seconds until the next shot is allowed. */
  cooldown: number
  /** Set on fire, decays for the recoil animation. Render-only. */
  recoil: number
}

export function towerDamage(tower: Tower): number {
  return tower.def.damage * levelStats(tower.level).damage
}

export function towerRange(tower: Tower): number {
  return tower.def.range * levelStats(tower.level).range
}

/** Willpower needed for the next level, or null when fully upgraded. */
export function upgradeCost(tower: Tower): number | null {
  if (tower.level >= MAX_TOWER_LEVEL) return null
  return Math.round(tower.def.cost * levelStats(tower.level + 1).upgradeCost)
}

/** What selling returns, accounting for everything invested in upgrades. */
export function investedValue(tower: Tower): number {
  let total = tower.def.cost
  for (let level = 2; level <= tower.level; level++) {
    total += Math.round(tower.def.cost * levelStats(level).upgradeCost)
  }
  return total
}

export interface Projectile {
  active: boolean
  x: number
  y: number
  damage: number
  speed: number
  /** Homing target. Null once the target dies, which retires the shot. */
  target: Enemy | null
}

export interface Particle {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds remaining. */
  life: number
  maxLife: number
}

export interface SimCounts {
  enemies: number
  towers: number
  projectiles: number
  particles: number
}

/**
 * Only projectiles and particles are pooled. They are the high-churn types —
 * hundreds created and discarded per second, which is where GC pauses on
 * low-end Android WebView come from. Enemies arrive a few dozen per wave and
 * are not worth the indirection.
 */
const PROJECTILE_POOL_SIZE = 400
const PARTICLE_POOL_SIZE = 600

/**
 * Fraction of a tower's cost returned when it is sold.
 *
 * Placement is two taps with no confirmation step, which is fast but means the
 * occasional misplaced tower. A partial refund makes that a small mistake
 * instead of a run-ending one — the alternative, a confirm step on every
 * placement, taxes every correct tap to protect against the rare wrong one.
 */
export const SELL_REFUND = 0.7

/**
 * `campaign` runs the wave schedule and ends on a win or a loss — the actual
 * game. `sandbox` runs the same combat with no waves and no end condition,
 * which is what the M0 perf harness and the entity-level tests need.
 */
export type SimMode = 'campaign' | 'sandbox'

export interface SimOptions {
  seed?: number
  /** Defaults to `campaign`, or `sandbox` when a stress count is given. */
  mode?: SimMode
  /**
   * Sandbox only: hold this many enemies alive at all times, recycling any
   * that reach the core. Zero leaves spawning entirely to the caller.
   */
  stressEnemyCount?: number
  particlesPerKill?: number
}

export class Sim {
  /** Every allocated slot, live or not. Pool sizes are fixed after construction. */
  readonly enemies: Enemy[] = []
  readonly towers: Tower[] = []
  readonly projectiles: Projectile[] = []
  readonly particles: Particle[] = []

  /**
   * Compact lists of what is currently alive.
   *
   * Both the simulation and the renderer walk these instead of scanning the
   * pools. Scanning 400 projectile and 600 particle slots every frame — plus a
   * linear search for a free slot on every shot — costs more than the work
   * being done once the pools are large, and it costs the same whether one
   * entity is alive or four hundred.
   */
  readonly activeEnemies: Enemy[] = []
  readonly activeProjectiles: Projectile[] = []
  readonly activeParticles: Particle[] = []

  private readonly freeEnemies: Enemy[] = []
  private readonly freeProjectiles: Projectile[] = []
  private readonly freeParticles: Particle[] = []

  coreHealth = 100
  willpower = 50
  elapsed = 0
  /** Enemies that reached the core. Reported by the fun/perf harness. */
  leaked = 0
  kills = 0

  readonly mode: SimMode
  stressEnemyCount: number
  particlesPerKill: number

  readonly waves: WaveRunner

  private readonly rng: Rng
  private readonly occupied = new Map<string, Tower>()

  constructor(options: SimOptions = {}) {
    this.rng = new Rng(options.seed ?? 1)
    this.stressEnemyCount = options.stressEnemyCount ?? 0
    this.mode = options.mode ?? (this.stressEnemyCount > 0 ? 'sandbox' : 'campaign')
    this.particlesPerKill = options.particlesPerKill ?? 8
    this.waves = new WaveRunner((enemyId) => this.spawnEnemy(enemyId))

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const projectile: Projectile = {
        active: false,
        x: 0,
        y: 0,
        damage: 0,
        speed: 0,
        target: null,
      }
      this.projectiles.push(projectile)
      this.freeProjectiles.push(projectile)
    }
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const particle: Particle = {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
      }
      this.particles.push(particle)
      this.freeParticles.push(particle)
    }
  }

  counts(): SimCounts {
    return {
      enemies: this.activeEnemies.length,
      towers: this.towers.length,
      projectiles: this.activeProjectiles.length,
      particles: this.activeParticles.length,
    }
  }

  /** Tower ids the player may build at the current point in the run. */
  availableTowers(): string[] {
    return unlockedTowers(this.waves.waveIndex)
  }

  canPlace(col: number, row: number, towerId: string): boolean {
    const def = TOWERS[towerId]
    if (!def) return false
    if (!this.availableTowers().includes(towerId)) return false
    if (!isBuildable(col, row)) return false
    if (this.occupied.has(`${col},${row}`)) return false
    return this.willpower >= def.cost
  }

  placeTower(col: number, row: number, towerId: string): boolean {
    if (!this.canPlace(col, row, towerId)) return false
    const def = TOWERS[towerId] as TowerDef

    this.willpower -= def.cost
    const tower: Tower = {
      def,
      col,
      row,
      x: col * TILE + TILE / 2,
      y: row * TILE + TILE / 2,
      level: 1,
      cooldown: 0,
      recoil: 0,
    }
    this.occupied.set(`${col},${row}`, tower)
    this.towers.push(tower)
    return true
  }

  towerAt(col: number, row: number): Tower | null {
    return this.occupied.get(`${col},${row}`) ?? null
  }

  /** @returns true if the tower advanced a level. */
  upgradeTower(col: number, row: number): boolean {
    const tower = this.occupied.get(`${col},${row}`)
    if (!tower) return false
    const cost = upgradeCost(tower)
    if (cost === null || this.willpower < cost) return false

    this.willpower -= cost
    tower.level++
    return true
  }

  /** @returns the willpower refunded, or 0 if there was no tower there. */
  sellTower(col: number, row: number): number {
    const tower = this.occupied.get(`${col},${row}`)
    if (!tower) return 0

    const index = this.towers.indexOf(tower)
    if (index >= 0) this.towers.splice(index, 1)
    this.occupied.delete(`${col},${row}`)

    // Any shot already in flight from this tower keeps its damage; retiring
    // them would make selling feel like it undid work the player already saw.
    const refund = Math.floor(investedValue(tower) * SELL_REFUND)
    this.willpower += refund
    return refund
  }

  /** Fills the board with towers on buildable cells. Stress harness only. */
  fillWithTowers(count: number): void {
    const ids = Object.keys(TOWERS)
    let placed = 0
    for (let row = 0; row < GRID_ROWS && placed < count; row++) {
      for (let col = 0; col < GRID_COLS && placed < count; col++) {
        if (!isBuildable(col, row) || this.occupied.has(`${col},${row}`)) continue
        const def = TOWERS[ids[placed % ids.length] as string] as TowerDef
        const tower: Tower = {
          def,
          col,
          row,
          x: col * TILE + TILE / 2,
          y: row * TILE + TILE / 2,
          level: 1,
          cooldown: this.rng.range(0, 1 / def.fireRate),
          recoil: 0,
        }
        this.occupied.set(`${col},${row}`, tower)
        this.towers.push(tower)
        placed++
      }
    }
  }

  spawnEnemy(defId?: string): Enemy {
    const def = ENEMIES[defId ?? this.rng.pick(ENEMY_IDS)] as EnemyDef

    let enemy = this.freeEnemies.pop()
    if (!enemy) {
      enemy = {
        active: false,
        def,
        x: 0,
        y: 0,
        hp: 0,
        maxHp: 0,
        waypoint: 1,
        activeIndex: -1,
      }
      this.enemies.push(enemy)
    }
    enemy.def = def
    // Later waves send the same creatures, tougher. Scaling health is what
    // keeps wave 9 threatening without inventing five more enemy types.
    const scale = this.mode === 'campaign' ? (this.waves.currentWave?.hpScale ?? 1) : 1
    enemy.maxHp = Math.round(def.maxHp * scale)
    this.sendToLaneStart(enemy)
    enemy.active = true
    enemy.activeIndex = this.activeEnemies.length
    this.activeEnemies.push(enemy)
    return enemy
  }

  private sendToLaneStart(enemy: Enemy): void {
    const start = WAYPOINTS[0] as Point
    enemy.x = start.x
    enemy.y = start.y
    enemy.hp = enemy.maxHp
    enemy.waypoint = 1
  }

  /**
   * Drops an enemy at a random point along the lane. Stress harness only.
   *
   * Recycling kills back to the entrance bunches the whole population at the
   * top of the map, where they die instantly and every tower further down sits
   * idle with no target. That understates the real workload badly — measured
   * concurrent projectiles were roughly a fifth of what steady play produces.
   * Spreading the population is what makes the perf table honest.
   */
  private placeAlongLane(enemy: Enemy): void {
    const segment = this.rng.int(1, WAYPOINTS.length - 1)
    const from = WAYPOINTS[segment - 1] as Point
    const to = WAYPOINTS[segment] as Point
    const t = this.rng.next()
    enemy.x = from.x + (to.x - from.x) * t
    enemy.y = from.y + (to.y - from.y) * t
    enemy.hp = enemy.maxHp
    enemy.waypoint = segment
  }

  private retireEnemy(enemy: Enemy): void {
    const index = enemy.activeIndex
    if (index < 0) return
    enemy.active = false
    enemy.activeIndex = -1
    // Swap-remove: order among active entities carries no meaning, so this
    // avoids the O(n) shift that splice would cost on every death.
    const last = this.activeEnemies.pop() as Enemy
    if (index < this.activeEnemies.length) {
      this.activeEnemies[index] = last
      last.activeIndex = index
    }
    this.freeEnemies.push(enemy)
  }

  get phase(): Phase {
    return this.waves.phase
  }

  get isOver(): boolean {
    return this.phase === 'won' || this.phase === 'lost'
  }

  step(): void {
    if (this.isOver) return

    this.elapsed += STEP_SECONDS

    if (this.mode === 'campaign') {
      const reward = this.waves.step(STEP_SECONDS, this.activeEnemies.length)
      if (reward !== null) this.willpower += reward
    } else {
      this.maintainStressPopulation()
    }

    this.stepEnemies()
    this.stepTowers()
    this.stepProjectiles()
    this.stepParticles()

    if (this.mode === 'campaign' && this.coreHealth <= 0) this.waves.lose()
  }

  private maintainStressPopulation(): void {
    if (this.stressEnemyCount <= 0) return
    while (this.activeEnemies.length < this.stressEnemyCount) {
      this.placeAlongLane(this.spawnEnemy())
    }
  }

  private stepEnemies(): void {
    // Backwards, so a swap-remove never skips the entity moved into this slot.
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const enemy = this.activeEnemies[i] as Enemy

      const target = WAYPOINTS[enemy.waypoint]
      if (!target) {
        this.onEnemyReachedCore(enemy)
        continue
      }

      const dx = target.x - enemy.x
      const dy = target.y - enemy.y
      const distance = Math.hypot(dx, dy)
      const travel = enemy.def.speed * STEP_SECONDS

      if (distance <= travel) {
        enemy.x = target.x
        enemy.y = target.y
        enemy.waypoint++
        if (enemy.waypoint >= WAYPOINTS.length) this.onEnemyReachedCore(enemy)
        continue
      }

      enemy.x += (dx / distance) * travel
      enemy.y += (dy / distance) * travel
    }
  }

  private onEnemyReachedCore(enemy: Enemy): void {
    this.leaked++
    if (this.stressEnemyCount > 0) {
      // Recycle rather than end the run, so a stress measurement can run long
      // enough to catch thermal throttling.
      this.placeAlongLane(enemy)
      return
    }
    this.coreHealth = Math.max(0, this.coreHealth - enemy.def.coreDamage)
    this.retireEnemy(enemy)
  }

  private stepTowers(): void {
    for (const tower of this.towers) {
      if (tower.recoil > 0) tower.recoil = Math.max(0, tower.recoil - STEP_SECONDS)
      tower.cooldown -= STEP_SECONDS
      if (tower.cooldown > 0) continue

      const target = this.findTarget(tower)
      if (!target) continue

      tower.cooldown = 1 / tower.def.fireRate
      tower.recoil = 0.08
      this.fire(tower, target)
    }
  }

  /** Targets the enemy furthest along the lane — the standard TD heuristic. */
  private findTarget(tower: Tower): Enemy | null {
    let best: Enemy | null = null
    let bestProgress = -1
    const range = towerRange(tower)
    const rangeSq = range * range

    for (const enemy of this.activeEnemies) {
      const dx = enemy.x - tower.x
      const dy = enemy.y - tower.y
      if (dx * dx + dy * dy > rangeSq) continue
      if (enemy.waypoint > bestProgress) {
        bestProgress = enemy.waypoint
        best = enemy
      }
    }
    return best
  }

  private fire(tower: Tower, target: Enemy): void {
    const projectile = this.freeProjectiles.pop()
    // Pool exhaustion drops the shot rather than growing the pool: an
    // unbounded pool would hide the very allocation spike we are measuring.
    if (!projectile) return

    projectile.active = true
    projectile.x = tower.x
    projectile.y = tower.y
    projectile.damage = towerDamage(tower)
    projectile.speed = 150
    projectile.target = target
    this.activeProjectiles.push(projectile)
  }

  private stepProjectiles(): void {
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.activeProjectiles[i] as Projectile

      const target = projectile.target
      if (!target || !target.active) {
        this.retireProjectile(i)
        continue
      }

      const dx = target.x - projectile.x
      const dy = target.y - projectile.y
      const distance = Math.hypot(dx, dy)
      const travel = projectile.speed * STEP_SECONDS

      if (distance <= travel) {
        this.damageEnemy(target, projectile.damage)
        this.retireProjectile(i)
        continue
      }

      projectile.x += (dx / distance) * travel
      projectile.y += (dy / distance) * travel
    }
  }

  private retireProjectile(index: number): void {
    const projectile = this.activeProjectiles[index] as Projectile
    projectile.active = false
    projectile.target = null
    const last = this.activeProjectiles.pop() as Projectile
    if (index < this.activeProjectiles.length) this.activeProjectiles[index] = last
    this.freeProjectiles.push(projectile)
  }

  private damageEnemy(enemy: Enemy, damage: number): void {
    enemy.hp -= damage
    if (enemy.hp > 0) return

    this.kills++
    this.willpower += enemy.def.bounty
    this.burst(enemy.x, enemy.y)

    if (this.stressEnemyCount > 0) {
      this.placeAlongLane(enemy)
      return
    }
    this.retireEnemy(enemy)
  }

  private burst(x: number, y: number): void {
    for (let i = 0; i < this.particlesPerKill; i++) {
      const particle = this.freeParticles.pop()
      if (!particle) return
      const angle = this.rng.range(0, Math.PI * 2)
      const speed = this.rng.range(18, 55)
      particle.active = true
      particle.x = x
      particle.y = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.maxLife = this.rng.range(0.25, 0.55)
      particle.life = particle.maxLife
      this.activeParticles.push(particle)
    }
  }

  private stepParticles(): void {
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const particle = this.activeParticles[i] as Particle
      particle.life -= STEP_SECONDS
      if (particle.life <= 0) {
        particle.active = false
        const last = this.activeParticles.pop() as Particle
        if (i < this.activeParticles.length) this.activeParticles[i] = last
        this.freeParticles.push(particle)
        continue
      }
      particle.x += particle.vx * STEP_SECONDS
      particle.y += particle.vy * STEP_SECONDS
      particle.vy += 40 * STEP_SECONDS // a little gravity so bursts settle
    }
  }
}
