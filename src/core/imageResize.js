// Pure RGBA resize helpers (no DOM, no image-q). Extracted from aiTile.js so the
// tile pipeline AND the gallery (which must NOT drag image-q into the main bundle)
// can both downscale raw pixel buffers.

// Area-average resize. Each destination pixel averages its source box; for
// upscaling each maps to a single source pixel (nearest).
export function resizeRgbaArea(data, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(data)
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor((dy * srcH) / dstH)
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * srcH) / dstH))
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor((dx * srcW) / dstW)
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * srcW) / dstW))
      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          a += data[i + 3]
          count++
        }
      }
      const o = (dy * dstW + dx) * 4
      out[o] = Math.round(r / count)
      out[o + 1] = Math.round(g / count)
      out[o + 2] = Math.round(b / count)
      out[o + 3] = Math.round(a / count)
    }
  }
  return out
}

// Halve an RGBA image with a 2×2 box average (one mip level).
function halveRgba(data, w, h) {
  const ow = Math.max(1, w >> 1)
  const oh = Math.max(1, h >> 1)
  const out = new Uint8ClampedArray(ow * oh * 4)
  for (let y = 0; y < oh; y++) {
    const sy = y * 2
    for (let x = 0; x < ow; x++) {
      const sx = x * 2
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < 2; dy++) {
        const yy = Math.min(h - 1, sy + dy)
        for (let dx = 0; dx < 2; dx++) {
          const xx = Math.min(w - 1, sx + dx)
          const i = (yy * w + xx) * 4
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]
        }
      }
      const o = (y * ow + x) * 4
      out[o] = r >> 2; out[o + 1] = g >> 2; out[o + 2] = b >> 2; out[o + 3] = a >> 2
    }
  }
  return { data: out, width: ow, height: oh }
}

// High-quality downscale: progressively halve until within 2× of the target,
// then one area resize. Cleaner (less aliasing/noise) than a single giant box
// average straight from 1024 px, so more structure survives at 16/32/64 px.
export function downscaleRgba(data, sw, sh, dw, dh) {
  let cur = data, cw = sw, ch = sh
  while ((cw >> 1) >= dw && (ch >> 1) >= dh) {
    const half = halveRgba(cur, cw, ch)
    cur = half.data; cw = half.width; ch = half.height
  }
  return resizeRgbaArea(cur, cw, ch, dw, dh)
}
