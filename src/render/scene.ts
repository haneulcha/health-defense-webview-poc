import { Container, Sprite, type Application } from 'pixi.js'
import type { Sim } from '../core/sim'
import { PATH_CELLS } from '../core/path'
import { GRID_COLS, GRID_ROWS, TILE } from './layout'
import { buildAtlas, type Atlas } from './textures'

/**
 * Mirrors simulation state onto sprites. Holds no game logic of its own.
 *
 * Sprites are allocated once and hidden when unused, mirroring the simulation's
 * pools — creating and destroying display objects every frame would reintroduce
 * exactly the GC pressure the pools exist to avoid.
 *
 * No interpolation between simulation steps: at this backing-store resolution a
 * sub-pixel position rounds away to nothing, so interpolating would buy motion
 * smoothness that the pixel grid immediately discards.
 */
export class Scene {
  readonly atlas: Atlas
  private readonly enemySprites: Sprite[] = []
  private readonly projectileSprites: Sprite[] = []
  private readonly particleSprites: Sprite[] = []
  private readonly overlayLayer = new Container()
  private readonly towerLayer = new Container()
  private readonly enemyLayer = new Container()
  private readonly projectileLayer = new Container()
  private readonly particleLayer = new Container()
  private towerSpriteCount = 0
  /** How many sprites of each kind were visible last frame. */
  private enemiesShown = 0
  private shotsShown = 0
  private particlesShown = 0

  private readonly root = new Container()

  constructor(app: Application) {
    this.atlas = buildAtlas()

    this.root.addChild(
      this.buildTerrain(),
      // Placement affordances sit above the ground but below the pieces, so a
      // highlighted cell never washes out the tower standing on it.
      this.overlayLayer,
      this.towerLayer,
      this.enemyLayer,
      this.projectileLayer,
      this.particleLayer,
    )
    app.stage.addChild(this.root)
  }

  attachOverlay(container: Container): void {
    this.overlayLayer.addChild(container)
  }

  /** Clears everything tied to a run so a restart starts from a blank board. */
  reset(): void {
    this.towerLayer.removeChildren()
    this.towerSpriteCount = 0
    for (const sprites of [this.enemySprites, this.projectileSprites, this.particleSprites]) {
      for (const sprite of sprites) sprite.visible = false
    }
    this.enemiesShown = 0
    this.shotsShown = 0
    this.particlesShown = 0
  }

  private buildTerrain(): Container {
    const layer = new Container()
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const onPath = PATH_CELLS.has(`${col},${row}`)
        const sprite = new Sprite(
          this.atlas.textures[onPath ? 'tile_path' : 'tile_ground'],
        )
        sprite.x = col * TILE
        sprite.y = row * TILE
        layer.addChild(sprite)
      }
    }

    const core = new Sprite(this.atlas.textures.core)
    core.anchor.set(0.5)
    core.x = 3 * TILE + TILE / 2
    core.y = 11 * TILE + TILE / 2
    layer.addChild(core)

    // The terrain never changes, so let Pixi upload it once and stop walking it.
    layer.cacheAsTexture(true)
    return layer
  }

  sync(sim: Sim): void {
    this.syncTowers(sim)
    this.syncEnemies(sim)
    this.syncProjectiles(sim)
    this.syncParticles(sim)
  }

  private syncTowers(sim: Sim): void {
    while (this.towerSpriteCount < sim.towers.length) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5)
      this.towerLayer.addChild(sprite)
      this.towerSpriteCount++
    }

    for (let i = 0; i < sim.towers.length; i++) {
      const tower = sim.towers[i]
      const sprite = this.towerLayer.children[i] as Sprite
      if (!tower) continue
      sprite.texture = this.atlas.textures[tower.def.sprite]
      sprite.x = tower.x
      sprite.y = tower.y
      // Recoil: a brief squash on fire. Cheap, and it makes towers feel alive.
      sprite.scale.set(1 + tower.recoil * 1.5, 1 - tower.recoil * 1.2)
      sprite.visible = true
    }
  }

  private syncEnemies(sim: Sim): void {
    const active = sim.activeEnemies
    for (let i = 0; i < active.length; i++) {
      const enemy = active[i]
      if (!enemy) continue
      const sprite = this.spriteAt(this.enemySprites, this.enemyLayer, i)
      sprite.texture = this.atlas.textures[enemy.def.sprite]
      sprite.x = enemy.x
      sprite.y = enemy.y
      // Tint toward red as health drops — readable damage feedback without a
      // per-enemy health bar, which would cost extra draw calls and clutter.
      const health = enemy.hp / enemy.def.maxHp
      sprite.tint = health > 0.99 ? 0xffffff : mixToward(0xff6060, health)
      sprite.visible = true
    }
    this.enemiesShown = this.hideFrom(this.enemySprites, active.length, this.enemiesShown)
  }

  private syncProjectiles(sim: Sim): void {
    const active = sim.activeProjectiles
    for (let i = 0; i < active.length; i++) {
      const projectile = active[i]
      if (!projectile) continue
      const sprite = this.spriteAt(
        this.projectileSprites,
        this.projectileLayer,
        i,
        this.atlas.textures.projectile,
      )
      sprite.x = projectile.x
      sprite.y = projectile.y
      sprite.visible = true
    }
    this.shotsShown = this.hideFrom(
      this.projectileSprites,
      active.length,
      this.shotsShown,
    )
  }

  private syncParticles(sim: Sim): void {
    const active = sim.activeParticles
    for (let i = 0; i < active.length; i++) {
      const particle = active[i]
      if (!particle) continue
      const sprite = this.spriteAt(
        this.particleSprites,
        this.particleLayer,
        i,
        this.atlas.textures.particle,
      )
      sprite.x = particle.x
      sprite.y = particle.y
      sprite.alpha = particle.life / particle.maxLife
      sprite.visible = true
    }
    this.particlesShown = this.hideFrom(
      this.particleSprites,
      active.length,
      this.particlesShown,
    )
  }

  private spriteAt(
    sprites: Sprite[],
    layer: Container,
    index: number,
    texture?: (typeof this.atlas.textures)[keyof typeof this.atlas.textures],
  ): Sprite {
    let sprite = sprites[index]
    if (!sprite) {
      sprite = texture ? new Sprite(texture) : new Sprite()
      sprite.anchor.set(0.5)
      layer.addChild(sprite)
      sprites[index] = sprite
    }
    return sprite
  }

  /**
   * Hides only the sprites that were visible last frame and are not now.
   * Sweeping the whole pool every frame would cost the same whether one entity
   * is alive or four hundred — the exact overhead the active lists remove.
   */
  private hideFrom(sprites: Sprite[], usedCount: number, previousCount: number): number {
    for (let i = usedCount; i < previousCount; i++) {
      const sprite = sprites[i]
      if (sprite) sprite.visible = false
    }
    return usedCount
  }
}

/** Blends white toward `color` as `health` falls from 1 to 0. */
function mixToward(color: number, health: number): number {
  const t = 1 - Math.max(0, Math.min(1, health))
  const mix = (shift: number): number => {
    const target = (color >> shift) & 0xff
    return Math.round(0xff + (target - 0xff) * t) << shift
  }
  return mix(16) | mix(8) | mix(0)
}
