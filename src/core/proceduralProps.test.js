import test from 'node:test'
import assert from 'node:assert/strict'
import { PROP_TYPES, defaultPropParams, sanitizePropParams, generateProp } from './proceduralProps.js'

const COLORS = { main: '#9c6b3f', dark: '#5e3a1e', light: '#c79a63' }

test('every prop type draws something opaque and keeps transparency', () => {
  const W = 32, H = 32
  for (const t of PROP_TYPES) {
    const data = generateProp(t.key, W, H, COLORS, defaultPropParams(t.key))
    assert.equal(data.length, W * H * 4)
    let opaque = 0, transparent = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 255) opaque++
      else if (data[i] === 0) transparent++
    }
    assert.ok(opaque > 0, `${t.key} drew no opaque pixels`)
    assert.ok(transparent > 0, `${t.key} is fully opaque (no transparency)`)
    // Opaque pixels must use one of the 3 provided colours (no stray colours).
    const allowed = new Set(['156,107,63', '94,58,30', '199,154,99'])
    for (let p = 0; p < data.length; p += 4) {
      if (data[p + 3] === 255) {
        assert.ok(allowed.has(`${data[p]},${data[p + 1]},${data[p + 2]}`))
      }
    }
  }
})

test('sanitizePropParams clamps to range and drops unknown keys', () => {
  const out = sanitizePropParams('stairs', { steps: 999, junk: 1 })
  assert.equal(out.steps, 10) // clamped to max
  assert.equal('junk' in out, false)
  assert.equal('mirror' in out, true) // filled default
  assert.deepEqual(sanitizePropParams('nope', {}), {})
})

test('defaultPropParams matches each type\'s declared defaults', () => {
  assert.deepEqual(defaultPropParams('pipe'), { diameter: 8, vertical: 0 })
  assert.deepEqual(defaultPropParams('fence'), { posts: 4, rails: 2, thickness: 2 })
})

test('generateProp tolerates an unknown type (fully transparent buffer)', () => {
  const data = generateProp('nope', 8, 8, COLORS, {})
  assert.equal(data.length, 8 * 8 * 4)
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 0)
})
