import { describe, expect, it } from 'vitest'
import {
  computeLayout,
  cssPointToCell,
  GRID_COLS,
  GRID_ROWS,
  MIN_HUD_CSS_PX,
  PLAYFIELD_H,
  PLAYFIELD_W,
  type Viewport,
} from './layout'

/** Viewports we actually expect to run on, in CSS px plus real DPR. */
const DEVICES = {
  /** The most common Android viewport, and the one the budget is pinned to. */
  androidCommon: { cssWidth: 360, cssHeight: 800, devicePixelRatio: 3 },
  /** Fractional DPR — where "integer CSS scale" silently stops being crisp. */
  androidFractionalDpr: { cssWidth: 411, cssHeight: 914, devicePixelRatio: 2.625 },
  iPhone14Pro: { cssWidth: 393, cssHeight: 852, devicePixelRatio: 3 },
  /** Short screen: the case where snapping to an integer costs too much. */
  iPhoneSE: { cssWidth: 375, cssHeight: 667, devicePixelRatio: 2 },
} satisfies Record<string, Viewport>

describe('computeLayout', () => {
  it('keeps tiles at or above the 48dp minimum touch target on common Android', () => {
    const layout = computeLayout(DEVICES.androidCommon)
    expect(layout.tileCssSize).toBeGreaterThanOrEqual(48)
  })

  it('snaps to a whole physical scale when the cost is small', () => {
    for (const name of ['androidCommon', 'androidFractionalDpr', 'iPhone14Pro'] as const) {
      const layout = computeLayout(DEVICES[name])
      expect(layout.pixelPerfect, name).toBe(true)
      expect(Number.isInteger(layout.physicalScale), name).toBe(true)
    }
  })

  it('fills instead of snapping when an integer scale would waste too much space', () => {
    const layout = computeLayout(DEVICES.iPhoneSE)
    expect(layout.pixelPerfect).toBe(false)
    // Snapping down to 3 would have shrunk the playfield by ~18%.
    expect(layout.physicalScale).toBeGreaterThan(3)
    expect(layout.physicalScale).toBeLessThan(4)
  })

  it('always leaves at least the reserved HUD band', () => {
    for (const [name, viewport] of Object.entries(DEVICES)) {
      const layout = computeLayout(viewport)
      expect(layout.hudCssHeight, name).toBeGreaterThanOrEqual(MIN_HUD_CSS_PX - 0.01)
    }
  })

  it('never overflows the viewport', () => {
    for (const [name, viewport] of Object.entries(DEVICES)) {
      const layout = computeLayout(viewport)
      expect(layout.playfieldCssWidth, name).toBeLessThanOrEqual(viewport.cssWidth + 0.01)
      expect(layout.playfieldCssLeft, name).toBeGreaterThanOrEqual(-0.01)
    }
  })

  it('centres the playfield horizontally', () => {
    const layout = computeLayout(DEVICES.androidCommon)
    expect(layout.playfieldCssLeft * 2 + layout.playfieldCssWidth).toBeCloseTo(360)
  })

  it('maps the buffer to whole device pixels when pixel perfect', () => {
    const viewport = DEVICES.androidCommon
    const layout = computeLayout(viewport)
    const physicalWidth = layout.playfieldCssWidth * viewport.devicePixelRatio
    expect(physicalWidth / PLAYFIELD_W).toBeCloseTo(layout.physicalScale)
    expect(Number.isInteger(Math.round(physicalWidth))).toBe(true)
  })

  it('degrades to a smaller scale rather than clipping on a tiny viewport', () => {
    const layout = computeLayout({ cssWidth: 120, cssHeight: 200, devicePixelRatio: 1 })
    expect(layout.playfieldCssWidth).toBeLessThanOrEqual(120)
    expect(layout.physicalScale).toBeGreaterThan(0)
  })
})

describe('cssPointToCell', () => {
  const layout = computeLayout(DEVICES.androidCommon)

  it('maps the playfield corners to the corner cells', () => {
    const topLeft = cssPointToCell(layout, layout.playfieldCssLeft, 0)
    expect(topLeft).toEqual({ col: 0, row: 0 })

    const bottomRight = cssPointToCell(
      layout,
      layout.playfieldCssLeft + layout.playfieldCssWidth - 0.5,
      layout.playfieldCssHeight - 0.5,
    )
    expect(bottomRight).toEqual({ col: GRID_COLS - 1, row: GRID_ROWS - 1 })
  })

  it('rejects points in the pillarbox and the HUD band', () => {
    expect(cssPointToCell(layout, layout.playfieldCssLeft - 1, 10)).toBeNull()
    expect(cssPointToCell(layout, 180, layout.playfieldCssHeight + 1)).toBeNull()
  })

  it('covers every cell exactly once across the playfield', () => {
    const seen = new Set<string>()
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cssX =
          layout.playfieldCssLeft +
          ((col + 0.5) / GRID_COLS) * layout.playfieldCssWidth
        const cssY = ((row + 0.5) / GRID_ROWS) * layout.playfieldCssHeight
        const cell = cssPointToCell(layout, cssX, cssY)
        expect(cell).toEqual({ col, row })
        seen.add(`${col},${row}`)
      }
    }
    expect(seen.size).toBe(GRID_COLS * GRID_ROWS)
  })
})

describe('playfield constants', () => {
  it('matches the grid dimensions', () => {
    expect(PLAYFIELD_W).toBe(168)
    expect(PLAYFIELD_H).toBe(312)
  })

  it('reserves enough HUD height for the controls it has to hold', () => {
    // Derived from what the HUD contains, not guessed. The first value was 96
    // and it clipped the tower buttons inside the RN WebView, where the
    // viewport is shorter than in a browser. Unit tests cannot measure CSS, so
    // the derivation lives here to fail loudly if someone trims it again.
    const TOWER_BUTTON = 44 // minimum comfortable touch target
    const STATUS_ROW = 24
    const MESSAGE_ROW = 15
    const GAPS_AND_PADDING = 20

    expect(MIN_HUD_CSS_PX).toBeGreaterThanOrEqual(
      TOWER_BUTTON + STATUS_ROW + MESSAGE_ROW + GAPS_AND_PADDING,
    )
  })
})
