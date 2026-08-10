import { Sim, STEP_SECONDS, MAX_CATCHUP_STEPS } from './core/sim'
import { cssPointToCell } from './render/layout'
import { PlacementOverlay, type Selection } from './render/placement-overlay'
import { Scene } from './render/scene'
import type { Stage } from './render/stage'
import { GameHud, ResultPanel } from './ui/game-hud'

/**
 * Wires the simulation, the renderer, and the HUD together, and owns the one
 * piece of state that belongs to neither: what the player currently has
 * selected.
 */

/** Cell the onboarding pulse points at — good coverage of the opening bend. */
const OPENING_HINT_CELL = { col: 2, row: 1 }

/** How often the HUD and overlay refresh. Fast enough to feel live, rare
 * enough that rebuilding Graphics never lands in the frame budget. */
const UI_REFRESH_MS = 150

export class Game {
  private sim: Sim
  private selection: Selection = { kind: 'none' }
  private speed = 1
  private accumulator = 0
  private sinceUiRefresh = 0

  private readonly overlay = new PlacementOverlay()
  private readonly hud: GameHud
  private readonly result: ResultPanel

  constructor(
    private readonly stage: Stage,
    private readonly scene: Scene,
    hudParent: HTMLElement,
  ) {
    this.sim = new Sim({ seed: 20260810 })
    this.scene.attachOverlay(this.overlay.container)

    this.hud = new GameHud(hudParent, {
      onSelectTower: (towerId) => this.selectTowerType(towerId),
      onUpgrade: () => this.upgradeSelected(),
      onSell: () => this.sellSelected(),
      onStartWave: () => this.sim.waves.startWave(),
      onToggleSpeed: () => (this.speed = this.speed === 1 ? 2 : 1),
      onRestart: () => this.restart(),
    })
    this.result = new ResultPanel(hudParent, () => this.restart())

    stage.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    this.refreshUi()
  }

  /** @param deltaMs wall-clock since the previous frame. */
  advance(deltaMs: number): void {
    this.accumulator += (deltaMs / 1000) * this.speed

    let steps = 0
    const budget = MAX_CATCHUP_STEPS * this.speed
    while (this.accumulator >= STEP_SECONDS && steps < budget) {
      this.sim.step()
      this.accumulator -= STEP_SECONDS
      steps++
    }
    // Drop the backlog rather than carrying it: a frame that missed by half a
    // second must not spend the next second catching up and missing every one.
    if (this.accumulator > STEP_SECONDS * budget) this.accumulator = 0

    this.scene.sync(this.sim)
    this.overlay.tick(deltaMs / 1000)

    this.sinceUiRefresh += deltaMs
    if (this.sinceUiRefresh >= UI_REFRESH_MS) {
      this.sinceUiRefresh = 0
      this.refreshUi()
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.sim.isOver) return
    const rect = this.stage.canvas.getBoundingClientRect()
    const cell = cssPointToCell(
      this.stage.layout,
      event.clientX - rect.left + this.stage.layout.playfieldCssLeft,
      event.clientY - rect.top,
    )
    if (!cell) return

    const existing = this.sim.towerAt(cell.col, cell.row)
    if (existing) {
      // Tapping a tower always inspects it, even mid-build. Placing on top of
      // one is impossible anyway, so the tap would otherwise do nothing.
      this.selection = { kind: 'tower', col: cell.col, row: cell.row }
    } else if (this.selection.kind === 'build') {
      // Selection survives a successful placement so several towers can be
      // dropped in a row without going back to the button each time.
      this.sim.placeTower(cell.col, cell.row, this.selection.towerId)
    } else {
      this.selection = { kind: 'none' }
    }
    this.refreshUi()
  }

  private selectTowerType(towerId: string): void {
    this.selection =
      this.selection.kind === 'build' && this.selection.towerId === towerId
        ? { kind: 'none' }
        : { kind: 'build', towerId }
    this.refreshUi()
  }

  private upgradeSelected(): void {
    if (this.selection.kind !== 'tower') return
    this.sim.upgradeTower(this.selection.col, this.selection.row)
    this.refreshUi()
  }

  private sellSelected(): void {
    if (this.selection.kind !== 'tower') return
    this.sim.sellTower(this.selection.col, this.selection.row)
    this.selection = { kind: 'none' }
    this.refreshUi()
  }

  private restart(): void {
    this.sim = new Sim({ seed: 20260810 })
    this.selection = { kind: 'none' }
    this.speed = 1
    this.accumulator = 0
    this.scene.reset()
    this.refreshUi()
  }

  private refreshUi(): void {
    this.overlay.setHintCell(
      this.sim.towers.length === 0 && this.sim.waves.waveIndex === 0
        ? OPENING_HINT_CELL
        : null,
    )
    this.overlay.redraw(this.sim, this.selection)
    this.hud.update(this.sim, this.selection, this.speed)
    this.result.update(this.sim)
  }
}
