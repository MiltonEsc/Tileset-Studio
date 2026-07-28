import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Segmented } from '../ui/Segmented.jsx'
import { Section } from '../ui/Section.jsx'
import { Btn } from '../ui/Btn.jsx'
import { LevelCanvas } from './LevelCanvas.jsx'
import { computeIndexMap } from '../../core/autotile.js'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { exportLevelTiled, exportLevelGodot, exportLevelUnity } from '../../core/exportLevel.js'
import { FILL_INDEX, makeFillVariants, pickVariant } from '../../core/tileVariants.js'
import { GeneratePanel } from './GeneratePanel.jsx'
import { PixIcon } from '../ui/PixIcon.jsx'
import { ICONS } from '../ui/icons.js'

// The AI idea assistant pulls in the text-generation code; load it only when the
// (collapsed-by-default) "AI ideas" section is opened.
const LevelIdeaPanel = lazy(() => import('./LevelIdeaPanel.jsx').then(m => ({ default: m.LevelIdeaPanel })))

const SIZE_PRESETS = [
  { label: 'S', w: 24, h: 16 },
  { label: 'M', w: 32, h: 20 },
  { label: 'L', w: 48, h: 28 },
  { label: 'XL', w: 64, h: 40 },
]

const LEVEL_TOOL_OPTIONS = [
  { value: 'terrain', label: 'Terrain' },
  { value: 'props', label: 'Props' },
  { value: 'select', label: 'Select' },
]

const TERRAIN_TOOLS = [
  { id: 'brush', icon: 'brush', label: 'Brush' },
  { id: 'fill', icon: 'bucket', label: 'Fill' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'picker', icon: 'picker', label: 'Picker' },
  { id: 'rect', icon: 'rect', label: 'Rect' },
]

const BRUSH_SIZE_OPTIONS = [
  { value: 1, label: '1x1' },
  { value: 2, label: '3x3' },
  { value: 3, label: '5x5' },
]

const propCanvasCache = new WeakMap()

function getAssetCanvas(asset) {
  if (!asset) return null
  const cached = propCanvasCache.get(asset)
  if (cached) return cached
  const width = asset.cols * asset.tileSize
  const height = asset.rows * asset.tileSize
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const pixels = asset.pixels instanceof Uint8ClampedArray ? asset.pixels : new Uint8ClampedArray(asset.pixels)
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
  propCanvasCache.set(asset, canvas)
  return canvas
}

const PropMini = memo(function PropMini({ asset }) {
  const ref = useRef(null)
  const pxW = asset.cols * asset.tileSize
  const pxH = asset.rows * asset.tileSize

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const box = 52
    cv.width = box
    cv.height = box
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, box, box)
    const assetCanvas = getAssetCanvas(asset)
    if (!assetCanvas) return
    const s = Math.min(box / pxW, box / pxH)
    ctx.drawImage(assetCanvas, (box - pxW * s) / 2, (box - pxH * s) / 2, pxW * s, pxH * s)
  }, [asset, pxW, pxH])

  return <canvas ref={ref} />
})

function LayerRow({
  layer, layerTile, tileSize, isActive,
  canMoveUp, canMoveDown,
  onSelect, onToggleVisible, onMoveUp, onMoveDown, onRename, onRemove,
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(layer.name)
  const thumbRef = useRef(null)

  useEffect(() => { setName(layer.name) }, [layer.name])

  useEffect(() => {
    const cv = thumbRef.current
    if (!cv) return
    const box = 28
    cv.width = box
    cv.height = box
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, box, box)
    if (!layerTile?.tiles?.length) return
    const tilePx = layerTile.tileSize || tileSize
    const native = composeNativeSheet(layerTile.tiles, tilePx)
    const scale = Math.min(box / native.width, box / native.height)
    const dW = native.width * scale
    const dH = native.height * scale
    ctx.drawImage(native, (box - dW) / 2, (box - dH) / 2, dW, dH)
  }, [layerTile, tileSize])

  const commit = () => {
    const next = name.trim() || layer.name
    setEditing(false)
    if (next !== layer.name) onRename(next)
  }

  return (
    <div className={`sf-layer-row ${isActive ? 'active' : ''}`} onClick={onSelect}>
      <button className={`sf-layer-eye ${layer.visible ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); onToggleVisible() }} title={layer.visible ? 'Hide layer' : 'Show layer'}>
        <PixIcon grid={ICONS.eye} px={1.5} color={layer.visible ? 'var(--ink)' : 'var(--ink-faint)'} />
      </button>
      <div className="sf-layer-order">
        <button
          className="sf-layer-order-btn"
          onClick={(e) => { e.stopPropagation(); onMoveUp() }}
          disabled={!canMoveUp}
          title="Move layer up"
        >
          <PixIcon grid={ICONS.arrowUp} px={1} color="currentColor" />
        </button>
        <button
          className="sf-layer-order-btn"
          onClick={(e) => { e.stopPropagation(); onMoveDown() }}
          disabled={!canMoveDown}
          title="Move layer down"
        >
          <PixIcon grid={ICONS.arrowDown} px={1} color="currentColor" />
        </button>
      </div>
      <div className="sf-layer-main">
        {editing ? (
          <input
            className="text-input sf-layer-input"
            value={name}
            autoFocus
            onClick={e => e.stopPropagation()}
            onChange={e => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setEditing(false); setName(layer.name) }
            }}
          />
        ) : (
          <span className="sf-layer-name">{layer.name}</span>
        )}
        <div className="sf-layer-meta">
          <span className={`sf-layer-kind ${layer.kind === 'manual' ? 'manual' : 'auto'}`}>
            {layer.kind === 'manual' ? 'Manual' : 'Autotile'}
          </span>
          <canvas ref={thumbRef} className="sf-layer-thumb" />
        </div>
      </div>
      <button className="sf-layer-icon" onClick={(e) => { e.stopPropagation(); setEditing(true) }} title="Rename layer">
        <PixIcon grid={ICONS.picker} px={1.5} color="var(--ink-dim)" />
      </button>
      <button className="sf-layer-icon" onClick={(e) => { e.stopPropagation(); onRemove() }} title="Delete layer">
        x
      </button>
    </div>
  )
}

export function LevelsWorkspace({
  levelMode, level, tiles, tileSize,
  cellPx, setCellPx, showGrid, setShowGrid, onFit, levelCanvasAreaRef,
  levelTool, setLevelTool, assets, assetsById, selectedAssetId, onSelectAsset,
  terrainTool, setTerrainTool, terrainBrushSize, setTerrainBrushSize,
  manualSelectedTile, setManualSelectedTile,
  propTransform, setPropTransform,
  selectedProp = null, onSelectPropAt, onMoveProp,
  onUpdateSelectedProp, onMoveSelectedPropZ, onDeleteSelectedProp,
  layerTiles,
  onTerrainStart, onTerrainContinue, onTerrainFill, onTerrainRect, onTerrainPick,
  onFillActiveLayer, onClearActiveLayer,
  onPlaceProp, onRemovePropAt, onSurprise,
  levels, onSaveLevel, onLoadLevel, onRemoveLevel, levelsLoading = false, levelsError = '',
  onTileSizeChange, levelNotice = '',
  tileVariation = false, setTileVariation,
  active = true, smooth = false,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [saveName, setSaveName] = useState('')
  const paletteRef = useRef(null)
  const nativeSheetCache = useRef(new WeakMap())
  const indexMapCache = useRef(new WeakMap())

  const activeLayer = level.layers[level.activeLayerIdx] || null
  const activeLayerTile = layerTiles[level.activeLayerIdx] || null

  // Global level undo/redo (Ctrl+Z / Ctrl+Y) + Delete for the selected prop,
  // ignored while typing in a field. Only while the Levels view is active — the
  // workspace stays mounted (hidden) when in the editor, and a live listener
  // there would hijack Ctrl+Z / Delete from the tileset editor.
  useEffect(() => {
    if (!active) return
    const handleKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && levelTool === 'select' && selectedProp) {
        e.preventDefault()
        onDeleteSelectedProp?.()
        return
      }
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); level.undo() }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); level.redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, level.undo, level.redo, levelTool, selectedProp, onDeleteSelectedProp])

  const getCachedNativeSheet = useCallback((layerTile) => {
    if (!layerTile?.tiles?.length) return null
    const sheetTileSize = layerTile.tileSize || tileSize
    const cached = nativeSheetCache.current.get(layerTile)
    if (cached?.tileSize === sheetTileSize) return cached.sheet
    const sheet = composeNativeSheet(layerTile.tiles, sheetTileSize)
    nativeSheetCache.current.set(layerTile, { tileSize: sheetTileSize, sheet })
    return sheet
  }, [tileSize])

  const getCachedIndexMap = useCallback((grid, width, height, seamlessEdges) => {
    if (!grid) return null
    const seamless = seamlessEdges ? 1 : 0
    const cacheKey = `${width}:${height}:${seamless}`
    let gridCache = indexMapCache.current.get(grid)
    if (!gridCache) {
      gridCache = new Map()
      indexMapCache.current.set(grid, gridCache)
    }
    if (gridCache.has(cacheKey)) return gridCache.get(cacheKey)
    const map = computeIndexMap(grid, width, height, seamless)
    gridCache.set(cacheKey, map)
    return map
  }, [])

  const activeNative = useMemo(
    () => getCachedNativeSheet(activeLayerTile),
    [activeLayerTile, getCachedNativeSheet]
  )

  const gridStyle = useMemo(() => ({
    // Two columns: control panel + canvas. When the sidebar is hidden the panel
    // is `display:none` (see leftPanelStyle), which REMOVES it from the grid — so
    // we must collapse to a SINGLE column, otherwise the canvas auto-places into
    // the leftover 0-width first column and the map disappears.
    gridTemplateColumns: sidebarOpen ? '318px minmax(0,1fr)' : 'minmax(0,1fr)',
  }), [sidebarOpen])

  const leftPanelStyle = useMemo(() => ({
    display: sidebarOpen ? 'flex' : 'none',
  }), [sidebarOpen])

  const exportLevelPNG = useCallback(() => {
    const out = document.createElement('canvas')
    out.width = level.width * tileSize
    out.height = level.height * tileSize
    const ctx = out.getContext('2d')
    ctx.imageSmoothingEnabled = false

    for (let li = 0; li < level.layers.length; li++) {
      const layer = level.layers[li]
      const layerTile = layerTiles[li]
      if (!layer?.visible || !layerTile?.tiles) continue
      const ltSize = layerTile.tileSize || tileSize
      const sheet = getCachedNativeSheet(layerTile)
      const exportIndexMap = getCachedIndexMap(layer.grid, level.width, level.height, level.seamlessEdges)
      if (!sheet) continue
      // Fill-tile variants for this layer (anti-repetition), baked into the PNG.
      const variantCanvases = (tileVariation ? makeFillVariants(layerTile.tiles[FILL_INDEX], ltSize) : []).map(v => {
        const c = document.createElement('canvas')
        c.width = ltSize; c.height = ltSize
        c.getContext('2d').putImageData(v, 0, 0)
        return c
      })
      for (let y = 0; y < level.height; y++) {
        for (let x = 0; x < level.width; x++) {
          const cell = y * level.width + x
          const manualIdx = layer.manualTiles[cell]
          const idx = layer.kind === 'manual'
            ? manualIdx
            : (manualIdx >= 0 ? manualIdx : (exportIndexMap?.[cell] ?? 0))
          const isEmpty = layer.kind === 'manual' ? idx < 0 : !idx
          if (isEmpty) continue
          if (variantCanvases.length && idx === FILL_INDEX) {
            const pick = pickVariant(x, y, 1 + variantCanvases.length)
            if (pick > 0) {
              ctx.drawImage(variantCanvases[pick - 1], 0, 0, ltSize, ltSize, x * tileSize, y * tileSize, tileSize, tileSize)
              continue
            }
          }
          const sx = (idx % 8) * ltSize
          const sy = Math.floor(idx / 8) * ltSize
          ctx.drawImage(sheet, sx, sy, ltSize, ltSize, x * tileSize, y * tileSize, tileSize, tileSize)
        }
      }
    }

    for (const p of level.placedProps) {
      const asset = assetsById[p.assetId]
      const assetCanvas = getAssetCanvas(asset)
      if (!assetCanvas) continue
      // Mirror LevelCanvas's applyPropTransform: flip/rotate around the
      // footprint centre so the baked PNG matches the live view.
      const w = asset.cols * tileSize
      const h = asset.rows * tileSize
      ctx.save()
      ctx.translate(p.x * tileSize + w / 2, p.y * tileSize + h / 2)
      ctx.rotate(((p.rotation || 0) * Math.PI) / 180)
      ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1)
      ctx.drawImage(assetCanvas, -w / 2, -h / 2, w, h)
      ctx.restore()
    }

    const link = document.createElement('a')
    link.href = out.toDataURL('image/png')
    link.download = `level_${level.width}x${level.height}.png`
    link.click()
  }, [assetsById, getCachedIndexMap, getCachedNativeSheet, level, layerTiles, tileSize, tileVariation])

  // Context passed to the engine-format exporters (Tiled / Godot / Unity).
  const exportCtx = useMemo(
    () => ({ level, layerTiles, tileSize, assetsById, tileVariation }),
    [level, layerTiles, tileSize, assetsById, tileVariation]
  )

  useEffect(() => {
    if (levelMode !== 'manual') return
    const cv = paletteRef.current
    if (!cv || !activeNative) return
    const pc = 28
    cv.width = 8 * pc
    cv.height = 6 * pc
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(activeNative, 0, 0, activeNative.width, activeNative.height, 0, 0, cv.width, cv.height)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    for (let x = 0; x <= 8; x++) { ctx.beginPath(); ctx.moveTo(x * pc + 0.5, 0); ctx.lineTo(x * pc + 0.5, cv.height); ctx.stroke() }
    for (let y = 0; y <= 6; y++) { ctx.beginPath(); ctx.moveTo(0, y * pc + 0.5); ctx.lineTo(cv.width, y * pc + 0.5); ctx.stroke() }
    const sx = (manualSelectedTile % 8) * pc
    const sy = Math.floor(manualSelectedTile / 8) * pc
    ctx.strokeStyle = '#2fd6a6'
    ctx.lineWidth = 3
    ctx.strokeRect(sx + 1.5, sy + 1.5, pc - 3, pc - 3)
  }, [levelMode, activeNative, manualSelectedTile])

  const pickFromPalette = useCallback((e) => {
    const cv = paletteRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const pc = r.width / 8
    const cx = Math.floor((e.clientX - r.left) / pc)
    const cy = Math.floor((e.clientY - r.top) / pc)
    if (cx >= 0 && cy >= 0 && cx < 8 && cy < 6) setManualSelectedTile(cy * 8 + cx)
  }, [setManualSelectedTile])

  return (
    <div className="editor-grid" style={gridStyle}>
      <aside className="panel" style={leftPanelStyle}>
        <div className="panel-scroll">
          <div className="sf-row" style={{ display: 'flex', gap: 6, padding: '12px 18px 0' }}>
            <Btn size="sm" variant="outline" icon="undo" full onClick={level.undo} disabled={!level.canUndo}>Undo</Btn>
            <Btn size="sm" variant="outline" icon="redo" full onClick={level.redo} disabled={!level.canRedo}>Redo</Btn>
          </div>
          <p className="hint" style={{ padding: '4px 18px 0', margin: 0 }}>
            Shortcuts: Ctrl+Z undo · Ctrl+Y redo · right-click erases / removes a prop · Del removes the selected prop.
          </p>

          <Section title="Layers" icon="layers">
            <div className="sf-layer-board">
              <div className="sf-layer-list">
                {level.layers.map((layer, idx) => (
                  <LayerRow
                    key={layer.id}
                    layer={layer}
                    layerTile={layerTiles[idx]}
                    tileSize={tileSize}
                    isActive={idx === level.activeLayerIdx}
                    canMoveUp={idx < level.layers.length - 1}
                    canMoveDown={idx > 0}
                    onSelect={() => level.setActiveLayerIdx(idx)}
                    onToggleVisible={() => level.setLayerProp(idx, { visible: !layer.visible })}
                    onMoveUp={() => level.moveLayer(idx, 1)}
                    onMoveDown={() => level.moveLayer(idx, -1)}
                    onRename={(name) => level.setLayerName(idx, name)}
                    onRemove={() => level.removeLayer(idx)}
                  />
                )).reverse()}
              </div>
              <div className="sf-layer-actions">
                <button className="sf-layer-add" onClick={() => level.addLayer(activeLayer?.tileset || null, 'manual')}>
                  <span>+</span> Manual Layer
                </button>
                <button className="sf-layer-add" onClick={() => level.addLayer(activeLayer?.tileset || null, 'autotile')}>
                  <span>+</span> Autotile Layer
                </button>
              </div>
            </div>
            <p className="hint">Click a layer to paint on it. Manual layers use tile painting; autotile layers use terrain masks.</p>
          </Section>

          <Section title="Tools" icon="brush">
            <Segmented full size="sm" value={levelTool} onChange={setLevelTool} options={LEVEL_TOOL_OPTIONS} />
            <p className="hint">
              {levelTool === 'terrain'
                ? (levelMode === 'manual'
                  ? 'Left-click paints, right-click erases. Tile palette in Terrain options.'
                  : 'Left-click paints solid, right-click erases. Borders autotile.')
                : levelTool === 'props'
                  ? 'Pick a prop, click to place, right-click to remove.'
                  : 'Click a placed prop to select it. Drag to move, Delete to remove.'}
            </p>
          </Section>

          <Section
            title={levelTool === 'terrain' ? 'Terrain options' : levelTool === 'props' ? 'Props' : 'Selection'}
            icon={levelTool === 'props' ? 'image' : levelTool === 'select' ? 'layers' : 'brush'}
          >
            {levelTool === 'terrain' && (
              <>
                <div className="tool-grid">
                  {TERRAIN_TOOLS.map(tl => (
                    <button key={tl.id} className={`tool-btn ${terrainTool === tl.id ? 'on' : ''}`}
                      onClick={() => setTerrainTool(tl.id)} title={tl.label}>
                      <PixIcon grid={ICONS[tl.icon]} px={2.5} color={terrainTool === tl.id ? 'var(--accent-ink)' : 'var(--ink-dim)'} />
                      <span>{tl.label}</span>
                    </button>
                  ))}
                </div>
                <label className="field-label">Brush size</label>
                <Segmented full size="sm" value={terrainBrushSize} onChange={setTerrainBrushSize} options={BRUSH_SIZE_OPTIONS} />
              </>
            )}

            {levelTool === 'terrain' && levelMode === 'manual' && (
              <>
                <label className="field-label" style={{ marginTop: 10 }}>Tiles</label>
                <div className="palette-wrap">
                  <canvas ref={paletteRef} className="palette-canvas" onClick={pickFromPalette} />
                </div>
                <p className="hint">Active layer: {activeLayer?.name || 'None'} · tile #{manualSelectedTile}.</p>
              </>
            )}

            {levelTool === 'props' && (
              <div className="prop-picker" style={{ marginTop: 10 }}>
                {assets.length === 0 ? (
                  <p className="hint">No props yet. Create them in the Assets view.</p>
                ) : (
                  <div className="prop-grid">
                    {assets.map(a => (
                      <button key={a.id} className={`prop-card checker-bg ${selectedAssetId === a.id ? 'selected' : ''}`}
                        onClick={() => onSelectAsset(a.id)} title={`${a.name} · ${a.cols}x${a.rows}`}>
                        <PropMini asset={a} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="sidebar-inline-label" style={{ marginTop: 8 }}>
                  <span className="brush-label">Transform</span>
                  <span className="tool-meta">{propTransform.rotation}°{propTransform.flipX ? ' H' : ''}{propTransform.flipY ? ' V' : ''}</span>
                </div>
                <div className="gen-mini-row">
                  <button className={`gen-mini-btn ${propTransform.flipX ? 'on' : ''}`} title="Flip horizontal"
                    onClick={() => setPropTransform(t => ({ ...t, flipX: !t.flipX }))}>Flip H</button>
                  <button className={`gen-mini-btn ${propTransform.flipY ? 'on' : ''}`} title="Flip vertical"
                    onClick={() => setPropTransform(t => ({ ...t, flipY: !t.flipY }))}>Flip V</button>
                  <button className="gen-mini-btn" title="Rotate 90 degrees"
                    onClick={() => setPropTransform(t => ({ ...t, rotation: (t.rotation + 90) % 360 }))}>Rotate</button>
                  <button className="gen-mini-btn" title="Reset transform"
                    onClick={() => setPropTransform({ flipX: false, flipY: false, rotation: 0 })}>Reset</button>
                </div>
                <Btn size="sm" variant="outline" icon="trash" full style={{ marginTop: 8 }}
                  onClick={level.clearProps} disabled={!level.placedProps.length}>
                  Clear props ({level.placedProps.length})
                </Btn>
              </div>
            )}

            {levelTool === 'select' && (
              selectedProp ? (
                <div style={{ marginTop: 10 }}>
                  <div className="sidebar-inline-label">
                    <span className="brush-label">
                      {assetsById[selectedProp.assetId]?.name || 'Prop'} · ({selectedProp.x}, {selectedProp.y})
                    </span>
                    <span className="tool-meta">
                      {selectedProp.rotation || 0}°{selectedProp.flipX ? ' H' : ''}{selectedProp.flipY ? ' V' : ''}
                    </span>
                  </div>
                  <div className="gen-mini-row">
                    <button className={`gen-mini-btn ${selectedProp.flipX ? 'on' : ''}`} title="Flip horizontal"
                      onClick={() => onUpdateSelectedProp?.({ flipX: !selectedProp.flipX })}>Flip H</button>
                    <button className={`gen-mini-btn ${selectedProp.flipY ? 'on' : ''}`} title="Flip vertical"
                      onClick={() => onUpdateSelectedProp?.({ flipY: !selectedProp.flipY })}>Flip V</button>
                    <button className="gen-mini-btn" title="Rotate 90 degrees"
                      onClick={() => onUpdateSelectedProp?.({ rotation: ((selectedProp.rotation || 0) + 90) % 360 })}>Rotate</button>
                    <button className="gen-mini-btn" title="Reset transform"
                      onClick={() => onUpdateSelectedProp?.({ flipX: false, flipY: false, rotation: 0 })}>Reset</button>
                  </div>
                  <div className="gen-mini-row">
                    <button className="gen-mini-btn" title="Draw above other props"
                      onClick={() => onMoveSelectedPropZ?.(1)}>Forward</button>
                    <button className="gen-mini-btn" title="Draw below other props"
                      onClick={() => onMoveSelectedPropZ?.(-1)}>Backward</button>
                  </div>
                  <Btn size="sm" variant="danger" icon="trash" full style={{ marginTop: 8 }}
                    onClick={onDeleteSelectedProp}>
                    Delete prop (Del)
                  </Btn>
                </div>
              ) : (
                <p className="hint" style={{ marginTop: 10 }}>
                  {level.placedProps.length
                    ? 'No prop selected.'
                    : 'No props placed yet. Use the Props tool first.'}
                </p>
              )
            )}
          </Section>

          <Section title="Tileset" icon="image">
            <div className="sidebar-inline-label">
              <span className="brush-label">Tile size (paint px)</span>
            </div>
            <Segmented full size="sm" value={tileSize} onChange={onTileSizeChange}
              options={[{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }, { value: 64, label: '64' }]} />
            <p className="hint" style={{ marginTop: 8 }}>
              {activeLayer?.tileset
                ? `Current tileset: ${activeLayer.tileset.name || 'custom'} · ${activeLayer.tileset.tileSize || tileSize}px`
                : `Using the current editor tileset · ${tileSize}px`}
            </p>
            <p className="hint">Pick a biome or saved tileset below. Saved tilesets must match the level tile size ({tileSize}px).</p>
          </Section>

          <Section title="Map size" icon="grid">
            <div className="size-selector-row">
              {SIZE_PRESETS.map(p => (
                <button key={p.label}
                  className={`size-cell-btn ${level.width === p.w && level.height === p.h ? 'active' : ''}`}
                  style={{ width: 'auto', padding: '0 10px', height: 28 }}
                  onClick={() => level.resize(p.w, p.h)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="export-info"><span>Grid</span><b>{level.width} x {level.height}</b></div>
            <div className="row-btns">
              <Btn size="sm" variant="outline" icon="fit" full onClick={onFit}>Fit</Btn>
            </div>
          </Section>

          {levelMode === 'autotile' ? (
            <>
              <Section title="Generate" icon="spark">
                <GeneratePanel level={level} onSurprise={onSurprise} />
              </Section>
              <Section title="AI ideas" icon="spark" defaultOpen={false}>
                <Suspense fallback={<div className="ai-hint">Loading AI…</div>}>
                  <LevelIdeaPanel level={level} />
                </Suspense>
              </Section>
            </>
          ) : (
            <Section title="Manual actions" icon="layers">
              <div className="row-btns">
                <Btn size="sm" variant="outline" icon="grid" full onClick={onFillActiveLayer}>Fill</Btn>
                <Btn size="sm" variant="danger" icon="trash" full onClick={onClearActiveLayer}>Clear</Btn>
              </div>
            </Section>
          )}

          <Section title="Options" icon="layers" defaultOpen={false}>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Show grid</span>
              <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            </label>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Seamless edges</span>
              <input type="checkbox" checked={level.seamlessEdges} onChange={e => level.setSeamlessEdges(e.target.checked)} />
            </label>
            <p className="hint">Treats the map border as solid, so terrain touching the edge tiles cleanly instead of drawing an outer border.</p>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Tile variation</span>
              <input type="checkbox" checked={tileVariation} onChange={e => setTileVariation(e.target.checked)} />
            </label>
            <p className="hint">Breaks the repeating look by swapping the fill tile for mirrored variants per cell. Applies to the live view and to exports.</p>
          </Section>

          <Section title="Save / load level" icon="download" defaultOpen={false}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="text-input" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Level name" />
              <Btn variant="primary" size="sm" icon="save" onClick={() => { onSaveLevel(saveName.trim() || 'Level'); setSaveName('') }}>Save</Btn>
            </div>
            {levelsError ? (
              <p className="hint lib-error">Cloud storage error: {levelsError}</p>
            ) : levelsLoading ? (
              <p className="hint">Loading saved levels…</p>
            ) : levels.length === 0 ? (
              <p className="hint">No saved levels yet.</p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {levels.map(row => (
                  <div key={row.id} className="layer-row" onClick={() => onLoadLevel(row)}>
                    <span className="layer-name">{row.name}</span>
                    <span className="tool-meta">{row.width}x{row.height}</span>
                    <button className="lib-card-del" onClick={e => { e.stopPropagation(); onRemoveLevel(row.id) }}>x</button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Export" icon="download">
            <div className="export-info"><span>Output</span><b>{level.width * tileSize} x {level.height * tileSize}px</b></div>
            <Btn variant="primary" icon="download" full style={{ marginTop: 10 }} onClick={exportLevelPNG}>Export level PNG</Btn>
            <div className="sidebar-inline-label" style={{ marginTop: 10 }}>
              <span className="brush-label">For game engines</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Btn size="sm" variant="outline" icon="download" full onClick={() => exportLevelTiled(exportCtx)}>Tiled (.tmj)</Btn>
              <Btn size="sm" variant="outline" icon="download" full onClick={() => exportLevelGodot(exportCtx)}>Godot (.json + .gd)</Btn>
              <Btn size="sm" variant="outline" icon="download" full onClick={() => exportLevelUnity(exportCtx)}>Unity (.json + .cs)</Btn>
            </div>
            <p className="hint">Engine exports download the map file, an importer script, and the tileset PNG(s) — keep them together. Prop placement is included; prop images are not.</p>
          </Section>
        </div>
      </aside>

      <section className="level-canvas-area" ref={levelCanvasAreaRef}>
        <div className="level-status-bar">
          <span className="level-status-pill">Mode {levelMode}</span>
          <span className="level-status-pill">Map {level.width}x{level.height}</span>
          <span className="level-status-pill">Tile {tileSize}px</span>
          <span className="level-status-pill">Zoom {cellPx}px</span>
          <span className="level-status-pill">Layer {activeLayer?.name || 'None'}</span>
          <span className="level-status-pill">Props {level.placedProps.length}</span>
          {levelNotice && <span className="level-status-pill level-status-notice">{levelNotice}</span>}
        </div>
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Hide panel' : 'Show panel'}>
          {sidebarOpen ? '<' : '>'}
        </button>
        {tiles ? (
          <LevelCanvas
            layers={level.layers}
            layerTiles={layerTiles}
            width={level.width}
            height={level.height}
            tileSize={tileSize}
            cellPx={cellPx}
            setCellPx={setCellPx}
            seamlessEdges={level.seamlessEdges}
            showGrid={showGrid}
            onStartPaint={onTerrainStart}
            onContinuePaint={onTerrainContinue}
            onEndPaint={level.endStroke}
            terrainTool={terrainTool}
            terrainBrushSize={terrainBrushSize}
            onFillTerrain={onTerrainFill}
            onRectTerrain={onTerrainRect}
            onPickTerrain={onTerrainPick}
            levelTool={levelTool}
            placedProps={level.placedProps}
            assetsById={assetsById}
            selectedAssetId={selectedAssetId}
            propTransform={propTransform}
            tileVariation={tileVariation}
            onPlaceProp={onPlaceProp}
            onRemovePropAt={onRemovePropAt}
            selectedProp={selectedProp}
            onSelectPropAt={onSelectPropAt}
            onMoveProp={onMoveProp}
            active={active}
            smooth={smooth}
          />
        ) : (
          <div className="level-empty">Generate a tileset first in the Editor view.</div>
        )}
      </section>
    </div>
  )
}
