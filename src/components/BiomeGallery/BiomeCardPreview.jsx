import { useEffect, useRef } from 'react'
import { composeNativeSheet } from '../../core/composeSheet.js'

// One composed 8×6 native sheet per tiles array, reused across re-mounts (the
// tiles array identity is stable thanks to tilesFromDefinition's cache), so the
// preview blits from a cached canvas instead of building 12 temp canvases.
const sheetCache = new WeakMap()
function nativeSheetFor(tiles, tileSize) {
  let c = sheetCache.get(tiles)
  if (!c) { c = composeNativeSheet(tiles, tileSize); sheetCache.set(tiles, c) }
  return c
}

// Shows first 12 tiles (4 columns × 3 rows) of a biome as a mini preview
export function BiomeCardPreview({ tiles, tileSize, smooth = false }) {
  const canvasRef = useRef(null)
  const COLS = 4
  const ROWS = 3
  // Fixed on-screen cell size so cards stay the same size for any tile size
  const cellSize = 18

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !tiles) return
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = smooth
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const native = nativeSheetFor(tiles, tileSize)
    for (let i = 0; i < COLS * ROWS; i++) {
      const tileIdx = i + 1 // skip empty tile at 0
      if (!tiles[tileIdx]) continue
      const sx = (tileIdx % 8) * tileSize
      const sy = Math.floor(tileIdx / 8) * tileSize
      const col = i % COLS
      const row = Math.floor(i / COLS)
      ctx.drawImage(native, sx, sy, tileSize, tileSize, col * cellSize, row * cellSize, cellSize, cellSize)
    }
  }, [tiles, tileSize, cellSize, smooth])

  return (
    <canvas
      ref={canvasRef}
      width={COLS * cellSize}
      height={ROWS * cellSize}
      className="biome-card-preview"
      style={{ imageRendering: smooth ? 'auto' : 'pixelated' }}
    />
  )
}
