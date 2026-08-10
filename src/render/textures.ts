import { CanvasSource, Rectangle, Texture } from 'pixi.js'

/**
 * Every sprite is drawn into one canvas at build-up time and shared as a single
 * TextureSource. That is what lets PixiJS batch the whole scene into one draw
 * call — the difference between "510 sprites" being free and being 510 state
 * changes on a low-end GPU.
 *
 * Nothing is loaded over the network. The production build is a single inlined
 * HTML file for the RN WebView, so an asset directory would have to be resolved
 * against `file:///android_asset/...` on Android and a different bundle path on
 * iOS. Generating pixels in code removes that whole class of problem.
 *
 * These are placeholder shapes, not final art. Sprite keys live in `content/`,
 * so hand-drawn art can replace them without touching the render path.
 */

export type SpriteKey =
  | 'tile_ground'
  | 'tile_path'
  | 'enemy_calorie'
  | 'enemy_fat'
  | 'enemy_snack'
  | 'enemy_debt'
  | 'tower_cardio'
  | 'tower_veggie'
  | 'tower_water'
  | 'tower_sleep'
  | 'projectile'
  | 'particle'
  | 'core'

/** Transparent. */
const NONE = -1

/** 1px gutter stops neighbouring frames bleeding in when a sprite is rotated. */
const PADDING = 1

interface SpriteSpec {
  key: SpriteKey
  size: number
  /** Returns a 0xRRGGBB colour for the pixel, or NONE for transparent. */
  paint: (x: number, y: number, size: number) => number
}

/** Squared distance from a pixel's centre to the sprite's centre. */
function distSq(x: number, y: number, size: number): number {
  const c = (size - 1) / 2
  return (x - c) * (x - c) + (y - c) * (y - c)
}

/**
 * A round creature: darker rim, flat body, a lighter cap for a light source,
 * and two eyes. Deliberately readable at 16px rather than detailed.
 */
function blob(body: number, rim: number, highlight: number) {
  return (x: number, y: number, size: number): number => {
    const radius = size / 2 - 0.5
    const d = Math.sqrt(distSq(x, y, size))
    if (d > radius) return NONE
    if (d > radius - 1) return rim

    const eyeY = Math.round(size * 0.42)
    const eyeLeft = Math.round(size * 0.32)
    const eyeRight = Math.round(size * 0.65)
    if (y === eyeY && (x === eyeLeft || x === eyeRight)) return 0x1a1420

    if (y < size * 0.34 && d < radius - 2) return highlight
    return body
  }
}

/** A tower: a wide plinth with a narrower turret block above it. */
function tower(body: number, rim: number, accent: number) {
  return (x: number, y: number, size: number): number => {
    const baseTop = Math.round(size * 0.58)
    const inset = Math.round(size * 0.22)

    const inBase = y >= baseTop && x >= 1 && x < size - 1
    const inTurret = y < baseTop && y >= 2 && x >= inset && x < size - inset
    if (!inBase && !inTurret) return NONE

    const onEdge = inBase
      ? y === baseTop || x === 1 || x === size - 2 || y === size - 1
      : y === 2 || x === inset || x === size - inset - 1
    if (onEdge) return rim

    if (inTurret && y >= 4 && y <= 6) return accent
    return body
  }
}

/** Ground and path tiles: flat fill with a deterministic dither for texture. */
function tile(base: number, speck: number, edge: number | null) {
  return (x: number, y: number, _size: number): number => {
    if (edge !== null && (x === 0 || y === 0)) return edge
    // Fixed pattern rather than a PRNG so the atlas is byte-identical per build.
    if ((x * 7 + y * 13) % 11 === 0) return speck
    return base
  }
}

function disc(color: number, rim: number) {
  return (x: number, y: number, size: number): number => {
    const radius = size / 2 - 0.5
    const d = Math.sqrt(distSq(x, y, size))
    if (d > radius) return NONE
    return d > radius - 1 ? rim : color
  }
}

/** The thing being defended: a chunky pixel heart. */
function heart(x: number, y: number, size: number): number {
  const nx = (x + 0.5) / size
  const ny = (y + 0.5) / size
  // Two lobes on top, a triangle below.
  const inLobes =
    ny < 0.55 &&
    (Math.hypot(nx - 0.3, ny - 0.34) < 0.26 || Math.hypot(nx - 0.7, ny - 0.34) < 0.26)
  const inPoint = ny >= 0.4 && Math.abs(nx - 0.5) < 0.52 * (1 - (ny - 0.4) / 0.55)
  if (!inLobes && !inPoint) return NONE
  if (ny < 0.36 && nx > 0.2 && nx < 0.42) return 0xff9aa8
  return 0xe23d5a
}

const SPECS: SpriteSpec[] = [
  { key: 'tile_ground', size: 24, paint: tile(0x2b3a2e, 0x35473a, 0x24322a) },
  { key: 'tile_path', size: 24, paint: tile(0x4a4034, 0x574c3d, 0x3d3529) },
  { key: 'enemy_calorie', size: 16, paint: blob(0xe8a33d, 0x8f5f1c, 0xf6c877) },
  { key: 'enemy_fat', size: 16, paint: blob(0xf0e6c8, 0x9a8a63, 0xfffaea) },
  { key: 'enemy_snack', size: 16, paint: blob(0xe0556b, 0x8c2b3c, 0xf58a9a) },
  { key: 'enemy_debt', size: 16, paint: blob(0x6b5aa6, 0x3b2f63, 0x9c8ad4) },
  { key: 'tower_cardio', size: 20, paint: tower(0x5ba8d6, 0x2f5f80, 0xa8e0ff) },
  { key: 'tower_veggie', size: 20, paint: tower(0x6fbf5a, 0x36702c, 0xb6f0a4) },
  { key: 'tower_water', size: 20, paint: tower(0x4fd0d6, 0x27767a, 0xa9f2f5) },
  { key: 'tower_sleep', size: 20, paint: tower(0x8d7ce0, 0x483c85, 0xc9befb) },
  { key: 'projectile', size: 5, paint: disc(0xffe9a8, 0xd6a63c) },
  { key: 'particle', size: 3, paint: disc(0xffffff, 0xffffff) },
  { key: 'core', size: 24, paint: heart },
]

export interface Atlas {
  textures: Record<SpriteKey, Texture>
  /** The shared source — one of these means one draw call for the whole scene. */
  source: CanvasSource
  canvasWidth: number
  canvasHeight: number
}

export function buildAtlas(): Atlas {
  const height = Math.max(...SPECS.map((s) => s.size)) + PADDING * 2
  let width = 0
  for (const spec of SPECS) width += spec.size + PADDING * 2

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable — cannot build sprite atlas')

  const frames = new Map<SpriteKey, Rectangle>()
  let cursor = 0
  for (const spec of SPECS) {
    const originX = cursor + PADDING
    for (let y = 0; y < spec.size; y++) {
      for (let x = 0; x < spec.size; x++) {
        const color = spec.paint(x, y, spec.size)
        if (color === NONE) continue
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
        ctx.fillRect(originX + x, PADDING + y, 1, 1)
      }
    }
    frames.set(spec.key, new Rectangle(originX, PADDING, spec.size, spec.size))
    cursor += spec.size + PADDING * 2
  }

  const source = new CanvasSource({
    resource: canvas,
    // Nearest is a texture-level setting in Pixi v8, not an Application option.
    scaleMode: 'nearest',
    // The atlas is already at final resolution; mips would blur it and waste memory.
    autoGenerateMipmaps: false,
  })

  const textures = {} as Record<SpriteKey, Texture>
  for (const [key, frame] of frames) {
    textures[key] = new Texture({ source, frame })
  }

  return { textures, source, canvasWidth: width, canvasHeight: height }
}
