import test from 'node:test'
import assert from 'node:assert/strict'

const { normalizePixelSnapOptions } = await import('./pixelSnapper.js')

test('normalizePixelSnapOptions defaults to 16 colors and automatic grid detection', () => {
  assert.deepEqual(normalizePixelSnapOptions(), { colorCount: 16, pixelSize: null })
  assert.deepEqual(normalizePixelSnapOptions({ colorCount: '24', pixelSize: '' }), { colorCount: 24, pixelSize: null })
  assert.deepEqual(normalizePixelSnapOptions({ colorCount: 8, pixelSize: '6' }), { colorCount: 8, pixelSize: 6 })
})

test('normalizePixelSnapOptions rejects invalid form values before loading WASM', () => {
  assert.throws(() => normalizePixelSnapOptions({ colorCount: 0 }), /between 1 and 256/)
  assert.throws(() => normalizePixelSnapOptions({ colorCount: 16.5 }), /between 1 and 256/)
  assert.throws(() => normalizePixelSnapOptions({ pixelSize: -2 }), /positive number/)
})
