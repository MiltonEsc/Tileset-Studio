import { useRef, useEffect, useCallback } from 'react'
import { forEachCellOnLine } from '../../core/canvasUtils.js'

export function PixelCanvas({ pixels, tileSize, zoom, onStartStroke, onContinueStroke, onEndStroke, onZoomChange }) {
  const canvasRef  = useRef(null)
  const gridRef    = useRef(null)
  const wrapperRef = useRef(null)
  const lastCell   = useRef(null) // last painted cell, for stroke interpolation

  // Render pixels to canvas whenever they change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const imageData = new ImageData(new Uint8ClampedArray(pixels), tileSize, tileSize)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels, tileSize])

  // Draw grid overlay
  useEffect(() => {
    const canvas = gridRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const size = tileSize * zoom
    canvas.width  = size
    canvas.height = size
    ctx.clearRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= tileSize; i++) {
      const p = i * zoom
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(size, p)
      ctx.stroke()
    }
  }, [tileSize, zoom])

  const getPixelCoords = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / zoom)
    const y = Math.floor((e.clientY - rect.top)  / zoom)
    return [x, y]
  }, [zoom])

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    const [x, y] = getPixelCoords(e)
    lastCell.current = [x, y]
    onStartStroke(x, y)
  }, [getPixelCoords, onStartStroke])

  const handleMouseMove = useCallback((e) => {
    if (e.buttons !== 1) return
    const [x, y] = getPixelCoords(e)
    const prev = lastCell.current
    // Interpolate between move events so fast strokes don't leave gaps.
    if (prev && (prev[0] !== x || prev[1] !== y)) {
      forEachCellOnLine(prev[0], prev[1], x, y, (px, py) => onContinueStroke(px, py))
    } else {
      onContinueStroke(x, y)
    }
    lastCell.current = [x, y]
  }, [getPixelCoords, onContinueStroke])

  const handleMouseUp = useCallback(() => {
    lastCell.current = null
    onEndStroke()
  }, [onEndStroke])

  // Wheel zoom — attached as a non-passive native listener so preventDefault
  // works (React registers onWheel as passive, which would ignore it and warn).
  const handleWheel = useCallback((e) => {
    if (!onZoomChange) return
    e.preventDefault()
    onZoomChange(e.deltaY < 0 ? 1 : -1)
  }, [onZoomChange])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const displaySize = tileSize * zoom

  return (
    <div ref={wrapperRef} className="pixel-canvas-wrapper" style={{ position: 'relative', width: displaySize, height: displaySize }}>
      <canvas
        ref={canvasRef}
        width={tileSize}
        height={tileSize}
        style={{
          width: displaySize,
          height: displaySize,
          imageRendering: 'pixelated',
          cursor: 'crosshair',
          display: 'block',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <canvas
        ref={gridRef}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          pointerEvents: 'none',
          width: displaySize,
          height: displaySize,
        }}
      />
    </div>
  )
}
