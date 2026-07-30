/* @refresh reset */
import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { PixIcon }   from './components/ui/PixIcon.jsx'
import { Segmented } from './components/ui/Segmented.jsx'
import { ProjectModal } from './components/ui/ProjectModal.jsx'
import { ICONS }     from './components/ui/icons.js'
import { EditorWorkspace } from './components/Editor/EditorWorkspace.jsx'
import { GalleryDock }     from './components/BiomeGallery/GalleryDock.jsx'

// Editor is the landing view (eager). The Levels view drags in pixi.js (the
// bulk of the bundle) and Assets is secondary — load both on demand.
const LevelsWorkspace = lazy(() => import('./components/Level/LevelsWorkspace.jsx').then(m => ({ default: m.LevelsWorkspace })))
const AssetsView = lazy(() => import('./components/Assets/AssetsView.jsx').then(m => ({ default: m.AssetsView })))
import { useDrawingCanvas } from './hooks/useDrawingCanvas.js'
import { useTilesheet }     from './hooks/useTilesheet.js'
import { useLevelMap }      from './hooks/useLevelMap.js'
import { useAssets }        from './hooks/useAssets.js'
import { useTilesets }      from './hooks/useTilesets.js'
import { useLevels }        from './hooks/useLevels.js'
import { BIOMES, BIOME_MAP, DEFAULT_BIOME, GROUND_TEMPLATES } from './constants/biomes.js'
import { GENERATORS }       from './core/levelGenerator.js'
import { clampCellPx }      from './components/Level/zoomConfig.js'
import { bytesToBase64, base64ToBytes } from './lib/serialize.js'
import {
  tilesFromDefinition, applyTileOverrides, decodeDefinitionOverrides,
  framesFromDefinition, MAX_ANIM_FRAMES,
} from './core/tilesetDefinition.js'
import { generateAllBiomeTiles } from './core/proceduralGen.js'

function cloneColors(colors) {
  return {
    primary: colors?.primary || '#4a7c2f',
    secondary: colors?.secondary || '#3d6626',
    border: colors?.border || '#1e3a0f',
    highlight: colors?.highlight || '#6db84a',
    shadow: colors?.shadow || '#2a4a1a',
  }
}

// Resample a square RGBA texture (stored at its own native size) to size×size.
// AI textures are captured at the tile size they were generated for; when the
// global tile size changes, the bytes no longer match size*size*4, so we must
// rescale them (nearest-neighbour) before composing the 48 tiles.
function textureToImageData(bytes, size) {
  const data = bytes instanceof Uint8ClampedArray ? bytes : new Uint8ClampedArray(bytes)
  const native = Math.round(Math.sqrt(data.length / 4))
  if (native === size) return new ImageData(new Uint8ClampedArray(data), size, size)
  const src = document.createElement('canvas')
  src.width = native; src.height = native
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), native, native), 0, 0)
  const dst = document.createElement('canvas')
  dst.width = size; dst.height = size
  const ctx = dst.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0, native, native, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size)
}

function inferColorsFromTiles(tiles) {
  const counts = new Map()
  const luminance = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000

  for (const tile of tiles || []) {
    const data = tile?.data
    if (!data) continue
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }

  const ranked = [...counts.entries()]
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number)
      return { hex: `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`, count, lum: luminance(r, g, b) }
    })
    .sort((a, b) => b.count - a.count)

  if (!ranked.length) return null

  const unique = []
  for (const color of ranked) {
    if (!unique.find(c => c.hex === color.hex)) unique.push(color)
    if (unique.length >= 12) break
  }

  const byLum = [...unique].sort((a, b) => a.lum - b.lum)
  const primary = unique[0] || byLum[Math.floor(byLum.length / 2)] || null
  const secondary = unique[1] || primary
  const border = byLum[0] || primary
  const highlight = byLum[byLum.length - 1] || primary
  const shadow = byLum[Math.max(0, byLum.length - 2)] || border

  return {
    primary: primary?.hex || '#4a7c2f',
    secondary: secondary?.hex || primary?.hex || '#3d6626',
    border: border?.hex || '#1e3a0f',
    highlight: highlight?.hex || primary?.hex || '#6db84a',
    shadow: shadow?.hex || border?.hex || '#2a4a1a',
  }
}

function createEditorTilesetDescriptor({
  name,
  biomeId = null,
  colors,
  baseColors = null,
  savedId = null,
  isCustom = false,
  smooth = false,
  proceduralParams = {},
}) {
  const resolvedColors = cloneColors(colors)
  return {
    name: name || 'Custom',
    biomeId,
    colors: resolvedColors,
    baseColors: cloneColors(baseColors || resolvedColors),
    savedId,
    isCustom,
    smooth,
    proceduralParams: { ...proceduralParams },
  }
}

function distanceSq(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

function remapBaseTilePixels(bytes, fromColors, toColors) {
  const src = new Uint8ClampedArray(bytes)
  const fromPalette = [
    cloneColors(fromColors).primary,
    cloneColors(fromColors).secondary,
    cloneColors(fromColors).border,
    cloneColors(fromColors).highlight,
    cloneColors(fromColors).shadow,
  ].map(hex => {
    const clean = hex.replace('#', '')
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
  })
  const toPalette = [
    cloneColors(toColors).primary,
    cloneColors(toColors).secondary,
    cloneColors(toColors).border,
    cloneColors(toColors).highlight,
    cloneColors(toColors).shadow,
  ].map(hex => {
    const clean = hex.replace('#', '')
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
  })

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue
    const rgb = [src[i], src[i + 1], src[i + 2]]
    let nearest = 0
    let best = Number.POSITIVE_INFINITY
    for (let p = 0; p < fromPalette.length; p++) {
      const dist = distanceSq(rgb, fromPalette[p])
      if (dist < best) {
        best = dist
        nearest = p
      }
    }
    src[i] = toPalette[nearest][0]
    src[i + 1] = toPalette[nearest][1]
    src[i + 2] = toPalette[nearest][2]
  }

  return src
}

const PALETTE_KEYS = ['primary', 'secondary', 'border', 'highlight', 'shadow']
// Value-compare two palette objects (the 5 named swatches), case-insensitively.
function colorsEqual(a, b) {
  if (!a || !b) return false
  return PALETTE_KEYS.every(k => String(a[k]).toLowerCase() === String(b[k]).toLowerCase())
}

function descriptorFromBiome(biome) {
  return createEditorTilesetDescriptor({
    name: biome.label,
    biomeId: biome.id,
    colors: biome.colors,
    baseColors: biome.colors,
    savedId: null,
    isCustom: false,
    proceduralParams: biome.proceduralParams || {},
  })
}

// Lightweight persistence for navigation context (which view/mode the user left on).
const readUI = (key, fallback) => {
  try { return localStorage.getItem(`ts.ui.${key}`) || fallback } catch { return fallback }
}

export default function App({ auth = null }) {
  // Theme state: 'dark' (noche) or 'light' (día)
  const [theme, setTheme] = useState(() => readUI('theme', 'dark'))
  const toggleTheme = useCallback(() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark')), [])

  // Restore the last navigation context so a reload doesn't always dump the user
  // back on Editor ▸ Tileset (persisted in the effect below).
  const [activeView, setActiveView] = useState(() => readUI('activeView', 'editor')) // 'editor' | 'level'
  const [editorKind, setEditorKind] = useState(() => readUI('editorKind', 'tileset')) // 'tileset' | 'prop'
  const [tileSize, setTileSize]     = useState(32)
  const [regenerating, setRegenerating] = useState(false) // overlay while high-res tiles rebuild
  const [projectName, setProjectName] = useState('Untitled')
  const [activeLevelId, setActiveLevelId] = useState(null)
  const [projectModalOpen, setProjectModalOpen] = useState(true) // startup grid picker
  const [mode, setMode]             = useState(() => readUI('mode', 'procedural')) // 'procedural' | 'draw'
  const [levelMode, setLevelMode]   = useState('autotile')   // 'autotile' | 'manual'
  const [manualSelectedTile, setManualSelectedTile] = useState(1)
  const [editorTileset, setEditorTileset] = useState(() => descriptorFromBiome(DEFAULT_BIOME))
  const [editorSourceDef, setEditorSourceDef] = useState(() => ({
    mode: 'procedural',
    biomeId: DEFAULT_BIOME.id,
    label: DEFAULT_BIOME.label,
    colors: cloneColors(DEFAULT_BIOME.colors),
  }))

  const drawing   = useDrawingCanvas(tileSize)
  const tilesheet = useTilesheet()
  const level     = useLevelMap(32, 20)
  const assets    = useAssets()
  const tilesets  = useTilesets()
  const levels    = useLevels()

  // Per-tile overrides: hand-edited pixels for individual sheet tiles, applied
  // over whatever the generators produce. `overrideDraw` is a second drawing
  // canvas used only while editing one tile (editingTile = its sheet index).
  const [tileOverrides, setTileOverrides] = useState({})
  const [editingTile, setEditingTile] = useState(null)
  const overrideDraw = useDrawingCanvas(tileSize)
  // Animated tiles (procedural mode): total frame count, 1 = off.
  const [animFrameCount, setAnimFrameCount] = useState(1)
  // AI texture state (procedural textures mode) — declared before the memos
  // below that read it.
  const [aiTextures, setAiTextures] = useState(null)
  const [drawAiMeta, setDrawAiMeta] = useState(null)

  // "Latest ref" pattern: effects that call into these hooks read .current so
  // they don't have to list the (unstable, recreated-every-render) hook objects
  // as dependencies — which would cause infinite re-render loops.
  const drawingRef   = useRef(drawing);   drawingRef.current = drawing
  const tilesheetRef = useRef(tilesheet); tilesheetRef.current = tilesheet
  const overrideDrawRef = useRef(overrideDraw); overrideDrawRef.current = overrideDraw

  const [cellPx, setCellPxRaw]        = useState(18)
  const [showLevelGrid, setShowLevelGrid] = useState(true)
  const [tileVariation, setTileVariation] = useState(false) // fill-tile anti-repetition
  const [levelTool, setLevelTool]     = useState('terrain') // 'terrain' | 'props'
  const [terrainTool, setTerrainTool] = useState('brush')
  const [terrainBrushSize, setTerrainBrushSize] = useState(1)
  // Transform applied to newly placed props (and previewed by the placement ghost).
  const [propTransform, setPropTransform] = useState({ flipX: false, flipY: false, rotation: 0 })
  // Transient notice shown in the level view (e.g. tileset size mismatch).
  const [levelNotice, setLevelNotice] = useState('')
  const levelNoticeTimer = useRef(null)
  const showLevelNotice = useCallback((msg) => {
    setLevelNotice(msg)
    clearTimeout(levelNoticeTimer.current)
    levelNoticeTimer.current = setTimeout(() => setLevelNotice(''), 5000)
  }, [])
  const levelCanvasAreaRef = useRef(null)

  const assetsById = useMemo(
    () => Object.fromEntries(assets.assets.map(a => [a.id, a])),
    [assets.assets]
  )
  // Layer tiles: each layer resolves to actual ImageData[48].
  // null tileset = use current editor tileset; otherwise computed from definition.
  // Cached in a WeakMap by the `layer.tileset` object reference: regenerating the
  // 48 tiles is expensive, and during painting `level.layers` is rebuilt every
  // RAF flush while the tileset object stays the same reference, so a reference
  // key is both correct and avoids hashing the (large, base64-laden) definition.
  const layerTilesCache = useRef(new WeakMap())
  // The tiles everything renders: generator output + per-tile overrides on top.
  const displayTiles = useMemo(
    () => applyTileOverrides(tilesheet.tiles, tileOverrides, tileSize),
    [tilesheet.tiles, tileOverrides, tileSize]
  )
  // Animation frames for the editor tileset (procedural biome mode only): the
  // extra seeded sheet variants beyond the static frame, with the same per-tile
  // overrides applied so hand-edited tiles stay static.
  const editorAnimFrames = useMemo(() => {
    if (animFrameCount < 2 || mode !== 'procedural' || aiTextures) return null
    const base = BIOME_MAP[editorTileset.biomeId] || BIOMES[0]
    const biome = { ...base, colors: cloneColors(editorTileset.colors) }
    return Array.from({ length: animFrameCount - 1 }, (_, f) =>
      applyTileOverrides(generateAllBiomeTiles(biome, tileSize, f + 1), tileOverrides, tileSize))
  }, [animFrameCount, mode, aiTextures, editorTileset.biomeId, editorTileset.colors, tileSize, tileOverrides])
  const editorLayerTile = useMemo(
    () => ({ tiles: displayTiles, tileSize, frames: editorAnimFrames, smooth: editorTileset.smooth || false }),
    [displayTiles, tileSize, editorAnimFrames, editorTileset.smooth]
  )
  const layerTiles = useMemo(() => (
    level.layers.map(layer => {
      if (!layer.tileset) return editorLayerTile
      const cache = layerTilesCache.current
      if (!cache.has(layer.tileset)) {
        cache.set(layer.tileset, {
          tiles: tilesFromDefinition(layer.tileset.definition, layer.tileset.tileSize),
          tileSize: layer.tileset.tileSize,
          frames: framesFromDefinition(layer.tileset.definition, layer.tileset.tileSize),
          smooth: layer.tileset.definition?.smooth || false,
        })
      }
      return cache.get(layer.tileset)
    })
  ), [level.layers, editorLayerTile])
  const activeLayer = level.layers[level.activeLayerIdx] ?? null

  const handlePlaceProp = useCallback((x, y) => {
    if (assets.selectedId == null) return
    level.addProp(assets.selectedId, x, y, propTransform)
  }, [assets.selectedId, level, propTransform])

  // Topmost placed prop whose VISUAL footprint covers cell (x,y). Props rotate
  // around their footprint centre (see applyPropTransform), so 90°/270° swap
  // the extents; hit-test the cell against that rect. Used by the props tool's
  // right-click remove and by the Select tool.
  const findPropAt = useCallback((x, y) => {
    for (let i = level.placedProps.length - 1; i >= 0; i--) {
      const p = level.placedProps[i]
      const a = assetsById[p.assetId]
      if (!a) continue
      const swap = ((p.rotation || 0) % 180) !== 0
      const cx = p.x + a.cols / 2
      const cy = p.y + a.rows / 2
      const hw = (swap ? a.rows : a.cols) / 2
      const hh = (swap ? a.cols : a.rows) / 2
      if (x + 1 > cx - hw && x < cx + hw && y + 1 > cy - hh && y < cy + hh) return p
    }
    return null
  }, [level.placedProps, assetsById])

  const handleRemovePropAt = useCallback((x, y) => {
    const hit = findPropAt(x, y)
    if (hit) level.removeProp(hit.id)
  }, [findPropAt, level])

  // ── Prop selection (Select tool) ──────────────────────────────────────────
  const [selectedPropId, setSelectedPropId] = useState(null)
  const selectedProp = useMemo(
    () => level.placedProps.find(p => p.id === selectedPropId) || null,
    [level.placedProps, selectedPropId]
  )

  // Click on the map with the Select tool: select the hit prop (or clear).
  // Returns the hit so LevelCanvas can start a drag from it.
  const handleSelectPropAt = useCallback((x, y) => {
    const hit = findPropAt(x, y)
    setSelectedPropId(hit?.id ?? null)
    return hit
  }, [findPropAt])

  // Drag-move of the selected prop; recordHistory is true only for the first
  // cell change of a drag so the whole drag is one undo entry.
  const handleMoveProp = useCallback((id, x, y, recordHistory) => {
    const cx = Math.max(0, Math.min(level.width - 1, x))
    const cy = Math.max(0, Math.min(level.height - 1, y))
    level.updateProp(id, { x: cx, y: cy }, recordHistory)
  }, [level])

  const handleUpdateSelectedProp = useCallback((patch) => {
    if (selectedPropId) level.updateProp(selectedPropId, patch)
  }, [level, selectedPropId])

  const handleMoveSelectedPropZ = useCallback((direction) => {
    if (selectedPropId) level.movePropZ(selectedPropId, direction)
  }, [level, selectedPropId])

  const handleDeleteSelectedProp = useCallback(() => {
    if (!selectedPropId) return
    level.removeProp(selectedPropId)
    setSelectedPropId(null)
  }, [level, selectedPropId])

  const setCellPx = useCallback((next) => {
    setCellPxRaw(prev => clampCellPx(typeof next === 'function' ? next(prev) : next))
  }, [])

  const handleFitLevel = useCallback(() => {
    const area = levelCanvasAreaRef.current
    if (!area) return
    const pad = 48
    const fitW = Math.floor((area.clientWidth  - pad) / level.width)
    const fitH = Math.floor((area.clientHeight - pad) / level.height)
    setCellPx(Math.min(fitW, fitH))
  }, [level.width, level.height, setCellPx])

  useEffect(() => {
    tilesheet.generateFromBiome({ ...DEFAULT_BIOME, colors: cloneColors(DEFAULT_BIOME.colors) }, tileSize)
  }, []) // eslint-disable-line

  // Per-tile overrides are pixel-exact at one tile size; clear them whenever
  // the source they were painted over changes (size, biome, AI result, load).
  const clearTileOverrides = useCallback(() => {
    setTileOverrides({})
    setEditingTile(null)
  }, [])

  const handleEditTile = useCallback((idx) => {
    const tile = displayTiles?.[idx]
    if (!tile) return
    const od = overrideDrawRef.current
    od.resetCanvas(tileSize)
    od.loadPixels(tile.data)
    setEditingTile(idx)
  }, [displayTiles, tileSize])

  const handleApplyTileEdit = useCallback(() => {
    if (editingTile == null) return
    const pixels = new Uint8ClampedArray(overrideDrawRef.current.committedPixels)
    setTileOverrides(prev => ({ ...prev, [editingTile]: pixels }))
    setEditingTile(null)
  }, [editingTile])

  const handleCancelTileEdit = useCallback(() => setEditingTile(null), [])

  const handleResetTileOverride = useCallback(() => {
    if (editingTile == null) return
    setTileOverrides(prev => {
      if (!(editingTile in prev)) return prev
      const next = { ...prev }
      delete next[editingTile]
      return next
    })
    setEditingTile(null)
  }, [editingTile])

  // The heavy part of a tile-size change: reset the draw canvas + recompose the
  // 48 tiles at the new size. Factored out so it can run synchronously (small,
  // fast sizes) or deferred behind a "regenerating" overlay (128/256 px, which
  // would otherwise freeze the UI on the click).
  const regenForSize = (size) => {
    drawing.resetCanvas(size)
    clearTileOverrides()
    if (mode !== 'procedural') return
    const palette = editorTileset.colors
    if (aiTextures?.center) {
      const centerData = textureToImageData(aiTextures.center, size)
      const edgeData = aiTextures.edge ? textureToImageData(aiTextures.edge, size) : null
      tilesheet.generateFromTextures(centerData, edgeData, size, palette, aiTextures.smooth || false)
    } else {
      const base = BIOME_MAP[editorTileset.biomeId] || BIOMES[0]
      tilesheet.generateFromBiome({ ...base, label: editorTileset.name, colors: cloneColors(palette) }, size)
    }
  }

  const handleTileSizeChange = (newSize) => {
    if (newSize === tileSize) return
    setTileSize(newSize)
    // High-res tiles on a big level can blow past the browser/WebGL canvas limit
    // (~16384 px per side). Warn instead of silently failing to render.
    const MAX_CANVAS_PX = 16384
    if (level.width * newSize > MAX_CANVAS_PX || level.height * newSize > MAX_CANVAS_PX) {
      showLevelNotice(`At ${newSize}px this ${level.width}×${level.height} level exceeds ~16384px and may not render. Use a smaller level or tile size.`)
    }
    regenForSize(newSize)
  }

  // Startup "New Project" dialog: set the chosen grid (regen happens here, once)
  // and name, then close. The header GRID selector stays free to change it later.
  const handleProjectConfirm = ({ name, size }) => {
    setProjectName(name)
    handleTileSizeChange(size) // no-ops if size is unchanged
    setProjectModalOpen(false)
  }

  // Keyboard shortcuts: tile-override editor (any mode) or the base drawing
  // canvas (draw mode).
  useEffect(() => {
    const handleKey = (e) => {
      if (activeView !== 'editor' || editorKind !== 'tileset') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      const target = editingTile != null
        ? overrideDrawRef.current
        : (mode === 'draw' ? drawingRef.current : null)
      if (!target) return
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); target.undo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); target.redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeView, editorKind, mode, editingTile])

  const handleGenerate = () => {
    if (mode === 'draw') {
      const imageData = drawing.getImageData()
      tilesheet.generateFromBitmap(imageData, tileSize)
      // Reflect the drawing's own colors in the palette swatches (and the reset
      // baseline) instead of leaving the previously active biome's palette.
      const inferred = inferColorsFromTiles([{ data: imageData.data }])
      if (inferred) {
        setEditorTileset(prev => ({ ...prev, colors: cloneColors(inferred), baseColors: cloneColors(inferred) }))
        // If a saved draw tileset is loaded, keep its source in sync with the new
        // drawing + palette so the saved-tileset effect doesn't revert to the old
        // base pixels (colors now match → it would reload basePixels verbatim).
        setEditorSourceDef(prev => (prev?.mode === 'draw'
          ? { ...prev, colors: cloneColors(inferred), basePixels: bytesToBase64(imageData.data) }
          : prev))
      }
    } else if (aiTextures?.center) {
      const centerData = textureToImageData(aiTextures.center, tileSize)
      const edgeData = aiTextures.edge
        ? textureToImageData(aiTextures.edge, tileSize)
        : null
      tilesheet.generateFromTextures(centerData, edgeData, tileSize, editorTileset.colors, aiTextures.smooth || false)
    } else {
      const base = BIOME_MAP[editorTileset.biomeId] || BIOMES[0]
      tilesheet.generateFromBiome({ ...base, label: editorTileset.name, colors: cloneColors(editorTileset.colors) }, tileSize)
    }
  }

  const handleSelectBiome = useCallback((biome) => {
    const fresh = { ...biome, colors: cloneColors(biome.colors) }
    setEditorTileset(descriptorFromBiome(fresh))
    setEditorSourceDef({
      mode: 'procedural',
      biomeId: fresh.id,
      label: fresh.label,
      colors: cloneColors(fresh.colors),
      proceduralParams: fresh.proceduralParams || {},
    })
    setAiTextures(null)
    setDrawAiMeta(null)
    clearTileOverrides()
    tilesheet.generateFromBiome(fresh, tileSize)
  }, [tileSize, tilesheet, clearTileOverrides])

  const handleLoadPreset = useCallback((preset) => {
    const base = BIOME_MAP[preset.biomeId] || BIOMES[0]
    const fresh = { ...base, colors: cloneColors(preset.colors), proceduralParams: preset.proceduralParams || {} }
    setEditorTileset(descriptorFromBiome(fresh))
    setEditorSourceDef({
      mode: 'procedural',
      biomeId: fresh.id,
      label: fresh.label,
      colors: cloneColors(fresh.colors),
      proceduralParams: fresh.proceduralParams || {},
    })
    setAiTextures(null)
    setDrawAiMeta(null)
    clearTileOverrides()
    tilesheet.generateFromBiome(fresh, tileSize)
  }, [tileSize, tilesheet, clearTileOverrides])

  const handleColorChange = (key, value) => {
    setEditorTileset(prev => ({
      ...prev,
      colors: { ...prev.colors, [key]: value },
    }))
  }

  const handleProceduralParamChange = (key, value) => {
    setEditorTileset(prev => ({
      ...prev,
      proceduralParams: { ...prev.proceduralParams, [key]: value },
    }))
  }

  const handleResetBiomeColors = useCallback(() => {
    setEditorTileset(prev => ({
      ...prev,
      colors: cloneColors(prev.baseColors),
    }))
  }, [])

  const handleShuffleBiomeColors = useCallback(() => {
    const vary = (hex, amount) => {
      const value = hex.replace('#', '')
      const clamp = (n) => Math.max(0, Math.min(255, n))
      const next = [0, 2, 4].map((i) => {
        const channel = parseInt(value.slice(i, i + 2), 16)
        const drift = Math.round((Math.random() * 2 - 1) * amount)
        return clamp(channel + drift).toString(16).padStart(2, '0')
      })
      return `#${next.join('')}`
    }
    setEditorTileset(prev => ({
      ...prev,
      colors: {
        primary: vary(prev.colors.primary, 22),
        secondary: vary(prev.colors.secondary, 20),
        border: vary(prev.colors.border, 18),
        highlight: vary(prev.colors.highlight, 24),
        shadow: vary(prev.colors.shadow, 18),
      },
    }))
  }, [])

  const handleAITile = useCallback((pixels, result) => {
    drawing.loadPixels(pixels)
    setDrawAiMeta(result?.meta ? { base: result.meta } : null)
    clearTileOverrides()
    setEditorTileset(prev => ({
      ...prev,
      savedId: null,
      isCustom: true,
    }))
  }, [drawing, clearTileOverrides])

  const handleAIProcedural = useCallback((centerPixels, edgePixels, result) => {
    const center = new Uint8ClampedArray(centerPixels)
    const edge   = edgePixels ? new Uint8ClampedArray(edgePixels) : null
    const centerData = textureToImageData(center, tileSize)
    const edgeData   = edge ? textureToImageData(edge, tileSize) : null
    // A "smooth" (non-pixel) import keeps full colour and renders un-pixelated.
    const smooth = result?.center?.meta?.smooth || false
    // Reflect the AI material in the palette swatches (and the saved colors)
    // instead of keeping the previously active biome's palette — a lava center
    // shouldn't carry grass-green swatches into the gallery thumbnail.
    const inferred = inferColorsFromTiles([{ data: center }]) || editorTileset.colors
    tilesheet.generateFromTextures(centerData, edgeData, tileSize, inferred, smooth, editorTileset.proceduralParams)
    const ai = result ? {
      center: result.center?.meta || null,
      edge: result.edge?.meta || null,
    } : null
    setAiTextures({ center, edge, ai, smooth })
    setDrawAiMeta(null)
    clearTileOverrides()
    setEditorTileset(prev => ({
      ...prev,
      colors: cloneColors(inferred),
      baseColors: cloneColors(inferred),
      savedId: null,
      isCustom: true,
      smooth,
    }))
    setEditorSourceDef({
      mode: 'textures',
      centerPixels: bytesToBase64(center),
      edgePixels: edge ? bytesToBase64(edge) : null,
      biomeId: editorTileset.biomeId,
      label: editorTileset.name,
      colors: cloneColors(inferred),
      smooth,
      ai,
    })
  }, [tileSize, tilesheet, editorTileset, clearTileOverrides])

  // "Recolor the form": extract a 5-colour palette from the AI/imported image and
  // repaint the ACTIVE procedural template with it, KEEPING its shape (patternFn).
  // Unlike handleAIProcedural this stays in 'procedural' mode — it does NOT build a
  // texture tileset from the image, so the cobble / brick / crack form is preserved
  // (this is the "con IA aplicar el color, manteniendo la forma" behaviour).
  const handleAIRecolor = useCallback((centerPixels) => {
    const center = new Uint8ClampedArray(centerPixels)
    const inferred = inferColorsFromTiles([{ data: center }])
    if (!inferred) return
    const base = BIOME_MAP[editorTileset.biomeId] || BIOMES[0]
    setAiTextures(null)
    setDrawAiMeta(null)
    clearTileOverrides()
    setEditorTileset(prev => ({
      ...prev,
      colors: cloneColors(inferred),
      baseColors: cloneColors(inferred),
      savedId: null,
      isCustom: true,
      smooth: false,
    }))
    setEditorSourceDef({
      mode: 'procedural',
      biomeId: editorTileset.biomeId,
      label: editorTileset.name,
      colors: cloneColors(inferred),
    })
    tilesheet.generateFromBiome({ ...base, label: editorTileset.name, colors: cloneColors(inferred) }, tileSize)
  }, [tileSize, tilesheet, editorTileset, clearTileOverrides])

  const currentTilesetDefinition = useCallback(() => {
    // Hand-edited tiles ride in the definition as { index: base64 }.
    const overrideKeys = Object.keys(tileOverrides)
    const overridesOut = overrideKeys.length
      ? { overrides: Object.fromEntries(overrideKeys.map(k => [k, bytesToBase64(tileOverrides[k])])) }
      : {}
    if (mode === 'draw') {
      // Persist the palette inferred from the drawing's own pixels (so the saved
      // swatches reflect the art), falling back to the current swatches.
      const inferred = inferColorsFromTiles([{ data: drawing.committedPixels }]) || editorTileset.colors
      return {
        mode: 'draw',
        basePixels: bytesToBase64(drawing.committedPixels),
        label: editorTileset.name,
        colors: inferred,
        ...(drawAiMeta ? { ai: drawAiMeta } : {}),
        ...overridesOut,
      }
    }
    if (aiTextures) return {
      mode: 'textures',
      centerPixels: bytesToBase64(aiTextures.center),
      edgePixels: aiTextures.edge ? bytesToBase64(aiTextures.edge) : null,
      biomeId: editorTileset.biomeId,
      label: editorTileset.name,
      colors: editorTileset.colors,
      proceduralParams: editorTileset.proceduralParams,
      ...(aiTextures.smooth ? { smooth: true } : {}),
      ...(aiTextures.ai ? { ai: aiTextures.ai } : {}),
      ...overridesOut,
    }
    return {
      mode: 'procedural',
      biomeId: editorTileset.biomeId,
      label: editorTileset.name,
      colors: editorTileset.colors,
      proceduralParams: editorTileset.proceduralParams,
      ...(animFrameCount > 1 ? { animationFrames: animFrameCount } : {}),
      ...overridesOut,
    }
  }, [mode, drawing.committedPixels, editorTileset, aiTextures, drawAiMeta, tileOverrides, animFrameCount])

  // `generate` controls whether the 48-tile sheet is rendered here. The editor
  // tileset-load path passes false because the saved-tileset effect regenerates
  // once afterwards; the level-load path keeps it true (that effect is inactive
  // in level view). Avoids rendering the sheet 2-3× per selection.
  const applyTilesetDefinition = useCallback((def, size, generate = true) => {
    if (!def) return
    // Restore the definition's hand-edited tiles (or clear stale ones), and its
    // animation frame count (procedural only — other modes can't animate).
    setEditingTile(null)
    setTileOverrides(decodeDefinitionOverrides(def) || {})
    setAnimFrameCount(def.mode === 'procedural' || (!def.mode && def.biomeId)
      ? Math.max(1, Math.min(MAX_ANIM_FRAMES, def.animationFrames | 0)) || 1
      : 1)
    if (def.mode === 'draw') {
      setMode('draw')
      setAiTextures(null)
      const bytes = base64ToBytes(def.basePixels)
      const bmp = textureToImageData(bytes, size)
      if (generate) tilesheet.generateFromBitmap(bmp, size)
      const inferred = def.colors || inferColorsFromTiles(tilesFromDefinition(def, size)) || BIOMES[0].colors
      setEditorTileset(createEditorTilesetDescriptor({
        name: def.label || 'Drawn tileset',
        biomeId: null,
        colors: inferred,
        baseColors: inferred,
        savedId: null,
        isCustom: true,
      }))
      setEditorSourceDef({
        mode: 'draw',
        basePixels: def.basePixels,
        label: def.label || 'Drawn tileset',
        colors: cloneColors(inferred),
        ...(def.ai ? { ai: def.ai } : {}),
      })
      setDrawAiMeta(def.ai || null)
      return bytes
    }
    if (def.mode === 'textures') {
      setMode('procedural')
      const center = new Uint8ClampedArray(base64ToBytes(def.centerPixels))
      const edge   = def.edgePixels ? new Uint8ClampedArray(base64ToBytes(def.edgePixels)) : null
      const inferred = def.colors || inferColorsFromTiles(tilesFromDefinition(def, size)) || BIOMES[0].colors
      if (generate) {
        const centerData = textureToImageData(center, size)
        const edgeData   = edge ? textureToImageData(edge, size) : null
        tilesheet.generateFromTextures(centerData, edgeData, size, inferred, def.smooth || false, def.proceduralParams)
      }
      const base = def.biomeId ? BIOME_MAP[def.biomeId] : null
      setEditorTileset(createEditorTilesetDescriptor({
        name: def.label || base?.label || 'Custom textured',
        biomeId: base?.id || null,
        colors: inferred,
        baseColors: def.colors || inferred,
        savedId: null,
        isCustom: !base,
        smooth: def.smooth || false,
        proceduralParams: def.proceduralParams || {},
      }))
      setEditorSourceDef({
        ...def,
        label: def.label || base?.label || 'Custom textured',
        colors: cloneColors(def.colors || inferred),
      })
      setAiTextures({ center, edge, ai: def.ai || null, smooth: def.smooth || false })
      setDrawAiMeta(null)
      return null
    }
    setMode('procedural')
    setAiTextures(null)
    setDrawAiMeta(null)
    const base = def.biomeId ? BIOME_MAP[def.biomeId] : null
    const inferred = def.colors || inferColorsFromTiles(tilesFromDefinition(def, size)) || BIOMES[0].colors
    const biome = {
      ...(base || BIOMES[0]),
      label: def.label || base?.label || 'Custom procedural',
      colors: cloneColors(inferred),
      proceduralParams: { ...((base || BIOMES[0]).proceduralParams || {}), ...(def.proceduralParams || {}) },
    }
    setEditorTileset(createEditorTilesetDescriptor({
      name: biome.label,
      biomeId: base?.id || null,
      colors: inferred,
      baseColors: def.colors || inferred,
      savedId: null,
      isCustom: !base,
      proceduralParams: biome.proceduralParams,
    }))
    setEditorSourceDef({
      ...def,
      label: biome.label,
      colors: cloneColors(def.colors || inferred),
    })
    if (generate) tilesheet.generateFromBiome(biome, size)
    return null
  }, [tilesheet])

  const handleSaveTileset = useCallback((name) => {
    tilesets.save({ name, tileSize, definition: currentTilesetDefinition() })
  }, [tilesets, tileSize, currentTilesetDefinition])

  const handleLoadTileset = useCallback((row) => {
    const size = row.tile_size
    setTileSize(size)
    drawing.resetCanvas(size)
    // Defer the 48-tile generation to the saved-tileset effect below when we're
    // in the tileset editor: setting savedId triggers it to regenerate once from
    // editorSourceDef + colors, so generating here too would render the sheet
    // 2-3× per selection. Outside that view the effect is inactive, so generate
    // synchronously. Colors are inferred only when the definition didn't store them.
    applyTilesetDefinition(row.definition, size, editorKind !== 'tileset')
    const resolvedColors = row.definition?.colors
      || inferColorsFromTiles(tilesFromDefinition(row.definition, size))
      || BIOMES[0].colors
    if (resolvedColors) {
      const base = row.definition?.biomeId ? BIOME_MAP[row.definition.biomeId] : null
      setEditorTileset(createEditorTilesetDescriptor({
        name: row.name || row.definition?.label || base?.label || 'Saved tileset',
        biomeId: base?.id || null,
        colors: resolvedColors,
        baseColors: row.definition?.colors || resolvedColors,
        savedId: row.id,
        isCustom: !base,
        proceduralParams: row.definition?.proceduralParams || {},
      }))
      setEditorSourceDef({
        ...row.definition,
        label: row.name || row.definition?.label || base?.label || 'Saved tileset',
        colors: cloneColors(row.definition?.colors || resolvedColors),
      })
    }
    // The saved-tileset effect (draw branch) loads the recolored base pixels, so
    // no drawing.loadPixels here — doing both double-loads + double-pushes history.
  }, [drawing, applyTilesetDefinition, editorKind])

  useEffect(() => {
    if (activeView !== 'editor' || editorKind !== 'tileset') return
    if (!editorSourceDef) return

    if (editorSourceDef.mode === 'draw' && editorSourceDef.basePixels) {
      const bytes = base64ToBytes(editorSourceDef.basePixels)
      // A freehand drawing is its own source of truth: load it verbatim (matching
      // the gallery thumbnail). Only remap when the user actually edited a palette
      // swatch — otherwise nearest-color snapping to the 5 swatches corrupts drawn
      // colors that aren't exactly in the palette (the reported "otros colores").
      const pixels = colorsEqual(editorSourceDef.colors, editorTileset.colors)
        ? new Uint8ClampedArray(bytes)
        : remapBaseTilePixels(bytes, editorSourceDef.colors || editorTileset.baseColors, editorTileset.colors)
      drawingRef.current.loadPixels(pixels)
      const side = Math.round(Math.sqrt(pixels.length / 4))
      tilesheetRef.current.generateFromBitmap(new ImageData(pixels, side, side), side)
      return
    }

    if (editorSourceDef.mode === 'textures' && editorSourceDef.centerPixels) {
      const needsRecolor = !colorsEqual(editorSourceDef.colors, editorTileset.colors)
      let cBytes = base64ToBytes(editorSourceDef.centerPixels)
      let eBytes = editorSourceDef.edgePixels ? base64ToBytes(editorSourceDef.edgePixels) : null

      if (needsRecolor) {
        cBytes = remapBaseTilePixels(cBytes, editorSourceDef.colors || editorTileset.baseColors, editorTileset.colors)
        if (eBytes) eBytes = remapBaseTilePixels(eBytes, editorSourceDef.colors || editorTileset.baseColors, editorTileset.colors)
      }

      const centerData = textureToImageData(cBytes, tileSize)
      const edgeData = eBytes ? textureToImageData(eBytes, tileSize) : null
      tilesheetRef.current.generateFromTextures(centerData, edgeData, tileSize, editorTileset.colors, editorSourceDef.smooth || false, editorTileset.proceduralParams)
      return
    }

    const base = editorSourceDef.biomeId ? BIOME_MAP[editorSourceDef.biomeId] : BIOMES[0]
    tilesheetRef.current.generateFromBiome({
      ...base,
      label: editorTileset.name,
      colors: cloneColors(editorTileset.colors),
      proceduralParams: { ...(base.proceduralParams || {}), ...(editorTileset.proceduralParams || {}) },
    }, tileSize)
  }, [
    activeView,
    editorKind,
    editorTileset.savedId,
    editorTileset.colors,
    editorTileset.baseColors,
    editorTileset.name,
    editorTileset.proceduralParams,
    editorSourceDef,
    tileSize,
  ])

  const handleSaveLevel = useCallback(async (name) => {
    if (!level.layers.length) return
    const row = await levels.save({
      id: activeLevelId,
      name, width: level.width, height: level.height, tileSize,
      layers: level.layers.map(layer => {
        const manualOut = new Uint8ClampedArray(layer.manualTiles.length)
        for (let i = 0; i < layer.manualTiles.length; i++) manualOut[i] = layer.manualTiles[i] + 1
        return {
          id: layer.id,
          name: layer.name,
          kind: layer.kind || 'autotile',
          visible: layer.visible !== false,
          tileset: layer.tileset,
          gridB64: bytesToBase64(layer.grid),
          manualTilesB64: bytesToBase64(manualOut),
        }
      }),
      placedProps: level.placedProps,
      seamlessEdges: level.seamlessEdges,
    })
    if (row) {
      setActiveLevelId(row.id)
      setProjectName(row.name)
    }
  }, [levels, level, tileSize, activeLevelId])

  const handleLoadLevel = useCallback((row) => {
    const size = row.tile_size || tileSize
    let loadedLayers
    if (row.layers?.length > 0) {
      loadedLayers = row.layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible !== false, tileset: l.tileset || null,
        kind: l.kind || 'autotile',
        grid: new Uint8Array(base64ToBytes(l.gridB64 || '')),
        manualTiles: l.manualTilesB64
          ? Int16Array.from(base64ToBytes(l.manualTilesB64), v => v - 1)
          : new Int16Array(row.width * row.height).fill(-1),
      }))
    } else {
      // Legacy single-layer format
      const grid = row.grid ? base64ToBytes(row.grid) : new Uint8Array(row.width * row.height)
      const manualTiles = row.manual_tiles
        ? Int16Array.from(base64ToBytes(row.manual_tiles), v => v - 1)
        : new Int16Array(row.width * row.height).fill(-1)
      loadedLayers = [{
        id: `layer-${Date.now()}`, name: 'Layer 1', visible: true,
        kind: 'autotile',
        tileset: row.tileset ? { name: 'Base', tileSize: size, definition: row.tileset } : null,
        grid, manualTiles,
      }]
    }
    const mainDef = loadedLayers[0]?.tileset?.definition ?? row.tileset
    setTileSize(size)
    drawing.resetCanvas(size)
    if (mainDef) { const bytes = applyTilesetDefinition(mainDef, size); if (bytes) drawing.loadPixels(bytes) }
    level.loadState({ width: row.width, height: row.height, layers: loadedLayers, placedProps: row.placed_props })
    level.setSeamlessEdges(!!row.seamless_edges)
    setSelectedPropId(null)
    setActiveLevelId(row.id)
    setProjectName(row.name)
  }, [drawing, applyTilesetDefinition, level, tileSize])

  const handleExportLevel = useCallback(() => {
    if (!level.layers.length) return
    const payload = {
      name: projectName,
      width: level.width,
      height: level.height,
      tile_size: tileSize, // export format matches DB format
      layers: level.layers.map(layer => {
        const manualOut = new Uint8ClampedArray(layer.manualTiles.length)
        for (let i = 0; i < layer.manualTiles.length; i++) manualOut[i] = layer.manualTiles[i] + 1
        return {
          id: layer.id,
          name: layer.name,
          kind: layer.kind || 'autotile',
          visible: layer.visible !== false,
          tileset: layer.tileset,
          gridB64: bytesToBase64(layer.grid),
          manualTilesB64: bytesToBase64(manualOut),
        }
      }),
      placed_props: level.placedProps,
      seamless_edges: level.seamlessEdges,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/\s+/g, '_')}_project.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [level, tileSize, projectName])

  const handleImportLevel = useCallback((e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const row = JSON.parse(event.target.result)
        // Set id to null so it's loaded as a new project
        row.id = null
        handleLoadLevel(row)
        setActiveLevelId(null) // clear active level ID so it's unlinked from DB until saved
      } catch (err) {
        alert('Invalid project file')
      }
    }
    reader.readAsText(file)
    e.target.value = '' // reset input
  }, [handleLoadLevel])

  const handleSurprise = useCallback(() => {
    const keys = Object.keys(GENERATORS)
    level.generate(keys[Math.floor(Math.random() * keys.length)])
  }, [level])

  // The erase decision (right button or eraser tool) is made once at stroke
  // start and held in a ref, so a right-button DRAG keeps erasing — continue
  // events don't carry the mouse button.
  const terrainStrokeErase = useRef(false)
  const handleTerrainStart = useCallback((x, y, erase, brushSize = 1) => {
    const shouldErase = erase || terrainTool === 'eraser'
    terrainStrokeErase.current = shouldErase
    const targetManual = activeLayer?.kind === 'manual'
    if (targetManual) {
      level.paintManualArea(x, y, shouldErase ? -1 : manualSelectedTile, brushSize)
      return
    }
    level.paintArea(x, y, shouldErase ? 0 : 1, brushSize)
    level.clearManualArea(x, y, brushSize)
  }, [level, activeLayer, manualSelectedTile, terrainTool])

  const handleTerrainContinue = useCallback((x, y, brushSize = 1) => {
    const shouldErase = terrainStrokeErase.current
    const targetManual = activeLayer?.kind === 'manual'
    if (targetManual) {
      level.paintManualArea(x, y, shouldErase ? -1 : manualSelectedTile, brushSize)
      return
    }
    level.paintArea(x, y, shouldErase ? 0 : 1, brushSize)
    level.clearManualArea(x, y, brushSize)
  }, [level, activeLayer, manualSelectedTile])

  const handleTerrainFill = useCallback((x, y, erase) => {
    const shouldErase = erase || terrainTool === 'eraser'
    if (activeLayer?.kind === 'manual') {
      level.fillManualAt(x, y, shouldErase ? -1 : manualSelectedTile)
      return
    }
    level.fillAt(x, y, shouldErase ? 0 : 1)
    level.clearManualFill(x, y)
  }, [level, activeLayer, manualSelectedTile, terrainTool])

  const handleTerrainRect = useCallback((a, b, erase) => {
    const shouldErase = erase || terrainTool === 'eraser'
    if (activeLayer?.kind === 'manual') {
      level.fillManualRect(a, b, shouldErase ? -1 : manualSelectedTile)
      return
    }
    level.fillRect(a, b, shouldErase ? 0 : 1)
    level.clearManualRect(a, b)
  }, [level, activeLayer, manualSelectedTile, terrainTool])

  const handleTerrainPick = useCallback((x, y) => {
    if (activeLayer?.kind === 'manual') {
      const manual = level.getManualTile(x, y)
      if (manual >= 0) { setManualSelectedTile(manual); return }
      return
    }
    const value = level.getCell(x, y)
    setTerrainTool(value ? 'brush' : 'eraser')
  }, [level, activeLayer])

  const handleFillActiveLayer = useCallback(() => {
    if (activeLayer?.kind === 'manual') {
      level.fillManualAll(manualSelectedTile)
      return
    }
    level.fillAll()
  }, [activeLayer, level, manualSelectedTile])

  const handleClearActiveLayer = useCallback(() => {
    if (activeLayer?.kind === 'manual') {
      level.clearManualTiles()
      return
    }
    level.clear()
  }, [activeLayer, level])

  useEffect(() => {
    if (!activeLayer) return
    const nextMode = activeLayer.kind === 'manual' ? 'manual' : 'autotile'
    setLevelMode(prev => prev === nextMode ? prev : nextMode)
  }, [activeLayer?.id, activeLayer?.kind])

  // View visibility flags. The three workspaces are kept MOUNTED once opened and
  // toggled with CSS (display:none) instead of unmount/remount, so switching back
  // is instant — no lazy re-download, no pixi re-init. Latch refs remember which
  // lazy views have been opened so their chunk loads only on first activation.
  const showTileset = activeView === 'editor' && editorKind === 'tileset'
  const showAssets  = activeView === 'editor' && editorKind === 'prop'
  const showLevel   = activeView === 'level'
  const everAssets = useRef(false); everAssets.current = everAssets.current || showAssets
  const everLevel  = useRef(false); everLevel.current  = everLevel.current  || showLevel

  // Remember the navigation context across reloads (see readUI above).
  useEffect(() => {
    try {
      localStorage.setItem('ts.ui.activeView', activeView)
      localStorage.setItem('ts.ui.editorKind', editorKind)
      localStorage.setItem('ts.ui.mode', mode)
      localStorage.setItem('ts.ui.theme', theme)
    } catch { /* storage unavailable — non-critical */ }
  }, [activeView, editorKind, mode, theme])

  // Stable array of overridden tile indices (avoids a fresh array prop each render).
  const overriddenTiles = useMemo(() => Object.keys(tileOverrides).map(Number), [tileOverrides])

  // Prefetch the lazy view chunks during idle time so the FIRST switch is also
  // instant (the chunk — incl. pixi for Levels — is already cached).
  useEffect(() => {
    const prefetch = () => {
      import('./components/Assets/AssetsView.jsx').catch(() => {})
      import('./components/Level/LevelsWorkspace.jsx').catch(() => {})
    }
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(prefetch)
      return () => window.cancelIdleCallback?.(id)
    }
    const id = setTimeout(prefetch, 1200)
    return () => clearTimeout(id)
  }, [])

  // A saved tileset can carry a biomeId in its definition; don't also light up
  // the biome card when a saved tileset is the active selection.
  const galleryActiveBiomeId = activeView === 'level'
    ? (activeLayer?.tileset?.savedId ? null : (activeLayer?.tileset?.definition?.biomeId ?? null))
    : (editorTileset.savedId ? null : editorTileset.biomeId)
  const galleryActiveSavedId = activeView === 'level'
    ? (activeLayer?.tileset?.savedId ?? null)
    : editorTileset.savedId

  const galleryContext = activeView === 'level'
    ? `Click applies to layer: ${activeLayer?.name || '—'}`
    : 'Click loads into the editor'

  const galleryDock = (
    <GalleryDock
      biomes={BIOMES}
      groundTemplates={GROUND_TEMPLATES}
      context={galleryContext}
      activeBiomeId={galleryActiveBiomeId}
      activeSavedTilesetId={galleryActiveSavedId}
      onSelectBiome={activeView === 'level'
        ? (biome) => level.setLayerProp(level.activeLayerIdx, {
            tileset: { name: biome.label, tileSize, definition: { mode: 'procedural', biomeId: biome.id, colors: biome.colors } },
          })
        : handleSelectBiome}
      tilesets={tilesets.tilesets}
      defaultName={mode === 'draw' ? 'Drawn tileset' : editorTileset.name}
      onSaveTileset={handleSaveTileset}
      onLoadTileset={activeView === 'level'
        ? (row) => {
            // Only allow tilesets whose tile size matches the level's tile size.
            if ((row.tile_size || tileSize) !== tileSize) {
              showLevelNotice(`"${row.name}" is ${row.tile_size}px — the level paints at ${tileSize}px. Set the level tile size to ${row.tile_size}px to use it.`)
              return
            }
            level.setLayerProp(level.activeLayerIdx, {
              tileset: { name: row.name, tileSize: row.tile_size, definition: row.definition, savedId: row.id },
            })
          }
        : handleLoadTileset}
      onRemoveTileset={tilesets.remove}
      assets={assets.assets}
      selectedAssetId={assets.selectedId}
      onSelectAsset={assets.select}
      tilesetsLoading={tilesets.loading}
      tilesetsError={tilesets.error}
      propsLoading={assets.loading}
      propsError={assets.error}
    />
  )

  return (
    <div className="app" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><PixIcon grid={ICONS.grid} px={3} color="#06150f" /></div>
          <span className="brand-name">Tileset Studio</span>
        </div>

        <Segmented
          size="sm"
          value={activeView === 'level' ? 'level' : (editorKind === 'tileset' ? 'tileset' : 'prop')}
          onChange={(tab) => {
            if (tab === 'level') {
              setActiveView('level')
            } else {
              setActiveView('editor')
              setEditorKind(tab)
            }
          }}
          options={[
            { value: 'tileset', label: '🎨 Tileset' },
            { value: 'prop', label: '📦 Assets' },
            { value: 'level', label: '🗺️ Niveles' }
          ]}
        />

        <div className="spacer" />

        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Cambiar a Modo Día (Light)' : 'Cambiar a Modo Noche (Dark)'}
        >
          <span className="theme-toggle-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span className="theme-toggle-label">{theme === 'dark' ? 'Día' : 'Noche'}</span>
        </button>

        <button className="project-new-btn" onClick={() => setProjectModalOpen(true)} title="New project (choose tile size)">
          {projectName}
        </button>

        <div className="topgroup">
          <span className="group-label">GRID</span>
          <Segmented size="sm" value={tileSize} onChange={handleTileSizeChange}
            options={[{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }, { value: 64, label: '64' }]} />
        </div>

        {auth?.user && (
          <div className="topgroup account-group">
            <span className="account-email" title={auth.user.email}>{auth.user.email}</span>
            <button className="account-signout" onClick={auth.signOut} title="Sign out">
              Sign out
            </button>
          </div>
        )}
      </header>

      <div className={`view-pane ${showTileset ? '' : 'view-hidden'}`}>
        <EditorWorkspace
          mode={mode} setMode={setMode} tileSize={tileSize} setTileSize={setTileSize}
          biome={editorTileset} onColorChange={handleColorChange}
          onProceduralParamChange={handleProceduralParamChange}
          onLoadPreset={handleLoadPreset}
          onResetColors={handleResetBiomeColors} onShuffleColors={handleShuffleBiomeColors}
          drawing={drawing} tiles={displayTiles}
          onGenerate={handleGenerate} onAITile={handleAITile} onAIProcedural={handleAIProcedural}
          onAIRecolor={handleAIRecolor}
          biomeId={editorTileset.biomeId} savedCount={tilesets.tilesets.length}
          editingTile={editingTile} overrideDraw={overrideDraw}
          overriddenTiles={overriddenTiles}
          onEditTile={handleEditTile} onApplyTileEdit={handleApplyTileEdit}
          onCancelTileEdit={handleCancelTileEdit} onResetTileOverride={handleResetTileOverride}
          animFrameCount={animFrameCount} setAnimFrameCount={setAnimFrameCount}
          canAnimate={!aiTextures} animFrames={editorAnimFrames}
          active={showTileset}
        />
      </div>

      {everAssets.current && (
        <div className={`view-pane ${showAssets ? '' : 'view-hidden'}`}>
          <Suspense fallback={<div className="level-empty">Loading…</div>}>
            <AssetsView tileSize={tileSize} gallery={assets} active={showAssets} />
          </Suspense>
        </div>
      )}

      {everLevel.current && (
        <div className={`view-pane ${showLevel ? '' : 'view-hidden'}`}>
          <Suspense fallback={<div className="level-empty">Loading…</div>}>
            <LevelsWorkspace
              levelMode={levelMode} setLevelMode={setLevelMode}
              level={level} tiles={displayTiles} tileSize={tileSize}
              cellPx={cellPx} setCellPx={setCellPx}
              showGrid={showLevelGrid} setShowGrid={setShowLevelGrid}
              onFit={handleFitLevel} levelCanvasAreaRef={levelCanvasAreaRef}
              levelTool={levelTool} setLevelTool={setLevelTool}
              terrainTool={terrainTool} setTerrainTool={setTerrainTool}
              terrainBrushSize={terrainBrushSize} setTerrainBrushSize={setTerrainBrushSize}
              manualSelectedTile={manualSelectedTile} setManualSelectedTile={setManualSelectedTile}
              layerTiles={layerTiles}
              assets={assets.assets} assetsById={assetsById}
              selectedAssetId={assets.selectedId} onSelectAsset={assets.select}
              propTransform={propTransform} setPropTransform={setPropTransform}
              onPlaceProp={handlePlaceProp} onRemovePropAt={handleRemovePropAt}
              selectedProp={selectedProp}
              onSelectPropAt={handleSelectPropAt} onMoveProp={handleMoveProp}
              onUpdateSelectedProp={handleUpdateSelectedProp}
              onMoveSelectedPropZ={handleMoveSelectedPropZ}
              onDeleteSelectedProp={handleDeleteSelectedProp}
              onTerrainStart={handleTerrainStart} onTerrainContinue={handleTerrainContinue}
              onTerrainFill={handleTerrainFill} onTerrainRect={handleTerrainRect} onTerrainPick={handleTerrainPick}
              onFillActiveLayer={handleFillActiveLayer} onClearActiveLayer={handleClearActiveLayer}
              onSurprise={handleSurprise}
              levels={levels.levels} onSaveLevel={handleSaveLevel} onLoadLevel={handleLoadLevel} onRemoveLevel={levels.remove}
              onExportLevel={handleExportLevel} onImportLevel={handleImportLevel}
              levelsLoading={levels.loading} levelsError={levels.error}
              onTileSizeChange={handleTileSizeChange} levelNotice={levelNotice}
              tileVariation={tileVariation} setTileVariation={setTileVariation}
              active={showLevel}
              smooth={layerTiles.some(lt => lt?.smooth)}
            />
          </Suspense>
        </div>
      )}

      {galleryDock}

      {regenerating && (
        <div className="regen-overlay">
          <div className="regen-card">Regenerating tileset at {tileSize}px…</div>
        </div>
      )}

      {projectModalOpen && (
        <ProjectModal initialName={projectName} initialSize={tileSize} onConfirm={handleProjectConfirm} />
      )}
    </div>
  )
}
