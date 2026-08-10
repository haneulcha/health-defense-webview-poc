/**
 * WebView-specific behaviour, isolated behind one module.
 *
 * Everything here is a thing that works fine in a desktop browser and breaks —
 * or lies — inside an Android WebView or WKWebView. Discovering these during
 * integration is what makes WebView ports overrun, so they are handled up front.
 */

export interface WebViewHostMessage {
  type: string
  [key: string]: unknown
}

export interface PlatformHooks {
  /** Fires when the page is backgrounded and the simulation must stop. */
  onPause: () => void
  onResume: () => void
  /** Fires when the GPU context is gone and the frame loop cannot continue. */
  onContextLost: () => void
}

/**
 * Seam for the healthcare product to drive game parameters from real user data
 * (steps, sleep, and so on). Deliberately unimplemented in this PoC — the point
 * is that the boundary exists and nothing downstream has to change when it does.
 */
export interface HealthParameterSource {
  /** Values in [0, 1] keyed by parameter name, or null when unavailable. */
  read(): Record<string, number> | null
}

export const NO_HEALTH_DATA: HealthParameterSource = { read: () => null }

export class WebViewPlatform {
  private paused = false
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: PlatformHooks,
  ) {
    this.blockNativeGestures()
    this.watchVisibility()
    this.watchContextLoss()
    this.unlockAudioOnFirstTouch()
  }

  get isPaused(): boolean {
    return this.paused
  }

  /**
   * Subscribes to messages from the React Native host.
   *
   * Listens on both `window` and `document`: react-native-webview delivers
   * host→web messages as a `message` event, and which target receives it has
   * differed between platforms and library versions. Listening to both is the
   * only way to get one code path that works on Android and iOS.
   *
   * @returns an unsubscribe function.
   */
  onHostMessage(handler: (message: WebViewHostMessage) => void): () => void {
    const listener = (event: Event): void => {
      const raw = (event as MessageEvent).data
      if (typeof raw !== 'string') return
      try {
        const parsed = JSON.parse(raw) as WebViewHostMessage
        if (parsed && typeof parsed.type === 'string') handler(parsed)
      } catch {
        // Not our message. Other libraries post to the same channel, so a
        // parse failure is routine rather than an error worth surfacing.
      }
    }
    window.addEventListener('message', listener)
    document.addEventListener('message', listener)

    const unsubscribe = (): void => {
      window.removeEventListener('message', listener)
      document.removeEventListener('message', listener)
    }
    this.disposers.push(unsubscribe)
    return unsubscribe
  }

  /**
   * Sends a message to the React Native host.
   * A no-op in a plain browser, which is exactly what we want during dev.
   */
  postToHost(message: WebViewHostMessage): void {
    const host = (
      window as unknown as {
        ReactNativeWebView?: { postMessage: (payload: string) => void }
      }
    ).ReactNativeWebView
    host?.postMessage(JSON.stringify(message))
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
  }

  /**
   * Pause on background rather than only clamping the resumed delta.
   *
   * rAF stops while the WebView is backgrounded, so the first frame back
   * carries the whole gap. Clamping keeps the physics from exploding, but
   * pausing is the behaviour a player expects and it also sidesteps most
   * context-loss-mid-game situations.
   */
  private watchVisibility(): void {
    const onVisibility = (): void => {
      if (document.hidden) this.setPaused(true)
      else this.setPaused(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    // iOS fires pagehide on app switch where visibilitychange can be unreliable.
    window.addEventListener('pagehide', () => this.setPaused(true))
    this.disposers.push(() =>
      document.removeEventListener('visibilitychange', onVisibility),
    )
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused) this.hooks.onPause()
    else this.hooks.onResume()
  }

  /**
   * Pixi's automatic context restoration is not dependable across WebView
   * versions. For a PoC the honest response is to stop and ask for a reload
   * rather than to render a half-restored scene and mislead the measurement.
   */
  private watchContextLoss(): void {
    const onLost = (event: Event): void => {
      event.preventDefault()
      this.setPaused(true)
      this.hooks.onContextLost()
    }
    this.canvas.addEventListener('webglcontextlost', onLost)
    this.disposers.push(() =>
      this.canvas.removeEventListener('webglcontextlost', onLost),
    )
  }

  /**
   * iOS refuses to start audio until a user gesture. Resuming a shared
   * AudioContext on the first touch is the standard unlock; doing it now means
   * sound can be added later without rediscovering this.
   */
  private unlockAudioOnFirstTouch(): void {
    const unlock = (): void => {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctor) {
        const context = new Ctor()
        void context.resume().catch(() => {
          /* Nothing to do: audio simply stays unavailable. */
        })
        audioContext = context
      }
      window.removeEventListener('pointerdown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
  }

  /** Stops Android overscroll glow and iOS rubber-band from eating drags. */
  private blockNativeGestures(): void {
    const prevent = (event: TouchEvent): void => event.preventDefault()
    document.body.addEventListener('touchmove', prevent, { passive: false })
    this.disposers.push(() =>
      document.body.removeEventListener('touchmove', prevent),
    )
  }
}

let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext | null {
  return audioContext
}
