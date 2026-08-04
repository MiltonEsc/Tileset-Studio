import test from 'node:test'
import assert from 'node:assert/strict'
import { SPRITECOOK_BLOB47_MASKS, SPRITECOOK_DEFAULTS, spriteCookSheetInfo } from './spriteCookBaseGenerator.js'

test('native SpriteCook generator exposes all three complete sheet layouts', () => {
  assert.deepEqual(spriteCookSheetInfo('topdown-15', 32), { columns: 4, rows: 4, width: 128, height: 128, pieceLabel: '15-piece top-down' })
  assert.deepEqual(spriteCookSheetInfo('topdown-17', 32), { columns: 5, rows: 5, width: 160, height: 160, pieceLabel: '17-piece top-down' })
  assert.deepEqual(spriteCookSheetInfo('platform-47', 32), { columns: 8, rows: 6, width: 256, height: 192, pieceLabel: '47+1-piece platform' })
  assert.equal(SPRITECOOK_BLOB47_MASKS.length, 47)
})

test('native SpriteCook defaults retain every standalone output option', () => {
  for (const key of ['elevationEdge', 'elevationDepth', 'whiteBackground', 'showGrid', 'providerSize', 'pixelFlecks', 'seed']) {
    assert.ok(key in SPRITECOOK_DEFAULTS, `missing ${key}`)
  }
})
