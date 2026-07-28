import test from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height }
  }
}

const { valueNoise, generateAllBiomeTiles } = await import('./proceduralGen.js')

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
