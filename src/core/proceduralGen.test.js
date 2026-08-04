import test from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height }
  }
}

const { valueNoise, generateAllBiomeTiles, generateBiomeTiles, generateTilesFromTextures } = await import('./proceduralGen.js')

const biome = {
  colors: { primary: '#5aa83a', secondary: '#4a9030', border: '#2a5612', highlight: '#9be05a', shadow: '#386a20' },
  proceduralParams: { edgeWidth: 2, dither: false, cornerStyle: 'organic', patternFn: 'grass' },
}

test('valueNoise is in [0,1] and deterministic', () => {
  for (const [x, y] of [[0, 0], [3, 7], [15, 2], [31, 31]]) {
    const a = valueNoise(x, y, 32, 4201, 4)
    const b = valueNoise(x, y, 32, 4201, 4)
    assert.equal(a, b)
    assert.ok(a >= 0 && a <= 1)
  }
})

test('valueNoise is toroidal (periodic with period s) → seamless tiling', () => {
  const s = 32, g = 4, seed = 4201
  for (const y of [0, 5, 17, 31]) {
    // The value one full tile to the right/below must equal the value at the origin
    // column/row, so repeated tiles join without a seam.
    assert.ok(Math.abs(valueNoise(0, y, s, seed, g) - valueNoise(s, y, s, seed, g)) < 1e-9)
    assert.ok(Math.abs(valueNoise(y, 0, s, seed, g) - valueNoise(y, s, s, seed, g)) < 1e-9)
  }
})

test('generateAllBiomeTiles is deterministic and yields 48 tiles', () => {
  const a = generateAllBiomeTiles(biome, 32)
  const b = generateAllBiomeTiles({ ...biome }, 32) // fresh object → bypasses identity, recomputes
  assert.equal(a.length, 48)
  assert.equal(b.length, 48)
  for (let i = 0; i < 48; i++) {
    assert.deepEqual(Array.from(a[i].data), Array.from(b[i].data))
  }
})

test('SpriteCook procedural mode preserves the biome texture behind transparent platform edges', () => {
  const spriteCookBiome = {
    ...biome,
    proceduralParams: { ...biome.proceduralParams, engine: 'spritecook' },
  }
  const dispatched = generateBiomeTiles(spriteCookBiome, 16)

  assert.equal(dispatched.length, 48)
  assert.equal(dispatched[0].data[3], 0, 'empty slot must be transparent')
  assert.equal(dispatched[1].data[3], 0, 'isolated platform corner must reveal the layer below')
  assert.equal(dispatched[1].data[((8 * 16 + 8) * 4) + 3], 255, 'platform centre remains opaque')
  for (let i = 0; i < dispatched[1].data.length; i += 4) {
    if (!dispatched[1].data[i + 3]) continue
    assert.deepEqual(
      Array.from(dispatched[1].data.slice(i, i + 3)),
      Array.from(dispatched[47].data.slice(i, i + 3)),
      'visible platform pixels must come directly from the seamless fill texture',
    )
  }
  for (let i = 3; i < dispatched[47].data.length; i += 4) {
    assert.equal(dispatched[47].data[i], 255, 'fully surrounded fill tile remains opaque')
  }
})

test('SpriteCook masking also applies to imported or AI procedural textures', () => {
  const size = 16
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 80; pixels[i + 1] = 120; pixels[i + 2] = 60; pixels[i + 3] = 255
  }
  const tiles = generateTilesFromTextures(
    new ImageData(pixels, size, size),
    null,
    size,
    biome.colors,
    false,
    { engine: 'spritecook' },
  )

  assert.equal(tiles[1].data[3], 0)
  assert.equal(tiles[1].data[((8 * size + 8) * 4) + 3], 255)
})

test('the fill tile carries mottling (not a single flat colour)', () => {
  const tiles = generateAllBiomeTiles(biome, 32)
  const fill = tiles[47] // FILL_INDEX
  const colours = new Set()
  for (let i = 0; i < fill.data.length; i += 4) {
    colours.add(`${fill.data[i]},${fill.data[i + 1]},${fill.data[i + 2]}`)
  }
  // A flat fill would be ~1 colour; mottling + pattern must add several tones.
  assert.ok(colours.size >= 3, `expected varied tones, got ${colours.size}`)
})
