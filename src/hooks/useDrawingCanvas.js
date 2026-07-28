import { useState, useCallback, useRef } from 'react'
import {
  hexToRGBA, rgbaToHex, setPixelRGBA, floodFill,
  paintBrush, drawLineInto, drawRectInto, getPixelRGBA,
} from '../core/canvasUtils.js'

const MAX_HISTORY = 60
const ERASE_RGBA = [100, 100, 100, 255]

// Tools that drag out a shape and only commit on mouse-up (with live preview)
const SHAPE_TOOLS = new Set(['line', 'rect', 'rectFill'])

export function useDrawingCanvas(tileSize) {
  const makeBlankPixels = (size) => {
    const data = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = 100; data[i * 4 + 1] = 100; data[i * 4 + 2] = 100; data[i * 4 + 3] = 255
    }
    return data
  }

  // Default zoom so the editor canvas is ~360px wide for any tile size
  const defaultZoom = (size) => ({ 8: 16, 16: 10, 64: 6 }[size] ?? Math.max(2, Math.round(360 / size)))

  const [pixels, setPixels]   = useState(() => makeBlankPixels(tileSize))
  const [preview, setPreview] = useState(null) // live shape preview overlay
  const [tool, setTool]       = useState('pencil')
  const [brush, setBrush]     = useState(1)
  const [activeColor, setActiveColor] = useState('#4a7c2f')
  const [zoom, setZoom]       = useState(() => defaultZoom(tileSize))
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const isDrawing = useRef(false)
  const strokeStart = useRef(null)   // [x,y] for shape tools
  const baseSnapshot = useRef(null)  // committed pixels at stroke start
  const currentTileSize = useRef(tileSize)

  const resetCanvas = useCallback((size, fillColor = null) => {
    currentTileSize.current = size
    const data = makeBlankPixels(size)
    if (fillColor) {
      const [r, g, b] = hexToRGBA(fillColor)
      for (let i = 0; i < size * size; i++) {
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255
      }
    }
    setPixels(data); setPreview(null); setHistory([]); setHistoryIndex(-1)
    setZoom(defaultZoom(size))
  }, [])

  const pushHistory = useCallback((snapshot) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1)
      return [...trimmed, new Uint8ClampedArray(snapshot)].slice(-MAX_HISTORY)
    })
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1))
  }, [historyIndex])

  // History holds the PRE-state of each op (pushed at stroke start); the current
  // pixels live outside it. Undo restores history[historyIndex] and parks the
  // current pixels in that slot so redo can come back to them.
  const undo = useCallback(() => {
    if (historyIndex < 0) return
    const prevState = history[historyIndex]
    if (!prevState) return
    const idx = historyIndex
    setHistory(prev => {
      const next = [...prev]
      next[idx] = new Uint8ClampedArray(pixels)
      return next
    })
    setPixels(new Uint8ClampedArray(prevState))
    setHistoryIndex(i => i - 1)
  }, [history, historyIndex, pixels])

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const nextState = history[historyIndex + 1]
    if (!nextState) return
    const idx = historyIndex + 1
    setHistory(prev => {
      const next = [...prev]
      next[idx] = new Uint8ClampedArray(pixels)
      return next
    })
    setPixels(new Uint8ClampedArray(nextState))
    setHistoryIndex(i => i + 1)
  }, [history, historyIndex, pixels])

  const rgbaFor = useCallback((isErase) => isErase ? ERASE_RGBA : hexToRGBA(activeColor), [activeColor])

  // Apply a point-based tool (pencil/eraser/fill) into a fresh copy
  const applyPointTool = useCallback((x, y, src) => {
    const size = currentTileSize.current
    const out = new Uint8ClampedArray(src)
    if (tool === 'fill') {
      floodFill(out, size, size, x, y, hexToRGBA(activeColor))
    } else {
      paintBrush(out, size, size, x, y, brush, rgbaFor(tool === 'eraser'))
    }
    return out
  }, [tool, brush, activeColor, rgbaFor])

  const startStroke = useCallback((x, y) => {
    const size = currentTileSize.current
    if (x < 0 || x >= size || y < 0 || y >= size) return

    if (tool === 'eyedropper') {
      const [r, g, b] = getPixelRGBA(pixels, x, y, size)
      setActiveColor(rgbaToHex(r, g, b))
      return
    }

    isDrawing.current = true
    pushHistory(pixels)

    if (SHAPE_TOOLS.has(tool)) {
      strokeStart.current = [x, y]
      baseSnapshot.current = pixels
      setPreview(new Uint8ClampedArray(pixels))
    } else {
      setPixels(prev => applyPointTool(x, y, prev))
    }
  }, [tool, pixels, pushHistory, applyPointTool])

  const continueStroke = useCallback((x, y) => {
    if (!isDrawing.current) return
    const size = currentTileSize.current

    if (SHAPE_TOOLS.has(tool)) {
      const [sx, sy] = strokeStart.current
      const out = new Uint8ClampedArray(baseSnapshot.current)
      const rgba = hexToRGBA(activeColor)
      if (tool === 'line') {
        drawLineInto(out, size, size, sx, sy, x, y, brush, rgba)
      } else {
        drawRectInto(out, size, size, sx, sy, x, y, brush, rgba, tool === 'rectFill')
      }
      setPreview(out)
    } else if (tool !== 'fill') {
      setPixels(prev => applyPointTool(x, y, prev))
    }
  }, [tool, brush, activeColor, applyPointTool])

  const endStroke = useCallback(() => {
    if (!isDrawing.current) return
    isDrawing.current = false
    if (SHAPE_TOOLS.has(tool) && preview) {
      setPixels(preview)
      setPreview(null)
    }
  }, [tool, preview])

  // Replace the canvas content (e.g. from an AI-generated tile)
  const loadPixels = useCallback((data) => {
    pushHistory(pixels)
    setPixels(new Uint8ClampedArray(data))
    setPreview(null)
  }, [pixels, pushHistory])

  const getImageData = useCallback(() => {
    const size = currentTileSize.current
    return new ImageData(new Uint8ClampedArray(pixels), size, size)
  }, [pixels])

  const clear = useCallback(() => {
    pushHistory(pixels)
    setPixels(makeBlankPixels(currentTileSize.current))
    setPreview(null)
  }, [pixels, pushHistory])

  return {
    pixels: preview || pixels,
    committedPixels: pixels,
    tool, setTool,
    brush, setBrush,
    activeColor, setActiveColor,
    zoom, setZoom,
    startStroke, continueStroke, endStroke,
    undo, redo,
    resetCanvas,
    clear,
    loadPixels,
    getImageData,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
  }
}
