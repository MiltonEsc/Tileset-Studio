import { generateAllBiomeTiles, generateTilesFromTextures } from './proceduralGen.js'
import { generateSpriteCookTiles } from './spritecookGen.js'
import { generateAllTiles } from './tileGenerator.js'
import { downscaleRgba } from './imageResize.js'
import { BIOME_MAP, BIOMES } from '../constants/biomes.js'
import { base64ToBytes } from '../lib/serialize.js'

// Decode a stored texture buffer (base64, saved at its native size) into an
// ImageData at the REQUESTED tileSize — resizing if they differ. This lets a
// 256 px tileset be composed at a small size (e.g. a 48 px gallery thumbnail)
// instead of always rebuilding 48 tiles at the native size.
function textureImageData(b64, tileSize) {
  const bytes = new Uint8ClampedArray(base64ToBytes(b64))
  const native = Math.round(Math.sqrt(bytes.length / 4))
  if (native === tileSize) return new ImageData(bytes, tileSize, tileSize)
  return new ImageData(downscaleRgba(bytes, native, native, tileSize, tileSize), tileSize, tileSize)
}

// Frame duration for animated tiles — shared by the live pixi view, the editor
// preview, and the Tiled export's animation entries.
export const ANIM_FRAME_MS = 260
export const MAX_ANIM_FRAMES = 4

// Replaces individual generated tiles with hand-edited pixel overrides.
// `overrides` maps sheet index -> Uint8ClampedArray (RGBA at tileSize).
// Entries whose byte length doesn't match the tile size are skipped (e.g. an
// override saved at a different tile size).
export function applyTileOverrides(tiles, overrides, tileSize) {
  if (!tiles || !overrides) return tiles
  const expected = tileSize * tileSize * 4
  let out = null
  for (const [key, bytes] of Object.entries(overrides)) {
    const idx = Number(key)
    if (!Number.isInteger(idx) || idx < 0 || idx >= tiles.length) continue
    if (!bytes || bytes.length !== expected) continue
    if (!out) out = [...tiles]
    out[idx] = new ImageData(new Uint8ClampedArray(bytes), tileSize, tileSize)
  }
  return out || tiles
}

// Decodes a definition's `overrides` field ({ index: base64 }) into the
// in-memory shape ({ index: Uint8ClampedArray }).
export function decodeDefinitionOverrides(def) {
  if (!def?.overrides) return null
  const out = {}
  let any = false
  for (const [key, b64] of Object.entries(def.overrides)) {
    if (typeof b64 !== 'string' || !b64) continue
    try {
      out[key] = base64ToBytes(b64)
      any = true
    } catch {
      // Skip malformed entries; the generated tile is used instead.
    }
  }
  return any ? out : null
}

function baseTilesFromDefinition(def, tileSize) {
  if (def?.mode === 'draw') {
    const bytes = base64ToBytes(def.basePixels)
    const side = Math.round(Math.sqrt(bytes.length / 4))
    return generateAllTiles(new ImageData(new Uint8ClampedArray(bytes), side, side), side)
  }
  if (def?.mode === 'textures') {
    const centerData = textureImageData(def.centerPixels, tileSize)
    const edgeData = def.edgePixels ? textureImageData(def.edgePixels, tileSize) : null
    return generateTilesFromTextures(centerData, edgeData, tileSize, def.colors || {}, def.smooth || false)
  }
  const base = BIOME_MAP[def?.biomeId] || BIOMES[0]
  const biome = { ...base, colors: { ...base.colors, ...(def?.colors || {}) } }
  if (biome.proceduralParams?.engine === "spritecook") return generateSpriteCookTiles(biome, tileSize);
  return generateAllBiomeTiles(biome, tileSize)
}

function computeTilesFromDefinition(def, tileSize) {
  const tiles = baseTilesFromDefinition(def, tileSize)
  const overrides = decodeDefinitionOverrides(def)
  if (!overrides) return tiles
  // Draw-mode tiles render at the basePixels' own side length, which is the
  // size the overrides were saved at too.
  const size = def?.mode === 'draw'
    ? Math.round(Math.sqrt(base64ToBytes(def.basePixels).length / 4))
    : tileSize
  return applyTileOverrides(tiles, overrides, size)
}

// Generating the 48 tiles for a definition decodes base64 + runs the tile
// generators — expensive to repeat for every gallery card on every render/reopen.
// Cache by the definition's object identity (definitions are treated immutably:
// an edit produces a new object), with a per-tileSize sub-map. Callers treat the
// result as read-only (overrides do copy-on-write), so sharing the array is safe.
const tilesCache = new WeakMap()
const framesCache = new WeakMap()

export function tilesFromDefinition(def, tileSize) {
  if (!def || typeof def !== 'object') return computeTilesFromDefinition(def, tileSize)
  let bySize = tilesCache.get(def)
  if (!bySize) { bySize = new Map(); tilesCache.set(def, bySize) }
  if (bySize.has(tileSize)) return bySize.get(tileSize)
  const tiles = computeTilesFromDefinition(def, tileSize)
  bySize.set(tileSize, tiles)
  return tiles
}

// Animation frames for a PROCEDURAL definition (`animationFrames: N`): the
// N-1 extra seeded sheet variants (frame 0 = tilesFromDefinition's result).
// Returns null when the definition isn't procedural or has no animation.
// Hand-edited override tiles are applied to every frame, so they stay static.
function computeFramesFromDefinition(def, tileSize) {
  const count = Math.min(MAX_ANIM_FRAMES, def?.animationFrames | 0)
  if (!def || def.mode === 'draw' || def.mode === 'textures' || count < 2) return null
  const base = BIOME_MAP[def.biomeId] || BIOMES[0]
  const biome = { ...base, colors: { ...base.colors, ...(def.colors || {}) } }
  const overrides = decodeDefinitionOverrides(def)
  return Array.from({ length: count - 1 }, (_, f) => {
    const tiles = biome.proceduralParams?.engine === "spritecook" ? generateSpriteCookTiles(biome, tileSize, f + 1) : generateAllBiomeTiles(biome, tileSize, f + 1)
    return overrides ? applyTileOverrides(tiles, overrides, tileSize) : tiles
  })
}

export function framesFromDefinition(def, tileSize) {
  if (!def || typeof def !== 'object') return computeFramesFromDefinition(def, tileSize)
  let bySize = framesCache.get(def)
  if (!bySize) { bySize = new Map(); framesCache.set(def, bySize) }
  if (bySize.has(tileSize)) return bySize.get(tileSize)
  const frames = computeFramesFromDefinition(def, tileSize)
  bySize.set(tileSize, frames)
  return frames
}
