import { useState, useCallback, useRef } from 'react'
import {
  hexToRGBA, rgbaToHex, floodFill,
  paintBrush, translatePixels, drawLineInto, drawRectInto, getPixelRGBA, solidifyAlpha,
} from '../core/canvasUtils.js'

const MAX_HISTORY = 60
// Eraser writes full transparency (real alpha), unlike the tileset editor's gray.
const ERASE_RGBA = [0, 0, 0, 0]

// Tools that drag out a shape and only commit on mouse-up (with live preview)
const SHAPE_TOOLS = new Set(['line', 'rect', 'rectFill'])
const MOVE_TOOL = 'move'

// Pixel editor for non-square, transparent prop canvases (width × height).
export function useAssetEditor(initialW, initialH) {
  const makeBlankPixels = (w, h) => new Uint8ClampedArray(w * h * 4) // all 0 → transparent

  const [pixels, setPixels]   = useState(() => makeBlankPixels(initialW, initialH))
  const [preview, setPreview] = useState(null)
  const [tool, setTool]       = useState('pencil')
  const [brush, setBrush]     = useState(1)
  const [activeColor, setActiveColor] = useState('#4a7c2f')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const isDrawing = useRef(false)
  const strokeStart = useRef(null)
  const baseSnapshot = useRef(null)
  const dims = useRef({ w: initialW, h: initialH })
  // Last image loaded with CONTINUOUS alpha (e.g. AI result), kept so the
  // Solidify slider can re-derive from the original instead of a binarized copy.
  const rawRef = useRef(null)

  const resetCanvas = useCallback((w, h) => {
    dims.current = { w, h }
    rawRef.current = null
    setPixels(makeBlankPixels(w, h))
    setPreview(null); setHistory([]); setHistoryIndex(-1)
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

  const applyPointTool = useCallback((x, y, src) => {
    const { w, h } = dims.current
    const out = new Uint8ClampedArray(src)
    if (tool === 'fill') {
      floodFill(out, w, h, x, y, hexToRGBA(activeColor))
    } else {
      paintBrush(out, w, h, x, y, brush, rgbaFor(tool === 'eraser'))
    }
    return out
  }, [tool, brush, activeColor, rgbaFor])

  const startStroke = useCallback((x, y) => {
    const { w, h } = dims.current
    if (x < 0 || x >= w || y < 0 || y >= h) return

    if (tool === 'eyedropper') {
      const [r, g, b, a] = getPixelRGBA(pixels, x, y, w)
      if (a > 0) setActiveColor(rgbaToHex(r, g, b))
      return
    }

    isDrawing.current = true
    rawRef.current = null // manual edit → slider should act on current pixels
    pushHistory(pixels)

    if (tool === MOVE_TOOL) {
      strokeStart.current = [x, y]
      baseSnapshot.current = pixels
      setPreview(new Uint8ClampedArray(pixels))
    } else if (SHAPE_TOOLS.has(tool)) {
      strokeStart.current = [x, y]
      baseSnapshot.current = pixels
      setPreview(new Uint8ClampedArray(pixels))
    } else {
      setPixels(prev => applyPointTool(x, y, prev))
    }
  }, [tool, pixels, pushHistory, applyPointTool])

  const continueStroke = useCallback((x, y) => {
    if (!isDrawing.current) return
    const { w, h } = dims.current

    if (tool === MOVE_TOOL) {
      const [sx, sy] = strokeStart.current
      setPreview(translatePixels(baseSnapshot.current, w, h, x - sx, y - sy))
    } else if (SHAPE_TOOLS.has(tool)) {
      const [sx, sy] = strokeStart.current
      const out = new Uint8ClampedArray(baseSnapshot.current)
      const rgba = hexToRGBA(activeColor)
      if (tool === 'line') {
        drawLineInto(out, w, h, sx, sy, x, y, brush, rgba)
      } else {
        drawRectInto(out, w, h, sx, sy, x, y, brush, rgba, tool === 'rectFill')
      }
      setPreview(out)
    } else if (tool !== 'fill') {
      setPixels(prev => applyPointTool(x, y, prev))
    }
  }, [tool, brush, activeColor, applyPointTool])

  const endStroke = useCallback(() => {
    if (!isDrawing.current) return
    isDrawing.current = false
    if ((SHAPE_TOOLS.has(tool) || tool === MOVE_TOOL) && preview) {
      setPixels(preview)
      setPreview(null)
    }
  }, [tool, preview])

  // Replace the canvas content (e.g. from an AI-generated prop). The data is
  // remembered as the "raw" source so the Solidify slider can re-derive from it.
  const loadPixels = useCallback((data, w, h) => {
    if (w && h) dims.current = { w, h }
    rawRef.current = new Uint8ClampedArray(data)
    pushHistory(pixels)
    setPixels(new Uint8ClampedArray(data))
    setPreview(null)
  }, [pixels, pushHistory])

  // Binarize alpha at `threshold`, re-deriving from the raw (continuous-alpha)
  // source when available so the slider can be dragged both ways. With
  // commit=false it only previews; commit=true writes it and records history.
  const applySolidify = useCallback((threshold, commit) => {
    const base = rawRef.current || pixels
    const out = new Uint8ClampedArray(base)
    solidifyAlpha(out, threshold)
    if (commit) {
      pushHistory(pixels)
      setPixels(out)
      setPreview(null)
    } else {
      setPreview(out)
    }
  }, [pixels, pushHistory])

  const eraseAt = useCallback((x, y, src) => {
    const { w, h } = dims.current
    const out = new Uint8ClampedArray(src)
    paintBrush(out, w, h, x, y, brush, ERASE_RGBA)
    return out
  }, [brush])

  const startErase = useCallback((x, y) => {
    const { w, h } = dims.current
    if (x < 0 || x >= w || y < 0 || y >= h) return
    isDrawing.current = true
    rawRef.current = null
    pushHistory(pixels)
    setPixels(prev => eraseAt(x, y, prev))
  }, [pixels, pushHistory, eraseAt])

  const continueErase = useCallback((x, y) => {
    if (!isDrawing.current) return
    setPixels(prev => eraseAt(x, y, prev))
  }, [eraseAt])

  const clear = useCallback(() => {
    const { w, h } = dims.current
    rawRef.current = null
    pushHistory(pixels)
    setPixels(makeBlankPixels(w, h))
    setPreview(null)
  }, [pixels, pushHistory])

  const getPixels = useCallback(() => new Uint8ClampedArray(pixels), [pixels])

  return {
    pixels: preview || pixels,
    committedPixels: pixels,
    tool, setTool,
    brush, setBrush,
    activeColor, setActiveColor,
    startStroke, continueStroke, endStroke,
    startErase, continueErase,
    undo, redo,
    resetCanvas, loadPixels, clear, getPixels, applySolidify,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
  }
}
