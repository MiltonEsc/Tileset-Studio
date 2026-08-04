const MASK_15_LAYOUT = [
  [4, 10, 13, 12],
  [9, 14, 15, 7],
  [2, 3, 11, 5],
  [0, 8, 6, 1],
]

const EMPTY = Object.freeze({ kind: 'empty' })
const rect = connections => ({ kind: 'rect', ...connections })
const TOPDOWN_17_LAYOUT = [
  [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
  [rect({ s: true }), rect({ e: true, s: true }), rect({ e: true, s: true, w: true }), rect({ s: true, w: true }), { kind: 'innerCorners' }],
  [rect({ n: true, s: true }), rect({ n: true, e: true, s: true }), rect({ n: true, e: true, s: true, w: true }), rect({ n: true, s: true, w: true }), EMPTY],
  [rect({ n: true }), rect({ n: true, e: true }), rect({ n: true, e: true, w: true }), rect({ n: true, w: true }), EMPTY],
  [rect({}), rect({ e: true }), rect({ e: true, w: true }), rect({ w: true }), EMPTY],
]

const BLOB_BITS = { tl: 0x01, t: 0x02, tr: 0x04, l: 0x08, r: 0x10, bl: 0x20, b: 0x40, br: 0x80 }
export const SPRITECOOK_BLOB47_MASKS = Object.freeze(Array.from({ length: 256 }, (_, raw) => raw).filter(raw => {
  const has = bit => (raw & bit) !== 0
  if (has(BLOB_BITS.tl) && !(has(BLOB_BITS.t) && has(BLOB_BITS.l))) return false
  if (has(BLOB_BITS.tr) && !(has(BLOB_BITS.t) && has(BLOB_BITS.r))) return false
  if (has(BLOB_BITS.bl) && !(has(BLOB_BITS.b) && has(BLOB_BITS.l))) return false
  if (has(BLOB_BITS.br) && !(has(BLOB_BITS.b) && has(BLOB_BITS.r))) return false
  return true
}))

const QUADRANTS = [
  { bit: 1, col: 0, row: 0 }, { bit: 2, col: 1, row: 0 },
  { bit: 4, col: 0, row: 1 }, { bit: 8, col: 1, row: 1 },
]
const OVERLAP = 0.09

export const SPRITECOOK_DEFAULTS = Object.freeze({
  layout: 'topdown-15', tileSize: 32, cornerRadius: 4,
  edgePadding: 2, edgeStyle: 'rough', edgeRoughness: 6, edgeFrequency: 5,
  elevationEdge: false, elevationDepth: 6,
  baseColor: '#73ad38', edgeColor: '#2f662d', shades: 4, edgeFade: 4,
  textureNoise: 10, fleckAmount: 6, seed: 31415,
  whiteBackground: true, showGrid: true, providerSize: false, pixelFlecks: true,
})

export function spriteCookSheetInfo(layout, tileSize = 32, showGrid = false) {
  const columns = layout === 'platform-47' ? 8 : layout === 'topdown-17' ? 5 : 4
  const rows = layout === 'platform-47' ? 6 : layout === 'topdown-17' ? 5 : 4
  const grid = showGrid ? 1 : 0
  const pieceLabel = layout === 'platform-47' ? '47+1-piece platform' : layout === 'topdown-17' ? '17-piece top-down' : '15-piece top-down'
  return { columns, rows, width: columns * tileSize + grid * (columns + 1), height: rows * tileSize + grid * (rows + 1), pieceLabel }
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = t => t * t * (3 - 2 * t)
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b)
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return lerp(b, a, h) - k * h * (1 - h)
}
const smax = (a, b, k) => -smin(-a, -b, k)
const hexToRgb = hex => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) })
function mixColor(a, b, t) {
  const n = clamp(t, 0, 1)
  return { r: Math.round(lerp(a.r, b.r, n)), g: Math.round(lerp(a.g, b.g, n)), b: Math.round(lerp(a.b, b.b, n)) }
}
const shadeColor = (c, n) => ({ r: clamp(Math.round(c.r + n), 0, 255), g: clamp(Math.round(c.g + n), 0, 255), b: clamp(Math.round(c.b + n), 0, 255) })

function hash2(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = smoothstep(x - xi), ty = smoothstep(y - yi)
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
}
function fbm(x, y, seed) {
  let total = 0, amp = 0.55, freq = 1, norm = 0
  for (let i = 0; i < 4; i++) { total += valueNoise(x * freq, y * freq, seed + i * 71) * amp; norm += amp; amp *= 0.5; freq *= 2 }
  return total / norm
}

function roundedBoxSdf(px, py, l, t, r, b, radius) {
  const cx = (l + r) * 0.5, cy = (t + b) * 0.5, hx = (r - l) * 0.5, hy = (b - t) * 0.5
  const rad = Math.min(radius, hx, hy), qx = Math.abs(px - cx) - (hx - rad), qy = Math.abs(py - cy) - (hy - rad)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad
}

function bitAt(col, row) { return col < 0 || col > 1 || row < 0 || row > 1 ? -1 : 1 << (row * 2 + col) }
function mask15Sdf(mask, x, y, size, radius, roughness) {
  const half = size * 0.5, overlap = OVERLAP * size, ext = radius + roughness + 1
  let dist = null
  for (const q of QUADRANTS) {
    if (!(mask & q.bit)) continue
    const l = q.col === 0 ? -ext : half - overlap, r = q.col === 1 ? size + ext : half + overlap
    const t = q.row === 0 ? -ext : half - overlap, b = q.row === 1 ? size + ext : half + overlap
    const d = roundedBoxSdf(x, y, l, t, r, b, radius)
    dist = dist === null ? d : smin(dist, d, radius)
  }
  return dist ?? 9999
}
function mask15VoidSdf(mask, x, y, size, radius) {
  const half = size * 0.5, overlap = OVERLAP * size, filled = bit => bit !== -1 && (mask & bit) !== 0
  let dist = Infinity
  for (const q of QUADRANTS) {
    if (mask & q.bit) continue
    const l = q.col === 0 ? 0 : filled(bitAt(q.col - 1, q.row)) ? half + overlap : half
    const r = q.col === 1 ? size : filled(bitAt(q.col + 1, q.row)) ? half - overlap : half
    const t = q.row === 0 ? 0 : filled(bitAt(q.col, q.row - 1)) ? half + overlap : half
    const b = q.row === 1 ? size : filled(bitAt(q.col, q.row + 1)) ? half - overlap : half
    dist = Math.min(dist, roundedBoxSdf(x, y, l, t, r, b, radius))
  }
  return dist
}

function rectPieceSdf(piece, x, y, size, radius, roughness, padding) {
  const ext = radius + roughness + 1, inset = clamp(Math.round(padding), 1, Math.max(1, Math.floor(size * 0.35)))
  return roundedBoxSdf(x, y, piece.w ? -ext : inset, piece.n ? -ext : inset, piece.e ? size + ext : size - inset, piece.s ? size + ext : size - inset, radius)
}
function innerCornersSdf(x, y, size, radius, roughness, padding) {
  const ext = radius + roughness + 1, base = roundedBoxSdf(x, y, -ext, -ext, size + ext, size + ext, radius)
  const notch = clamp(Math.round(padding), 1, Math.max(1, Math.floor(size * 0.35))), nr = Math.max(1, Math.min(radius, notch * 0.45))
  const cuts = [roundedBoxSdf(x, y, -ext, -ext, notch, notch, nr), roundedBoxSdf(x, y, size - notch, -ext, size + ext, notch, nr), roundedBoxSdf(x, y, -ext, size - notch, notch, size + ext, nr), roundedBoxSdf(x, y, size - notch, size - notch, size + ext, size + ext, nr)]
  return Math.max(base, -Math.min(...cuts))
}
function topdown17Sdf(piece, x, y, size, radius, roughness, padding) {
  if (!piece || piece.kind === 'empty') return 9999
  return piece.kind === 'innerCorners' ? innerCornersSdf(x, y, size, radius, roughness, padding) : rectPieceSdf(piece, x, y, size, radius, roughness, padding)
}

function blob47Sdf(mask, x, y, size, radius, roughness, padding) {
  const half = size * 0.5, overlap = Math.max(2, Math.floor(size * OVERLAP)), inset = clamp(Math.round(padding), 1, Math.max(1, Math.floor(size * 0.35))), ext = radius + roughness + 2
  const has = bit => (mask & bit) !== 0
  let dist = 9999
  const add = (l, t, r, b, notch) => {
    let d = roundedBoxSdf(x, y, l, t, r, b, radius)
    if (notch) d = smax(d, -roundedBoxSdf(x, y, ...notch, radius), radius)
    dist = Math.min(dist, d)
  }
  add(has(BLOB_BITS.l) ? -ext : inset, has(BLOB_BITS.t) ? -ext : inset, half + overlap, half + overlap, has(BLOB_BITS.l) && has(BLOB_BITS.t) && !has(BLOB_BITS.tl) ? [-ext, -ext, inset, inset] : null)
  add(half - overlap, has(BLOB_BITS.t) ? -ext : inset, has(BLOB_BITS.r) ? size + ext : size - inset, half + overlap, has(BLOB_BITS.r) && has(BLOB_BITS.t) && !has(BLOB_BITS.tr) ? [size - inset, -ext, size + ext, inset] : null)
  add(has(BLOB_BITS.l) ? -ext : inset, half - overlap, half + overlap, has(BLOB_BITS.b) ? size + ext : size - inset, has(BLOB_BITS.l) && has(BLOB_BITS.b) && !has(BLOB_BITS.bl) ? [-ext, size - inset, inset, size + ext] : null)
  add(half - overlap, half - overlap, has(BLOB_BITS.r) ? size + ext : size - inset, has(BLOB_BITS.b) ? size + ext : size - inset, has(BLOB_BITS.r) && has(BLOB_BITS.b) && !has(BLOB_BITS.br) ? [size - inset, size - inset, size + ext, size + ext] : null)
  return dist
}

function axisMapper(tile, grid) {
  if (!grid) return o => ({ cell: Math.floor(o / tile), local: o % tile })
  const period = tile + grid
  return o => { const m = o % period; return m < grid ? { cell: -1, local: 0 } : { cell: Math.floor(o / period), local: m - grid } }
}

export function renderSpriteCookSheet(input = {}) {
  const settings = { ...SPRITECOOK_DEFAULTS, ...input }
  const tile = settings.tileSize, grid = settings.showGrid ? 1 : 0
  const info = spriteCookSheetInfo(settings.layout, tile, settings.showGrid)
  const canvas = document.createElement('canvas'); canvas.width = info.width; canvas.height = info.height
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(info.width, info.height), data = image.data
  const roughness = settings.edgeStyle === 'clean' ? 0 : settings.edgeRoughness * (tile / 32)
  const radius = settings.cornerRadius * (tile / 32), padding = settings.edgePadding * (tile / 16)
  const edgeFade = settings.edgeFade * (tile / 32), elevationDepthSetting = settings.elevationDepth * (tile / 32)
  const bg = settings.whiteBackground ? { r: 255, g: 255, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }
  const baseColor = hexToRgb(settings.baseColor), edgeColor = hexToRgb(settings.edgeColor), shades = Math.max(2, Math.round(settings.shades))
  const ramp = Array.from({ length: shades }, (_, i) => mixColor(baseColor, edgeColor, i / (shades - 1)))
  const mapAxis = axisMapper(tile, grid), top17 = settings.layout === 'topdown-17', platform47 = settings.layout === 'platform-47'

  const sdfAt = (piece, mask15, blobMask, x, y) => top17
    ? topdown17Sdf(piece, x, y, tile, radius, roughness, padding)
    : platform47 ? blob47Sdf(blobMask, x, y, tile, radius, roughness, padding) : mask15Sdf(mask15, x, y, tile, radius, roughness)

  for (let py = 0; py < info.height; py++) {
    const ay = mapAxis(py)
    for (let px = 0; px < info.width; px++) {
      const ax = mapAxis(px), i = (py * info.width + px) * 4
      if (ax.cell < 0 || ay.cell < 0) { data[i + 3] = 255; continue }
      const col = ax.cell, row = ay.cell, piece = top17 ? TOPDOWN_17_LAYOUT[row][col] : null
      const platformIndex = platform47 ? row * info.columns + col : -1
      const blobMask = platform47 && platformIndex > 0 ? SPRITECOOK_BLOB47_MASKS[platformIndex - 1] : null
      const mask15 = !top17 && !platform47 ? MASK_15_LAYOUT[row][col] : 0
      const empty = (platform47 && platformIndex === 0) || (top17 && (!piece || piece.kind === 'empty')) || (!top17 && !platform47 && mask15 === 0)
      if (empty) { data[i] = bg.r; data[i + 1] = bg.g; data[i + 2] = bg.b; data[i + 3] = bg.a; continue }

      const x = ax.local + 0.5, y = ay.local + 0.5, cx = col * tile + ax.local, cy = row * tile + ay.local
      const sdf = sdfAt(piece, mask15, blobMask, x, y), pieceSeed = top17 || platform47 ? row * info.columns + col + 1 : mask15
      const edgeNoise = (fbm(cx / Math.max(1, settings.edgeFrequency), cy / Math.max(1, settings.edgeFrequency), settings.seed + pieceSeed * 113) - 0.5) * roughness
      const adjusted = sdf + edgeNoise
      if (adjusted > 0) {
        let elevationDepth = 0
        if (settings.elevationEdge) {
          for (let depth = 1; depth <= Math.max(1, Math.round(elevationDepthSetting)) && y - depth >= 0; depth++) {
            const sampleNoise = (fbm(cx / Math.max(1, settings.edgeFrequency), (cy - depth) / Math.max(1, settings.edgeFrequency), settings.seed + pieceSeed * 113) - 0.5) * roughness
            if (sdfAt(piece, mask15, blobMask, x, y - depth) + sampleNoise <= 0) { elevationDepth = depth; break }
          }
        }
        if (elevationDepth) {
          const amount = elevationDepth / Math.max(1, elevationDepthSetting), faceBase = mixColor(edgeColor, shadeColor(edgeColor, -42), amount)
          const face = shadeColor(faceBase, hash2(Math.floor(cx / 2), Math.floor(cy / 2), settings.seed + pieceSeed * 197) > 0.72 ? -12 : 0)
          data[i] = face.r; data[i + 1] = face.g; data[i + 2] = face.b; data[i + 3] = 255
        } else { data[i] = bg.r; data[i + 1] = bg.g; data[i + 2] = bg.b; data[i + 3] = bg.a }
        continue
      }

      const fleckSeed = hash2(Math.floor(cx / 2), Math.floor(cy / 2), settings.seed + pieceSeed * 17)
      const fleck = settings.pixelFlecks && settings.fleckAmount > 0 && fleckSeed > 1 - settings.fleckAmount / 250
      const depth = top17 || platform47 ? -(sdf + edgeNoise) : mask15VoidSdf(mask15, x, y, tile, radius) - edgeNoise
      let level = (edgeFade > 0 ? clamp(1 - depth / edgeFade, 0, 1) : 0) * (shades - 1)
      level += (fbm(cx / 4.2, cy / 4.2, settings.seed + 809) - 0.5) * (settings.textureNoise / 42) * 4
      if (fleck) level += hash2(cx, cy, settings.seed + 421) > 0.6 ? 2 : 1
      const color = ramp[clamp(Math.round(level), 0, shades - 1)]
      data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b; data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function scaleSpriteCookCanvas(source, width = 1024, height = 1024) {
  const target = document.createElement('canvas'); target.width = width; target.height = height
  const ctx = target.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 0, 0, width, height)
  return target
}
