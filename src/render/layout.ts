/**
 * Playfield sizing for a fixed low-resolution pixel-art backing store.
 *
 * The renderer draws into a PLAYFIELD_W x PLAYFIELD_H buffer and the browser
 * upscales it. That caps fill-rate no matter how dense the device's pixels are,
 * which is the whole reason a 3x-DPR low-end Android can hold frame budget.
 *
 * Scaling is computed in PHYSICAL pixels, not CSS pixels: an integer CSS scale
 * on a device with a fractional DPR (2.625, 2.75 are common on Android) still
 * lands the buffer on fractional physical pixels. Snapping in physical space is
 * the only way to get genuinely crisp pixel art — and even that is best-effort,
 * since WebView layout rounding is not something a page can promise.
 */

/** Internal pixels per grid tile. Also the pixel-art sprite size. */
export const TILE = 24

/**
 * 7 columns is a touch-target decision, not an aesthetic one. On a 360 CSS px
 * wide phone (the most common Android width) 7 columns gives 48 CSS px per
 * tile, exactly the 48dp minimum touch target. 9 columns would give 40 — below
 * the floor, on a game whose core interaction is tapping a cell.
 */
export const GRID_COLS = 7
export const GRID_ROWS = 13

export const PLAYFIELD_W = TILE * GRID_COLS // 168
export const PLAYFIELD_H = TILE * GRID_ROWS // 312

/** Space reserved below the playfield for the DOM HUD (tower buttons, status). */
export const MIN_HUD_CSS_PX = 96

/**
 * How much playfield area we are willing to give up to get a whole-number
 * scale. Above this ratio we snap and stay pixel-perfect; below it the
 * letterboxing would cost more than the crispness is worth, so we fill instead.
 */
export const INTEGER_SNAP_THRESHOLD = 0.9

export interface Viewport {
  cssWidth: number
  cssHeight: number
  devicePixelRatio: number
}

export interface Layout {
  /** Buffer-to-physical-pixel scale. A whole number when `pixelPerfect`. */
  physicalScale: number
  /** True when one buffer pixel maps to a whole number of device pixels. */
  pixelPerfect: boolean
  playfieldCssWidth: number
  playfieldCssHeight: number
  /** Left offset that centres the playfield (pillarbox on wide screens). */
  playfieldCssLeft: number
  /** Height of the HUD band below the playfield, in CSS px. */
  hudCssHeight: number
  /** CSS px per grid tile — the effective touch target size. */
  tileCssSize: number
}

export function computeLayout(viewport: Viewport): Layout {
  const { cssWidth, cssHeight, devicePixelRatio: dpr } = viewport

  const availableCssHeight = Math.max(cssHeight - MIN_HUD_CSS_PX, 1)
  const fitScale = Math.min(
    (cssWidth * dpr) / PLAYFIELD_W,
    (availableCssHeight * dpr) / PLAYFIELD_H,
  )

  const integerScale = Math.floor(fitScale)
  // `integerScale <= fitScale` also rejects the fitScale < 1 case, where
  // flooring to 1 would overflow the viewport instead of shrinking to fit.
  const snap =
    integerScale >= 1 && integerScale / fitScale >= INTEGER_SNAP_THRESHOLD

  const physicalScale = snap ? integerScale : fitScale

  const playfieldCssWidth = (PLAYFIELD_W * physicalScale) / dpr
  const playfieldCssHeight = (PLAYFIELD_H * physicalScale) / dpr

  return {
    physicalScale,
    pixelPerfect: snap,
    playfieldCssWidth,
    playfieldCssHeight,
    playfieldCssLeft: (cssWidth - playfieldCssWidth) / 2,
    hudCssHeight: cssHeight - playfieldCssHeight,
    tileCssSize: playfieldCssWidth / GRID_COLS,
  }
}

/** Converts a pointer position in CSS px to a grid cell, or null if outside. */
export function cssPointToCell(
  layout: Layout,
  cssX: number,
  cssY: number,
): { col: number; row: number } | null {
  const localX = cssX - layout.playfieldCssLeft
  if (localX < 0 || localX >= layout.playfieldCssWidth) return null
  if (cssY < 0 || cssY >= layout.playfieldCssHeight) return null

  const col = Math.floor((localX / layout.playfieldCssWidth) * GRID_COLS)
  const row = Math.floor((cssY / layout.playfieldCssHeight) * GRID_ROWS)
  return { col, row }
}
