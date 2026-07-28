import { useState, useCallback, useRef, useReducer } from 'react'
import { createGrid } from '../core/autotile.js'
import { GENERATORS } from '../core/levelGenerator.js'

const HISTORY_LIMIT = 60

let _lid = 0
function makeLayer(name, w, h, tileset = null, kind = 'autotile') {
  return {
    id: `layer-${++_lid}`,
    name,
    kind,
    visible: true,
    tileset,
    grid: createGrid(w, h),
    manualTiles: new Int16Array(w * h).fill(-1),
  }
}

export function useLevelMap(initialW = 32, initialH = 20) {
  const [width, setWidth]   = useState(initialW)
  const [height, setHeight] = useState(initialH)
  const [layers, setLayers] = useState(() => [makeLayer('Layer 1', initialW, initialH)])
  const [activeLayerIdx, setActiveLayerIdx] = useState(0)
  const [seamlessEdges, setSeamlessEdges] = useState(false)
  const [placedProps, setPlacedProps] = useState([])

  const paintValue = useRef(1)
  const wRef  = useRef(initialW)
  const hRef  = useRef(initialH)
  const aiRef = useRef(0)
  const lRef  = useRef(layers)
  const ppRef = useRef(placedProps)
  const seRef = useRef(seamlessEdges)

  wRef.current  = width
  hRef.current  = height
  aiRef.current = activeLayerIdx
  ppRef.current = placedProps
  seRef.current = seamlessEdges
  if (lRef.current !== layers) lRef.current = layers

  // ── Undo/redo history ──────────────────────────────────────────────────────
  // Snapshots reference the (immutable) committed state — every mutation already
  // produces fresh arrays/objects, so storing references is correct without deep
  // cloning. One entry per logical op: a drag = one entry (captured at stroke
  // start, pushed on first real change); one-shot ops push before mutating.
  const undoStack = useRef([])
  const redoStack = useRef([])
  const [, bumpHistory] = useReducer(v => v + 1, 0)

  const snapshot = useCallback(() => ({
    width: wRef.current,
    height: hRef.current,
    layers: lRef.current,
    placedProps: ppRef.current,
    seamlessEdges: seRef.current,
    activeLayerIdx: aiRef.current,
  }), [])

  const pushHistory = useCallback((snap) => {
    undoStack.current.push(snap)
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
    redoStack.current = []
    bumpHistory()
  }, [])

  const resetHistory = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    bumpHistory()
  }, [])

  // ── RAF-batched stroke buffer ──────────────────────────────────────────────
  // Paint operations write here instead of calling setLayers on every mousemove.
  // A requestAnimationFrame flushes the buffer to React state (≤60fps),
  // keeping the render cycle fast regardless of mouse-move frequency.
  const strokeBuf = useRef(null)  // { layerIdx, grid, manualTiles?, dirtyTerrain:Set, dirtyManual:Set }
  const strokeRaf = useRef(null)

  const flushStroke = useCallback(() => {
    strokeRaf.current = null
    const buf = strokeBuf.current
    if (!buf) return
    const { layerIdx, grid, manualTiles, dirtyTerrain, dirtyManual } = buf
    // Commit snapshot copies to React state; buf stays mutable for ongoing stroke
    const gridSnap = new Uint8Array(grid)
    const mtSnap   = manualTiles ? new Int16Array(manualTiles) : undefined
    setLayers(prev => prev.map((l, i) =>
      i === layerIdx ? {
        ...l,
        grid: gridSnap,
        ...(mtSnap ? { manualTiles: mtSnap } : {}),
        _dirtyTerrain: dirtyTerrain?.size ? Array.from(dirtyTerrain) : null,
        _dirtyManual: dirtyManual?.size ? Array.from(dirtyManual) : null,
      } : l
    ))
  }, [])

  const scheduleFlush = useCallback(() => {
    if (!strokeRaf.current) strokeRaf.current = requestAnimationFrame(flushStroke)
  }, [flushStroke])

  const discardStrokeBuffer = useCallback(() => {
    if (strokeRaf.current) {
      cancelAnimationFrame(strokeRaf.current)
      strokeRaf.current = null
    }
    strokeBuf.current = null
  }, [])

  // Restores a snapshot. Dirty-cell hints are stripped so LevelCanvas re-diffs
  // the whole grid (the hints describe the snapshot's original edit, not the
  // difference from whatever is currently on screen).
  const restore = useCallback((snap) => {
    discardStrokeBuffer()
    setWidth(snap.width)
    setHeight(snap.height)
    setLayers(snap.layers.map(l => (l._dirtyTerrain || l._dirtyManual)
      ? { ...l, _dirtyTerrain: null, _dirtyManual: null }
      : l))
    setPlacedProps(snap.placedProps)
    setSeamlessEdges(snap.seamlessEdges)
    setActiveLayerIdx(Math.min(snap.activeLayerIdx, snap.layers.length - 1))
  }, [discardStrokeBuffer])

  const undo = useCallback(() => {
    if (!undoStack.current.length) return
    discardStrokeBuffer()
    redoStack.current.push(snapshot())
    restore(undoStack.current.pop())
    bumpHistory()
  }, [discardStrokeBuffer, snapshot, restore])

  const redo = useCallback(() => {
    if (!redoStack.current.length) return
    discardStrokeBuffer()
    undoStack.current.push(snapshot())
    restore(redoStack.current.pop())
    bumpHistory()
  }, [discardStrokeBuffer, snapshot, restore])

  // Returns the mutable grid buffer for the active layer (lazy-init).
  const ensureGridBuf = useCallback((layerIdx) => {
    if (strokeBuf.current?.layerIdx !== layerIdx) {
      const layer = lRef.current[layerIdx]
      strokeBuf.current = {
        layerIdx,
        grid: layer ? new Uint8Array(layer.grid) : new Uint8Array(wRef.current * hRef.current),
        manualTiles: undefined,
        dirtyTerrain: new Set(),
        dirtyManual: new Set(),
        preSnap: snapshot(),
        histPushed: false,
      }
    }
    return strokeBuf.current.grid
  }, [snapshot])

  // Pushes the pre-stroke snapshot the first time a drag actually changes a
  // cell, so an empty stroke leaves no history and a drag is a single entry.
  const noteStrokeChange = useCallback(() => {
    const buf = strokeBuf.current
    if (buf && !buf.histPushed) {
      pushHistory(buf.preSnap)
      buf.histPushed = true
    }
  }, [pushHistory])

  // Called on mouseup to commit remaining paint immediately (no frame delay).
  const endStroke = useCallback(() => {
    if (strokeRaf.current) { cancelAnimationFrame(strokeRaf.current); flushStroke() }
    strokeBuf.current = null
  }, [flushStroke])

  // ── One-shot patch (for fill/rect/generate/clear — not during drag) ────────
  const patchActive = useCallback((patchFn) => {
    discardStrokeBuffer()
    const idx = aiRef.current
    const layer = lRef.current[idx]
    if (!layer) return
    const patch = patchFn(layer)
    if (!patch) return
    pushHistory(snapshot())
    setLayers(prev => prev.map((l, i) => i === idx ? {
      ...l,
      _dirtyTerrain: null,
      _dirtyManual: null,
      ...patch,
    } : l))
  }, [discardStrokeBuffer, pushHistory, snapshot])

  // ── Layer CRUD ─────────────────────────────────────────────────────────────
  const addLayer = useCallback((tileset = null, kind = 'autotile') => {
    discardStrokeBuffer()
    pushHistory(snapshot())
    const newIdx = lRef.current.length
    setLayers(prev => {
      const w = wRef.current, h = hRef.current
      const label = kind === 'manual' ? 'Layer' : 'Autotile'
      return [...prev, makeLayer(`${label} ${prev.length + 1}`, w, h, tileset, kind)]
    })
    setActiveLayerIdx(newIdx)
  }, [discardStrokeBuffer, pushHistory, snapshot])

  const removeLayer = useCallback((idx) => {
    if (lRef.current.length <= 1) return
    discardStrokeBuffer()
    pushHistory(snapshot())
    setLayers(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
    setActiveLayerIdx(prev => (prev >= idx && prev > 0) ? prev - 1 : prev)
  }, [discardStrokeBuffer, pushHistory, snapshot])

  const moveLayer = useCallback((idx, direction) => {
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= lRef.current.length) return
    discardStrokeBuffer()
    pushHistory(snapshot())
    setLayers(prev => {
      if (idx < 0 || idx >= prev.length || nextIdx < 0 || nextIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[nextIdx]] = [next[nextIdx], next[idx]]
      return next
    })
    setActiveLayerIdx(prev => {
      if (prev === idx) return nextIdx
      if (prev === nextIdx) return idx
      return prev
    })
  }, [discardStrokeBuffer, pushHistory, snapshot])

  const setLayerProp = useCallback((idx, props) => {
    setLayers(prev => prev.map((l, i) => i === idx ? { ...l, ...props } : l))
  }, [])

  const setLayerName = useCallback((idx, name) => {
    setLayers(prev => prev.map((l, i) => i === idx ? { ...l, name } : l))
  }, [])

  // ── Terrain paint — buffered, flush via RAF ────────────────────────────────
  const paintArea = useCallback((cx, cy, value, brushSize = 1) => {
    const w = wRef.current, h = hRef.current
    const grid = ensureGridBuf(aiRef.current)
    const r = Math.max(0, brushSize - 1)
    let changed = false
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        if (grid[y * w + x] === value) continue
        const cell = y * w + x
        grid[cell] = value
        strokeBuf.current?.dirtyTerrain?.add(cell)
        changed = true
      }
    }
    if (changed) { noteStrokeChange(); scheduleFlush() }
  }, [ensureGridBuf, scheduleFlush, noteStrokeChange])

  const fillAt = useCallback((cx, cy, value) => {
    const w = wRef.current, h = hRef.current
    patchActive(layer => {
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return null
      const target = layer.grid[cy * w + cx]
      if (target === value) return null
      const next = new Uint8Array(layer.grid)
      const stack = [[cx, cy]]
      while (stack.length) {
        const [x, y] = stack.pop()
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        if (next[y * w + x] !== target) continue
        next[y * w + x] = value
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
      }
      return { grid: next }
    })
  }, [patchActive])

  const fillRect = useCallback((a, b, value) => {
    const w = wRef.current, h = hRef.current
    patchActive(layer => {
      const next = new Uint8Array(layer.grid)
      let changed = false
      const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y))
      const x1 = Math.min(w - 1, Math.max(a.x, b.x)), y1 = Math.min(h - 1, Math.max(a.y, b.y))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (next[y * w + x] === value) continue
          next[y * w + x] = value
          changed = true
        }
      }
      return changed ? { grid: next } : null
    })
  }, [patchActive])

  const getCell = useCallback((x, y) => {
    const layer = lRef.current[aiRef.current]
    if (!layer || x < 0 || x >= wRef.current || y < 0 || y >= hRef.current) return 0
    // Check stroke buffer first for live state
    const buf = strokeBuf.current
    if (buf?.layerIdx === aiRef.current) return buf.grid[y * wRef.current + x]
    return layer.grid[y * wRef.current + x]
  }, [])

  // ── Manual tiles — buffered, flush via RAF ─────────────────────────────────
  const ensureManualBuf = useCallback((layerIdx) => {
    ensureGridBuf(layerIdx)  // grid buffer must exist first
    const buf = strokeBuf.current
    if (!buf.manualTiles) {
      const layer = lRef.current[layerIdx]
      buf.manualTiles = layer
        ? new Int16Array(layer.manualTiles)
        : new Int16Array(wRef.current * hRef.current).fill(-1)
    }
    return buf.manualTiles
  }, [ensureGridBuf])

  const paintManualArea = useCallback((cx, cy, tileIndex, brushSize = 1) => {
    const w = wRef.current, h = hRef.current
    const mt = ensureManualBuf(aiRef.current)
    const r = Math.max(0, brushSize - 1)
    let changed = false
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        if (mt[y * w + x] === tileIndex) continue
        const cell = y * w + x
        mt[cell] = tileIndex
        strokeBuf.current?.dirtyManual?.add(cell)
        changed = true
      }
    }
    if (changed) { noteStrokeChange(); scheduleFlush() }
  }, [ensureManualBuf, scheduleFlush, noteStrokeChange])

  const fillManualAt = useCallback((cx, cy, tileIndex) => {
    const w = wRef.current, h = hRef.current
    patchActive(layer => {
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return null
      const target = layer.manualTiles[cy * w + cx]
      if (target === tileIndex) return null
      const next = new Int16Array(layer.manualTiles)
      const stack = [[cx, cy]]
      while (stack.length) {
        const [x, y] = stack.pop()
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        if (next[y * w + x] !== target) continue
        next[y * w + x] = tileIndex
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
      }
      return { manualTiles: next }
    })
  }, [patchActive])

  const fillManualRect = useCallback((a, b, tileIndex) => {
    const w = wRef.current, h = hRef.current
    patchActive(layer => {
      const next = new Int16Array(layer.manualTiles)
      let changed = false
      const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y))
      const x1 = Math.min(w - 1, Math.max(a.x, b.x)), y1 = Math.min(h - 1, Math.max(a.y, b.y))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (next[y * w + x] === tileIndex) continue
          next[y * w + x] = tileIndex
          changed = true
        }
      }
      return changed ? { manualTiles: next } : null
    })
  }, [patchActive])

  const clearManualArea   = useCallback((cx, cy, bs) => paintManualArea(cx, cy, -1, bs), [paintManualArea])
  const clearManualFill   = useCallback((cx, cy) => fillManualAt(cx, cy, -1), [fillManualAt])
  const clearManualRect   = useCallback((a, b) => fillManualRect(a, b, -1), [fillManualRect])

  const clearManualTiles = useCallback(() => {
    const w = wRef.current, h = hRef.current
    patchActive(() => ({
      grid: createGrid(w, h),
      manualTiles: new Int16Array(w * h).fill(-1),
    }))
  }, [patchActive])

  const fillManualAll = useCallback((tileIndex) => {
    const w = wRef.current, h = hRef.current
    patchActive(() => ({
      grid: createGrid(w, h),
      manualTiles: new Int16Array(w * h).fill(tileIndex),
    }))
  }, [patchActive])

  const getManualTile = useCallback((x, y) => {
    const layer = lRef.current[aiRef.current]
    if (!layer || x < 0 || x >= wRef.current || y < 0 || y >= hRef.current) return -1
    const buf = strokeBuf.current
    if (buf?.layerIdx === aiRef.current && buf.manualTiles) return buf.manualTiles[y * wRef.current + x]
    return layer.manualTiles[y * wRef.current + x]
  }, [])

  // ── startPaint / continuePaint (autotile click-drag) ──────────────────────
  const startPaint = useCallback((x, y, erase) => {
    paintValue.current = erase ? 0 : 1
    paintArea(x, y, paintValue.current)
  }, [paintArea])

  const continuePaint = useCallback((x, y) => {
    paintArea(x, y, paintValue.current)
  }, [paintArea])

  // ── Generate / Clear / Fill (active layer, one-shot) ──────────────────────
  const generate = useCallback((type, opts = {}) => {
    const gen = GENERATORS[type]
    if (!gen) return
    const w = wRef.current, h = hRef.current
    const nextGrid = gen.fn(w, h, opts)
    patchActive(() => ({ grid: nextGrid, manualTiles: new Int16Array(w * h).fill(-1) }))
  }, [patchActive])

  const clear = useCallback(() => {
    const w = wRef.current, h = hRef.current
    patchActive(() => ({ grid: createGrid(w, h), manualTiles: new Int16Array(w * h).fill(-1) }))
  }, [patchActive])

  const fillAll = useCallback(() => {
    const w = wRef.current, h = hRef.current
    patchActive(() => ({ grid: createGrid(w, h, 1) }))
  }, [patchActive])

  // ── Resize (all layers) ────────────────────────────────────────────────────
  const resize = useCallback((w, h) => {
    discardStrokeBuffer()
    pushHistory(snapshot())
    const oldW = wRef.current, oldH = hRef.current
    setWidth(w); setHeight(h)
    setLayers(prev => prev.map(layer => {
      const nextGrid = createGrid(w, h)
      const nextMT   = new Int16Array(w * h).fill(-1)
      const copyW = Math.min(w, oldW), copyH = Math.min(h, oldH)
      for (let y = 0; y < copyH; y++) {
        for (let x = 0; x < copyW; x++) {
          nextGrid[y * w + x] = layer.grid[y * oldW + x]
          nextMT[y * w + x]   = layer.manualTiles[y * oldW + x]
        }
      }
      return { ...layer, grid: nextGrid, manualTiles: nextMT }
    }))
    // Drop props whose anchor falls outside the new bounds (the hook doesn't
    // know asset dimensions, so partially-overhanging props are kept — same
    // rule as placement, which only validates the anchor cell).
    setPlacedProps(prev => prev.every(p => p.x < w && p.y < h)
      ? prev
      : prev.filter(p => p.x < w && p.y < h))
  }, [discardStrokeBuffer, pushHistory, snapshot])

  // ── Props ──────────────────────────────────────────────────────────────────
  // `transform` is optional { flipX, flipY, rotation }; only non-default fields
  // are stored so older props (no transform) stay clean and back-compatible.
  const addProp = useCallback((assetId, x, y, transform = null) => {
    pushHistory(snapshot())
    const id = crypto?.randomUUID?.() ?? String(Date.now() + Math.random())
    const t = transform || {}
    setPlacedProps(prev => [...prev, {
      id, assetId, x, y,
      ...(t.flipX ? { flipX: true } : {}),
      ...(t.flipY ? { flipY: true } : {}),
      ...(t.rotation ? { rotation: t.rotation } : {}),
    }])
  }, [pushHistory, snapshot])
  const removeProp = useCallback((id) => {
    if (!ppRef.current.some(p => p.id === id)) return
    pushHistory(snapshot())
    setPlacedProps(prev => prev.filter(p => p.id !== id))
  }, [pushHistory, snapshot])
  // Patches a placed prop (move / transform edits from the Select tool).
  // recordHistory=false lets a drag be a single undo entry: the caller pushes
  // on the first real change and passes false for the rest of the drag.
  const updateProp = useCallback((id, patch, recordHistory = true) => {
    if (!ppRef.current.some(p => p.id === id)) return
    if (recordHistory) pushHistory(snapshot())
    setPlacedProps(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }, [pushHistory, snapshot])
  // Z-order: placedProps array order = draw order (later = on top).
  const movePropZ = useCallback((id, direction) => {
    const idx = ppRef.current.findIndex(p => p.id === id)
    const next = idx + direction
    if (idx < 0 || next < 0 || next >= ppRef.current.length) return
    pushHistory(snapshot())
    setPlacedProps(prev => {
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }, [pushHistory, snapshot])
  const clearProps = useCallback(() => {
    if (!ppRef.current.length) return
    pushHistory(snapshot())
    setPlacedProps([])
  }, [pushHistory, snapshot])

  // ── Load saved level ───────────────────────────────────────────────────────
  const loadState = useCallback(({ width: w, height: h, layers: ls, placedProps: pp }) => {
    discardStrokeBuffer()
    setWidth(w); setHeight(h)
    setLayers(Array.isArray(ls) && ls.length > 0 ? ls : [makeLayer('Layer 1', w, h)])
    setActiveLayerIdx(0)
    setPlacedProps(Array.isArray(pp) ? pp : [])
    resetHistory()
  }, [discardStrokeBuffer, resetHistory])

  return {
    width, height,
    layers, activeLayerIdx, setActiveLayerIdx,
    addLayer, removeLayer, moveLayer, setLayerProp, setLayerName,
    seamlessEdges, setSeamlessEdges,
    startPaint, continuePaint, endStroke,
    generate, clear, fillAll, resize,
    getCell, paintArea, fillAt, fillRect,
    getManualTile, paintManualArea, fillManualAt, fillManualRect,
    clearManualTiles, clearManualArea, clearManualFill, clearManualRect, fillManualAll,
    placedProps, addProp, removeProp, updateProp, movePropZ, clearProps,
    loadState,
    undo, redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}
