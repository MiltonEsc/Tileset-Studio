import { BITS, validMasks, BITMASK_TO_INDEX } from '../constants/bitmaskTable.js'
import { generateSpriteCookTiles } from './spritecookGen.js'
import {
  hexToRGBA, fillRegion, applyOrderedDither,
  setPixelRGBA, getPixelIdx
} from './canvasUtils.js'

const EDGE_SEED = 1337
const MOTTLE_SEED = 4201 // large-scale tonal variation under the fill

// Deterministic per-pixel hash → 0..1
function rnd(x, y, seed) {
  let n = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

// Picks a textured border color so the edge isn't a flat fill: mostly `border`,
// with scattered `shadow` (darker) and `highlight` (brighter) pixels.
function edgeColor(x, y, seed, bo, sh, hi, edgeNoise = 1.0) {
  if (edgeNoise <= 0) return bo
  const r = rnd(x, y, seed)
  if (r < 0.24 * edgeNoise) return sh
  if (r > 1.0 - 0.20 * edgeNoise) return hi
  return bo
}

// Paints one border strip with an irregular (noisy) inner boundary and a
// textured color, giving a snow/ice-like edge instead of a solid bar.
// side: 0=top 1=bottom 2=left 3=right. bo/sh/hi are [r,g,b].
function paintEdge(data, s, side, ew, bo, sh, hi, seed, params = {}) {
  const edgeJitter = params.edgeJitter ?? 1.0
  const edgeNoise = params.edgeNoise ?? 1.0

  // The irregular boundary amplitude scales with tile size so the noisy edge stays
  // visible at 64/128/256px (a fixed ±1px is invisible there).
  const baseJit = Math.max(1, Math.round(s / 32))
  const jit = Math.round(baseJit * edgeJitter)
  
  const coord = (p, d) =>
    side === 0 ? [p, d]
    : side === 1 ? [p, s - 1 - d]
    : side === 2 ? [d, p]
    : [s - 1 - d, p]
  for (let p = 0; p < s; p++) {
    const depth = ew + (jit > 0 ? Math.floor(rnd(p, side * 31 + 5, seed) * (jit + 1)) : 0) // ew .. ew+jit
    for (let d = 0; d < depth; d++) {
      const [x, y] = coord(p, d)
      const c = edgeColor(x, y, seed, bo, sh, hi, edgeNoise)
      setPixelRGBA(data, x, y, s, c[0], c[1], c[2], 255)
    }
    // Soft AO: nudge the first interior pixel past the strip toward shadow so the
    // border blends into the fill instead of ending in a hard line.
    const [ax, ay] = coord(p, depth)
    if (ax >= 0 && ax < s && ay >= 0 && ay < s) {
      const i = (ay * s + ax) * 4, k = 0.35
      data[i]     += (sh[0] - data[i])     * k
      data[i + 1] += (sh[1] - data[i + 1]) * k
      data[i + 2] += (sh[2] - data[i + 2]) * k
    }
  }
}

// Draws a single tile procedurally for a given bitmask and biome.
// `frameSeed` > 0 produces an animation frame: the textured edges re-scatter
// with a shifted seed and a light interior shimmer is added, so cycling the
// frames reads as living material (water glints, snow sparkle).
function drawTile(mask, tileSize, colors, params, frameSeed = 0) {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4)
  const s = tileSize

  const t  = (mask & BITS.T)  !== 0
  const b  = (mask & BITS.B)  !== 0
  const l  = (mask & BITS.L)  !== 0
  const r  = (mask & BITS.R)  !== 0
  const tl = (mask & BITS.TL) !== 0
  const tr = (mask & BITS.TR) !== 0
  const bl = (mask & BITS.BL) !== 0
  const br = (mask & BITS.BR) !== 0

  const [pr, pg, pb] = hexToRGBA(colors.primary)
  const [sr, sg, sb] = hexToRGBA(colors.secondary)
  const [boR, boG, boB] = hexToRGBA(colors.border)
  const [hr, hg, hb] = hexToRGBA(colors.highlight)
  const [shr, shg, shb] = hexToRGBA(colors.shadow)

  // Step 1: Fill with primary color
  fillRegion(data, s, 0, 0, s, s, pr, pg, pb, 255)

  // Step 1.5: subtle large-scale tonal mottling so flat fills read as hand-textured
  // (uneven lighting / patches) instead of a uniform field. Toroidal noise → the
  // fill stays seamless; a small default strength keeps each biome's identity. Set
  // proceduralParams.mottleStrength to 0 to opt a busy pattern out.
  const mottle = params.mottleStrength ?? 0.1
  if (mottle > 0 && s >= 8) {
    const gM = Math.max(2, Math.round(s / 8)) // soft blobs across the tile
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const t = (valueNoise(x, y, s, MOTTLE_SEED, gM) - 0.5) * 2 * mottle // -m..+m
        const k = Math.abs(t)
        // below mid → toward shadow (darker patch); above → toward secondary
        const tr = t < 0 ? shr : sr, tg = t < 0 ? shg : sg, tb = t < 0 ? shb : sb
        const i = (y * s + x) * 4
        data[i]     += (tr - data[i])     * k
        data[i + 1] += (tg - data[i + 1]) * k
        data[i + 2] += (tb - data[i + 2]) * k
      }
    }
  }

  // Step 2: distinctive per-biome texture. A light ordered dither lays down a
  // base grain, then the named pattern paints its features (grass blades, dune
  // ripples, cracks, mortar…) on top. (Previously the pattern was an `else` to
  // the dither, so any biome with dither:true rendered as flat dither — all of
  // them looked the same; now both apply.)
  if (params.dither) applyOrderedDither(data, s, s, [sr, sg, sb, 255], params.ditherStrength)
  applyBiomePattern(params.patternFn, data, s, { pr, pg, pb, sr, sg, sb, hr, hg, hb, shr, shg, shb })

  // Step 2.5: animation shimmer — scatter a few secondary/highlight pixels
  // with a per-frame seed (frame 0 stays exactly the static tile).
  if (frameSeed) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = rnd(x, y, frameSeed * 7919)
        if (v < 0.045) setPixelRGBA(data, x, y, s, sr, sg, sb, 255)
        else if (v > 0.985) setPixelRGBA(data, x, y, s, hr, hg, hb, 255)
      }
    }
  }

  // Border scales with tile size so it stays visible on large tiles (e.g. 64px)
  const ew = Math.max(params.edgeWidth, Math.round(tileSize / 6))
  const bo = [boR, boG, boB], sh = [shr, shg, shb], hi = [hr, hg, hb]
  const edgeSeed = EDGE_SEED + frameSeed * 101

  // Step 3: Draw border strips (exposed cardinal edges) — textured, not flat
  if (!t) paintEdge(data, s, 0, ew, bo, sh, hi, edgeSeed, params)
  if (!b) paintEdge(data, s, 1, ew, bo, sh, hi, edgeSeed, params)
  if (!l) paintEdge(data, s, 2, ew, bo, sh, hi, edgeSeed, params)
  if (!r) paintEdge(data, s, 3, ew, bo, sh, hi, edgeSeed, params)

  // Step 4: Inner corner indicators (diagonal missing, both cardinals present)
  // Draw a 1×1 highlight pixel at the inner concave corner
  if (t && l && !tl) {
    setPixelRGBA(data, 0,     0,     s, hr, hg, hb, 255)
    setPixelRGBA(data, 1,     0,     s, shr, shg, shb, 255)
    setPixelRGBA(data, 0,     1,     s, shr, shg, shb, 255)
  }
  if (t && r && !tr) {
    setPixelRGBA(data, s - 1, 0,     s, hr, hg, hb, 255)
    setPixelRGBA(data, s - 2, 0,     s, shr, shg, shb, 255)
    setPixelRGBA(data, s - 1, 1,     s, shr, shg, shb, 255)
  }
  if (b && l && !bl) {
    setPixelRGBA(data, 0,     s - 1, s, hr, hg, hb, 255)
    setPixelRGBA(data, 1,     s - 1, s, shr, shg, shb, 255)
    setPixelRGBA(data, 0,     s - 2, s, shr, shg, shb, 255)
  }
  if (b && r && !br) {
    setPixelRGBA(data, s - 1, s - 1, s, hr, hg, hb, 255)
    setPixelRGBA(data, s - 2, s - 1, s, shr, shg, shb, 255)
    setPixelRGBA(data, s - 1, s - 2, s, shr, shg, shb, 255)
  }

  // Step 5: Corner style adjustments
  if (params.cornerStyle === 'rounded') {
    applyRoundedCorners(data, s, !t, !b, !l, !r, boR, boG, boB)
  }

  return new ImageData(data, tileSize, tileSize)
}

// Per-biome textures. Each takes the full palette `p`
// ({pr,pg,pb, sr,sg,sb (secondary), hr,hg,hb (highlight), shr,shg,shb (shadow)})
// so it can use highlights/shadows for depth, not just one flat speckle colour.
const px = (data, x, y, s, c) => setPixelRGBA(data, x, y, s, c[0], c[1], c[2], 255)

export function applyBiomePattern(name, data, s, p) {
  const se = [p.sr, p.sg, p.sb], hi = [p.hr, p.hg, p.hb], sh = [p.shr, p.shg, p.shb]
  switch (name) {
    case 'grass':   drawGrassPattern(data, s, se, hi, sh); break
    case 'sand':    drawSandPattern(data, s, se, hi, sh); break
    case 'snow':    drawSnowPattern(data, s, se, hi); break
    case 'stone':   drawStonePattern(data, s, se, hi, sh); break
    case 'water':   drawWavyPattern(data, s, se, hi, sh); break
    case 'cracked': drawCrackedPattern(data, s, se, hi, sh); break
    case 'lava':    drawLavaPattern(data, s, se, hi, sh); break
    case 'ice':     drawIcePattern(data, s, se, hi, sh); break
    case 'sandpebble': drawSandPebblePattern(data, s, se, hi, sh); break
    case 'brick':   drawBrickPattern(data, s, se, hi, sh); break
    case 'dirt':    drawDirtPattern(data, s, se, hi, sh); break
    case 'mud':     drawMudPattern(data, s, se, hi, sh); break
    case 'ash':     drawAshPattern(data, s, se, hi, sh); break
    case 'moss':    drawMossPattern(data, s, se, hi, sh); break
    case 'swamp':   drawSwampPattern(data, s, se, hi, sh); break
    case 'cobble':  drawCobblePattern(data, s, se, hi, sh, Math.max(3, Math.round(s / 6.4))); break
    case 'gravel':  drawCobblePattern(data, s, se, hi, sh, Math.max(3, Math.round(s / 4))); break
    default:        break // 'solid'/unknown → primary fill only
  }
}

// Toroidal Voronoi COBBLESTONE: a jittered grid of seed points; each pixel takes
// its nearest seed (a "stone"). Dark mortar at cell boundaries, a top-left
// highlight rim + bottom-right shadow (rounded 3D look), and per-stone tone
// variation. Distances wrap, so it tiles seamlessly. `div` ≈ stones across.
function drawCobblePattern(data, s, se, hi, sh, div = 5) {
  const g = Math.max(2, Math.round(div))
  const cw = s / g
  const seeds = new Array(g * g)
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      seeds[j * g + i] = {
        jx: 0.2 + 0.6 * rnd(i, j, 91),   // seed jitter inside the cell
        jy: 0.2 + 0.6 * rnd(i, j, 137),
        tone: rnd(i, j, 53),             // per-stone brightness 0..1
      }
    }
  }
  for (let y = 0; y < s; y++) {
    const gj0 = Math.floor(y / cw)
    for (let x = 0; x < s; x++) {
      const gi0 = Math.floor(x / cw)
      let d1 = Infinity, d2 = Infinity, bx = 0, by = 0, btone = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = gi0 + di, cj = gj0 + dj
          const wi = ((ci % g) + g) % g, wj = ((cj % g) + g) % g
          const sd = seeds[wj * g + wi]
          const sx = (ci + sd.jx) * cw       // virtual neighbour position (may be off-tile)
          const sy = (cj + sd.jy) * cw
          const ddx = x - sx, ddy = y - sy
          const dist = ddx * ddx + ddy * ddy
          if (dist < d1) { d2 = d1; d1 = dist; bx = sx; by = sy; btone = sd.tone }
          else if (dist < d2) { d2 = dist }
        }
      }
      const gap = Math.sqrt(d2) - Math.sqrt(d1) // distance to the nearest cell border
      // Thresholds scale with cell size so small cells (gravel) keep thin rims.
      const mortarT = Math.max(0.9, cw * 0.16)
      const rimT = mortarT + Math.max(1, cw * 0.22)
      if (gap < mortarT) { px(data, x, y, s, sh); continue }    // mortar / crack
      if (gap < rimT) {                                         // rounded rim of the stone
        if (y <= by && x <= bx) px(data, x, y, s, hi)
        else if (y >= by && x >= bx) px(data, x, y, s, sh)
        continue
      }
      if (btone > 0.72) px(data, x, y, s, hi)                   // light stones
      else if (btone < 0.32) px(data, x, y, s, se)              // dark stones
    }
  }
}

// Soft 2-octave value noise at (x,y) for a given seed → 0..1 (blobby patches).
function blob(x, y, seed) {
  return rnd((x / 3) | 0, (y / 3) | 0, seed) * 0.6 + rnd(x, y, seed) * 0.4
}

// TOROIDAL value noise → 0..1. A g×g lattice of random values spread over the
// tile, wrapped (so the value at x and x+s match → SEAMLESS) and smoothstep-
// interpolated. `g` = roughly how many soft blobs span the tile. Deterministic.
export function valueNoise(x, y, s, seed, g) {
  const cell = s / g
  const fx = x / cell, fy = y / cell
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const lat = (i, j) => rnd(((i % g) + g) % g, ((j % g) + g) % g, seed) // wrap → toroidal
  const v00 = lat(x0, y0),     v10 = lat(x0 + 1, y0)
  const v01 = lat(x0, y0 + 1), v11 = lat(x0 + 1, y0 + 1)
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty) // smoothstep
  const a = v00 + (v10 - v00) * sx
  const b = v01 + (v11 - v01) * sx
  return a + (b - a) * sy
}

// Grass: scattered blade tips (highlight) + mid blades (secondary) + dark gaps,
// CLUSTERED by a mid-scale toroidal noise so blades form lush/sparse patches
// instead of a uniform field (still seamless + deterministic).
function drawGrassPattern(data, s, se, hi, sh) {
  const g = Math.max(2, Math.round(s / 6))
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = valueNoise(x, y, s, 272, g) // patchiness 0..1
      const v = rnd(x, y, 271)
      const tip = 0.06 + 0.16 * n
      if (v < tip) px(data, x, y, s, hi)
      else if (v < tip + 0.15) px(data, x, y, s, se)
      else if (v > 0.93 - 0.06 * n) px(data, x, y, s, sh)
    }
  }
}

// Sand: horizontal dune ripples (highlight crest / shadow trough) + fine grain.
function drawSandPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const wave = Math.sin((y * 6 / s + Math.sin(x * 0.4) * 0.35) * Math.PI)
      if (wave > 0.58) px(data, x, y, s, hi)
      else if (wave < -0.58) px(data, x, y, s, sh)
      else if (rnd(x, y, 53) < 0.05) px(data, x, y, s, se)
    }
  }
}

// Snow: mostly clean with sparse sparkles (highlight) + soft dimples (secondary).
function drawSnowPattern(data, s, se, hi) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const v = rnd(x, y, 613)
      if (v > 0.965) px(data, x, y, s, hi)
      else if (v < 0.06) px(data, x, y, s, se)
    }
  }
}

// Stone (cave): crack lines (shadow) + mottling (secondary) + mineral glints (highlight).
function drawStonePattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = ((x * 7 + y * 13 + 42) * 2654435761) >>> 0
      if ((n % 17) < 1) px(data, x, y, s, sh)
      else if (rnd(x, y, 9) < 0.08) px(data, x, y, s, se)
      else if (rnd(x, y, 31) > 0.975) px(data, x, y, s, hi)
    }
  }
}

// Water (ocean): wavy bands — bright crests (highlight), mid (secondary), dark troughs.
function drawWavyPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const wave = Math.sin((x + y * 0.5) * (Math.PI / (s / 3)))
      if (wave > 0.7) px(data, x, y, s, hi)
      else if (wave > 0.2) px(data, x, y, s, se)
      else if (wave < -0.78) px(data, x, y, s, sh)
    }
  }
}

// Cracked (lava): glowing cracks (highlight) over charred speckle (shadow) + embers (secondary).
function drawCrackedPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = ((x * 5 + y * 11) * 2246822519) >>> 0
      if ((n % 11) < 1) px(data, x, y, s, hi)
      else if (rnd(x, y, 17) < 0.10) px(data, x, y, s, se)
      else if (rnd(x, y, 71) > 0.93) px(data, x, y, s, sh)
    }
  }
}

// Lava (improved): cooling basalt crust with glowing magma cracks. Same toroidal
// Voronoi as cobblestone but INVERTED — the cell *borders* become the cracks
// (a white-hot highlight core fading through an orange glow halo of the base
// primary) and the cell *interiors* are dark charred plates (shadow / secondary
// by per-plate tone) flecked with rare embers. Tiles seamlessly (wrapped dists).
function drawLavaPattern(data, s, se, hi, sh) {
  const g = Math.max(3, Math.round(s / 10))   // ~basalt plates across the tile
  const cw = s / g
  const seeds = new Array(g * g)
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      seeds[j * g + i] = {
        jx: 0.2 + 0.6 * rnd(i, j, 91),
        jy: 0.2 + 0.6 * rnd(i, j, 137),
        tone: rnd(i, j, 53),                  // per-plate brightness 0..1
      }
    }
  }
  const coreT = Math.max(0.8, cw * 0.10)            // white-hot crack core
  const glowT = coreT + Math.max(1.5, cw * 0.34)    // orange glow halo (left as base primary)
  for (let y = 0; y < s; y++) {
    const gj0 = Math.floor(y / cw)
    for (let x = 0; x < s; x++) {
      const gi0 = Math.floor(x / cw)
      let d1 = Infinity, d2 = Infinity, btone = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = gi0 + di, cj = gj0 + dj
          const wi = ((ci % g) + g) % g, wj = ((cj % g) + g) % g
          const sd = seeds[wj * g + wi]
          const sx = (ci + sd.jx) * cw, sy = (cj + sd.jy) * cw
          const ddx = x - sx, ddy = y - sy
          const dist = ddx * ddx + ddy * ddy
          if (dist < d1) { d2 = d1; d1 = dist; btone = sd.tone }
          else if (dist < d2) { d2 = dist }
        }
      }
      const gap = Math.sqrt(d2) - Math.sqrt(d1)     // distance to nearest plate border
      if (gap < coreT) { px(data, x, y, s, hi); continue }   // white-hot crack core
      if (gap < glowT) continue                              // orange glow halo (base primary)
      if (rnd(x, y, 17) > 0.985) continue                    // rare ember speck (stays glowing)
      px(data, x, y, s, btone < 0.6 ? sh : se)               // dark charred plate
    }
  }
}

// Ice (cracked): a frozen sheet — clean light plates split by thin blue fracture
// lines. Same toroidal Voronoi as lava but the contrast is flipped: the cell
// *borders* are the cracks (a thin deep-blue core with a bright refraction sheen
// on the upper-left side) and the *interiors* are clean ice (base primary) with a
// faint per-plate tint + sparse sparkle glints. Tiles seamlessly (wrapped dists).
function drawIcePattern(data, s, se, hi, sh) {
  const g = Math.max(3, Math.round(s / 11))   // ~ice plates across the tile
  const cw = s / g
  const seeds = new Array(g * g)
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      seeds[j * g + i] = {
        jx: 0.2 + 0.6 * rnd(i, j, 91),
        jy: 0.2 + 0.6 * rnd(i, j, 137),
        tone: rnd(i, j, 53),                  // per-plate brightness 0..1
      }
    }
  }
  const crackT = Math.max(0.8, cw * 0.08)            // thin fracture line
  const sheenT = crackT + Math.max(1, cw * 0.12)     // bright refraction rim (one side)
  for (let y = 0; y < s; y++) {
    const gj0 = Math.floor(y / cw)
    for (let x = 0; x < s; x++) {
      const gi0 = Math.floor(x / cw)
      let d1 = Infinity, d2 = Infinity, bx = 0, by = 0, btone = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = gi0 + di, cj = gj0 + dj
          const wi = ((ci % g) + g) % g, wj = ((cj % g) + g) % g
          const sd = seeds[wj * g + wi]
          const sx = (ci + sd.jx) * cw, sy = (cj + sd.jy) * cw
          const ddx = x - sx, ddy = y - sy
          const dist = ddx * ddx + ddy * ddy
          if (dist < d1) { d2 = d1; d1 = dist; bx = sx; by = sy; btone = sd.tone }
          else if (dist < d2) { d2 = dist }
        }
      }
      const gap = Math.sqrt(d2) - Math.sqrt(d1)              // distance to nearest plate border
      if (gap < crackT) { px(data, x, y, s, sh); continue }  // thin deep-blue fracture
      if (gap < sheenT && y <= by && x <= bx) { px(data, x, y, s, hi); continue } // refraction sheen
      if (btone < 0.22) px(data, x, y, s, se)                // faintly tinted plate
      else if (rnd(x, y, 211) > 0.985) px(data, x, y, s, hi) // sparkle glint
    }
  }
}

// Sand with pebbles: the dune-ripple sand base, then scattered rounded pebbles.
// A sparse jittered grid (wrapped, so it tiles) seeds a pebble in ~half its cells;
// each pebble is a small disc shaded top-left highlight / bottom-right shadow with
// a 1px dark contact ring, so it reads as a rounded stone sitting on the sand.
function drawSandPebblePattern(data, s, se, hi, sh) {
  drawSandPattern(data, s, se, hi, sh)               // dune ripple base first
  const g = Math.max(3, Math.round(s / 7))           // pebble-site grid
  const cw = s / g
  const peb = new Array(g * g)
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      peb[j * g + i] = {
        on: rnd(i, j, 17) > 0.45,                     // ~half the cells host a pebble
        jx: 0.25 + 0.5 * rnd(i, j, 91),
        jy: 0.25 + 0.5 * rnd(i, j, 137),
        r: cw * (0.18 + 0.16 * rnd(i, j, 53)),        // pebble radius
        light: rnd(i, j, 71) > 0.6,                   // some pale (quartz) pebbles
      }
    }
  }
  for (let y = 0; y < s; y++) {
    const gj0 = Math.floor(y / cw)
    for (let x = 0; x < s; x++) {
      const gi0 = Math.floor(x / cw)
      let best = null, bestD = Infinity, bdx = 0, bdy = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = gi0 + di, cj = gj0 + dj
          const wi = ((ci % g) + g) % g, wj = ((cj % g) + g) % g
          const p = peb[wj * g + wi]
          if (!p.on) continue
          const sx = (ci + p.jx) * cw, sy = (cj + p.jy) * cw
          const ddx = x - sx, ddy = y - sy
          const dist = ddx * ddx + ddy * ddy
          if (dist < bestD) { bestD = dist; best = p; bdx = ddx; bdy = ddy }
        }
      }
      if (!best) continue
      const d = Math.sqrt(bestD), r = best.r
      if (d > r + 1) continue
      if (d > r) { px(data, x, y, s, sh); continue }                  // contact-shadow ring
      if (bdx < -r * 0.25 && bdy < -r * 0.25) px(data, x, y, s, hi)   // lit top-left
      else if (bdx > r * 0.25 && bdy > r * 0.25) px(data, x, y, s, sh) // shadowed bottom-right
      else px(data, x, y, s, best.light ? hi : se)                    // pebble body
    }
  }
}

// Brick (dungeon): mortar lines (shadow) + a top highlight per course + speckle.
// Beveled bricks (running bond): 1px mortar between bricks, a top+left highlight
// rim and a bottom+right shadow rim per brick → a raised/relief look, with a
// little interior grain. bw=s/2, bh=s/4 (both divide every tile size) so it tiles.
function drawBrickPattern(data, s, se, hi, sh) {
  const bh = Math.max(2, Math.round(s / 4))   // courses
  const bw = Math.max(4, Math.round(s / 2))   // bricks per row (offset alternate rows)
  for (let y = 0; y < s; y++) {
    const row = Math.floor(y / bh)
    const yy = y % bh
    const offset = (row % 2 === 0) ? 0 : (bw >> 1)
    for (let x = 0; x < s; x++) {
      const bx = (x + offset) % bw
      if (yy === 0 || bx === 0) { px(data, x, y, s, sh); continue }            // mortar
      if (yy === 1 || bx === 1) { px(data, x, y, s, hi); continue }            // top/left bevel (light)
      if (yy === bh - 1 || bx === bw - 1) { px(data, x, y, s, sh); continue }  // bottom/right bevel (dark)
      if (rnd(x, y, 5) < 0.05) px(data, x, y, s, se)                           // interior grain
    }
  }
}

// Dirt: earth clumps (secondary) that CLUSTER into patches via mid-scale noise,
// plus dark crumbs (shadow) and small grains (highlight). Seamless + deterministic.
function drawDirtPattern(data, s, se, hi, sh) {
  const g = Math.max(2, Math.round(s / 5))
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = valueNoise(x, y, s, 402, g)
      const v = rnd(x, y, 401)
      if (v < 0.10 + 0.12 * n) px(data, x, y, s, se)
      else if (v > 0.965) px(data, x, y, s, hi)
      else if (v > 0.90) px(data, x, y, s, sh)
    }
  }
}

// Mud: blobby wet patches — dark (shadow) and mid (secondary) with rare glints.
function drawMudPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = blob(x, y, 733)
      if (n < 0.24) px(data, x, y, s, sh)
      else if (n < 0.42) px(data, x, y, s, se)
      else if (rnd(x, y, 11) > 0.985) px(data, x, y, s, hi)
    }
  }
}

// Volcanic ash: fine gray soot (secondary) drifting into patches via mid-scale
// noise + dark flecks (shadow) + rare embers (highlight). Seamless + deterministic.
function drawAshPattern(data, s, se, hi, sh) {
  const g = Math.max(2, Math.round(s / 5))
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = valueNoise(x, y, s, 930, g)
      const v = rnd(x, y, 929)
      if (v < 0.12 + 0.14 * n) px(data, x, y, s, se)
      else if (v < 0.30) px(data, x, y, s, sh)
      else if (v > 0.987) px(data, x, y, s, hi)
    }
  }
}

// Moss: clumpy bright moss (highlight) over mid green (secondary) with dark gaps.
function drawMossPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = blob(x, y, 557)
      if (n > 0.72) px(data, x, y, s, hi)
      else if (n > 0.5) px(data, x, y, s, se)
      else if (rnd(x, y, 13) < 0.07) px(data, x, y, s, sh)
    }
  }
}

// Swamp: murky water/mud patches (shadow/secondary) with sparse algae sheen (highlight).
function drawSwampPattern(data, s, se, hi, sh) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = blob(x, y, 311)
      if (n < 0.26) px(data, x, y, s, sh)
      else if (n < 0.46) px(data, x, y, s, se)
      else if (rnd(x, y, 29) > 0.97) px(data, x, y, s, hi)
    }
  }
}

function applyRoundedCorners(data, s, noTop, noBot, noLeft, noRight, br, bg, bb) {
  // Soften outer corners by adding a diagonal pixel at the corner junction
  if (!noTop && !noLeft) {
    setPixelRGBA(data, 0, 0, s, br, bg, bb, 255)
  }
  if (!noTop && !noRight) {
    setPixelRGBA(data, s - 1, 0, s, br, bg, bb, 255)
  }
  if (!noBot && !noLeft) {
    setPixelRGBA(data, 0, s - 1, s, br, bg, bb, 255)
  }
  if (!noBot && !noRight) {
    setPixelRGBA(data, s - 1, s - 1, s, br, bg, bb, 255)
  }
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)))

// Copies an edge pixel scaled by `f` (a bevel shade) so the border reads as a
// raised terrain edge instead of a flat band.
function copyPixelShaded(data, src, x, y, s, f) {
  const i = getPixelIdx(x, y, s)
  data[i] = clampByte(src[i] * f); data[i + 1] = clampByte(src[i + 1] * f); data[i + 2] = clampByte(src[i + 2] * f); data[i + 3] = 255
}

// Copies a border strip from an `edge` texture, beveled across its depth (outer
// rim darker/shadow, inner lip brighter/catch-light). The depth is UNIFORM (= ew
// on every column): a constant-width border has no doubled pixels at the junction
// between two adjacent border tiles and tiles seamlessly along its run.
function paintEdgeFromTexture(data, edge, s, side, ew) {
  for (let p = 0; p < s; p++) {
    for (let d = 0; d < ew; d++) {
      let x, y
      if (side === 0)      { x = p;         y = d }
      else if (side === 1) { x = p;         y = s - 1 - d }
      else if (side === 2) { x = d;         y = p }
      else                 { x = s - 1 - d; y = p }
      // d = 0 is the outermost pixel; d = ew-1 the inner lip.
      const f = ew <= 1 ? 0.78 : 0.62 + (d / (ew - 1)) * 0.5
      copyPixelShaded(data, edge, x, y, s, f)
    }
  }
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

// Darken a color by `f` while keeping its hue and boosting chroma a touch, so a
// dark border still reads as the SAME material colour (just deeper) instead of
// flat near-black — which is what plain RGB scaling drifts toward on the
// low-saturation greys the AI tends to produce.
function darkenKeepHue([r, g, b], f, sat = 1.18) {
  r *= f; g *= f; b *= f
  const l = luma(r, g, b)
  return [
    clampByte(l + (r - l) * sat),
    clampByte(l + (g - l) * sat),
    clampByte(l + (b - l) * sat),
  ]
}

// Paints one synthesized border strip, beveled by depth using in-material tones:
// outer rim = shadow, body = border, inner lip = highlight (all derived from the
// center's own colour). UNIFORM depth (= ew) → constant width, so a run of border
// tiles connects with no doubled edge pixels.
function paintEdgeBevel(data, s, side, ew, tones) {
  const { sh, bo, hi } = tones
  for (let p = 0; p < s; p++) {
    for (let d = 0; d < ew; d++) {
      let x, y
      if (side === 0)      { x = p;         y = d }
      else if (side === 1) { x = p;         y = s - 1 - d }
      else if (side === 2) { x = d;         y = p }
      else                 { x = s - 1 - d; y = p }
      const c = d === 0 ? sh : (d >= ew - 1 ? hi : bo)
      setPixelRGBA(data, x, y, s, c[0], c[1], c[2], 255)
    }
  }
}

// Inner (concave) corner geometry: 0=TL 1=TR 2=BL 3=BR → the corner pixel + the
// inward step direction.
function cornerGeom(corner, s) {
  const left = corner === 0 || corner === 2
  const top  = corner === 0 || corner === 1
  return { cx: left ? 0 : s - 1, cy: top ? 0 : s - 1, dx: left ? 1 : -1, dy: top ? 1 : -1 }
}

// Paints a DEFINED inner (concave) corner from the material tones — more than a
// single pixel: a short shadow notch down both meeting edges, a border-tone
// diagonal, and a highlight tip — scaled with the border width (`ew`) so it reads
// at every tile size. Replaces the old 1-pixel concave-corner marker.
function paintInnerCornerTones(data, s, corner, tones, ew) {
  const { cx, cy, dx, dy } = cornerGeom(corner, s)
  const cs = Math.max(2, Math.round(ew * 0.7))
  const { sh, bo, hi } = tones
  for (let k = 0; k < cs; k++) {
    setPixelRGBA(data, cx + dx * k, cy,          s, sh[0], sh[1], sh[2], 255)
    setPixelRGBA(data, cx,          cy + dy * k, s, sh[0], sh[1], sh[2], 255)
  }
  for (let k = 1; k < cs; k++) {
    setPixelRGBA(data, cx + dx * k, cy + dy * k, s, bo[0], bo[1], bo[2], 255)
  }
  setPixelRGBA(data, cx, cy, s, hi[0], hi[1], hi[2], 255)
}

// Same defined inner corner, copied from an explicit edge texture (beveled).
function paintInnerCornerTexture(data, edge, s, corner, ew) {
  const { cx, cy, dx, dy } = cornerGeom(corner, s)
  const cs = Math.max(2, Math.round(ew * 0.7))
  for (let k = 0; k < cs; k++) {
    copyPixelShaded(data, edge, cx + dx * k, cy,          s, 0.7)
    copyPixelShaded(data, edge, cx,          cy + dy * k, s, 0.7)
  }
  for (let k = 1; k < cs; k++) copyPixelShaded(data, edge, cx + dx * k, cy + dy * k, s, 0.85)
  copyPixelShaded(data, edge, cx, cy, s, 1.05)
}

// SMOOTH (non-pixel) border: instead of a hard 3-tone bevel, blend a dark tone
// at the outer rim that FADES back into the material toward the inner lip — a
// soft shaded edge that suits cartoon/anime tilesets. `center` is the source so
// the inner part keeps the material's own colour.
function paintEdgeGradient(data, center, s, side, ew, dark) {
  for (let p = 0; p < s; p++) {
    for (let d = 0; d < ew; d++) {
      let x, y
      if (side === 0)      { x = p;         y = d }
      else if (side === 1) { x = p;         y = s - 1 - d }
      else if (side === 2) { x = d;         y = p }
      else                 { x = s - 1 - d; y = p }
      const t = ew <= 1 ? 0 : d / (ew - 1) // 0 outer (dark) → 1 inner (material)
      const i = getPixelIdx(x, y, s)
      data[i]     = clampByte(dark[0] * (1 - t) + center[i] * t)
      data[i + 1] = clampByte(dark[1] * (1 - t) + center[i + 1] * t)
      data[i + 2] = clampByte(dark[2] * (1 - t) + center[i + 2] * t)
      data[i + 3] = 255
    }
  }
}

// Smooth inner (concave) corner: a small quarter that darkens toward the corner
// and fades back into the material (radial blend), matching paintEdgeGradient.
function paintInnerCornerSmooth(data, center, s, corner, ew, dark) {
  const { cx, cy, dx, dy } = cornerGeom(corner, s)
  const cs = Math.max(2, Math.round(ew * 0.7))
  for (let a = 0; a < cs; a++) {
    for (let b = 0; b < cs; b++) {
      const x = cx + dx * a, y = cy + dy * b
      const t = Math.min(1, Math.hypot(a, b) / cs) // 0 at corner → 1 outward
      const i = getPixelIdx(x, y, s)
      data[i]     = clampByte(dark[0] * (1 - t) + center[i] * t)
      data[i + 1] = clampByte(dark[1] * (1 - t) + center[i + 1] * t)
      data[i + 2] = clampByte(dark[2] * (1 - t) + center[i + 2] * t)
      data[i + 3] = 255
    }
  }
}

function makeEmptyTileData(s) {
  const d = new Uint8ClampedArray(s * s * 4)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4
      const light = ((x + y) % 2 === 0)
      d[i] = light ? 70 : 45; d[i + 1] = light ? 70 : 45; d[i + 2] = light ? 70 : 45; d[i + 3] = 255
    }
  }
  return new ImageData(d, s, s)
}

// Composes all 48 tiles from a CENTER texture + an EDGE source. `edgeData` is an
// ImageData (e.g. an AI snow texture) or null → the border is synthesized from
// the center material's OWN average colour, darkened in-hue (`darkenKeepHue`)
// into a 3-tone bevel (shadow/border/highlight) so it reads as the same colours
// as the center, just deeper — NOT the old near-black/desaturated edge, and NOT
// the even-older palette speckle (which gave e.g. a lava center grass-green
// borders). Using the average — rather than copying the center's boundary rows —
// keeps the border UNIFORM on every side (AI images carry bands/artifacts in
// their edge rows that would make one side differ from another). Always autotiles
// correctly because tiles are composed, not cropped. `biomeColors` is kept for
// signature compatibility only.
export function generateTilesFromTextures(centerData, edgeData, tileSize, biomeColors, smooth = false, proceduralParams = {}) { // eslint-disable-line no-unused-vars
  const s = tileSize
  const center = centerData.data
  const ew = proceduralParams.edgeWidth !== undefined ? proceduralParams.edgeWidth : Math.max(2, Math.round(s / 6))

  // Pick the strip + inner-corner painters: an explicit edge texture is copied
  // (beveled); otherwise the border is synthesized from the center's own colour —
  // a hard 3-tone bevel for pixel tilesets, or a soft fading gradient for smooth
  // (non-pixel) ones.
  let paintStrip, paintCorner
  if (edgeData) {
    const edge = edgeData.data
    paintStrip = (data, side) => paintEdgeFromTexture(data, edge, s, side, ew)
    paintCorner = (data, corner) => paintInnerCornerTexture(data, edge, s, corner, ew)
  } else {
    let ar = 0, ag = 0, ab = 0
    const count = s * s
    for (let i = 0; i < center.length; i += 4) { ar += center[i]; ag += center[i + 1]; ab += center[i + 2] }
    const avg = [ar / count, ag / count, ab / count]
    if (smooth) {
      const dark = darkenKeepHue(avg, 0.45)
      paintStrip = (data, side) => paintEdgeGradient(data, center, s, side, ew, dark)
      paintCorner = (data, corner) => paintInnerCornerSmooth(data, center, s, corner, ew, dark)
    } else {
      // Same colour family as the center, three depths: outer shadow → inner lip.
      const tones = {
        sh: darkenKeepHue(avg, 0.50),
        bo: darkenKeepHue(avg, 0.62),
        hi: darkenKeepHue(avg, 0.78),
      }
      paintStrip = (data, side) => paintEdgeBevel(data, s, side, ew, tones)
      paintCorner = (data, corner) => paintInnerCornerTones(data, s, corner, tones, ew)
    }
  }

  const tiles = new Array(48)
  tiles[0] = makeEmptyTileData(s)

  for (const mask of validMasks) {
    const idx = BITMASK_TO_INDEX.get(mask)
    const t  = (mask & BITS.T)  !== 0, b  = (mask & BITS.B)  !== 0
    const l  = (mask & BITS.L)  !== 0, r  = (mask & BITS.R)  !== 0
    const tl = (mask & BITS.TL) !== 0, tr = (mask & BITS.TR) !== 0
    const bl = (mask & BITS.BL) !== 0, br = (mask & BITS.BR) !== 0

    const data = new Uint8ClampedArray(center) // start from the center texture
    if (!t) paintStrip(data, 0)
    if (!b) paintStrip(data, 1)
    if (!l) paintStrip(data, 2)
    if (!r) paintStrip(data, 3)
    // Inner (concave) corners: a defined notch (0=TL 1=TR 2=BL 3=BR)
    if (t && l && !tl) paintCorner(data, 0)
    if (t && r && !tr) paintCorner(data, 1)
    if (b && l && !bl) paintCorner(data, 2)
    if (b && r && !br) paintCorner(data, 3)

    tiles[idx] = new ImageData(data, s, s)
  }
  return proceduralParams.engine === 'spritecook'
    ? applySpriteCookPlatformMasks(tiles, { colors: biomeColors, proceduralParams }, s)
    : tiles
}

// Generates all 48 tiles procedurally for a given biome
// Bounded memo of generated biome sheets. The signature includes colors and
// procedural params (not just an id) so color edits still regenerate. Callers
// treat the 48 ImageData tiles as read-only (compose/export/infer never mutate
// them), which makes returning shared references safe.
const biomeTilesCache = new Map()
// Animation frames share this cache (one entry per frame), so keep headroom
// for a few biomes × up to 4 frames.
const BIOME_CACHE_MAX = 24

function biomeSignature(biome, tileSize, frameSeed) {
  return `${tileSize}|f${frameSeed}|${JSON.stringify(biome.colors)}|${JSON.stringify(biome.proceduralParams || null)}`
}

// `frameSeed` 0 = the static sheet; 1..N = animation frame variants (see drawTile).
export function generateAllBiomeTiles(biome, tileSize, frameSeed = 0) {
  const sig = biomeSignature(biome, tileSize, frameSeed)
  const cached = biomeTilesCache.get(sig)
  if (cached) return cached

  const tiles = new Array(48)

  // Tile 0: transparent empty slot
  const emptyData = new Uint8ClampedArray(tileSize * tileSize * 4)
  const [pr, pg, pb] = hexToRGBA(biome.colors.primary)
  const [br2, bg2, bb2] = hexToRGBA(biome.colors.border)
  // Checkerboard for empty slot using biome dark tones
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const i = (y * tileSize + x) * 4
      const light = ((x + y) % 2 === 0)
      emptyData[i]     = light ? 70 : 45
      emptyData[i + 1] = light ? 70 : 45
      emptyData[i + 2] = light ? 70 : 45
      emptyData[i + 3] = 255
    }
  }
  tiles[0] = new ImageData(emptyData, tileSize, tileSize)

  for (const mask of validMasks) {
    const sheetIndex = BITMASK_TO_INDEX.get(mask)
    tiles[sheetIndex] = drawTile(mask, tileSize, biome.colors, biome.proceduralParams, frameSeed)
  }

  if (biomeTilesCache.size >= BIOME_CACHE_MAX) {
    biomeTilesCache.delete(biomeTilesCache.keys().next().value)
  }
  biomeTilesCache.set(sig, tiles)
  return tiles
}

// Shared procedural-engine dispatcher. Every consumer must go through this
// function so the live editor, saved definitions, animation, and level layers
// all render the same tileset for the same procedural parameters.
export function generateBiomeTiles(biome, tileSize, frameSeed = 0) {
  if (biome?.proceduralParams?.engine !== 'spritecook') {
    return generateAllBiomeTiles(biome, tileSize, frameSeed)
  }

  // Keep the selected biome/AI material, but cut its 47 variants with the same
  // transparent platform geometry as Base Gen. This lets another terrain layer
  // show through around exposed edges instead of drawing an opaque rectangular
  // bevel across the whole boundary cell.
  const sourceBiome = {
    ...biome,
    proceduralParams: { ...(biome.proceduralParams || {}), engine: 'default' },
  }
  return applySpriteCookPlatformMasks(
    generateAllBiomeTiles(sourceBiome, tileSize, frameSeed),
    biome,
    tileSize,
  )
}

export function applySpriteCookPlatformMasks(tiles, biome, tileSize) {
  const colors = {
    primary: '#808080', secondary: '#707070', border: '#404040',
    highlight: '#a0a0a0', shadow: '#303030',
    ...(biome?.colors || {}),
  }
  const masks = generateSpriteCookTiles({
    ...biome,
    colors,
    proceduralParams: biome?.proceduralParams || {},
  }, tileSize)
  const out = new Array(48)
  // Tile 47 is the fully surrounded, seamless material. Use it as the colour
  // source for every shape; the other legacy variants already contain an opaque
  // painted bevel, which would survive the alpha cut and reappear in the level.
  const seamlessSource = tiles?.[47]?.data

  for (let idx = 0; idx < 48; idx++) {
    const source = seamlessSource || tiles?.[idx]?.data
    const mask = masks[idx]?.data
    const data = new Uint8ClampedArray(tileSize * tileSize * 4)
    if (idx > 0 && source && mask) {
      for (let i = 0; i < data.length; i += 4) {
        const alpha = Math.min(source[i + 3], mask[i + 3])
        if (!alpha) continue
        data[i] = source[i]
        data[i + 1] = source[i + 1]
        data[i + 2] = source[i + 2]
        data[i + 3] = alpha
      }
    }
    out[idx] = new ImageData(data, tileSize, tileSize)
  }
  return out
}
