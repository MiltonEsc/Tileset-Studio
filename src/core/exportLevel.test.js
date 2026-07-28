import test from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height }
  }
}
// composeNativeSheet needs a DOM canvas; stub just enough for the model build.
if (!globalThis.document) {
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ imageSmoothingEnabled: false, putImageData() {}, drawImage() {} }),
    }),
  }
}

const { buildLevelModel, tiledMap, genericJson } = await import('./exportLevel.js')

function fakeLevel() {
  const width = 3, height = 2
  const grid = new Uint8Array([
    1, 1, 0,
    0, 1, 0,
  ])
  const manualTiles = new Int16Array(width * height).fill(-1)
  return {
    width, height, seamlessEdges: false,
    placedProps: [{ id: 'p1', assetId: 'tree', x: 1, y: 0, flipX: true, rotation: 90 }],
    layers: [{ id: 'l1', name: 'Ground', kind: 'autotile', visible: true, grid, manualTiles }],
  }
}

const fakeLayerTiles = [{ tiles: new Array(48).fill(null).map(() => ({})), tileSize: 16 }]
const ctx = { level: fakeLevel(), layerTiles: fakeLayerTiles, tileSize: 16, assetsById: { tree: { cols: 1, rows: 2 } } }

test('tileVariation bakes fill variants: extended sheet + variant tile indices', () => {
  const size = 8
  const tiles = new Array(48).fill(null).map(() => ({}))
  const fill = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < fill.length; i += 4) { fill[i] = (i / 4) % 256; fill[i + 1] = 120; fill[i + 2] = 70; fill[i + 3] = 255 }
  tiles[47] = new ImageData(fill, size, size) // FILL_INDEX = 47
  const grid = new Uint8Array(9).fill(1)       // 3x3 all solid → centre cell is the fill tile
  const manualTiles = new Int16Array(9).fill(-1)
  const level = { width: 3, height: 3, seamlessEdges: false, placedProps: [], layers: [{ id: 'l', name: 'G', kind: 'autotile', visible: true, grid, manualTiles }] }
  const lt = [{ tiles, tileSize: size }]

  const plain = buildLevelModel({ level, layerTiles: lt, tileSize: size })
  assert.equal(plain.tilesets[0].tileCount, 48)
  assert.equal(plain.layers[0].data[4], 47) // centre stays the base fill

  const baked = buildLevelModel({ level, layerTiles: lt, tileSize: size, tileVariation: true })
  assert.ok(baked.tilesets[0].tileCount > 48) // variant tiles appended
  assert.ok(baked.tilesets[0].rows > 6)
  const centre = baked.layers[0].data[4]
  assert.ok(centre === 47 || centre >= 48)    // base fill or one of the variant tiles
})

test('buildLevelModel resolves indices, dedupes tilesets, and keeps props', () => {
  const model = buildLevelModel(ctx)
  assert.equal(model.width, 3)
  assert.equal(model.height, 2)
  assert.equal(model.tilesets.length, 1)
  assert.equal(model.layers.length, 1)
  assert.equal(model.layers[0].data.length, 6)
  // Cell (2,0) and (2,1) are empty terrain → -1; solid cells are >= 0.
  assert.equal(model.layers[0].data[2], -1)
  assert.equal(model.layers[0].data[5], -1)
  assert.ok(model.layers[0].data[0] >= 0)
  assert.deepEqual(model.props, [
    { asset: 'tree', x: 1, y: 0, cols: 1, rows: 2, flipX: true, flipY: false, rotation: 90 },
  ])
})

test('prop transforms reach the Tiled object (rotation + flip props) and generic JSON', () => {
  const model = buildLevelModel(ctx)
  const map = tiledMap(model, 'level_3x2')
  const obj = map.layers.find(l => l.type === 'objectgroup').objects[0]
  assert.equal(obj.rotation, 90)
  assert.ok(obj.properties.some(p => p.name === 'flipX' && p.value === true))

  const json = genericJson(model, 'level_3x2')
  assert.equal(json.props[0].flipX, true)
  assert.equal(json.props[0].rotation, 90)
})

test('tiledMap encodes empty as gid 0 and tiles as firstgid + index', () => {
  const model = buildLevelModel(ctx)
  const map = tiledMap(model, 'level_3x2')
  assert.equal(map.orientation, 'orthogonal')
  assert.equal(map.tilewidth, 16)
  assert.equal(map.tilesets[0].firstgid, 1)
  assert.equal(map.tilesets[0].image, 'level_3x2_tileset_0.png')
  const tileLayer = map.layers.find(l => l.type === 'tilelayer')
  assert.equal(tileLayer.data[2], 0) // empty
  assert.equal(tileLayer.data[0], 1 + model.layers[0].data[0]) // firstgid + index
  // Props become an object group.
  assert.ok(map.layers.some(l => l.type === 'objectgroup' && l.objects.length === 1))
})

test('animated tilesets append frame blocks and emit Tiled animation entries', () => {
  const frames = [new Array(48).fill(null).map(() => ({}))] // one extra frame
  const lt = [{ tiles: new Array(48).fill(null).map(() => ({})), tileSize: 16, frames }]
  const model = buildLevelModel({ level: fakeLevel(), layerTiles: lt, tileSize: 16 })
  const ts = model.tilesets[0]
  assert.equal(ts.frameCount, 1)
  assert.equal(ts.frameStart, 48) // no variants → frames right after the base block
  assert.equal(ts.tileCount, 96)

  const map = tiledMap(model, 'level_3x2')
  const entry = map.tilesets[0]
  assert.equal(entry.tilecount, 96)
  assert.equal(entry.tiles.length, 47) // every autotile id gets an animation
  assert.deepEqual(entry.tiles[0].animation.map(a => a.tileid), [1, 49]) // id 1 → frame copy at 48+1
  assert.ok(entry.tiles[0].animation.every(a => a.duration > 0))

  const json = genericJson(model, 'level_3x2')
  assert.equal(json.tilesets[0].animation.frameCount, 1)
  assert.equal(json.tilesets[0].animation.frameStart, 48)
})

test('genericJson carries flat per-layer data and tileset refs', () => {
  const model = buildLevelModel(ctx)
  const json = genericJson(model, 'level_3x2')
  assert.equal(json.format, 'tileset-studio-level')
  assert.equal(json.tileSize, 16)
  assert.equal(json.tilesets[0].image, 'level_3x2_tileset_0.png')
  assert.equal(json.layers[0].data.length, 6)
  assert.equal(json.layers[0].tileset, 0)
})
