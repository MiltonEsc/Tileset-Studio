import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRegionToState,
  captureRegion,
  decodeRegionPlane,
  deleteRegionFromState,
  resolveRegionLayers,
  transformRegionPayload,
} from './levelSelection.js'

function layer(id, name, kind, width, grid = [], manual = [], tileset = null) {
  const cells = width * Math.max(1, Math.ceil(Math.max(grid.length, manual.length) / width))
  const gridData = new Uint8Array(cells)
  gridData.set(grid)
  const manualData = new Int16Array(cells).fill(-1)
  manualData.set(manual)
  return { id, name, kind, visible: true, tileset, grid: gridData, manualTiles: manualData }
}

function state(width, height, layers, placedProps = []) {
  return { width, height, layers, placedProps }
}

test('captures multiple layers and relative props through a JSON round trip', () => {
  const layers = [
    layer('ground', 'Ground', 'autotile', 4, [0, 1, 1, 0, 0, 1, 0, 0]),
    layer('detail', 'Detail', 'manual', 4, [], [-1, 8, 9, -1, -1, 4, -1, -1], { id: 'forest' }),
  ]
  const payload = captureRegion({
    width: 4, height: 2, layers, placedProps: [{ id: 'p1', assetId: 'tree', x: 2, y: 1 }],
    rect: { x: 1, y: 0, width: 2, height: 2 }, layerIds: ['ground', 'detail'],
    includeProps: true, tileSize: 16, assetsById: { tree: { cols: 2, rows: 3 } },
  })
  const restored = JSON.parse(JSON.stringify(payload))
  assert.equal(restored.version, 1)
  assert.deepEqual([restored.width, restored.height], [2, 2])
  assert.deepEqual(restored.props[0], { assetId: 'tree', dx: 1, dy: 1, flipX: false, flipY: false, rotation: 0, zOrder: 0, cols: 2, rows: 3 })
  assert.deepEqual([...decodeRegionPlane(restored.planes[0], 2, 2).grid], [1, 1, 1, 0])
  assert.deepEqual([...decodeRegionPlane(restored.planes[1], 2, 2).manualTiles], [8, 9, 4, -1])
})

test('overlay preserves empty destination cells while replace clears them and destination props', () => {
  const sourceLayer = layer('ground', 'Ground', 'manual', 2, [], [7, -1])
  const payload = captureRegion({ width: 2, height: 1, layers: [sourceLayer], rect: { x: 0, y: 0, width: 2, height: 1 }, layerIds: ['ground'], tileSize: 16 })
  const base = state(3, 1, [layer('ground', 'Ground', 'manual', 3, [], [1, 2, 3])], [{ id: 'old', assetId: 'rock', x: 2, y: 0 }])
  const overlay = applyRegionToState(base, payload, { x: 1, y: 0, mode: 'overlay', includeProps: true })
  assert.deepEqual([...overlay.layers[0].manualTiles], [1, 7, 3])
  assert.equal(overlay.placedProps.length, 1)
  const replace = applyRegionToState(base, payload, { x: 1, y: 0, mode: 'replace', includeProps: true })
  assert.deepEqual([...replace.layers[0].manualTiles], [1, 7, -1])
  assert.equal(replace.placedProps.length, 0)
})

test('overlapping move clears from a snapshot and does not corrupt copied cells', () => {
  const original = layer('ground', 'Ground', 'manual', 3, [], [4, 5, 6])
  const base = state(3, 1, [original])
  const payload = captureRegion({ width: 3, height: 1, layers: [original], rect: { x: 0, y: 0, width: 2, height: 1 }, layerIds: ['ground'], tileSize: 16 })
  const moved = applyRegionToState(base, payload, {
    x: 1, y: 0, mode: 'overlay', clearSource: { rect: { x: 0, y: 0, width: 2, height: 1 }, layerIds: ['ground'], includeProps: false },
  })
  assert.deepEqual([...moved.layers[0].manualTiles], [-1, 4, 5])
})

test('rectangular rotation moves tiles without changing indices and transforms props', () => {
  const source = layer('ground', 'Ground', 'manual', 3, [], [1, 2, 3, 4, 5, 6])
  const payload = captureRegion({
    width: 3, height: 2, layers: [source], placedProps: [{ id: 'p', assetId: 'tree', x: 0, y: 1 }],
    rect: { x: 0, y: 0, width: 3, height: 2 }, layerIds: ['ground'], tileSize: 16,
  })
  const rotated = transformRegionPayload(payload, 'rotate')
  assert.deepEqual([rotated.width, rotated.height], [2, 3])
  assert.deepEqual([...decodeRegionPlane(rotated.planes[0], 2, 3).manualTiles], [4, 1, 5, 2, 6, 3])
  assert.deepEqual({ dx: rotated.props[0].dx, dy: rotated.props[0].dy, rotation: rotated.props[0].rotation }, { dx: 0, dy: 0, rotation: 90 })
  const flipped = transformRegionPayload(payload, 'flipX')
  assert.deepEqual([...decodeRegionPlane(flipped.planes[0], 3, 2).manualTiles], [3, 2, 1, 6, 5, 4])
  assert.equal(flipped.props[0].flipX, true)
  const counterClockwise = transformRegionPayload(payload, 'rotate270')
  assert.deepEqual([...decodeRegionPlane(counterClockwise.planes[0], 2, 3).manualTiles], [3, 6, 2, 5, 1, 4])
  assert.deepEqual({ dx: counterClockwise.props[0].dx, dy: counterClockwise.props[0].dy, rotation: counterClockwise.props[0].rotation }, { dx: 1, dy: 2, rotation: 270 })
})

test('expands left and top, shifting existing content, props and destination selection', () => {
  const source = layer('ground', 'Ground', 'manual', 1, [], [9])
  const payload = captureRegion({ width: 1, height: 1, layers: [source], rect: { x: 0, y: 0, width: 1, height: 1 }, layerIds: ['ground'], tileSize: 16 })
  const base = state(2, 2, [layer('ground', 'Ground', 'manual', 2, [], [1, -1, -1, -1])], [{ id: 'p', assetId: 'tree', x: 0, y: 0 }])
  const result = applyRegionToState(base, payload, { x: -1, y: -2, maxWidth: 1024, maxHeight: 1024 })
  assert.deepEqual([result.width, result.height, result.shiftX, result.shiftY], [3, 4, 1, 2])
  assert.deepEqual(result.selectionRect, { x: 0, y: 0, width: 1, height: 1 })
  assert.deepEqual([result.placedProps[0].x, result.placedProps[0].y], [1, 2])
  assert.equal(result.layers[0].manualTiles[2 * 3 + 1], 1)
  assert.equal(result.layers[0].manualTiles[0], 9)
})

test('expands right and bottom without shifting existing content and enforces the render limit', () => {
  const source = layer('ground', 'Ground', 'manual', 2, [], [8, 9])
  const payload = captureRegion({ width: 2, height: 1, layers: [source], rect: { x: 0, y: 0, width: 2, height: 1 }, layerIds: ['ground'], tileSize: 16 })
  const base = state(2, 2, [layer('ground', 'Ground', 'manual', 2, [], [1, -1, -1, -1])])
  const result = applyRegionToState(base, payload, { x: 2, y: 3, maxWidth: 8, maxHeight: 8 })
  assert.deepEqual([result.width, result.height, result.shiftX, result.shiftY], [4, 4, 0, 0])
  assert.equal(result.layers[0].manualTiles[0], 1)
  assert.deepEqual([...result.layers[0].manualTiles.slice(14, 16)], [8, 9])
  const rejected = applyRegionToState(base, payload, { x: 8, y: 0, maxWidth: 8, maxHeight: 8 })
  assert.match(rejected.error, /render limit/i)
})

test('maps by id or compatible name and creates a layer for incompatible manual tilesets', () => {
  const planes = [
    { sourceLayerId: 'exact', name: 'A', kind: 'autotile', order: 0, tileset: { id: 1 } },
    { sourceLayerId: 'foreign', name: 'Decor', kind: 'manual', order: 1, tileset: { id: 'blue' } },
  ]
  const existing = [
    { id: 'exact', name: 'Other', kind: 'autotile' },
    { id: 'manual-red', name: 'Decor', kind: 'manual', tileset: { id: 'red' } },
  ]
  let next = 0
  const resolved = resolveRegionLayers(planes, existing, () => `new-${++next}`)
  assert.equal(resolved.mappings[0].layerIdx, 0)
  assert.equal(resolved.layers.length, 3)
  assert.equal(resolved.layers[2].id, 'new-1')
  assert.deepEqual(resolved.layers[2].tileset, { id: 'blue' })

  const externalCollision = resolveRegionLayers([planes[0]], existing, () => 'external-layer', {}, false)
  assert.equal(externalCollision.layers.at(-1).id, 'external-layer')

  const fallbackMatch = resolveRegionLayers([planes[1]], [existing[1]], () => 'unused', { 'manual-red': { id: 'blue' } })
  assert.equal(fallbackMatch.layers.length, 1)
  assert.equal(fallbackMatch.mappings[0].layerIdx, 0)
})

test('delete respects layer selection and missing stamp assets are skipped with a warning', () => {
  const ground = layer('ground', 'Ground', 'manual', 2, [], [1, 2])
  const detail = layer('detail', 'Detail', 'manual', 2, [], [3, 4])
  const deleted = deleteRegionFromState(state(2, 1, [ground, detail], [{ id: 'p', assetId: 'tree', x: 0, y: 0 }]), { x: 0, y: 0, width: 1, height: 1 }, ['ground'], true)
  assert.deepEqual([...deleted.layers[0].manualTiles], [-1, 2])
  assert.deepEqual([...deleted.layers[1].manualTiles], [3, 4])
  assert.equal(deleted.placedProps.length, 0)

  const payload = captureRegion({ width: 2, height: 1, layers: [ground], placedProps: [{ id: 'p', assetId: 'missing', x: 0, y: 0 }], rect: { x: 0, y: 0, width: 1, height: 1 }, layerIds: ['ground'], tileSize: 16 })
  const placed = applyRegionToState(state(2, 1, [ground]), payload, { x: 1, y: 0, validAssetIds: new Set(['known']) })
  assert.deepEqual(placed.missingAssetIds, ['missing'])
  assert.equal(placed.placedProps.length, 0)
})
