// Composes a tilesheet (ImageData[48]) into one native 8×6 canvas, so the level
// editors can blit individual tiles with fast drawImage calls.
const SHEET_COLS = 8
const SHEET_ROWS = 6

// Returns an offscreen <canvas> of size (8*tileSize) × (6*tileSize) with all
// 48 tiles laid out left-to-right, top-to-bottom (index 0 = empty slot).
export function composeNativeSheet(tiles, tileSize) {
  const canvas = document.createElement('canvas')
  canvas.width = SHEET_COLS * tileSize
  canvas.height = SHEET_ROWS * tileSize
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  if (!tiles) return canvas
  for (let i = 0; i < 48; i++) {
    const td = tiles[i]
    if (!td) continue
    const col = i % SHEET_COLS
    const row = Math.floor(i / SHEET_COLS)
    // putImageData honours the dx/dy destination offset and writes raw pixels.
    // We compose at native resolution (no scaling), so no per-tile temp canvas
    // is needed — creating 48 canvas contexts here cost ~15ms each on some GPUs,
    // making every tile regeneration take >1s. Direct putImageData is ~instant.
    ctx.putImageData(td, col * tileSize, row * tileSize)
  }
  return canvas
}

export { SHEET_COLS, SHEET_ROWS }
