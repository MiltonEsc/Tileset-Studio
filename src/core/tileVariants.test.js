import test from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height }
  }
}

const { FILL_INDEX, VARIANT_COUNT, makeFillVariants, pickVariant } = await import('./tileVariants.js')

function gradientTile(size) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      data[i] = (x * 17) % 256
      data[i + 1] = (y * 23) % 256
      data[i + 2] = ((x + y) * 11) % 256
      data[i + 3] = 255
    }
  }
  return new ImageData(data, size, size)
}

test('FILL_INDEX is the all-neighbours fill tile (47)', () => {
  assert.equal(FILL_INDEX, 47)
})

test('makeFillVariants returns VARIANT_COUNT variants that differ from the base but keep the border', () => {
  const size = 16
  const base = gradientTile(size)
  const variants = makeFillVariants(base, size)
  assert.equal(variants.length, VARIANT_COUNT)

  for (const v of variants) {
    assert.equal(v.width, size)
    // Border pixels (row/col 0 and last) must be untouched → seamless preserved.
    for (let x = 0; x < size; x++) {
      for (const y of [0, size - 1]) {
        const i = (y * size + x) * 4
        assert.equal(v.data[i], base.data[i])
        assert.equal(v.data[i + 1], base.data[i + 1])
      }
    }
    for (let y = 0; y < size; y++) {
      for (const x of [0, size - 1]) {
        const i = (y * size + x) * 4
        assert.equal(v.data[i], base.data[i])
      }
    }
    // Interior must actually differ somewhere.
    let differs = false
    for (let i = 0; i < v.data.length; i++) if (v.data[i] !== base.data[i]) { differs = true; break }
    assert.ok(differs)
  }
})

test('makeFillVariants is deterministic and introduces no new colours', () => {
  const size = 16
  const base = gradientTile(size)
  const a = makeFillVariants(base, size)
  const b = makeFillVariants(base, size)
  assert.deepEqual(Array.from(a[0].data), Array.from(b[0].data))

  // Variants only shuffle existing pixels → the colour multiset is unchanged.
  const colours = (img) => {
    const s = new Set()
    for (let i = 0; i < img.data.length; i += 4) s.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
    return s
  }
  const baseColours = colours(base)
  for (const c of colours(a[0])) assert.ok(baseColours.has(c))
})

test('makeFillVariants produces pairwise-distinct variants (genuine variety)', () => {
  const size = 16
  const base = gradientTile(size)
  const variants = makeFillVariants(base, size)
  assert.ok(variants.length >= 7) // flipX/flipY/rot180/rot90/rot270/transpose/antitranspose
  const key = (img) => Array.from(img.data).join(',')
  const seen = new Set()
  for (const v of variants) {
    const k = key(v)
    assert.ok(!seen.has(k), 'each variant must be unique')
    seen.add(k)
  }
})

test('pickVariant is deterministic and in range', () => {
  for (const [x, y] of [[0, 0], [3, 5], [12, 7]]) {
    assert.equal(pickVariant(x, y, 4), pickVariant(x, y, 4))
    const p = pickVariant(x, y, 4)
    assert.ok(p >= 0 && p < 4)
  }
  assert.equal(pickVariant(2, 2, 1), 0) // total 1 → always base
})
