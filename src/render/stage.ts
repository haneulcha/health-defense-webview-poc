import { Application, TextureSource } from 'pixi.js'
import { computeLayout, PLAYFIELD_H, PLAYFIELD_W, type Layout } from './layout'

/**
 * Owns the Pixi renderer and the low-resolution backing store.
 *
 * The canvas is exactly PLAYFIELD_W x PLAYFIELD_H device pixels — `resolution`
 * is pinned to 1 and `autoDensity` is off, so a 3x-DPR phone rasterises the
 * same number of pixels as a 1x one and the browser does the upscale for free
 * in the compositor. This is the single biggest lever for holding frame budget
 * on low-end hardware, and it makes a `resolution` cap unnecessary.
 */
export async function createStage(container: HTMLElement): Promise<Stage> {
  // Nearest filtering is a texture-level setting in Pixi v8. Setting the
  // default before any texture is created keeps pixel art crisp everywhere.
  TextureSource.defaultOptions.scaleMode = 'nearest'

  const app = new Application()
  await app.init({
    width: PLAYFIELD_W,
    height: PLAYFIELD_H,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    // Snaps sprite positions to whole pixels — v8 provides this precisely to
    // stop pixel art shimmering as things move sub-pixel.
    roundPixels: true,
    backgroundColor: 0x141a17,
    // WebGL, not WebGPU: WebGPU support across Android WebView versions is
    // uneven, and a silent backend difference would poison the perf numbers.
    preference: 'webgl',
    powerPreference: 'high-performance',
  })

  const canvas = app.canvas as HTMLCanvasElement
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.imageRendering = 'pixelated'
  canvas.style.touchAction = 'none'
  container.appendChild(canvas)

  return new Stage(app, canvas, container)
}

export class Stage {
  layout: Layout

  constructor(
    readonly app: Application,
    readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
  ) {
    this.layout = this.applyLayout()
  }

  /** Recomputes CSS size and position. Call on resize and orientation change. */
  applyLayout(): Layout {
    const layout = computeLayout({
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    })

    this.canvas.style.width = `${layout.playfieldCssWidth}px`
    this.canvas.style.height = `${layout.playfieldCssHeight}px`
    this.canvas.style.left = `${layout.playfieldCssLeft}px`
    this.container.style.setProperty('--hud-height', `${layout.hudCssHeight}px`)
    this.container.style.setProperty(
      '--playfield-height',
      `${layout.playfieldCssHeight}px`,
    )

    this.layout = layout
    return layout
  }

  /** The live WebGL context, when the renderer is WebGL. Used for draw counts. */
  get gl(): WebGL2RenderingContext | WebGLRenderingContext | null {
    const renderer = this.app.renderer as unknown as { gl?: WebGL2RenderingContext }
    return renderer.gl ?? null
  }
}
