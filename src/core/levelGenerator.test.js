import test from 'node:test'
import assert from 'node:assert/strict'
import { GENERATORS, GENERATOR_PARAMS, defaultParams, sanitizeParams } from './levelGenerator.js'

test('defaultParams returns each generator\'s declared defaults', () => {
  assert.deepEqual(defaultParams('caves'), { density: 0.45, steps: 5 })
  assert.deepEqual(defaultParams('random'), { density: 0.5 })
  assert.deepEqual(defaultParams('unknown'), {})
})

test('sanitizeParams clamps to range, fills missing, drops unknown keys', () => {
  const out = sanitizeParams('caves', { density: 5, junk: 1 })
  assert.equal(out.density, GENERATOR_PARAMS.caves[0].max) // clamped from 5
  assert.equal(out.steps, 5)                               // filled default
  assert.equal('junk' in out, false)                       // dropped
})

test('sanitizeParams keeps min ≤ max for ordered pairs', () => {
  const p = sanitizeParams('platforms', { minWidth: 10, maxWidth: 2 })
  assert.ok(p.maxWidth >= p.minWidth)
  const r = sanitizeParams('rooms', { minSize: 9, maxSize: 4 })
  assert.ok(r.maxSize >= r.minSize)
})

test('sanitizeParams of unknown generator is empty and safe', () => {
  assert.deepEqual(sanitizeParams('nope', { a: 1 }), {})
})

test('every generator runs with sanitized params and returns a full 0/1 grid', () => {
  const w = 12, h = 8
  for (const type of Object.keys(GENERATORS)) {
    const grid = GENERATORS[type].fn(w, h, { ...sanitizeParams(type, {}), seed: 123 })
    assert.equal(grid.length, w * h)
    for (const v of grid) assert.ok(v === 0 || v === 1)
  }
})
