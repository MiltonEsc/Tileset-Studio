import { BITS, BITMASK_TO_INDEX } from '../constants/bitmaskTable.js'

// A level map is a flat Uint8Array of length w*h: 1 = solid, 0 = empty.

export function createGrid(w, h, fill = 0) {
  return new Uint8Array(w * h).fill(fill)
}

export function gridGet(grid, w, h, x, y, outOfBounds = 0) {
  if (x < 0 || x >= w || y < 0 || y >= h) return outOfBounds
  return grid[y * w + x]
}

export function gridSet(grid, w, x, y, value) {
  grid[y * w + x] = value
}

// Computes the autotile sheet index for a single solid cell at (x,y).
// Out-of-bounds neighbors are treated as `border` (0 = empty by default,
// so map edges show borders; pass 1 to make edges seamless).
// Returns the sheet index (0..47). Returns 0 (empty) if the cell is not solid.
// SpriteCook's 15-piece sheet is a dual-grid corner mask. Values are source
// sheet slots in its original 4x4 layout; mask 0 is transparent, represented
// as -1 so it does not collide with the normal Blob-47 empty index (0).
const DUAL_GRID_15_SLOT = new Int16Array([
  -1, 15, 8, 9, 0, 11, 14, 7, 13, 4, 1, 10, 3, 2, 5, 6,
])
const CARDINAL_17_SLOT = new Int16Array([
  20, 15, 21, 16, 5, 10, 6, 11, 23, 18, 22, 17, 8, 13, 7, 12,
])

export function autotileModeForDefinition(definition) {
  if (definition?.autotile) return definition.autotile
  // Backward compatibility for SpriteCook sheets saved before the explicit
  // `autotile` marker was added.
  if (definition?.source === 'spritecook-tileset-gen' && definition?.layout === 'topdown-15') return 'dual-grid-15'
  if (definition?.source === 'spritecook-tileset-gen' && definition?.layout === 'topdown-17') return 'cardinal-17'
  return 'blob47'
}

// Manual sheets are manual by default. They become autotile layers only when
// they explicitly declare Blob-47, or when they are one of the legacy
// SpriteCook layouts whose mode can be inferred from their layout metadata.
export function isAutotileDefinition(definition) {
  const mode = autotileModeForDefinition(definition)
  return mode === 'dual-grid-15'
    || mode === 'cardinal-17'
    || (mode === 'blob47' && definition?.autotile === 'blob47')
}

export function getDualGridTileIndex(grid, w, h, x, y, border = 0) {
  let mask = 0
  if (gridGet(grid, w, h, x,     y,     border)) mask |= 1
  if (gridGet(grid, w, h, x + 1, y,     border)) mask |= 2
  if (gridGet(grid, w, h, x,     y + 1, border)) mask |= 4
  if (gridGet(grid, w, h, x + 1, y + 1, border)) mask |= 8
  return DUAL_GRID_15_SLOT[mask]
}

export function getCardinal17TileIndex(grid, w, h, x, y, border = 0) {
  if (!gridGet(grid, w, h, x, y)) return -1
  let mask = 0
  if (gridGet(grid, w, h, x,     y - 1, border)) mask |= 1
  if (gridGet(grid, w, h, x + 1, y,     border)) mask |= 2
  if (gridGet(grid, w, h, x,     y + 1, border)) mask |= 4
  if (gridGet(grid, w, h, x - 1, y,     border)) mask |= 8
  return CARDINAL_17_SLOT[mask]
}

export function getTileIndex(grid, w, h, x, y, border = 0, mode = 'blob47') {
  if (mode === 'dual-grid-15') return getDualGridTileIndex(grid, w, h, x, y, border)
  if (mode === 'cardinal-17') return getCardinal17TileIndex(grid, w, h, x, y, border)
  if (gridGet(grid, w, h, x, y) === 0) return 0

  const t  = gridGet(grid, w, h, x,     y - 1, border)
  const b  = gridGet(grid, w, h, x,     y + 1, border)
  const l  = gridGet(grid, w, h, x - 1, y,     border)
  const r  = gridGet(grid, w, h, x + 1, y,     border)
  const tl = gridGet(grid, w, h, x - 1, y - 1, border)
  const tr = gridGet(grid, w, h, x + 1, y - 1, border)
  const bl = gridGet(grid, w, h, x - 1, y + 1, border)
  const br = gridGet(grid, w, h, x + 1, y + 1, border)

  let mask = 0
  if (t) mask |= BITS.T
  if (b) mask |= BITS.B
  if (l) mask |= BITS.L
  if (r) mask |= BITS.R
  // Diagonals only count when both adjacent cardinals are present (pruning rule)
  if (tl && t && l) mask |= BITS.TL
  if (tr && t && r) mask |= BITS.TR
  if (bl && b && l) mask |= BITS.BL
  if (br && b && r) mask |= BITS.BR

  // After pruning, mask is always one of the 47 valid configurations
  const index = BITMASK_TO_INDEX.get(mask)
  return index !== undefined ? index : 1
}

// Returns an Int16Array of length w*h with the sheet index for every cell.
export function computeIndexMap(grid, w, h, border = 0, mode = 'blob47') {
  const out = new Int16Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = getTileIndex(grid, w, h, x, y, border, mode)
    }
  }
  return out
}

// Incrementally updates a previously computed index map after some grid cells
// changed. Only the changed cells and their 8 neighbors are re-evaluated, so a
// brush stroke costs O(changed) instead of O(w*h). Falls back to a full compute
// when the previous map/grid are missing or the shape differs.
// When `dirty` (array) is passed, the cell indices whose sheet index actually
// changed are pushed onto it (useful for partial canvas redraws).
// Returns { map, full }.
export function patchIndexMap(prevMap, prevGrid, grid, w, h, border = 0, dirty = null, mode = 'blob47') {
  if (!prevMap || !prevGrid || prevGrid.length !== grid.length || prevMap.length !== w * h) {
    return { map: computeIndexMap(grid, w, h, border, mode), full: true }
  }
  const out = new Int16Array(prevMap)
  const done = new Set()
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === prevGrid[i]) continue
    const cx = i % w
    const cy = (i / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ci = ny * w + nx
        if (done.has(ci)) continue
        done.add(ci)
        const after = getTileIndex(grid, w, h, nx, ny, border, mode)
        if (after !== out[ci]) {
          out[ci] = after
          if (dirty) dirty.push(ci)
        }
      }
    }
  }
  return { map: out, full: false }
}

// Same as patchIndexMap, but the caller provides the exact cell indices that
// changed in the source grid. This avoids scanning the whole map to discover
// diffs during brush strokes.
export function patchIndexMapFromCells(prevMap, grid, changedCells, w, h, border = 0, dirty = null, mode = 'blob47') {
  if (!prevMap || prevMap.length !== w * h || !changedCells?.length) {
    return { map: computeIndexMap(grid, w, h, border, mode), full: true }
  }
  const out = new Int16Array(prevMap)
  const done = new Set()
  for (const cell of changedCells) {
    const cx = cell % w
    const cy = (cell / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ci = ny * w + nx
        if (done.has(ci)) continue
        done.add(ci)
        const after = getTileIndex(grid, w, h, nx, ny, border, mode)
        if (after !== out[ci]) {
          out[ci] = after
          if (dirty) dirty.push(ci)
        }
      }
    }
  }
  return { map: out, full: false }
}
