export function getPixelIdx(x, y, width) {
  return (y * width + x) * 4
}

export function getPixelRGBA(data, x, y, width) {
  const i = getPixelIdx(x, y, width)
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

export function setPixelRGBA(data, x, y, width, r, g, b, a) {
  const i = getPixelIdx(x, y, width)
  data[i]     = r
  data[i + 1] = g
  data[i + 2] = b
  data[i + 3] = a
}

export function hexToRGBA(hex) {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
    255,
  ]
}

export function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

// Scanline flood fill — mutates data in place
export function floodFill(data, width, height, startX, startY, fillRGBA) {
  const target = getPixelRGBA(data, startX, startY, width)
  if (colorsEqual(target, fillRGBA)) return

  const stack = [[startX, startY]]
  const visited = new Uint8Array(width * height)

  while (stack.length > 0) {
    const [x, y] = stack.pop()
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const key = y * width + x
    if (visited[key]) continue
    const current = getPixelRGBA(data, x, y, width)
    if (!colorsEqual(current, target)) continue

    visited[key] = 1
    setPixelRGBA(data, x, y, width, ...fillRGBA)
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
}

// Darkens a rectangular region in an ImageData-like data array
export function darkenRegion(data, width, x0, y0, w, h, factor) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = getPixelIdx(x, y, width)
      if (data[i + 3] === 0) continue
      data[i]     = Math.round(data[i]     * factor)
      data[i + 1] = Math.round(data[i + 1] * factor)
      data[i + 2] = Math.round(data[i + 2] * factor)
    }
  }
}

// Blends a color into a rectangular region
export function tintRegion(data, width, x0, y0, w, h, r, g, b, alpha) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = getPixelIdx(x, y, width)
      if (data[i + 3] === 0) continue
      data[i]     = Math.round(data[i]     * (1 - alpha) + r * alpha)
      data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + g * alpha)
      data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + b * alpha)
    }
  }
}

// Fill a region with a solid RGBA color
export function fillRegion(data, width, x0, y0, w, h, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixelRGBA(data, x, y, width, r, g, b, a)
    }
  }
}

// Paint a square brush of size `brush` centered near (x,y)
export function paintBrush(data, width, height, x, y, brush, rgba) {
  const half = Math.floor(brush / 2)
  for (let dy = 0; dy < brush; dy++) {
    for (let dx = 0; dx < brush; dx++) {
      const px = x - half + dx
      const py = y - half + dy
      if (px < 0 || px >= width || py < 0 || py >= height) continue
      setPixelRGBA(data, px, py, width, ...rgba)
    }
  }
}

// Moves the whole pixel buffer by dx/dy, clipping anything outside the canvas.
export function translatePixels(data, width, height, dx, dy) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const ty = y + dy
    if (ty < 0 || ty >= height) continue
    for (let x = 0; x < width; x++) {
      const tx = x + dx
      if (tx < 0 || tx >= width) continue
      const src = getPixelIdx(x, y, width)
      const dst = getPixelIdx(tx, ty, width)
      out[dst] = data[src]
      out[dst + 1] = data[src + 1]
      out[dst + 2] = data[src + 2]
      out[dst + 3] = data[src + 3]
    }
  }
  return out
}

// Bresenham walk: calls visit(x, y) for every cell on the line from (x0,y0) to
// (x1,y1), endpoints included. Used to fill the gaps between mouse-move events
// so fast strokes don't skip pixels.
export function forEachCellOnLine(x0, y0, x1, y1, visit) {
  let x = x0, y = y0
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (true) {
    visit(x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx)  { err += dx; y += sy }
  }
}

// Bresenham line, painting a brush at each step
export function drawLineInto(data, width, height, x0, y0, x1, y1, brush, rgba) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0, y = y0
  while (true) {
    paintBrush(data, width, height, x, y, brush, rgba)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx)  { err += dx; y += sy }
  }
}

// Rectangle: outline or filled
export function drawRectInto(data, width, height, x0, y0, x1, y1, brush, rgba, filled) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1)
  if (filled) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) paintBrush(data, width, height, x, y, brush, rgba)
    }
  } else {
    for (let x = minX; x <= maxX; x++) {
      paintBrush(data, width, height, x, minY, brush, rgba)
      paintBrush(data, width, height, x, maxY, brush, rgba)
    }
    for (let y = minY; y <= maxY; y++) {
      paintBrush(data, width, height, minX, y, brush, rgba)
      paintBrush(data, width, height, maxX, y, brush, rgba)
    }
  }
}

// Binarizes alpha: pixels with alpha >= threshold become fully opaque (255),
// everything below becomes fully transparent (0). Removes the semi-transparent
// edge "halo" so a sprite is solid with hard edges.
export function solidifyAlpha(data, threshold) {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] >= threshold ? 255 : 0
  }
}

// Bayer 4x4 ordered dither matrix (normalized 0..1)
const BAYER_4x4 = [
  [ 0, 8, 2,10],
  [12, 4,14, 6],
  [ 3,11, 1, 9],
  [15, 7,13, 5],
]

export function applyOrderedDither(data, width, height, secondaryRGBA, strength) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const threshold = BAYER_4x4[y % 4][x % 4] / 16.0
      if (threshold < strength) {
        const i = getPixelIdx(x, y, width)
        if (data[i + 3] === 0) continue
        data[i]     = secondaryRGBA[0]
        data[i + 1] = secondaryRGBA[1]
        data[i + 2] = secondaryRGBA[2]
      }
    }
  }
}
