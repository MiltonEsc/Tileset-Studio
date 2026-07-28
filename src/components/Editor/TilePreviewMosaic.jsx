import { useEffect, useRef } from 'react'

// Shows the base tile repeated in a 3×3 mosaic so the user can check seamlessness.
export function TilePreviewMosaic({ pixels, tileSize }) {
  const canvasRef = useRef(null)
  const REPEAT = 3
  // Scale each repeated tile to ~48px so the mosaic stays a sane size at any tile size
  const SCALE = Math.max(1, Math.round(48 / tileSize))
  const cell = tileSize * SCALE

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false

    const tmp = document.createElement('canvas')
    tmp.width = tileSize
    tmp.height = tileSize
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), tileSize, tileSize), 0, 0)

    for (let ry = 0; ry < REPEAT; ry++) {
      for (let rx = 0; rx < REPEAT; rx++) {
        ctx.drawImage(tmp, 0, 0, tileSize, tileSize, rx * cell, ry * cell, cell, cell)
      }
    }
  }, [pixels, tileSize, cell])

  return (
    <div className="tile-mosaic">
      <div className="tile-mosaic-label">Tiled preview 3×3</div>
      <canvas
        ref={canvasRef}
        width={REPEAT * cell}
        height={REPEAT * cell}
        className="tile-mosaic-canvas"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
