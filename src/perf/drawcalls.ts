/**
 * Counts WebGL draw calls per frame.
 *
 * PixiJS v8 exposes no public draw-call counter, and the PixiJS DevTools
 * extension is desktop-Chrome only — useless inside the WebView that is the
 * whole point of this measurement. Wrapping the context's draw entry points is
 * the one approach that works everywhere the game actually runs.
 *
 * The count matters because the sprite atlas is supposed to collapse the entire
 * scene into a single batch. If this number climbs with entity count, batching
 * has silently broken and the perf table would be measuring the wrong thing.
 */
export interface DrawCallCounter {
  /** Draw calls issued since the last `nextFrame()`. */
  readonly lastFrame: number
  nextFrame(): void
  dispose(): void
}

type AnyGl = WebGLRenderingContext | WebGL2RenderingContext

const DRAW_METHODS = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
] as const

export function instrumentDrawCalls(gl: AnyGl | null): DrawCallCounter {
  if (!gl) {
    return { lastFrame: 0, nextFrame: () => {}, dispose: () => {} }
  }

  let current = 0
  let lastFrame = 0
  const originals = new Map<string, unknown>()
  const target = gl as unknown as Record<string, unknown>

  for (const method of DRAW_METHODS) {
    const original = target[method]
    if (typeof original !== 'function') continue
    originals.set(method, original)
    target[method] = function wrapped(this: unknown, ...args: unknown[]) {
      current++
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    }
  }

  return {
    get lastFrame() {
      return lastFrame
    },
    nextFrame() {
      lastFrame = current
      current = 0
    },
    dispose() {
      for (const [method, original] of originals) target[method] = original
      originals.clear()
    },
  }
}
