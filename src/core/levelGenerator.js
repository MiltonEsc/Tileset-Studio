import { createGrid, gridGet } from './autotile.js'

// Seedable PRNG (mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF)
}

// ─── Cellular automata caves ────────────────────────────────────────────────
export function generateCaves(w, h, opts = {}) {
  const { density = 0.45, steps = 5, seed = randomSeed() } = opts
  const rng = mulberry32(seed)
  let grid = createGrid(w, h)

  // Random seed fill (edges forced solid)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      grid[y * w + x] = (edge || rng() < density) ? 1 : 0
    }
  }

  // Smoothing iterations
  for (let s = 0; s < steps; s++) {
    const next = createGrid(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let solid = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            solid += gridGet(grid, w, h, x + dx, y + dy, 1)
          }
        }
        next[y * w + x] = solid >= 5 ? 1 : 0
      }
    }
    grid = next
  }
  return grid
}

// ─── Value-noise islands ────────────────────────────────────────────────────
export function generateIslands(w, h, opts = {}) {
  const { threshold = 0.5, scale = 0.18, seed = randomSeed() } = opts
  const rng = mulberry32(seed)

  // Generate a coarse random lattice, then bilinear-interpolate
  const gw = Math.ceil(w * scale) + 2
  const gh = Math.ceil(h * scale) + 2
  const lattice = new Float32Array(gw * gh)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng()

  const smooth = (t) => t * t * (3 - 2 * t)
  const sample = (fx, fy) => {
    const gx = fx * scale, gy = fy * scale
    const x0 = Math.floor(gx), y0 = Math.floor(gy)
    const tx = smooth(gx - x0), ty = smooth(gy - y0)
    const a = lattice[y0 * gw + x0]
    const b = lattice[y0 * gw + x0 + 1]
    const c = lattice[(y0 + 1) * gw + x0]
    const d = lattice[(y0 + 1) * gw + x0 + 1]
    const top = a + (b - a) * tx
    const bot = c + (d - c) * tx
    return top + (bot - top) * ty
  }

  const grid = createGrid(w, h)
  const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Radial falloff so islands sit away from edges
      const dist = Math.hypot(x - cx, y - cy) / maxR
      const falloff = Math.max(0, 1 - dist * dist)
      const value = sample(x, y) * falloff
      grid[y * w + x] = value > threshold * 0.6 ? 1 : 0
    }
  }
  return grid
}

// ─── Floating platforms ─────────────────────────────────────────────────────
export function generatePlatforms(w, h, opts = {}) {
  const { rows = 5, minWidth = 3, maxWidth = 8, thickness = 2, seed = randomSeed() } = opts
  const rng = mulberry32(seed)
  const grid = createGrid(w, h)

  const gap = Math.floor(h / (rows + 1))
  for (let r = 1; r <= rows; r++) {
    const y = r * gap
    let x = 1 + Math.floor(rng() * 3)
    while (x < w - 1) {
      const pw = minWidth + Math.floor(rng() * (maxWidth - minWidth + 1))
      for (let px = x; px < Math.min(x + pw, w - 1); px++) {
        for (let py = y; py < Math.min(y + thickness, h); py++) {
          grid[py * w + px] = 1
        }
      }
      x += pw + 2 + Math.floor(rng() * 4)
    }
  }
  // Solid ground at the bottom
  for (let x = 0; x < w; x++) {
    for (let py = h - thickness; py < h; py++) {
      grid[py * w + x] = 1
    }
  }
  return grid
}

// ─── Rooms & corridors (dungeon) ────────────────────────────────────────────
export function generateRooms(w, h, opts = {}) {
  const { roomCount = 8, minSize = 3, maxSize = 7, seed = randomSeed() } = opts
  const rng = mulberry32(seed)
  // Start fully solid, carve rooms/corridors as empty, then invert so walls are solid
  const carved = createGrid(w, h, 0)
  const rooms = []

  for (let i = 0; i < roomCount; i++) {
    const rw = minSize + Math.floor(rng() * (maxSize - minSize + 1))
    const rh = minSize + Math.floor(rng() * (maxSize - minSize + 1))
    const rx = 1 + Math.floor(rng() * (w - rw - 2))
    const ry = 1 + Math.floor(rng() * (h - rh - 2))
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) carved[y * w + x] = 1
    }
    rooms.push([rx + (rw >> 1), ry + (rh >> 1)])
  }
  // Connect room centers with L-shaped corridors
  for (let i = 1; i < rooms.length; i++) {
    const [x0, y0] = rooms[i - 1]
    const [x1, y1] = rooms[i]
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carved[y0 * w + x] = 1
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carved[y * w + x1] = 1
  }
  // Walls = solid where NOT carved
  const grid = createGrid(w, h)
  for (let i = 0; i < grid.length; i++) grid[i] = carved[i] ? 0 : 1
  return grid
}

// ─── Plain random noise ─────────────────────────────────────────────────────
export function generateRandom(w, h, opts = {}) {
  const { density = 0.5, seed = randomSeed() } = opts
  const rng = mulberry32(seed)
  const grid = createGrid(w, h)
  for (let i = 0; i < grid.length; i++) grid[i] = rng() < density ? 1 : 0
  return grid
}

export const GENERATORS = {
  caves:     { label: 'Caves',     emoji: '🕳️', fn: generateCaves },
  islands:   { label: 'Islands',   emoji: '🏝️', fn: generateIslands },
  platforms: { label: 'Platforms', emoji: '🟫', fn: generatePlatforms },
  rooms:     { label: 'Dungeon',   emoji: '🏰', fn: generateRooms },
  random:    { label: 'Random',    emoji: '🎲', fn: generateRandom },
}

// UI/validation metadata for each generator's tunable parameters. The defaults
// match the generator function defaults above. `min`/`max` bound the sliders and
// are the clamp range for sanitizeParams. `seed` is handled separately.
export const GENERATOR_PARAMS = {
  caves: [
    { key: 'density', label: 'Density',   min: 0.30, max: 0.65, step: 0.01, default: 0.45 },
    { key: 'steps',   label: 'Smoothing', min: 0,    max: 8,    step: 1,    default: 5 },
  ],
  islands: [
    { key: 'threshold', label: 'Coverage', min: 0.20, max: 0.90, step: 0.01, default: 0.50 },
    { key: 'scale',     label: 'Scale',    min: 0.06, max: 0.40, step: 0.01, default: 0.18 },
  ],
  platforms: [
    { key: 'rows',      label: 'Rows',      min: 1, max: 12, step: 1, default: 5 },
    { key: 'minWidth',  label: 'Min width', min: 1, max: 12, step: 1, default: 3 },
    { key: 'maxWidth',  label: 'Max width', min: 2, max: 16, step: 1, default: 8 },
    { key: 'thickness', label: 'Thickness', min: 1, max: 6,  step: 1, default: 2 },
  ],
  rooms: [
    { key: 'roomCount', label: 'Rooms',    min: 1, max: 24, step: 1, default: 8 },
    { key: 'minSize',   label: 'Min size', min: 2, max: 10, step: 1, default: 3 },
    { key: 'maxSize',   label: 'Max size', min: 3, max: 14, step: 1, default: 7 },
  ],
  random: [
    { key: 'density', label: 'Density', min: 0.10, max: 0.90, step: 0.01, default: 0.5 },
  ],
}

// Pairs that must stay ordered (min ≤ max) or the generator math goes negative.
const ORDERED_PAIRS = { platforms: [['minWidth', 'maxWidth']], rooms: [['minSize', 'maxSize']] }

// The default params object for a generator (e.g. { density: 0.45, steps: 5 }).
export function defaultParams(type) {
  const specs = GENERATOR_PARAMS[type] || []
  return Object.fromEntries(specs.map(s => [s.key, s.default]))
}

// Clamps each param to its [min,max] spec, drops unknown keys, fills missing ones
// with defaults, and enforces min ≤ max pairs. Always returns a safe object.
export function sanitizeParams(type, params = {}) {
  const specs = GENERATOR_PARAMS[type]
  if (!specs) return {}
  const out = {}
  for (const s of specs) {
    const raw = Number(params[s.key])
    const v = Number.isFinite(raw) ? raw : s.default
    out[s.key] = Math.min(s.max, Math.max(s.min, v))
  }
  for (const [lo, hi] of ORDERED_PAIRS[type] || []) {
    if (out[lo] > out[hi]) out[hi] = out[lo]
  }
  return out
}
