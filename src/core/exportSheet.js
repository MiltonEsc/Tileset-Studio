import { BITMASK_TO_INDEX } from '../constants/bitmaskTable.js'

const SHEET_COLS = 8
const SHEET_ROWS = 6

const WANG_16 = [
  0, 2, 64, 66,
  16, 22, 208, 214,
  8, 11, 104, 107,
  24, 31, 248, 255
];

// `frames` (optional) = extra animation frames (each an ImageData[48]); they
// stack below the base sheet as full 8×6 blocks, top to bottom.
export function exportTilesheet(tiles, tileSize, filename = 'tileset.png', scale = 1, frames = null, format = '48') {
  const blocks = [tiles, ...(frames || [])]
  const is16 = format === '16'
  const cols = is16 ? 4 : 8
  const rows = is16 ? 4 : 6
  
  const sheetW = cols * tileSize * scale
  const sheetH = rows * tileSize * scale * blocks.length

  const canvas = document.createElement('canvas')
  canvas.width  = sheetW
  canvas.height = sheetH
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false // keep crisp pixels when scaling up

  const tmp = document.createElement('canvas')
  tmp.width  = tileSize
  tmp.height = tileSize
  const tmpCtx = tmp.getContext('2d')

  blocks.forEach((blockTiles, block) => {
    const blockY = block * rows * tileSize * scale
    
    if (is16) {
      for (let i = 0; i < 16; i++) {
        const mask = WANG_16[i]
        const sheetIndex = BITMASK_TO_INDEX.get(mask)
        if (sheetIndex === undefined || !blockTiles?.[sheetIndex]) continue
        
        const x = (i % cols) * tileSize * scale
        const y = blockY + Math.floor(i / cols) * tileSize * scale
        
        tmpCtx.putImageData(blockTiles[sheetIndex], 0, 0)
        ctx.drawImage(tmp, 0, 0, tileSize, tileSize, x, y, tileSize * scale, tileSize * scale)
      }
    } else {
      for (let i = 0; i < 48; i++) {
        if (!blockTiles?.[i]) continue
        const x = (i % cols) * tileSize * scale
        const y = blockY + Math.floor(i / cols) * tileSize * scale

        // Draw ImageData into a temp canvas then blit (scaled) to main sheet
        tmpCtx.putImageData(blockTiles[i], 0, 0)
        ctx.drawImage(tmp, 0, 0, tileSize, tileSize, x, y, tileSize * scale, tileSize * scale)
      }
    }
  })

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // Revoking synchronously can abort the download in some browsers; give the
    // fetch a moment (same pattern as exportLevel.js).
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}
