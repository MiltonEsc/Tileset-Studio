export const SPRITECOOK_LAYOUTS = Object.freeze({
  'topdown-15': Object.freeze({ columns: 4, rows: 4, pieceLabel: '15-piece', autotile: 'dual-grid-15' }),
  'topdown-17': Object.freeze({ columns: 5, rows: 5, pieceLabel: '17-piece', autotile: 'cardinal-17' }),
  'platform-47': Object.freeze({ columns: 8, rows: 6, pieceLabel: '47+1-piece platform', autotile: 'blob47' }),
})

export function spriteCookLayoutInfo(layout) {
  return SPRITECOOK_LAYOUTS[layout] || SPRITECOOK_LAYOUTS['topdown-15']
}
