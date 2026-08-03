import test from 'node:test'
import assert from 'node:assert/strict'
import { computeIndexMap, patchIndexMapFromCells } from './autotile.js'

test('SpriteCook dual-grid autotile maps one painted point to four connected corner pieces', () => {
  const w = 3, h = 3
  const grid = new Uint8Array(w * h)
  grid[1 * w + 1] = 1
  const map = computeIndexMap(grid, w, h, 0, 'dual-grid-15')

  assert.equal(map[0 * w + 0], 13) // mask 8 (bottom-right corner)
  assert.equal(map[0 * w + 1], 0)  // mask 4 (bottom-left corner)
  assert.equal(map[1 * w + 0], 8)  // mask 2 (top-right corner)
  assert.equal(map[1 * w + 1], 15) // mask 1 (top-left corner)
  assert.equal(map[2 * w + 2], -1)
})

test('SpriteCook dual-grid incremental updates match a full recompute', () => {
  const w = 4, h = 4
  const grid = new Uint8Array(w * h)
  const before = computeIndexMap(grid, w, h, 0, 'dual-grid-15')
  grid[2 * w + 2] = 1
  const dirty = []
  const patched = patchIndexMapFromCells(before, grid, [2 * w + 2], w, h, 0, dirty, 'dual-grid-15').map
  const expected = computeIndexMap(grid, w, h, 0, 'dual-grid-15')

  assert.deepEqual(patched, expected)
  assert.deepEqual(new Set(dirty), new Set([5, 6, 9, 10]))
})

test('SpriteCook 17-piece mode autotiles cardinal connections in its original 5x5 slots', () => {
  const w = 5, h = 3
  const grid = new Uint8Array(w * h)
  grid[1 * w + 1] = 1
  grid[1 * w + 2] = 1
  grid[1 * w + 3] = 1
  const map = computeIndexMap(grid, w, h, 0, 'cardinal-17')

  assert.equal(map[1 * w + 1], 21) // east connection
  assert.equal(map[1 * w + 2], 22) // east + west horizontal stroke
  assert.equal(map[1 * w + 3], 23) // west connection
  assert.equal(map[0], -1)
})
