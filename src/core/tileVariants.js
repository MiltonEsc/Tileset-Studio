// Tile anti-repetition: the "fill" tile (fully-interior, all neighbours present)
// repeats across big solid areas and shows the grid. We derive a few VARIANTS of
// just that tile and pick one per cell with a deterministic hash, breaking the
// repetition. Variants only shuffle INTERIOR pixels (border row/col untouched) so
// seamless tiling is preserved and no new colours are introduced.
import { BITMASK_TO_INDEX } from '../constants/bitmaskTable.js'

// Sheet index of the fill tile (bitmask 0xFF = every neighbour solid).
export const FILL_INDEX = BITMASK_TO_INDEX.get(0xFF)

// Interior transforms applied to derive each variant. The interior is the
// (size-2)×(size-2) square inside the 1px border ring; it's square, so 90°/270°
// rotations and (anti)transpose are valid too — giving genuinely different-looking
// fills, not just mirrors. The border ring is always copied as-is, so every
// variant's edges are identical to the original fill → seamless tiling preserved.
const VARIANT_MODES = ['flipX', 'flipY', 'rot180', 'rot90', 'rot270', 'transpose', 'antitranspose']

export const VARIANT_COUNT = VARIANT_MODES.length

// Deterministic per-cell pick in [0, total). total = 1 (base) + variant count.
export function pickVariant(x, y, total) {
  if (total <= 1) return 0
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = (h ^ (h >>> 16)) >>> 0
  return h % total
}

// Map a destination interior coord (ix,iy in 0..n-1) to its source interior coord
// for a given transform. n = size-2 (the interior side length).
function srcInterior(mode, ix, iy, n) {
  switch (mode) {
    case 'flipX':         return [n - 1 - ix, iy]
    case 'flipY':         return [ix, n - 1 - iy]
    case 'rot180':        return [n - 1 - ix, n - 1 - iy]
    case 'rot90':         return [iy, n - 1 - ix]
    case 'rot270':        return [n - 1 - iy, ix]
    case 'transpose':     return [iy, ix]
    case 'antitranspose': return [n - 1 - iy, n - 1 - ix]
    default:              return [ix, iy]
  }
}

// One variant: remap the INTERIOR region per `mode` (border row/col untouched, so
// seamless tiling and the palette are preserved) — a clearly visible "the texture
// moved" change with no new colours introduced.
function transformInterior(src, size, mode) {
  const n = size - 2
  const out = new Uint8ClampedArray(src.data) // border kept as-is
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const [six, siy] = srcInterior(mode, ix, iy, n)
      const di = ((iy + 1) * size + (ix + 1)) * 4
      const si = ((siy + 1) * size + (six + 1)) * 4
      out[di] = src.data[si]
      out[di + 1] = src.data[si + 1]
      out[di + 2] = src.data[si + 2]
      out[di + 3] = src.data[si + 3]
    }
  }
  return new ImageData(out, size, size)
}

// Builds `count` variant ImageData from the fill tile. Returns [] if no fill tile
// (or it's too small to vary safely).
export function makeFillVariants(fillTile, size, count = VARIANT_COUNT) {
  if (!fillTile?.data || size < 4) return []
  const variants = []
  for (let v = 0; v < count; v++) {
    variants.push(transformInterior(fillTile, size, VARIANT_MODES[v % VARIANT_MODES.length]))
  }
  return variants
}
