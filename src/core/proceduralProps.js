// Procedural (parametric) prop generation — fences, stairs, pipes, ladders,
// railings, beams. Each draws a recognizable pixel-art shape onto a transparent
// RGBA buffer (alpha 0 background) at the prop's pixel size, from a few params +
// 3 colors (main / dark / light). Output plugs into the same asset editor as the
// AI props (`editor.loadPixels`), so it stays editable and saveable.
import { hexToRGBA } from './canvasUtils.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Safe filled rectangle (clamped to the buffer; never writes out of bounds).
function rect(data, W, H, x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h))
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255
    }
  }
}

// ── Drawers ──────────────────────────────────────────────────────────────────
function drawFence(d, W, H, c, p) {
  const t = clamp(p.thickness, 1, Math.max(1, Math.floor(W / 3)))
  // rails (behind)
  for (let r = 0; r < p.rails; r++) {
    const y = Math.round((r + 1) * H / (p.rails + 1)) - Math.floor(t / 2)
    rect(d, W, H, 0, y, W, t, c.main)
    rect(d, W, H, 0, y + t - 1, W, 1, c.dark)
  }
  // posts (front), with a light top cap + right-edge shadow
  for (let i = 0; i < p.posts; i++) {
    const x = p.posts === 1 ? (W - t) / 2 : Math.round(i * (W - t) / (p.posts - 1))
    rect(d, W, H, x, 1, t, H - 1, c.main)
    rect(d, W, H, x, 0, t, 1, c.light)
    rect(d, W, H, x + t - 1, 1, 1, H - 1, c.dark)
  }
}

function drawStairs(d, W, H, c, p) {
  const n = clamp(p.steps, 1, 16)
  const sw = W / n, sh = H / n
  for (let x = 0; x < W; x++) {
    let step = Math.floor(x / sw)
    if (p.mirror) step = n - 1 - step
    step = clamp(step, 0, n - 1)
    const top = Math.round(H - (step + 1) * sh)
    rect(d, W, H, x, top, 1, H - top, c.main)
    rect(d, W, H, x, top, 1, 1, c.light)           // tread highlight
  }
  rect(d, W, H, 0, H - 1, W, 1, c.dark)            // ground shadow line
}

function drawPipe(d, W, H, c, p) {
  // Draw along the longer axis; `vertical` swaps roles.
  const vertical = !!p.vertical
  const across = vertical ? W : H
  const dia = clamp(p.diameter, 3, across)
  const off = Math.round((across - dia) / 2)
  const lip = Math.max(1, Math.floor(dia / 4))
  const cap = Math.max(2, Math.floor((vertical ? H : W) * 0.12))
  const ext = Math.max(1, Math.floor(dia * 0.18))
  if (!vertical) {
    rect(d, W, H, 0, off, W, dia, c.main)
    rect(d, W, H, 0, off, W, lip, c.light)
    rect(d, W, H, 0, off + dia - lip, W, lip, c.dark)
    rect(d, W, H, 0, off - ext, cap, dia + 2 * ext, c.main)
    rect(d, W, H, W - cap, off - ext, cap, dia + 2 * ext, c.main)
    rect(d, W, H, 0, off - ext, cap, lip, c.light)
    rect(d, W, H, W - cap, off - ext, cap, lip, c.light)
  } else {
    rect(d, W, H, off, 0, dia, H, c.main)
    rect(d, W, H, off, 0, lip, H, c.light)
    rect(d, W, H, off + dia - lip, 0, lip, H, c.dark)
    rect(d, W, H, off - ext, 0, dia + 2 * ext, cap, c.main)
    rect(d, W, H, off - ext, H - cap, dia + 2 * ext, cap, c.main)
    rect(d, W, H, off - ext, 0, lip, cap, c.light)
    rect(d, W, H, off - ext, H - cap, lip, cap, c.light)
  }
}

function drawLadder(d, W, H, c, p) {
  const t = clamp(p.thickness, 1, Math.max(1, Math.floor(W / 4)))
  const inset = Math.max(0, Math.floor(W * 0.12))
  const rail = (x) => {
    rect(d, W, H, x, 0, t, H, c.main)
    rect(d, W, H, x, 0, 1, H, c.light)
    rect(d, W, H, x + t - 1, 0, 1, H, c.dark)
  }
  rail(inset)
  rail(W - inset - t)
  for (let r = 0; r < p.rungs; r++) {
    const y = Math.round((r + 0.5) * H / p.rungs) - Math.floor(t / 2)
    rect(d, W, H, inset, y, W - 2 * inset, t, c.main)
    rect(d, W, H, inset, y + t - 1, W - 2 * inset, 1, c.dark)
  }
}

function drawRailing(d, W, H, c, p) {
  const t = clamp(p.thickness, 1, Math.max(1, Math.floor(W / 4)))
  const capH = t + 1
  rect(d, W, H, 0, 0, W, capH, c.main)            // top rail (pasamanos)
  rect(d, W, H, 0, 0, W, 1, c.light)
  rect(d, W, H, 0, capH - 1, W, 1, c.dark)
  const midY = Math.round(H * 0.62)
  rect(d, W, H, 0, midY, W, t, c.main)            // mid rail
  rect(d, W, H, 0, midY + t - 1, W, 1, c.dark)
  for (let i = 0; i < p.posts; i++) {             // posts
    const x = p.posts === 1 ? (W - t) / 2 : Math.round(i * (W - t) / (p.posts - 1))
    rect(d, W, H, x, capH, t, H - capH, c.main)
    rect(d, W, H, x + t - 1, capH, 1, H - capH, c.dark)
  }
}

function drawBeam(d, W, H, c, p) {
  const dia = clamp(p.thickness, 3, H)
  const y = Math.round((H - dia) / 2)
  rect(d, W, H, 0, y, W, dia, c.main)
  rect(d, W, H, 0, y, W, 1, c.light)
  rect(d, W, H, 0, y + dia - 1, W, 1, c.dark)
  const b = Math.max(1, Math.floor(dia / 4))
  rect(d, W, H, Math.floor(W * 0.07), y + Math.floor(dia / 2) - 1, b, b, c.dark)
  rect(d, W, H, Math.floor(W * 0.90), y + Math.floor(dia / 2) - 1, b, b, c.dark)
}

// ── Type registry (params + default colours + drawer) ────────────────────────
export const PROP_TYPES = [
  {
    key: 'stairs', label: 'Stairs', draw: drawStairs,
    colors: { main: '#8a8f99', dark: '#4f545c', light: '#b9bec6' },
    params: [
      { key: 'steps', label: 'Steps', min: 2, max: 10, step: 1, default: 4 },
      { key: 'mirror', label: 'Mirror', min: 0, max: 1, step: 1, default: 0 },
    ],
  },
  {
    key: 'pipe', label: 'Pipe', draw: drawPipe,
    colors: { main: '#7f8c9a', dark: '#414c57', light: '#b6c2cd' },
    params: [
      { key: 'diameter', label: 'Diameter', min: 3, max: 24, step: 1, default: 8 },
      { key: 'vertical', label: 'Vertical', min: 0, max: 1, step: 1, default: 0 },
    ],
  },
  {
    key: 'fence', label: 'Fence', draw: drawFence,
    colors: { main: '#9c6b3f', dark: '#5e3a1e', light: '#c79a63' },
    params: [
      { key: 'posts', label: 'Posts', min: 2, max: 8, step: 1, default: 4 },
      { key: 'rails', label: 'Rails', min: 1, max: 3, step: 1, default: 2 },
      { key: 'thickness', label: 'Thickness', min: 1, max: 6, step: 1, default: 2 },
    ],
  },
  {
    key: 'ladder', label: 'Ladder', draw: drawLadder,
    colors: { main: '#9c6b3f', dark: '#5e3a1e', light: '#c79a63' },
    params: [
      { key: 'rungs', label: 'Rungs', min: 2, max: 10, step: 1, default: 5 },
      { key: 'thickness', label: 'Thickness', min: 1, max: 6, step: 1, default: 2 },
    ],
  },
  {
    key: 'railing', label: 'Railing', draw: drawRailing,
    colors: { main: '#7f8c9a', dark: '#414c57', light: '#b6c2cd' },
    params: [
      { key: 'posts', label: 'Posts', min: 2, max: 8, step: 1, default: 5 },
      { key: 'thickness', label: 'Thickness', min: 1, max: 6, step: 1, default: 2 },
    ],
  },
  {
    key: 'beam', label: 'Beam', draw: drawBeam,
    colors: { main: '#9c6b3f', dark: '#5e3a1e', light: '#c79a63' },
    params: [
      { key: 'thickness', label: 'Thickness', min: 3, max: 24, step: 1, default: 8 },
    ],
  },
]

const TYPE_BY_KEY = Object.fromEntries(PROP_TYPES.map(t => [t.key, t]))

export function defaultPropParams(type) {
  const specs = TYPE_BY_KEY[type]?.params || []
  return Object.fromEntries(specs.map(s => [s.key, s.default]))
}

export function sanitizePropParams(type, params = {}) {
  const specs = TYPE_BY_KEY[type]?.params
  if (!specs) return {}
  const out = {}
  for (const s of specs) {
    const raw = Number(params[s.key])
    const v = Number.isFinite(raw) ? raw : s.default
    out[s.key] = Math.round(Math.min(s.max, Math.max(s.min, v)))
  }
  return out
}

// Generates a transparent RGBA prop. `colors` are hex strings {main,dark,light}.
export function generateProp(type, pxW, pxH, colors, params) {
  const spec = TYPE_BY_KEY[type]
  const data = new Uint8ClampedArray(pxW * pxH * 4) // transparent (alpha 0)
  if (!spec) return data
  const c = {
    main: hexToRGBA(colors.main),
    dark: hexToRGBA(colors.dark),
    light: hexToRGBA(colors.light),
  }
  spec.draw(data, pxW, pxH, c, sanitizePropParams(type, params))
  return data
}
