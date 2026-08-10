import { GRID_COLS, GRID_ROWS, TILE } from '../render/layout'

/**
 * The single serpentine lane enemies walk, in grid coordinates.
 *
 * A hand-authored waypoint list rather than pathfinding: a fixed lane is what
 * classic tower defense wants, and it keeps the simulation free of any
 * per-frame search that would show up in the frame budget.
 */
const WAYPOINT_CELLS: ReadonlyArray<readonly [col: number, row: number]> = [
  [3, -1], // off-screen spawn so enemies walk in rather than pop in
  [3, 1],
  [5, 1],
  [5, 3],
  [1, 3],
  [1, 5],
  [5, 5],
  [5, 7],
  [1, 7],
  [1, 9],
  [3, 9],
  [3, 11], // the core sits here
]

export interface Point {
  x: number
  y: number
}

/** Waypoints in playfield pixels, at tile centres. */
export const WAYPOINTS: readonly Point[] = WAYPOINT_CELLS.map(([col, row]) => ({
  x: col * TILE + TILE / 2,
  y: row * TILE + TILE / 2,
}))

export const CORE_POSITION: Point = WAYPOINTS[WAYPOINTS.length - 1] as Point

/** Cells the lane runs through — towers may not be built on these. */
export const PATH_CELLS: ReadonlySet<string> = (() => {
  const cells = new Set<string>()
  for (let i = 0; i < WAYPOINT_CELLS.length - 1; i++) {
    const [fromCol, fromRow] = WAYPOINT_CELLS[i] as [number, number]
    const [toCol, toRow] = WAYPOINT_CELLS[i + 1] as [number, number]
    const stepCol = Math.sign(toCol - fromCol)
    const stepRow = Math.sign(toRow - fromRow)
    let col = fromCol
    let row = fromRow
    cells.add(`${col},${row}`)
    while (col !== toCol || row !== toRow) {
      col += stepCol
      row += stepRow
      cells.add(`${col},${row}`)
    }
  }
  return cells
})()

export function isBuildable(col: number, row: number): boolean {
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false
  return !PATH_CELLS.has(`${col},${row}`)
}

/** Total lane length in pixels, used to size enemy speeds against wave timing. */
export const PATH_LENGTH: number = (() => {
  let total = 0
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i] as Point
    const b = WAYPOINTS[i + 1] as Point
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
})()
