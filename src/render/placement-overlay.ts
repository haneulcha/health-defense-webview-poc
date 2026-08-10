import { Container, Graphics } from 'pixi.js'
import type { Sim, Tower } from '../core/sim'
import { towerRange } from '../core/sim'
import { isBuildable } from '../core/path'
import { GRID_COLS, GRID_ROWS, TILE } from './layout'

/**
 * The visual half of tower placement: which cells are legal, what a tower
 * covers, and how far each tower has been upgraded.
 *
 * Redrawn only when the selection or the tower list changes, never per frame.
 * Graphics rebuilds are the expensive kind of Pixi work, and none of this moves.
 */

export type Selection =
  | { kind: 'none' }
  | { kind: 'build'; towerId: string }
  | { kind: 'tower'; col: number; row: number }

export class PlacementOverlay {
  readonly container = new Container()

  private readonly cells = new Graphics()
  private readonly range = new Graphics()
  private readonly pips = new Graphics()
  private readonly hint = new Graphics()

  /** Pulses the suggested first cell until the player builds anything. */
  private hintCell: { col: number; row: number } | null = null
  private hintPhase = 0

  constructor() {
    this.container.addChild(this.range, this.cells, this.hint, this.pips)
  }

  setHintCell(cell: { col: number; row: number } | null): void {
    this.hintCell = cell
    if (!cell) this.hint.clear()
  }

  /** Cheap per-frame work: only the onboarding pulse animates. */
  tick(deltaSeconds: number): void {
    if (!this.hintCell) return
    this.hintPhase = (this.hintPhase + deltaSeconds) % 1.2
    const t = Math.abs(Math.sin((this.hintPhase / 1.2) * Math.PI))

    this.hint.clear()
    this.hint
      .rect(
        this.hintCell.col * TILE + 1,
        this.hintCell.row * TILE + 1,
        TILE - 2,
        TILE - 2,
      )
      .stroke({ color: 0xffe9a8, width: 1, alpha: 0.35 + t * 0.65 })
  }

  redraw(sim: Sim, selection: Selection): void {
    this.drawCandidateCells(sim, selection)
    this.drawRange(sim, selection)
    this.drawLevelPips(sim)
  }

  private drawCandidateCells(sim: Sim, selection: Selection): void {
    this.cells.clear()
    if (selection.kind !== 'build') return

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!isBuildable(col, row) || sim.towerAt(col, row)) continue
        // Affordable cells read as inviting; unaffordable ones stay visible but
        // muted, so the player can see where they *could* build once they save.
        const affordable = sim.canPlace(col, row, selection.towerId)
        this.cells
          .rect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4)
          .fill({ color: affordable ? 0x7ee08a : 0x5a6470, alpha: affordable ? 0.28 : 0.12 })
      }
    }
  }

  private drawRange(sim: Sim, selection: Selection): void {
    this.range.clear()
    const tower = this.selectedTower(sim, selection)
    if (!tower) return

    this.range
      .circle(tower.x, tower.y, towerRange(tower))
      .fill({ color: 0x8fd3ff, alpha: 0.12 })
      .stroke({ color: 0x8fd3ff, width: 1, alpha: 0.5 })
  }

  private selectedTower(sim: Sim, selection: Selection): Tower | null {
    return selection.kind === 'tower' ? sim.towerAt(selection.col, selection.row) : null
  }

  /**
   * Level shown as pips under each tower rather than as different sprites:
   * three sprites per tower type is art we do not have, and a player needs to
   * read "which of my towers is still level 1" at a glance while a wave runs.
   */
  private drawLevelPips(sim: Sim): void {
    this.pips.clear()
    for (const tower of sim.towers) {
      if (tower.level <= 1) continue
      for (let i = 0; i < tower.level - 1; i++) {
        this.pips
          .rect(tower.x - 3 + i * 4, tower.y + TILE / 2 - 4, 2, 2)
          .fill({ color: 0xffe9a8 })
      }
    }
  }
}
