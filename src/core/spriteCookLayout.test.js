import test from 'node:test'
import assert from 'node:assert/strict'
import { spriteCookLayoutInfo } from './spriteCookLayout.js'

test('SpriteCook platform layout matches the editor Blob-47 sheet contract', () => {
  assert.deepEqual(spriteCookLayoutInfo('platform-47'), {
    columns: 8,
    rows: 6,
    pieceLabel: '47+1-piece platform',
    autotile: 'blob47',
  })
})

test('SpriteCook keeps the existing 15-piece fallback for unknown layouts', () => {
  assert.equal(spriteCookLayoutInfo('unknown').autotile, 'dual-grid-15')
  assert.equal(spriteCookLayoutInfo('unknown').columns, 4)
})
