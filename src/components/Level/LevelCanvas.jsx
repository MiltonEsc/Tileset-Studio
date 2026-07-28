import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react'
import { useGesture } from '@use-gesture/react'
import { Application, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { computeIndexMap, patchIndexMap, patchIndexMapFromCells } from '../../core/autotile.js'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { FILL_INDEX, makeFillVariants, pickVariant } from '../../core/tileVariants.js'
import { ANIM_FRAME_MS } from '../../core/tilesetDefinition.js'
import { MIN_CELL_PX, MAX_CELL_PX, ZOOM_STEP, ZOOM_FACTOR } from './zoomConfig.js'

const NO_TRANSFORM = { flipX: false, flipY: false, rotation: 0 }

// Positions/scales/rotates a pixi prop sprite for its placement transform.
// Uses a centered anchor so flip (negative scale) and rotation pivot in place.
function applyPropTransform(sprite, placed, entry, tileSize) {
  const tex = sprite.texture
  const baseSx = (entry.cols * tileSize) / tex.width
  const baseSy = (entry.rows * tileSize) / tex.height
  sprite.anchor.set(0.5)
  sprite.scale.set(baseSx * (placed.flipX ? -1 : 1), baseSy * (placed.flipY ? -1 : 1))
  sprite.rotation = ((placed.rotation || 0) * Math.PI) / 180
  sprite.x = (placed.x + entry.cols / 2) * tileSize
  sprite.y = (placed.y + entry.rows / 2) * tileSize
}

function assetToCanvas(asset) {
  const pxW = asset.cols * asset.tileSize
  const pxH = asset.rows * asset.tileSize
  const c = document.createElement('canvas')
  c.width = pxW
  c.height = pxH
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(asset.pixels), pxW, pxH), 0, 0)
  return c
}

export function LevelCanvas({
  layers = [], layerTiles = [],
  width, height, tileSize, cellPx, setCellPx, seamlessEdges, showGrid,
  onStartPaint, onContinuePaint, onEndPaint,
  terrainTool = 'brush', terrainBrushSize = 1, onFillTerrain, onRectTerrain, onPickTerrain,
  levelTool = 'terrain', placedProps = [], assetsById = {}, selectedAssetId = null,
  propTransform = NO_TRANSFORM, tileVariation = false,
  onPlaceProp, onRemovePropAt,
  selectedProp = null, onSelectPropAt, onMoveProp,
  active = true, smooth = false,
}) {
  const wrapperRef = useRef(null)
  const pixiHostRef = useRef(null)
  const overlayRef = useRef(null)
  const painting = useRef(false)
  const hoverCell = useRef(null)
  const zoomAnchor = useRef(null)
  const rectDrag = useRef(null)
  const lastPaintCell = useRef(null)
  const propDrag = useRef(null) // { id, dx, dy, lastX, lastY, histPushed } for the Select tool

  const appRef = useRef(null)
  const appReadyRef = useRef(false)
  const terrainContainerRef = useRef(null)
  const propsContainerRef = useRef(null)
  const layerStateCacheRef = useRef(new Map())
  const terrainTextureCache = useRef(new WeakMap())
  const assetTextureCache = useRef(new Map())
  const propSpriteCacheRef = useRef(new Map())
  const [pixiReady, setPixiReady] = useState(false)

  const displayW = width * cellPx
  const displayH = height * cellPx
  const cursor = levelTool === 'props'
    ? (selectedAssetId != null ? 'copy' : 'not-allowed')
    : levelTool === 'select' ? 'default' : 'crosshair'

  const forEachCellOnLine = useCallback((fromX, fromY, toX, toY, visit) => {
    let x = fromX
    let y = fromY
    const dx = Math.abs(toX - fromX)
    const dy = Math.abs(toY - fromY)
    const sx = fromX < toX ? 1 : -1
    const sy = fromY < toY ? 1 : -1
    let err = dx - dy

    while (true) {
      visit(x, y)
      if (x === toX && y === toY) break
      const e2 = err * 2
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }, [])

  const assetTextures = useMemo(() => {
    const cache = {}
    const ids = new Set(placedProps.map(p => p.assetId))
    if (selectedAssetId != null) ids.add(selectedAssetId)

    for (const id of ids) {
      const asset = assetsById[id]
      if (!asset) continue

      const cacheKey = `${asset.id}:${asset.cols}:${asset.rows}:${asset.tileSize}:${asset.pixels?.byteLength || asset.pixels?.length || 0}`
      const cached = assetTextureCache.current.get(cacheKey)
      if (cached) {
        cache[id] = cached
        continue
      }

      const canvas = assetToCanvas(asset)
      const texture = Texture.from(canvas, true)
      const entry = { texture, cols: asset.cols, rows: asset.rows }
      assetTextureCache.current.set(cacheKey, entry)
      cache[id] = entry
    }

    return cache
  }, [placedProps, assetsById, selectedAssetId])

  const getTerrainTextures = useCallback((layerTile) => {
    if (!layerTile?.tiles?.length) return null

    const cached = terrainTextureCache.current.get(layerTile)
    if (cached && cached.tileSize === (layerTile.tileSize || tileSize)) return cached

    const native = composeNativeSheet(layerTile.tiles, layerTile.tileSize || tileSize)
    const sheetTexture = Texture.from(native, true)
    const source = sheetTexture.source
    const sourceTileSize = layerTile.tileSize || tileSize

    const textures = Array.from({ length: 48 }, (_, idx) => new Texture({
      source,
      frame: new Rectangle((idx % 8) * sourceTileSize, Math.floor(idx / 8) * sourceTileSize, sourceTileSize, sourceTileSize),
    }))

    // Animation frames (procedural tilesets): one extra 48-texture set per frame.
    const frameTextures = (layerTile.frames || []).map(frameTiles => {
      const frameNative = composeNativeSheet(frameTiles, sourceTileSize)
      const frameSource = Texture.from(frameNative, true).source
      return Array.from({ length: 48 }, (_, idx) => new Texture({
        source: frameSource,
        frame: new Rectangle((idx % 8) * sourceTileSize, Math.floor(idx / 8) * sourceTileSize, sourceTileSize, sourceTileSize),
      }))
    })

    // Standalone textures for the fill-tile variants (anti-repetition). Always
    // built (cheap, cached); whether they're used is the `tileVariation` toggle.
    const fillVariantTextures = makeFillVariants(layerTile.tiles[FILL_INDEX], sourceTileSize).map(v => {
      const c = document.createElement('canvas')
      c.width = sourceTileSize
      c.height = sourceTileSize
      c.getContext('2d').putImageData(v, 0, 0)
      return Texture.from(c, true)
    })

    const entry = { tileSize: sourceTileSize, textures, sheetTexture, fillVariantTextures, frameTextures }
    terrainTextureCache.current.set(layerTile, entry)
    return entry
  }, [tileSize])

  useEffect(() => {
    let cancelled = false
    const app = new Application()

    const init = async () => {
      await app.init({
        width: Math.max(1, width * tileSize),
        height: Math.max(1, height * tileSize),
        antialias: false,
        autoDensity: false,
        resolution: 1,
        backgroundAlpha: 0,
        preference: 'webgl',
        powerPreference: 'high-performance',
      })
      appReadyRef.current = true
      if (cancelled) {
        app.destroy()
        return
      }

      app.canvas.style.width = '100%'
      app.canvas.style.height = '100%'
      app.canvas.style.display = 'block'
      app.canvas.style.imageRendering = 'pixelated'

      const terrain = new Container()
      const props = new Container()
      // Draw order of placed props follows their array order via zIndex (the
      // reconciler reuses sprites, so insertion order alone can't express it).
      props.sortableChildren = true
      app.stage.addChild(terrain)
      app.stage.addChild(props)

      terrainContainerRef.current = terrain
      propsContainerRef.current = props
      appRef.current = app
      pixiHostRef.current?.appendChild(app.canvas)
      setPixiReady(true)
    }

    init()

    return () => {
      cancelled = true
      setPixiReady(false)
      appReadyRef.current = false
      layerStateCacheRef.current = new Map()
      // Sprites belong to the app being destroyed; drop the stale cache so the
      // props effect rebuilds against the fresh container after re-init.
      propSpriteCacheRef.current = new Map()
      appRef.current = null
      terrainContainerRef.current = null
      propsContainerRef.current = null
      if (app.renderer) app.destroy()
    }
  }, [])

  useEffect(() => {
    const app = appRef.current
    if (!app) return
    app.renderer.resize(Math.max(1, width * tileSize), Math.max(1, height * tileSize))
  }, [width, height, tileSize])

  // The Levels view is kept mounted (for instant switching) but hidden via CSS
  // when inactive. Pause pixi's render ticker while hidden to free GPU/CPU; the
  // ticker resumes (and repaints on its next frame) when the view is shown again.
  useEffect(() => {
    if (!pixiReady) return
    const app = appRef.current
    if (!app?.ticker) return
    if (active) app.ticker.start()
    else app.ticker.stop()
  }, [active, pixiReady])

  // Smooth (non-pixel) tilesets render un-pixelated. The pixi canvas draws 1:1
  // and the on-screen zoom is CSS scaling of the canvas, so image-rendering is
  // the real control: 'auto' interpolates smoothly, 'pixelated' keeps it crisp.
  useEffect(() => {
    const app = appRef.current
    if (!app?.canvas) return
    app.canvas.style.imageRendering = smooth ? 'auto' : 'pixelated'
  }, [smooth, pixiReady])

  useEffect(() => {
    if (!pixiReady || !terrainContainerRef.current) return
    const terrainContainer = terrainContainerRef.current
    const border = seamlessEdges ? 1 : 0
    const expected = width * height
    const activeIds = new Set(layers.map(layer => layer.id))

    for (const [layerId, state] of layerStateCacheRef.current.entries()) {
      if (activeIds.has(layerId)) continue
      terrainContainer.removeChild(state.container)
      state.container.destroy({ children: true })
      layerStateCacheRef.current.delete(layerId)
    }

    // One Container of width*height Sprites per layer; tiles update incrementally
    // (only dirty cells swap texture). Reliable and efficient at these map sizes.
    const ensureLayerState = (layer, layerIdx) => {
      let state = layerStateCacheRef.current.get(layer.id)
      if (!state) {
        const container = new Container()
        terrainContainer.addChild(container)
        state = {
          container,
          sprites: [],
          indexMap: null,
          grid: null,
          manualTiles: null,
          tileRef: null,
          border: null,
          width: 0,
          height: 0,
        }
        layerStateCacheRef.current.set(layer.id, state)
      } else if (terrainContainer.getChildIndex(state.container) !== layerIdx) {
        terrainContainer.setChildIndex(state.container, Math.min(layerIdx, terrainContainer.children.length - 1))
      }

      state.container.visible = layer.visible !== false
      if (state.sprites.length !== expected || state.width !== width || state.height !== height) {
        state.container.removeChildren()
        state.sprites = []
        for (let cell = 0; cell < expected; cell++) {
          const sprite = new Sprite(Texture.EMPTY)
          sprite.visible = false
          sprite.roundPixels = true
          sprite.x = (cell % width) * tileSize
          sprite.y = ((cell / width) | 0) * tileSize
          sprite.width = tileSize
          sprite.height = tileSize
          state.container.addChild(sprite)
          state.sprites.push(sprite)
        }
        state.indexMap = null
        state.grid = null
        state.manualTiles = null
        state.cellIdx = new Int16Array(expected).fill(-1) // sheet index per cell (-1 = empty), for the animation ticker
        state.width = width
        state.height = height
      } else {
        for (let cell = 0; cell < expected; cell++) {
          const sprite = state.sprites[cell]
          sprite.x = (cell % width) * tileSize
          sprite.y = ((cell / width) | 0) * tileSize
          sprite.width = tileSize
          sprite.height = tileSize
        }
      }
      return state
    }

    layers.forEach((layer, layerIdx) => {
      const layerTile = layerTiles[layerIdx]
      const textureEntry = getTerrainTextures(layerTile)
      if (!textureEntry) return
      const state = ensureLayerState(layer, layerIdx)
      const textures = textureEntry.textures
      const variants = textureEntry.fillVariantTextures || []
      const useVariants = tileVariation && variants.length > 0
      const fullRebuild = !state.indexMap
        || state.tileRef !== layerTile
        || state.border !== border
        || state.variation !== useVariants

      let indexMap = state.indexMap
      let dirtyCells = []

      if (fullRebuild) {
        indexMap = computeIndexMap(layer.grid, width, height, border)
        dirtyCells = Array.from({ length: expected }, (_, cell) => cell)
      } else if (state.grid !== layer.grid) {
        const dirty = []
        const terrainDirty = Array.isArray(layer._dirtyTerrain) ? layer._dirtyTerrain : null
        indexMap = terrainDirty?.length
          ? patchIndexMapFromCells(state.indexMap, layer.grid, terrainDirty, width, height, border, dirty).map
          : patchIndexMap(state.indexMap, state.grid, layer.grid, width, height, border, dirty).map
        dirtyCells = dirty
      }

      if (state.manualTiles !== layer.manualTiles) {
        const manualDirty = Array.isArray(layer._dirtyManual) ? layer._dirtyManual : null
        if (manualDirty?.length) {
          const merged = new Set(dirtyCells)
          for (const cell of manualDirty) merged.add(cell)
          dirtyCells = [...merged]
        } else if (!fullRebuild) {
          const merged = new Set(dirtyCells)
          for (let cell = 0; cell < layer.manualTiles.length; cell++) {
            if (state.manualTiles?.[cell] !== layer.manualTiles[cell]) merged.add(cell)
          }
          dirtyCells = [...merged]
        }
      }

      for (const cell of dirtyCells) {
        const sprite = state.sprites[cell]
        const manualIdx = layer.manualTiles[cell]
        const idx = layer.kind === 'manual'
          ? manualIdx
          : (manualIdx >= 0 ? manualIdx : (indexMap[cell] ?? 0))
        const isEmpty = layer.kind === 'manual' ? idx < 0 : !idx
        state.cellIdx[cell] = isEmpty ? -1 : idx
        if (isEmpty) {
          sprite.visible = false
          sprite.texture = Texture.EMPTY
          continue
        }
        // Anti-repetition: for fill cells, deterministically pick a variant.
        let tex = textures[idx]
        if (useVariants && idx === FILL_INDEX) {
          const pick = pickVariant(cell % width, (cell / width) | 0, 1 + variants.length)
          if (pick > 0) tex = variants[pick - 1]
        }
        sprite.texture = tex || Texture.EMPTY
        sprite.visible = true
      }

      state.variation = useVariants
      state.indexMap = indexMap
      state.grid = layer.grid
      state.manualTiles = layer.manualTiles
      state.tileRef = layerTile
      state.border = border
      state.texEntry = textureEntry
    })
  }, [pixiReady, layers, layerTiles, width, height, tileSize, seamlessEdges, getTerrainTextures, tileVariation])

  // Animation ticker: when any layer's tileset has frames, cycle every sprite's
  // texture through [base, ...frames] using the per-cell sheet index recorded
  // by the terrain effect. The base slot restores fill-tile variants.
  useEffect(() => {
    if (!pixiReady || !active) return
    if (!layerTiles.some(lt => lt?.frames?.length)) return
    let tick = 0
    const id = setInterval(() => {
      tick++
      for (const state of layerStateCacheRef.current.values()) {
        const entry = state.texEntry
        const frames = entry?.frameTextures
        if (!frames?.length || !state.cellIdx) continue
        const slot = tick % (frames.length + 1)
        const set = slot === 0 ? entry.textures : frames[slot - 1]
        const variants = entry.fillVariantTextures || []
        for (let cell = 0; cell < state.cellIdx.length; cell++) {
          const idx = state.cellIdx[cell]
          if (idx < 0) continue
          const sprite = state.sprites[cell]
          if (!sprite) continue
          if (slot === 0 && state.variation && idx === FILL_INDEX && variants.length) {
            const pick = pickVariant(cell % state.width, (cell / state.width) | 0, 1 + variants.length)
            if (pick > 0) { sprite.texture = variants[pick - 1]; continue }
          }
          sprite.texture = set[idx] || Texture.EMPTY
        }
      }
    }, ANIM_FRAME_MS)
    return () => clearInterval(id)
  }, [pixiReady, layerTiles, active])

  useEffect(() => {
    if (!pixiReady || !propsContainerRef.current) return

    const propsContainer = propsContainerRef.current
    const cache = propSpriteCacheRef.current
    const seen = new Set()

    // Reconcile sprites against placedProps by id instead of rebuilding the
    // whole layer, so placing/removing one prop touches only that sprite.
    placedProps.forEach((placed, order) => {
      const entry = assetTextures[placed.assetId]
      if (!entry) return
      seen.add(placed.id)

      let sprite = cache.get(placed.id)
      if (!sprite) {
        sprite = new Sprite(entry.texture)
        sprite.roundPixels = true
        propsContainer.addChild(sprite)
        cache.set(placed.id, sprite)
      } else if (sprite.texture !== entry.texture) {
        sprite.texture = entry.texture
      }
      sprite.zIndex = order
      applyPropTransform(sprite, placed, entry, tileSize)
    })

    for (const [id, sprite] of cache) {
      if (seen.has(id)) continue
      propsContainer.removeChild(sprite)
      sprite.destroy()
      cache.delete(id)
    }
  }, [pixiReady, placedProps, assetTextures, tileSize])

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dW = width * cellPx
    const dH = height * cellPx

    if (canvas.width !== dW || canvas.height !== dH) {
      canvas.width = dW
      canvas.height = dH
    }

    ctx.clearRect(0, 0, dW, dH)

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      for (let x = 0; x <= width; x++) { ctx.beginPath(); ctx.moveTo(x * cellPx, 0); ctx.lineTo(x * cellPx, dH); ctx.stroke() }
      for (let y = 0; y <= height; y++) { ctx.beginPath(); ctx.moveTo(0, y * cellPx); ctx.lineTo(dW, y * cellPx); ctx.stroke() }
    }

    if (levelTool === 'props' && hoverCell.current && selectedAssetId != null) {
      const entry = assetTextures[selectedAssetId]
      if (entry) {
        const [hx, hy] = hoverCell.current
        const w = entry.cols * cellPx
        const h = entry.rows * cellPx
        ctx.imageSmoothingEnabled = false
        ctx.globalAlpha = 0.55
        // Preview the placement transform (flip/rotation) around the footprint centre.
        ctx.save()
        ctx.translate(hx * cellPx + w / 2, hy * cellPx + h / 2)
        ctx.rotate(((propTransform.rotation || 0) * Math.PI) / 180)
        ctx.scale(propTransform.flipX ? -1 : 1, propTransform.flipY ? -1 : 1)
        ctx.drawImage(entry.texture.source.resource, -w / 2, -h / 2, w, h)
        ctx.restore()
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth = 1
        ctx.strokeRect(hx * cellPx + 0.5, hy * cellPx + 0.5, w - 1, h - 1)
      }
    }

    if (levelTool === 'select' && selectedProp) {
      const a = assetsById[selectedProp.assetId]
      if (a) {
        // Same visual footprint as the hit-test: rotation swaps the extents.
        const swap = ((selectedProp.rotation || 0) % 180) !== 0
        const w = (swap ? a.rows : a.cols) * cellPx
        const h = (swap ? a.cols : a.rows) * cellPx
        const cx = (selectedProp.x + a.cols / 2) * cellPx
        const cy = (selectedProp.y + a.rows / 2) * cellPx
        ctx.strokeStyle = 'rgba(47,214,166,0.95)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.strokeRect(cx - w / 2 + 1, cy - h / 2 + 1, w - 2, h - 2)
        ctx.setLineDash([])
      }
    }

    if (levelTool === 'terrain' && terrainTool === 'rect' && rectDrag.current?.cur) {
      const { start, cur } = rectDrag.current
      const x0 = Math.min(start[0], cur[0])
      const y0 = Math.min(start[1], cur[1])
      const x1 = Math.max(start[0], cur[0])
      const y1 = Math.max(start[1], cur[1])
      ctx.strokeStyle = 'rgba(47,214,166,0.95)'
      ctx.lineWidth = 2
      ctx.strokeRect(x0 * cellPx + 1, y0 * cellPx + 1, (x1 - x0 + 1) * cellPx - 2, (y1 - y0 + 1) * cellPx - 2)
    }
  }, [width, height, cellPx, showGrid, levelTool, selectedAssetId, assetTextures, terrainTool, propTransform, selectedProp, assetsById])

  useEffect(() => { drawOverlay() }, [drawOverlay])

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    if (!anchor) return
    zoomAnchor.current = null
    const container = wrapperRef.current?.closest('.level-canvas-area')
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!container || !rect) return
    container.scrollLeft += (rect.left + anchor.worldX * cellPx) - anchor.clientX
    container.scrollTop += (rect.top + anchor.worldY * cellPx) - anchor.clientY
  }, [cellPx])

  const cellFromEvent = useCallback((e) => {
    const rect = wrapperRef.current.getBoundingClientRect()
    return [
      Math.floor((e.clientX - rect.left) / cellPx),
      Math.floor((e.clientY - rect.top) / cellPx),
    ]
  }, [cellPx])

  // Zoom to a target cell size, anchored at a client point so the cursor/pinch
  // centre stays put (the useLayoutEffect above restores scroll from zoomAnchor).
  // Reads cellPx from a ref so the gesture handlers never go stale.
  const cellPxRef = useRef(cellPx)
  cellPxRef.current = cellPx
  const clampCell = (v) => Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, v))
  const zoomToCell = useCallback((newCell, clientX, clientY) => {
    const cur = cellPxRef.current
    if (newCell === cur || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    zoomAnchor.current = {
      worldX: (clientX - rect.left) / cur,
      worldY: (clientY - rect.top) / cur,
      clientX,
      clientY,
    }
    setCellPx(newCell)
  }, [setCellPx])

  // Pointer-agnostic zoom: mouse/trackpad wheel + touch/trackpad pinch. Bound on
  // the wrapper with passive:false so preventDefault works (no console warnings).
  useGesture(
    {
      onWheel: ({ event }) => {
        if (!setCellPx) return
        event.preventDefault()
        const cur = cellPxRef.current
        const zoomIn = event.deltaY < 0
        // Multiplicative (proportional) zoom; always move at least 1px so small
        // cell sizes don't get stuck when rounding.
        let next = Math.round(cur * (zoomIn ? ZOOM_FACTOR : 1 / ZOOM_FACTOR))
        if (next === cur) next = cur + (zoomIn ? 1 : -1)
        zoomToCell(clampCell(next), event.clientX, event.clientY)
      },
      onPinch: ({ da: [dist], origin: [ox, oy], first, memo }) => {
        if (!setCellPx) return memo
        if (first || !memo) return { startDist: dist || 1, startCell: cellPxRef.current }
        const ratio = dist / memo.startDist
        const target = clampCell(Math.round((memo.startCell * ratio) / ZOOM_STEP) * ZOOM_STEP)
        zoomToCell(target, ox, oy)
        return memo
      },
    },
    { target: wrapperRef, eventOptions: { passive: false } },
  )

  const handleDown = useCallback((e) => {
    e.preventDefault()
    const [x, y] = cellFromEvent(e)
    if (levelTool === 'select') {
      const hit = onSelectPropAt?.(x, y)
      propDrag.current = hit
        ? { id: hit.id, dx: x - hit.x, dy: y - hit.y, lastX: hit.x, lastY: hit.y, histPushed: false }
        : null
      return
    }
    if (levelTool === 'props') {
      if (e.button === 2) onRemovePropAt?.(x, y)
      else onPlaceProp?.(x, y)
      return
    }
    if (terrainTool === 'picker') { onPickTerrain?.(x, y); return }
    if (terrainTool === 'fill') { onFillTerrain?.(x, y, e.button === 2); return }
    if (terrainTool === 'rect') {
      rectDrag.current = { start: [x, y], cur: [x, y], erase: e.button === 2 }
      drawOverlay()
      return
    }
    painting.current = true
    lastPaintCell.current = [x, y]
    onStartPaint(x, y, e.button === 2, terrainBrushSize)
  }, [cellFromEvent, drawOverlay, levelTool, onFillTerrain, onPickTerrain, onPlaceProp, onRemovePropAt, onSelectPropAt, onStartPaint, terrainBrushSize, terrainTool])

  const handleMove = useCallback((e) => {
    const [x, y] = cellFromEvent(e)
    if (levelTool === 'select') {
      const d = propDrag.current
      if (!d) return
      const nx = x - d.dx
      const ny = y - d.dy
      if (nx === d.lastX && ny === d.lastY) return
      // First real move records history once; the rest of the drag doesn't,
      // so the whole drag undoes in one step.
      onMoveProp?.(d.id, nx, ny, !d.histPushed)
      d.histPushed = true
      d.lastX = nx
      d.lastY = ny
      return
    }
    if (levelTool === 'props') {
      hoverCell.current = [x, y]
      drawOverlay()
      return
    }
    if (terrainTool === 'rect' && rectDrag.current) {
      rectDrag.current.cur = [x, y]
      drawOverlay()
      return
    }
    if (!painting.current) return
    const prev = lastPaintCell.current
    if (!prev) {
      lastPaintCell.current = [x, y]
      onContinuePaint(x, y, terrainBrushSize)
      return
    }
    if (prev[0] === x && prev[1] === y) return
    forEachCellOnLine(prev[0], prev[1], x, y, (px, py) => onContinuePaint(px, py, terrainBrushSize))
    lastPaintCell.current = [x, y]
  }, [cellFromEvent, drawOverlay, forEachCellOnLine, levelTool, onContinuePaint, onMoveProp, terrainBrushSize, terrainTool])

  const handleUp = useCallback(() => {
    if (rectDrag.current) {
      const { start, cur, erase } = rectDrag.current
      if (cur && onRectTerrain) onRectTerrain({ x: start[0], y: start[1] }, { x: cur[0], y: cur[1] }, erase)
      rectDrag.current = null
      drawOverlay()
    }
    painting.current = false
    lastPaintCell.current = null
    propDrag.current = null
    onEndPaint?.()
  }, [drawOverlay, onEndPaint, onRectTerrain])

  const handleLeave = useCallback(() => {
    painting.current = false
    rectDrag.current = null
    lastPaintCell.current = null
    propDrag.current = null
    onEndPaint?.()
    if (hoverCell.current) {
      hoverCell.current = null
      drawOverlay()
    }
  }, [drawOverlay, onEndPaint])

  return (
    <div
      ref={wrapperRef}
      className="level-canvas-wrapper"
      // touchAction:none lets @use-gesture handle touch pinch-zoom on the canvas.
      style={{ position: 'relative', width: displayW, height: displayH, cursor, touchAction: 'none' }}
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={handleLeave}
      onContextMenu={e => e.preventDefault()}
    >
      <div
        ref={pixiHostRef}
        style={{ position: 'absolute', inset: 0, width: displayW, height: displayH, overflow: 'hidden' }}
      />
      <canvas
        ref={overlayRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: displayW, height: displayH }}
      />
    </div>
  )
}
