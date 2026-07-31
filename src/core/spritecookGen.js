import { BITS, validMasks } from '../constants/bitmaskTable.js'
import { hexToRGBA, setPixelRGBA } from './canvasUtils.js'

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

function roundedBoxSdf(px, py, l, t, r, b, radius) {
  const cx = (l + r) * 0.5;
  const cy = (t + b) * 0.5;
  const hx = (r - l) * 0.5;
  const hy = (b - t) * 0.5;
  const rad = Math.min(radius, hx, hy);
  const qx = Math.abs(px - cx) - (hx - rad);
  const qy = Math.abs(py - cy) - (hy - rad);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - rad;
}

function mixColor(a, b, t) {
  const amount = clamp(t, 0, 1);
  return [
    Math.round(lerp(a[0], b[0], amount)),
    Math.round(lerp(a[1], b[1], amount)),
    Math.round(lerp(a[2], b[2], amount)),
    255
  ];
}
function shadeColor(color, amount) {
  return [
    clamp(Math.round(color[0] + amount), 0, 255),
    clamp(Math.round(color[1] + amount), 0, 255),
    clamp(Math.round(color[2] + amount), 0, 255),
    255
  ];
}

function hash2(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm(x, y, seed) {
  let total = 0, amp = 0.55, freq = 1, norm = 0;
  for (let i = 0; i < 4; i++) {
    total += valueNoise(x * freq, y * freq, seed + i * 71) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / norm;
}

// Evaluate SDF for a specific pixel and a 47-tile bitmask
function evaluateTileSdf(px, py, mask, tileSize, radius, pad, ov, ext) {
  const half = tileSize / 2;
  
  const hasL = (mask & BITS.L) !== 0;
  const hasR = (mask & BITS.R) !== 0;
  const hasT = (mask & BITS.T) !== 0;
  const hasB = (mask & BITS.B) !== 0;
  
  const hasTL = (mask & BITS.TL) !== 0;
  const hasTR = (mask & BITS.TR) !== 0;
  const hasBL = (mask & BITS.BL) !== 0;
  const hasBR = (mask & BITS.BR) !== 0;
  
  let dist = 9999;
  
  // Q1: Top-Left
  if (px <= half && py <= half) {
    let boxL = hasL ? 0 - ext : pad;
    let boxT = hasT ? 0 - ext : pad;
    let boxR = half + ov;
    let boxB = half + ov;
    let d = roundedBoxSdf(px, py, boxL, boxT, boxR, boxB, radius);
    if (hasL && hasT && !hasTL) {
      let cutout = roundedBoxSdf(px, py, 0 - ext, 0 - ext, pad, pad, radius);
      d = smax(d, -cutout, radius);
    }
    dist = Math.min(dist, d);
  }
  
  // Q2: Top-Right
  if (px >= half && py <= half) {
    let boxL = half - ov;
    let boxT = hasT ? 0 - ext : pad;
    let boxR = hasR ? tileSize + ext : tileSize - pad;
    let boxB = half + ov;
    let d = roundedBoxSdf(px, py, boxL, boxT, boxR, boxB, radius);
    if (hasR && hasT && !hasTR) {
      let cutout = roundedBoxSdf(px, py, tileSize - pad, 0 - ext, tileSize + ext, pad, radius);
      d = smax(d, -cutout, radius);
    }
    dist = Math.min(dist, d);
  }
  
  // Q3: Bottom-Left
  if (px <= half && py >= half) {
    let boxL = hasL ? 0 - ext : pad;
    let boxT = half - ov;
    let boxR = half + ov;
    let boxB = hasB ? tileSize + ext : tileSize - pad;
    let d = roundedBoxSdf(px, py, boxL, boxT, boxR, boxB, radius);
    if (hasL && hasB && !hasBL) {
      let cutout = roundedBoxSdf(px, py, 0 - ext, tileSize - pad, pad, tileSize + ext, radius);
      d = smax(d, -cutout, radius);
    }
    dist = Math.min(dist, d);
  }
  
  // Q4: Bottom-Right
  if (px >= half && py >= half) {
    let boxL = half - ov;
    let boxT = half - ov;
    let boxR = hasR ? tileSize + ext : tileSize - pad;
    let boxB = hasB ? tileSize + ext : tileSize - pad;
    let d = roundedBoxSdf(px, py, boxL, boxT, boxR, boxB, radius);
    if (hasR && hasB && !hasBR) {
      let cutout = roundedBoxSdf(px, py, tileSize - pad, tileSize - pad, tileSize + ext, tileSize + ext, radius);
      d = smax(d, -cutout, radius);
    }
    dist = Math.min(dist, d);
  }
  
  return dist;
}

export function generateSpriteCookTiles(biome, tileSize, frameSeed = 0) {
  const tiles = new Array(48);
  
  const cPrim = hexToRGBA(biome.colors.primary);
  const cSec  = hexToRGBA(biome.colors.secondary);
  const cBord = hexToRGBA(biome.colors.border);
  
  // Checkerboard for empty
  const emptyData = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const i = (y * tileSize + x) * 4;
      const light = ((x + y) % 2 === 0);
      emptyData[i]     = light ? 70 : 45;
      emptyData[i + 1] = light ? 70 : 45;
      emptyData[i + 2] = light ? 70 : 45;
      emptyData[i + 3] = 255;
    }
  }
  tiles[0] = new ImageData(emptyData, tileSize, tileSize);
  
  const p = biome.proceduralParams || {};
  const seed = (p.seed || 12345) + frameSeed * 99;
  
  // Match SpriteCook defaults
  const cornerRadius = p.cornerRadius ?? Math.max(0, Math.floor(tileSize * 0.2));
  const pad = p.padding ?? 1;
  const edgeStyle = p.edgeStyle ?? 'rough'; // 'rough' or 'clean'
  const edgeNoise = p.edgeNoise ?? 2.0;
  const noiseSize = p.noiseSize ?? 0.15;
  const edgeFade = p.edgeFade ?? 3;
  const textureNoise = p.textureNoise ?? 0.1;
  const flecks = p.flecks ?? 0.05;
  
  const ov = Math.max(2, Math.floor(tileSize * 0.09));
  const ext = cornerRadius + Math.ceil(edgeNoise) + 2;

  for (let idx = 1; idx <= 47; idx++) {
    const mask = validMasks[idx - 1];
    const data = new Uint8ClampedArray(tileSize * tileSize * 4);
    
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        
        let d = evaluateTileSdf(px, py, mask, tileSize, cornerRadius, pad, ov, ext);
        
        let localEdgeNoise = 0;
        if (edgeStyle === 'rough' && edgeNoise > 0) {
           localEdgeNoise = (valueNoise(px * noiseSize, py * noiseSize, seed) - 0.5) * 2.0 * edgeNoise;
           d -= localEdgeNoise;
        }
        
        if (d <= 0) {
           // Inside
           // Dist from the edge is -d (positive going inward)
           const depth = -d;
           
           let baseColor = cPrim;
           
           // Texture noise
           if (textureNoise > 0) {
              const tn = fbm(px * 0.05, py * 0.05, seed + 100);
              const shift = (tn - 0.5) * textureNoise * 255;
              baseColor = shadeColor(cPrim, shift);
           }
           
           // Flecks
           if (flecks > 0) {
              const fn = hash2(px, py, seed + 200);
              if (fn < flecks) {
                 baseColor = shadeColor(baseColor, -30);
              }
           }
           
           // Edge fade
           let finalColor = baseColor;
           if (edgeFade > 0) {
              const blend = clamp(depth / edgeFade, 0, 1);
              // at depth 0 (edge), color is border. at depth edgeFade, color is baseColor.
              finalColor = mixColor(cBord, baseColor, blend);
           }
           
           setPixelRGBA(data, x, y, tileSize, finalColor[0], finalColor[1], finalColor[2], finalColor[3]);
        }
      }
    }
    tiles[idx] = new ImageData(data, tileSize, tileSize);
  }
  
  return tiles;
}
