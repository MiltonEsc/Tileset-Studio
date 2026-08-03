import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Segmented } from '../ui/Segmented.jsx'
import { Section } from '../ui/Section.jsx'
import { Btn } from '../ui/Btn.jsx'
import { LevelCanvas } from './LevelCanvas.jsx'
import { autotileModeForDefinition, computeIndexMap } from '../../core/autotile.js'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { exportLevelTiled, exportLevelGodot, exportLevelUnity } from '../../core/exportLevel.js'
import { FILL_INDEX, makeFillVariants, pickVariant } from '../../core/tileVariants.js'
import { GeneratePanel } from './GeneratePanel.jsx'
import { Icon } from '../ui/Icon.jsx'
import { useI18n } from '../../i18n.jsx'
import { pointInRegion, transformRegionPayload } from '../../core/levelSelection.js'

// The AI idea assistant pulls in the text-generation code; load it only when the
// (collapsed-by-default) "AI ideas" section is opened.
const LevelIdeaPanel = lazy(() => import('./LevelIdeaPanel.jsx').then(m => ({ default: m.LevelIdeaPanel })))

const SIZE_PRESETS = [
  { label: 'S', w: 24, h: 16 },
  { label: 'M', w: 32, h: 20 },
  { label: 'L', w: 48, h: 28 },
  { label: 'XL', w: 64, h: 40 },
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
  const expected = width * height * 4; const data = pixels.length === expected ? pixels : new Uint8ClampedArray(expected); data.set(pixels.subarray(0, Math.min(pixels.length, expected))); ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
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
  onToggleLock, onDuplicate, onSolo, onDragStart, onDrop,
}) {
  const { t } = useI18n()
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
    <div className={`sf-layer-row ${isActive ? 'active' : ''} ${layer.locked ? 'locked' : ''} ${layer.collision ? 'collision' : ''}`}
      draggable onDragStart={onDragStart} onDragOver={e => e.preventDefault()} onDrop={onDrop} onClick={onSelect}>
      <span className="sf-layer-drag" title="Drag to reorder">⠿</span>
      <button className={`sf-layer-eye ${layer.visible ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); onToggleVisible() }} title={layer.visible ? t('hideLayer') : t('showLayer')}>
        <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={16} />
      </button>
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
          <span className={`sf-layer-kind ${layer.collision ? 'collision' : layer.kind === 'manual' ? 'manual' : 'auto'}`}>
            {layer.collision ? t('collision') : layer.kind === 'manual' ? t('manual') : t('autotile')}
          </span>
          {layer.group && <span className="sf-layer-group">{layer.group}</span>}
          <canvas ref={thumbRef} className="sf-layer-thumb" />
        </div>
        <span className="sf-layer-tileset" title={layer.tileset?.name || 'No tileset'}>{layer.tileset?.name || 'No tileset assigned'}</span>
      </div>
      <button className={`sf-layer-icon ${layer.locked ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleLock() }} title={layer.locked ? t('unlockLayer') : t('lockLayer')}><Icon name={layer.locked ? 'lock' : 'unlock'} size={15} /></button>
      <button className="sf-layer-icon" onClick={(e) => { e.stopPropagation(); onSolo() }} title={t('soloLayer')}><Icon name="eye" size={15} /></button>
      <button className="sf-layer-icon" onClick={(e) => { e.stopPropagation(); setEditing(true) }} title={t('renameLayer')}>
        <Icon name="picker" size={15} />
      </button>
      <button className="sf-layer-icon destructive" onClick={(e) => { e.stopPropagation(); onRemove() }} title={t('delete')}>
        <Icon name="trash" size={15} />
      </button>
    </div>
  )
}

function SafetyConfirm({ request, onCancel, onAccept }) {
  const [snapshotFirst, setSnapshotFirst] = useState(true)
  if (!request) return null
  return (
    <div className="safety-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="safety-modal" role="alertdialog" aria-modal="true" aria-labelledby="safety-title" onMouseDown={e => e.stopPropagation()}>
        <div className="safety-modal-kicker">Potentially destructive action</div>
        <h3 id="safety-title">{request.title}</h3>
        <p>{request.message}</p>
        <label className="safety-snapshot-option">
          <input type="checkbox" checked={snapshotFirst} onChange={e => setSnapshotFirst(e.target.checked)} />
          Create a local recovery snapshot first
        </label>
        <div className="safety-modal-actions">
          <Btn size="sm" variant="outline" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" variant="danger" icon="trash" onClick={() => onAccept(snapshotFirst)}>{request.confirmLabel || 'Continue'}</Btn>
        </div>
      </div>
    </div>
  )
}

function LevelMinimap({ layers, placedProps, width, height, cellPx, containerRef, bookmarks }) {
  const canvasRef = useRef(null)
  const baseRef = useRef(null)
  const dragging = useRef(false)
  const miniWidth = 190
  const miniHeight = Math.max(62, Math.min(132, Math.round(miniWidth * height / Math.max(1, width))))

  const drawViewport = useCallback(() => {
    const canvas = canvasRef.current
    const base = baseRef.current
    const container = containerRef.current
    const wrapper = container?.querySelector('.level-canvas-wrapper')
    if (!canvas || !base || !container || !wrapper) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, miniWidth, miniHeight)
    ctx.drawImage(base, 0, 0)
    const worldX = Math.max(0, (container.scrollLeft - wrapper.offsetLeft) / cellPx)
    const worldY = Math.max(0, (container.scrollTop - wrapper.offsetTop) / cellPx)
    const worldW = Math.min(width, container.clientWidth / cellPx)
    const worldH = Math.min(height, container.clientHeight / cellPx)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.fillStyle = 'rgba(255,255,255,.08)'
    const x = worldX / width * miniWidth
    const y = worldY / height * miniHeight
    const w = Math.max(3, worldW / width * miniWidth)
    const h = Math.max(3, worldH / height * miniHeight)
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x + .75, y + .75, Math.max(1, w - 1.5), Math.max(1, h - 1.5))
  }, [containerRef, cellPx, width, height, miniHeight])

  useEffect(() => {
    const base = document.createElement('canvas')
    base.width = miniWidth; base.height = miniHeight
    const ctx = base.getContext('2d')
    ctx.fillStyle = '#080d13'; ctx.fillRect(0, 0, miniWidth, miniHeight)
    const colors = ['#2fd6a6', '#6ea8fe', '#e8b84a', '#c084fc', '#fb7185']
    layers.forEach((layer, layerIndex) => {
      if (layer.visible === false) return
      ctx.fillStyle = colors[layerIndex % colors.length]
      ctx.globalAlpha = .68
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (layer.grid?.[i] || layer.manualTiles?.[i] >= 0) {
          ctx.fillRect(x / width * miniWidth, y / height * miniHeight,
            Math.max(1, miniWidth / width), Math.max(1, miniHeight / height))
        }
      }
    })
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    placedProps.forEach(prop => ctx.fillRect(prop.x / width * miniWidth - 1, prop.y / height * miniHeight - 1, 3, 3))
    bookmarks.forEach((bookmark, index) => {
      ctx.fillStyle = '#ffcf4a'
      ctx.beginPath(); ctx.arc(bookmark.x / width * miniWidth, bookmark.y / height * miniHeight, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#111'; ctx.font = '700 5px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(index + 1), bookmark.x / width * miniWidth, bookmark.y / height * miniHeight)
    })
    baseRef.current = base
    const canvas = canvasRef.current
    if (canvas) { canvas.width = miniWidth; canvas.height = miniHeight }
    drawViewport()
  }, [layers, placedProps, width, height, bookmarks, miniHeight, drawViewport])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const resize = new ResizeObserver(drawViewport)
    resize.observe(container)
    container.addEventListener('scroll', drawViewport, { passive: true })
    drawViewport()
    return () => { resize.disconnect(); container.removeEventListener('scroll', drawViewport) }
  }, [containerRef, drawViewport])

  const navigate = useCallback((event) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const wrapper = container?.querySelector('.level-canvas-wrapper')
    if (!canvas || !container || !wrapper) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width))
    const y = Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height))
    container.scrollLeft = wrapper.offsetLeft + x * cellPx - container.clientWidth / 2
    container.scrollTop = wrapper.offsetTop + y * cellPx - container.clientHeight / 2
  }, [containerRef, width, height, cellPx])

  return (
    <div className="level-minimap" title="Click or drag to navigate">
      <canvas ref={canvasRef}
        onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); navigate(event) }}
        onPointerMove={event => { if (dragging.current) navigate(event) }}
        onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }} />
    </div>
  )
}

export function LevelsWorkspace({
  levelMode, level, tiles, tileSize,
  cellPx, setCellPx, showGrid, setShowGrid, onFit, levelCanvasAreaRef,
  levelTool, setLevelTool, assets, assetsById, selectedAssetId,
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
  onExportLevel, onImportLevel,
  onTileSizeChange, levelNotice = '',
  tileVariation = false, setTileVariation,
  active = true, smooth = false,
  fallbackTileset = null, onNotice,
  pendingStamp = null, onStampConsumed, onSaveStamp,
  levelIdentity = null,
  activeLevelId = null, projectName = 'Untitled', isDirty = false, lastSavedAt = null,
  recoveryDraft = null, onRestoreRecovery, onDiscardRecovery,
  snapshots = [], onCreateSnapshot, onRestoreSnapshot, onRemoveSnapshot,
}) {
  const { t } = useI18n()
  const levelToolOptions = [
    { value: 'terrain', label: t('terrain') },
    { value: 'props', label: t('props') },
    { value: 'select', label: t('select') },
  ]
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [playtestMode, setPlaytestMode] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [selectMode, setSelectMode] = useState('object')
  const [areaRect, setAreaRect] = useState(null)
  const [areaLayerIds, setAreaLayerIds] = useState([])
  const [includeAreaProps, setIncludeAreaProps] = useState(true)
  const [areaClipboard, setAreaClipboard] = useState(null)
  const [placement, setPlacement] = useState(null)
  const [lastAreaCell, setLastAreaCell] = useState(null)
  const [stampName, setStampName] = useState('')
  const [safetyRequest, setSafetyRequest] = useState(null)
  const [pasteMode, setPasteMode] = useState(() => {
    try { return sessionStorage.getItem('ts.areaPasteMode') || 'overlay' } catch { return 'overlay' }
  })
  const paletteRef = useRef(null)
  const nativeSheetCache = useRef(new WeakMap())
  const indexMapCache = useRef(new WeakMap())
  const localLevelIdentity = useRef(globalThis.crypto?.randomUUID?.() || `level-session-${Date.now()}`)
  const currentLevelIdentity = levelIdentity || localLevelIdentity.current
  const [cursorCell, setCursorCell] = useState({ x: 0, y: 0 })
  const [bookmarks, setBookmarks] = useState([])
  const isolationBackup = useRef(null)
  const draggedLayerIdx = useRef(null)
  const bookmarkKey = `ts.levelBookmarks.v1.${currentLevelIdentity}`

  const activeLayer = level.layers[level.activeLayerIdx] || null
  const activeLayerTile = layerTiles[level.activeLayerIdx] || null
  const validAssetIds = useMemo(() => new Set(assets.map(a => a.id)), [assets])
  const effectiveTilesets = useMemo(() => Object.fromEntries(level.layers.map(layer => [
    layer.id, layer.tileset || fallbackTileset,
  ])), [level.layers, fallbackTileset])
  const maxMapCells = Math.floor(16384 / Math.max(1, tileSize))

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(bookmarkKey))
      setBookmarks(Array.isArray(stored) ? stored : [])
    } catch { setBookmarks([]) }
    isolationBackup.current = null
  }, [bookmarkKey])

  const updateBookmarks = useCallback((update) => {
    setBookmarks(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      try { localStorage.setItem(bookmarkKey, JSON.stringify(next)) } catch { /* optional */ }
      return next
    })
  }, [bookmarkKey])

  const navigateToCell = useCallback((x, y) => {
    const container = levelCanvasAreaRef.current
    const wrapper = container?.querySelector('.level-canvas-wrapper')
    if (!container || !wrapper) return
    container.scrollLeft = wrapper.offsetLeft + (x + .5) * cellPx - container.clientWidth / 2
    container.scrollTop = wrapper.offsetTop + (y + .5) * cellPx - container.clientHeight / 2
  }, [levelCanvasAreaRef, cellPx])

  const addBookmark = useCallback(() => {
    updateBookmarks(prev => [...prev, {
      id: globalThis.crypto?.randomUUID?.() || `bookmark-${Date.now()}`,
      name: `Marker ${prev.length + 1}`,
      x: Math.max(0, Math.min(level.width - 1, cursorCell.x)),
      y: Math.max(0, Math.min(level.height - 1, cursorCell.y)),
    }].slice(-9))
  }, [updateBookmarks, cursorCell, level.width, level.height])

  const zoomToSelection = useCallback(() => {
    if (!areaRect) return
    const container = levelCanvasAreaRef.current
    if (!container) return
    const target = Math.max(4, Math.min(512, Math.floor(Math.min(
      (container.clientWidth - 96) / areaRect.width,
      (container.clientHeight - 96) / areaRect.height,
    ))))
    setCellPx(target)
    requestAnimationFrame(() => {
      const wrapper = container.querySelector('.level-canvas-wrapper')
      if (!wrapper) return
      container.scrollLeft = wrapper.offsetLeft + (areaRect.x + areaRect.width / 2) * target - container.clientWidth / 2
      container.scrollTop = wrapper.offsetTop + (areaRect.y + areaRect.height / 2) * target - container.clientHeight / 2
    })
  }, [areaRect, levelCanvasAreaRef, setCellPx])

  const toggleIsolateActiveLayer = useCallback(() => {
    if (isolationBackup.current) {
      level.setLayerVisibility(isolationBackup.current, false)
      isolationBackup.current = null
      return
    }
    isolationBackup.current = level.layers.map(layer => layer.visible !== false)
    level.setLayerVisibility(level.layers.map((_, idx) => idx === level.activeLayerIdx), false)
  }, [level])

  const toggleSoloLayer = useCallback((idx) => {
    if (isolationBackup.current) {
      level.setLayerVisibility(isolationBackup.current, false)
      isolationBackup.current = null
      return
    }
    isolationBackup.current = level.layers.map(layer => layer.visible !== false)
    level.setActiveLayerIdx(idx)
    level.setLayerVisibility(level.layers.map((_, layerIdx) => layerIdx === idx), false)
  }, [level])

  const askSafety = useCallback((request, action) => {
    setSafetyRequest({ ...request, id: Date.now(), action })
  }, [])

  const acceptSafety = useCallback((snapshotFirst) => {
    const request = safetyRequest
    setSafetyRequest(null)
    if (!request) return
    if (snapshotFirst) onCreateSnapshot?.(`Before: ${request.title}`, request.snapshotPayload || null)
    request.action?.()
  }, [safetyRequest, onCreateSnapshot])

  const saveCurrentLevel = useCallback(() => {
    if (activeLevelId) {
      if (!isDirty) return
      askSafety({
        title: `Overwrite “${projectName}”`,
        message: 'Save the current changes over the active cloud level?',
        confirmLabel: 'Overwrite',
        snapshotPayload: levels.find(row => row.id === activeLevelId) || null,
      }, () => onSaveLevel(saveName.trim() || projectName, 'overwrite'))
      return
    }
    onSaveLevel(saveName.trim() || projectName || 'Level', 'new')
  }, [activeLevelId, isDirty, askSafety, projectName, levels, onSaveLevel, saveName])

  useEffect(() => {
    if (!safetyRequest) return undefined
    const close = (event) => { if (event.key === 'Escape') { event.preventDefault(); setSafetyRequest(null) } }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [safetyRequest])

  useEffect(() => {
    if (selectMode !== 'area' || !activeLayer) return
    setAreaLayerIds(prev => prev.some(id => level.layers.some(l => l.id === id))
      ? prev.filter(id => level.layers.some(l => l.id === id))
      : [activeLayer.id])
  }, [selectMode, activeLayer?.id, level.layers])

  useEffect(() => {
    try { sessionStorage.setItem('ts.areaPasteMode', pasteMode) } catch { /* optional */ }
  }, [pasteMode])

  const captureArea = useCallback(() => {
    if (!areaRect || !areaLayerIds.length) return null
    return level.captureRegion(areaRect, areaLayerIds, includeAreaProps, tileSize, effectiveTilesets, assetsById, currentLevelIdentity)
  }, [areaRect, areaLayerIds, includeAreaProps, level, tileSize, effectiveTilesets, assetsById, currentLevelIdentity])

  const copyArea = useCallback(() => {
    const payload = captureArea()
    if (payload) setAreaClipboard(payload)
    return payload
  }, [captureArea])

  const cutArea = useCallback(() => {
    if (!areaRect || !areaLayerIds.length) return
    const payload = level.cutRegion(areaRect, areaLayerIds, includeAreaProps, tileSize, effectiveTilesets, assetsById, currentLevelIdentity)
    setAreaClipboard(payload)
    setAreaRect(null)
  }, [areaRect, areaLayerIds, includeAreaProps, level, tileSize, effectiveTilesets, assetsById, currentLevelIdentity])

  const deleteArea = useCallback(() => {
    if (!areaRect || !areaLayerIds.length) return
    level.deleteRegion(areaRect, areaLayerIds, includeAreaProps)
    setAreaRect(null)
  }, [areaRect, areaLayerIds, includeAreaProps, level])

  const beginPlacement = useCallback((payload, kind = 'paste', position = null) => {
    if (!payload) return
    const fallback = areaRect ? { x: areaRect.x + 1, y: areaRect.y + 1 } : { x: 0, y: 0 }
    setPlacement({ payload, kind, ...(position || lastAreaCell || fallback) })
    setSelectMode('area')
    setLevelTool('select')
  }, [areaRect, lastAreaCell, setLevelTool])

  const pasteArea = useCallback(() => beginPlacement(areaClipboard, 'paste'), [areaClipboard, beginPlacement])
  const duplicateArea = useCallback(() => {
    const payload = copyArea()
    if (payload) beginPlacement(payload, 'duplicate', { x: areaRect.x + 1, y: areaRect.y + 1 })
  }, [copyArea, beginPlacement, areaRect])

  const adjustScrollAfterExpansion = useCallback((result) => {
    if (!result?.shiftX && !result?.shiftY) return
    requestAnimationFrame(() => {
      if (!levelCanvasAreaRef.current) return
      levelCanvasAreaRef.current.scrollLeft += result.shiftX * cellPx
      levelCanvasAreaRef.current.scrollTop += result.shiftY * cellPx
    })
  }, [cellPx, levelCanvasAreaRef])

  const commitPayload = useCallback((payload, x, y, clearSource = null) => {
    const result = level.applyRegion(payload, {
      x, y, mode: pasteMode, clearSource, includeProps: includeAreaProps,
      validAssetIds, destinationTilesets: effectiveTilesets,
      currentLevelId: currentLevelIdentity,
      maxWidth: maxMapCells, maxHeight: maxMapCells,
    })
    if (result?.error) { onNotice?.(result.error); return null }
    if (result?.missingAssetIds?.length) onNotice?.(`${result.missingAssetIds.length} missing prop asset(s) were skipped.`)
    adjustScrollAfterExpansion(result)
    setAreaRect(result.selectionRect)
    setAreaLayerIds(result.selectedLayerIds || areaLayerIds)
    setPlacement(null)
    return result
  }, [level, pasteMode, includeAreaProps, validAssetIds, effectiveTilesets, currentLevelIdentity, maxMapCells, onNotice, adjustScrollAfterExpansion, areaLayerIds])

  const moveArea = useCallback((x, y) => {
    const payload = captureArea()
    if (!payload || !areaRect) return
    commitPayload(payload, x, y, { rect: areaRect, layerIds: areaLayerIds, includeProps: includeAreaProps })
  }, [captureArea, areaRect, areaLayerIds, includeAreaProps, commitPayload])

  const transformArea = useCallback((operation) => {
    if (placement) {
      setPlacement(prev => ({ ...prev, payload: transformRegionPayload(prev.payload, operation) }))
      return
    }
    if (!areaRect) return
    const result = level.transformRegion(areaRect, areaLayerIds, includeAreaProps, operation, {
      tileSize, effectiveTilesets, assetsById, validAssetIds, mode: pasteMode, sourceLevelId: currentLevelIdentity,
      maxWidth: maxMapCells, maxHeight: maxMapCells,
    })
    if (result?.error) { onNotice?.(result.error); return }
    adjustScrollAfterExpansion(result)
    setAreaRect(result.selectionRect)
  }, [placement, areaRect, level, areaLayerIds, includeAreaProps, tileSize, effectiveTilesets, assetsById, validAssetIds, pasteMode, currentLevelIdentity, maxMapCells, onNotice, adjustScrollAfterExpansion])

  const saveAreaStamp = useCallback(async () => {
    const payload = captureArea()
    if (!payload) return
    const row = await onSaveStamp?.(stampName.trim() || 'Stamp', payload)
    if (row) { setStampName(''); onNotice?.(`Saved stamp "${row.name}".`) }
  }, [captureArea, onSaveStamp, stampName, onNotice])

  useEffect(() => {
    if (!pendingStamp?.stamp?.payload) return
    beginPlacement(pendingStamp.stamp.payload, 'stamp')
    onStampConsumed?.()
  }, [pendingStamp?.nonce, beginPlacement, onStampConsumed])

  // Global level undo/redo (Ctrl+Z / Ctrl+Y) + Delete for the selected prop,
  // ignored while typing in a field. Only while the Levels view is active — the
  // workspace stays mounted (hidden) when in the editor, and a live listener
  // there would hijack Ctrl+Z / Delete from the tileset editor.
  useEffect(() => {
    if (!active) return
    const handleKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (mod && key === 's') {
        e.preventDefault()
        saveCurrentLevel()
        return
      }
      if (e.altKey && /^[1-9]$/.test(key)) {
        const bookmark = bookmarks[Number(key) - 1]
        if (bookmark) { e.preventDefault(); navigateToCell(bookmark.x, bookmark.y) }
        return
      }
      if (playtestMode) {
        if (e.key === 'Escape') { e.preventDefault(); setPlaytestMode(false) }
        return
      }
      if (e.key === 'Escape' && levelTool === 'select' && selectMode === 'area') {
        e.preventDefault()
        if (placement) setPlacement(null)
        else setAreaRect(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && levelTool === 'select' && selectMode === 'area' && areaRect) {
        e.preventDefault(); deleteArea(); return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && levelTool === 'select' && selectMode === 'object' && selectedProp) {
        e.preventDefault()
        onDeleteSelectedProp?.()
        return
      }
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); level.undo(); return }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); level.redo(); return }
      if (levelTool !== 'select' || selectMode !== 'area') return
      if (mod && key === 'c') { e.preventDefault(); copyArea(); return }
      if (mod && key === 'x') { e.preventDefault(); cutArea(); return }
      if (mod && key === 'v') { e.preventDefault(); pasteArea(); return }
      if (mod && key === 'd') { e.preventDefault(); duplicateArea(); return }
      if (mod) return
      if (key === 'r') { e.preventDefault(); transformArea('rotate'); return }
      if (key === 'h') { e.preventDefault(); transformArea('flipX'); return }
      if (key === 'v') { e.preventDefault(); transformArea('flipY'); return }
      if (areaRect && key.startsWith('arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 5 : 1
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        moveArea(areaRect.x + dx, areaRect.y + dy)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, level, levelTool, selectMode, selectedProp, onDeleteSelectedProp, placement, areaRect,
    deleteArea, copyArea, cutArea, pasteArea, duplicateArea, transformArea, moveArea,
    activeLevelId, isDirty, projectName, saveName, askSafety, onSaveLevel, levels, bookmarks, navigateToCell, saveCurrentLevel, playtestMode])

  const getCachedNativeSheet = useCallback((layerTile) => {
    if (!layerTile?.tiles?.length) return null
    const sheetTileSize = layerTile.tileSize || tileSize
    const cached = nativeSheetCache.current.get(layerTile)
    if (cached?.tileSize === sheetTileSize) return cached.sheet
    const sheet = composeNativeSheet(layerTile.tiles, sheetTileSize)
    nativeSheetCache.current.set(layerTile, { tileSize: sheetTileSize, sheet })
    return sheet
  }, [tileSize])

  const getCachedIndexMap = useCallback((grid, width, height, seamlessEdges, mode = 'blob47') => {
    if (!grid) return null
    const seamless = seamlessEdges ? 1 : 0
    const cacheKey = `${width}:${height}:${seamless}:${mode}`
    let gridCache = indexMapCache.current.get(grid)
    if (!gridCache) {
      gridCache = new Map()
      indexMapCache.current.set(grid, gridCache)
    }
    if (gridCache.has(cacheKey)) return gridCache.get(cacheKey)
    const map = computeIndexMap(grid, width, height, seamless, mode)
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
    gridTemplateColumns: playtestMode
      ? 'minmax(0,1fr)'
      : sidebarOpen
        ? '92px minmax(0,1fr) 318px'
        : '92px minmax(0,1fr)',
  }), [sidebarOpen, playtestMode])

  const leftPanelStyle = useMemo(() => ({
    display: sidebarOpen && !playtestMode ? 'flex' : 'none',
  }), [sidebarOpen, playtestMode])

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
      const autotileMode = autotileModeForDefinition(layer.tileset?.definition)
      const usesNegativeEmpty = autotileMode === 'dual-grid-15' || autotileMode === 'cardinal-17'
      const exportIndexMap = getCachedIndexMap(layer.grid, level.width, level.height, level.seamlessEdges, autotileMode)
      if (!sheet) continue
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1))
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
          const isEmpty = layer.kind === 'manual' || usesNegativeEmpty ? idx < 0 : !idx
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
    ctx.globalAlpha = 1

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
    <>
    <div className={`level-workspace ${playtestMode ? 'is-playtesting' : ''}`}>
    <div className="level-workspace-toolbar">
      <div className="level-toolbar-group">
        <Btn size="sm" variant="outline" icon="undo" onClick={level.undo} disabled={!level.canUndo}>{t('undo')}</Btn>
        <Btn size="sm" variant="outline" icon="redo" onClick={level.redo} disabled={!level.canRedo}>{t('redo')}</Btn>
      </div>
      <div className="level-toolbar-project" title={projectName}>
        <b>{projectName}</b>
        <span>{level.width}×{level.height} · {tileSize}px</span>
      </div>
      <div className="level-toolbar-group level-toolbar-primary">
        <Btn size="sm" variant="primary" icon="save" onClick={saveCurrentLevel} disabled={!!activeLevelId && !isDirty}>
          {activeLevelId ? t('save') : t('saveLevel')}
        </Btn>
        <details className="level-toolbar-menu">
          <summary title={t('moreSaveOptions')}><Icon name="chevron" size={14} /></summary>
          <div className="level-toolbar-popover save-popover">
            <label>Level name</label>
            <input className="text-input" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={projectName || 'Level name'} />
            <Btn size="sm" variant="outline" disabled={!saveName.trim()} onClick={async () => {
              const row = await onSaveLevel(saveName.trim(), 'saveAs'); if (row) setSaveName('')
            }}>{t('saveAsNew')}</Btn>
            <button className="gen-mini-btn" onClick={() => onCreateSnapshot?.('Manual snapshot')}>Create recovery snapshot</button>
            <small>{lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : 'Not saved to cloud yet'}</small>
          </div>
        </details>
        <Btn size="sm" variant={playtestMode ? 'primary' : 'outline'}
          icon="play" onClick={() => setPlaytestMode(value => !value)}>{playtestMode ? t('exitPlaytest') : t('playtest')}</Btn>
        <details className="level-toolbar-menu export-menu">
          <summary><Icon name="download" size={14} /> {t('export')}</summary>
          <div className="level-toolbar-popover export-popover">
            <button onClick={onExportLevel}>Project JSON</button>
            <button onClick={exportLevelPNG}>PNG image</button>
            <button onClick={() => exportLevelTiled(exportCtx)}>Tiled (.tmj)</button>
            <button onClick={() => exportLevelGodot(exportCtx)}>Godot</button>
            <button onClick={() => exportLevelUnity(exportCtx)}>Unity</button>
            <label className="level-import-action">
              Import JSON
              <input type="file" accept=".json" onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                askSafety({ title: `Import “${file.name}”`, message: 'Importing will replace the current canvas with the selected project file.', confirmLabel: 'Import level' },
                  () => onImportLevel({ target: { files: [file], value: '' } }))
              }} />
            </label>
          </div>
        </details>
      </div>
    </div>
    <div className="editor-grid" style={gridStyle}>
      <aside className="panel level-tool-rail" style={{ display: playtestMode ? 'none' : 'flex' }} aria-label="Painting tools">
        <div className="level-tool-rail-main">
          {levelToolOptions.map(tool => (
            <button key={tool.value} className={`level-tool-rail-btn ${levelTool === tool.value ? 'on' : ''}`}
              onClick={() => setLevelTool(tool.value)} title={tool.label}>
              <Icon name={tool.value === 'terrain' ? 'brush' : tool.value === 'props' ? 'image' : 'select'} size={22} /><span>{tool.label}</span>
            </button>
          ))}
        </div>
        {levelTool === 'terrain' && <>
          <div className="level-tool-rail-sub">
            {TERRAIN_TOOLS.map(tool => <button key={tool.id} className={`level-tool-sub-btn ${terrainTool === tool.id ? 'on' : ''}`}
              onClick={() => setTerrainTool(tool.id)} title={t(tool.id === 'rect' ? 'rectangle' : tool.id)} aria-label={t(tool.id === 'rect' ? 'rectangle' : tool.id)}>
              <Icon name={tool.id === 'fill' ? 'bucket' : tool.id} size={18} />
            </button>)}
          </div>
          <div className="level-brush-picker">
            <span>{t('brush')}</span>
            <div>{BRUSH_SIZE_OPTIONS.map(size => <button key={size.value} className={`level-brush-size ${terrainBrushSize === size.value ? 'on' : ''}`}
              onClick={() => setTerrainBrushSize(size.value)} title={`Brush ${size.label}`}>{size.label}</button>)}</div>
          </div>
        </>}
      </aside>

      <aside className="panel level-inspector-panel" style={leftPanelStyle}>
        <div className="panel-scroll">
          <p className="hint" style={{ padding: '4px 18px 0', margin: 0 }}>
            Shortcuts: Ctrl+Z/Y (Undo/Redo) · Right-click (Erase/Remove) · Del (Remove selected).
          </p>

          <Section title={t('layers')} icon="layers">
            <div className="layer-quick-nav">
              <select className="text-input" value={level.activeLayerIdx}
                onChange={e => level.setActiveLayerIdx(Number(e.target.value))} aria-label="Active layer">
                {level.layers.map((layer, idx) => <option value={idx} key={layer.id}>{idx + 1}. {layer.name}</option>)}
              </select>
              <button className={`gen-mini-btn ${isolationBackup.current ? 'on' : ''}`} onClick={toggleIsolateActiveLayer}
                title="Temporarily hide every layer except the active one">
                {isolationBackup.current ? 'Restore' : 'Isolate'}
              </button>
            </div>
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
                    onToggleLock={() => level.setLayerProp(idx, { locked: !layer.locked })}
                    onDuplicate={() => level.duplicateLayer(idx)}
                    onSolo={() => toggleSoloLayer(idx)}
                    onDragStart={e => { draggedLayerIdx.current = idx; e.dataTransfer.effectAllowed = 'move' }}
                    onDrop={e => { e.preventDefault(); if (draggedLayerIdx.current != null) level.reorderLayer(draggedLayerIdx.current, idx); draggedLayerIdx.current = null }}
                    onRemove={() => askSafety({
                      title: `Delete layer “${layer.name}”`,
                      message: 'All terrain painted on this layer will be removed. You can still undo it during this session.',
                      confirmLabel: 'Delete layer',
                    }, () => level.removeLayer(idx))}
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
                <button className="sf-layer-add collision" onClick={() => level.addLayer(activeLayer?.tileset || null, 'manual', { collision: true })}>
                  <span>+</span> Collision
                </button>
              </div>
            </div>
            {activeLayer && <div className="layer-properties">
              <div className="layer-material-card">
                <span>Active tileset</span><b>{activeLayer.tileset?.name || 'No tileset assigned'}</b>
              </div>
              <label className="layer-opacity-control">
                <span>Opacity <b>{Math.round((activeLayer.opacity ?? 1) * 100)}%</b></span>
                <input type="range" min="0" max="1" step="0.05" value={activeLayer.opacity ?? 1}
                  onChange={e => level.setLayerProp(level.activeLayerIdx, { opacity: Number(e.target.value) })} />
              </label>
              <label className="layer-group-control">
                <span>Group / folder</span>
                <input className="text-input" value={activeLayer.group || ''} placeholder="None"
                  onChange={e => level.setLayerProp(level.activeLayerIdx, { group: e.target.value })} />
              </label>
              <div className="layer-property-actions">
                <button className="gen-mini-btn" onClick={() => level.duplicateLayer(level.activeLayerIdx)}>Duplicate</button>
                <button className="gen-mini-btn" disabled={activeLayer.kind !== 'manual' || level.activeLayerIdx === 0 || level.layers[level.activeLayerIdx - 1]?.kind !== 'manual'}
                  onClick={() => level.mergeManualLayerDown(level.activeLayerIdx)}>Merge down</button>
              </div>
            </div>}
            <p className="hint">Click a layer to paint on it. Manual layers use tile painting; autotile layers use terrain masks.</p>
          </Section>

          <Section title={t('activeTool')} icon="brush">
            <p className="hint">
              {levelTool === 'terrain'
                ? (levelMode === 'manual'
                  ? 'Left-click paints, right-click erases. Tile palette in Terrain options.'
                  : 'Left-click paints solid, right-click erases. Borders autotile.')
                : levelTool === 'props'
                  ? 'Pick a prop, click to place, right-click to remove.'
                  : selectMode === 'area'
                    ? 'Drag to select terrain across the checked layers; drag inside to move it.'
                    : 'Click a placed prop to select it. Drag to move, Delete to remove.'}
            </p>
          </Section>

          <Section
            title={levelTool === 'terrain' ? t('terrainOptions') : levelTool === 'props' ? t('props') : t('selection')}
            icon={levelTool === 'props' ? 'image' : levelTool === 'select' ? 'layers' : 'brush'}
          >
            {levelTool === 'terrain' && (
              <div className="context-tool-summary">
                <span>{TERRAIN_TOOLS.find(tool => tool.id === terrainTool)?.label || terrainTool}</span>
                <b>{BRUSH_SIZE_OPTIONS.find(size => size.value === terrainBrushSize)?.label || terrainBrushSize}</b>
              </div>
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
                <div className="context-asset-summary">
                  {selectedAssetId && assetsById[selectedAssetId]
                    ? <><PropMini asset={assetsById[selectedAssetId]} /><span><b>{assetsById[selectedAssetId].name}</b><small>Select props from the bottom library.</small></span></>
                    : <span><b>No prop selected</b><small>Choose one from the Props library below.</small></span>}
                </div>
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
                  onClick={() => askSafety({
                    title: 'Clear all props', message: `This will remove ${level.placedProps.length} placed prop(s) from the level.`, confirmLabel: 'Clear props',
                  }, level.clearProps)} disabled={!level.placedProps.length}>
                  Clear props ({level.placedProps.length})
                </Btn>
              </div>
            )}

            {levelTool === 'select' && (
              <div style={{ marginTop: 8 }}>
                <Segmented full size="sm" value={selectMode} onChange={mode => {
                  setSelectMode(mode)
                  if (mode === 'area' && activeLayer) setAreaLayerIds(prev => prev.length ? prev : [activeLayer.id])
                }} options={[{ value: 'object', label: t('object') }, { value: 'area', label: t('area') }]} />

                {selectMode === 'object' ? (
                  selectedProp ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="sidebar-inline-label">
                        <span className="brush-label">{assetsById[selectedProp.assetId]?.name || 'Prop'} · ({selectedProp.x}, {selectedProp.y})</span>
                        <span className="tool-meta">{selectedProp.rotation || 0}°{selectedProp.flipX ? ' H' : ''}{selectedProp.flipY ? ' V' : ''}</span>
                      </div>
                      <div className="gen-mini-row">
                        <button className={`gen-mini-btn ${selectedProp.flipX ? 'on' : ''}`} onClick={() => onUpdateSelectedProp?.({ flipX: !selectedProp.flipX })}>Flip H</button>
                        <button className={`gen-mini-btn ${selectedProp.flipY ? 'on' : ''}`} onClick={() => onUpdateSelectedProp?.({ flipY: !selectedProp.flipY })}>Flip V</button>
                        <button className="gen-mini-btn" onClick={() => onUpdateSelectedProp?.({ rotation: ((selectedProp.rotation || 0) + 90) % 360 })}>Rotate</button>
                        <button className="gen-mini-btn" onClick={() => onUpdateSelectedProp?.({ flipX: false, flipY: false, rotation: 0 })}>Reset</button>
                      </div>
                      <div className="gen-mini-row">
                        <button className="gen-mini-btn" onClick={() => onMoveSelectedPropZ?.(1)}>Forward</button>
                        <button className="gen-mini-btn" onClick={() => onMoveSelectedPropZ?.(-1)}>Backward</button>
                      </div>
                      <Btn size="sm" variant="danger" icon="trash" full style={{ marginTop: 8 }} onClick={onDeleteSelectedProp}>Delete prop (Del)</Btn>
                    </div>
                  ) : <p className="hint">Click a prop to select it.</p>
                ) : (
                  <div className="area-inspector">
                    <div className="sidebar-inline-label">
                      <span className="brush-label">Layers</span>
                      <span className="tool-meta">{areaLayerIds.length} selected</span>
                    </div>
                    <div className="area-layer-actions">
                      <button className="gen-mini-btn" onClick={() => setAreaLayerIds(level.layers.filter(l => l.visible !== false).map(l => l.id))}>{t('allVisible')}</button>
                      <button className="gen-mini-btn" onClick={() => setAreaLayerIds([])}>{t('none')}</button>
                    </div>
                    <div className="area-layer-list">
                      {level.layers.map(layer => (
                        <label key={layer.id} className="area-layer-check">
                          <input type="checkbox" checked={areaLayerIds.includes(layer.id)} onChange={e => setAreaLayerIds(prev => e.target.checked ? [...new Set([...prev, layer.id])] : prev.filter(id => id !== layer.id))} />
                          <span>{layer.name}</span><small>{layer.kind === 'manual' ? 'Manual' : 'Auto'}</small>
                        </label>
                      ))}
                    </div>
                    <label className="area-layer-check area-props-check">
                      <input type="checkbox" checked={includeAreaProps} onChange={e => setIncludeAreaProps(e.target.checked)} />
                      <span>{t('includeProps')}</span>
                    </label>
                    <Segmented full size="sm" value={pasteMode} onChange={setPasteMode}
                      options={[{ value: 'overlay', label: t('overlay') }, { value: 'replace', label: t('replace') }]} />

                    {areaRect ? (
                      <div className="area-summary">
                        <b>{areaRect.width}×{areaRect.height}</b>
                        <span>({areaRect.x}, {areaRect.y})</span>
                      </div>
                    ) : <p className="hint">Drag on the map to select a rectangular area.</p>}

                    <p className="area-shortcuts">
                      Drag inside to move · drag <b>↻</b> to rotate<br />
                      <kbd>Ctrl C/X/V/D</kbd> · <kbd>R</kbd> rotate · <kbd>H/V</kbd> flip · <kbd>Del</kbd>
                    </p>
                    {placement && <p className="hint area-placement-hint">Click to place · right-click/Esc cancels · map expands automatically.</p>}
                    <form className="area-stamp-save" onSubmit={e => { e.preventDefault(); if (areaRect) saveAreaStamp() }}>
                      <input className="text-input" value={stampName} onChange={e => setStampName(e.target.value)}
                        disabled={!areaRect} placeholder="Stamp name · Enter to save" />
                    </form>
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title={t('mapSettings')} icon="settings" defaultOpen={false}>
            <div className="sidebar-inline-label">
              <span className="brush-label">Tile size (paint px)</span>
            </div>
            <Segmented full size="sm" value={tileSize} onChange={nextSize => {
              if (nextSize === tileSize) return
              askSafety({
                title: `Change tile size to ${nextSize}px`,
                message: 'Changing the project tile size can rebuild tileset previews and alter the native output size.',
                confirmLabel: 'Change tile size',
              }, () => onTileSizeChange(nextSize))
            }}
              options={[{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }, { value: 64, label: '64' }]} />
            <p className="hint" style={{ marginTop: 8, marginBottom: 16 }}>
              {activeLayer?.tileset
                ? `Current: ${activeLayer.tileset.name || 'custom'} · ${activeLayer.tileset.tileSize || tileSize}px`
                : `Current editor size: ${tileSize}px`}
            </p>

            <div className="sidebar-inline-label">
              <span className="brush-label">Map size (cells)</span>
            </div>
            <div className="size-selector-row">
              {SIZE_PRESETS.map(p => (
                <button key={p.label}
                  className={`size-cell-btn ${level.width === p.w && level.height === p.h ? 'active' : ''}`}
                  style={{ width: 'auto', padding: '0 10px', height: 28 }}
                  onClick={() => {
                    if (level.width === p.w && level.height === p.h) return
                    askSafety({
                      title: `Resize map to ${p.w}×${p.h}`,
                      message: p.w < level.width || p.h < level.height
                        ? 'Shrinking can permanently crop terrain and props outside the new bounds.'
                        : 'The map dimensions will change across every layer.',
                      confirmLabel: 'Resize map',
                    }, () => level.resize(p.w, p.h))
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="export-info"><span>Grid</span><b>{level.width} x {level.height}</b></div>
            <div className="row-btns" style={{ marginBottom: 16 }}>
              <Btn size="sm" variant="outline" icon="fit" full onClick={onFit}>{t('fit')}</Btn>
            </div>

            <div className="sidebar-inline-label">
              <span className="brush-label">Options</span>
            </div>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Show grid</span>
              <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            </label>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Seamless edges</span>
              <input type="checkbox" checked={level.seamlessEdges} onChange={e => level.setSeamlessEdges(e.target.checked)} />
            </label>
            <label className="lib-card-foot" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <span className="layer-name">Tile variation</span>
              <input type="checkbox" checked={tileVariation} onChange={e => setTileVariation(e.target.checked)} />
            </label>
          </Section>

          {levelMode === 'autotile' ? (
            <>
              <Section title={t('generate')} icon="spark" defaultOpen={false}>
                <GeneratePanel level={level} onSurprise={onSurprise} />
              </Section>
              <Section title={t('aiIdeas')} icon="spark" defaultOpen={false}>
                <Suspense fallback={<div className="ai-hint">Loading AI…</div>}>
                  <LevelIdeaPanel level={level} />
                </Suspense>
              </Section>
            </>
          ) : (
            <Section title={t('manualActions')} icon="layers">
              <div className="row-btns">
                <Btn size="sm" variant="outline" icon="grid" full onClick={onFillActiveLayer} disabled={!!activeLayer?.locked}>Fill</Btn>
                <Btn size="sm" variant="danger" icon="trash" full onClick={() => askSafety({
                  title: `Clear “${activeLayer?.name || 'active layer'}”`,
                  message: 'All terrain cells on the active layer will be emptied.', confirmLabel: 'Clear layer',
                }, onClearActiveLayer)} disabled={!!activeLayer?.locked}>Clear</Btn>
              </div>
            </Section>
          )}

          <Section title={t('recovery')} icon="folder" defaultOpen={false}>

            {recoveryDraft && (
              <div className="level-recovery-card">
                <b>Local recovery available</b>
                <span>{new Date(recoveryDraft.savedAt).toLocaleString()}</span>
                <div className="row-btns">
                  <Btn size="sm" variant="primary" onClick={() => askSafety({
                    title: 'Restore local recovery', message: 'The current canvas will be replaced by the recovered draft.', confirmLabel: 'Restore draft',
                  }, onRestoreRecovery)}>Restore</Btn>
                  <Btn size="sm" variant="outline" onClick={onDiscardRecovery}>Discard</Btn>
                </div>
              </div>
            )}

            {levelsError ? (
              <p className="hint lib-error">Cloud error: {levelsError}</p>
            ) : levelsLoading ? (
              <p className="hint">Loading saved levels…</p>
            ) : levels.length === 0 ? (
              <p className="hint">No saved levels yet.</p>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {levels.map(row => (
                  <div key={row.id} className={`layer-row ${row.id === activeLevelId ? 'on' : ''}`} onClick={() => askSafety({
                    title: `Load “${row.name}”`,
                    message: isDirty ? 'The current level has unsaved changes and will be replaced.' : 'The current canvas will be replaced by this level.',
                    confirmLabel: 'Load level',
                  }, () => onLoadLevel(row))}>
                    <span className="layer-name">{row.name}</span>
                    <span className="tool-meta">{row.width}x{row.height}</span>
                    <button className="lib-card-del" onClick={e => {
                      e.stopPropagation()
                      askSafety({
                        title: `Delete “${row.name}”`, message: 'This removes the saved cloud level. This action cannot be undone from the cloud list.',
                        confirmLabel: 'Delete level', snapshotPayload: row.id === activeLevelId ? null : row,
                      }, () => onRemoveLevel(row.id))
                    }} title={t('delete')} aria-label={t('delete')}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="sidebar-inline-label">
              <span className="brush-label">Recovery snapshots</span>
              <button className="gen-mini-btn" onClick={() => onCreateSnapshot?.('Manual snapshot')}>Create snapshot</button>
            </div>
            {snapshots.length === 0 ? <p className="hint">No local snapshots yet.</p> : (
              <div className="level-snapshot-list">
                {snapshots.map(entry => (
                  <div className="level-snapshot-row" key={entry.id}>
                    <button onClick={() => askSafety({ title: `Restore “${entry.label}”`, message: 'The current canvas will be replaced by this snapshot.', confirmLabel: 'Restore snapshot' }, () => onRestoreSnapshot?.(entry))}>
                      <b>{entry.label}</b><small>{new Date(entry.createdAt).toLocaleString()}</small>
                    </button>
                    <button className="lib-card-del" title={t('delete')} aria-label={t('delete')} onClick={() => onRemoveSnapshot?.(entry.id)}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
              </div>
            )}

          </Section>
        </div>
      </aside>

      <section className="level-canvas-shell">
        <div className="level-status-bar">
          <span className="level-status-pill">{levelToolOptions.find(tool => tool.value === levelTool)?.label || levelTool}</span>
          <span className="level-status-pill" title={activeLayer?.name || t('noLayer')}>{t('layer')}: {activeLayer?.name || '—'}</span>
          <span className={`level-status-pill level-dirty-pill ${isDirty ? 'dirty' : 'clean'}`}>
            {isDirty ? t('unsavedChanges') : t('saved')}
          </span>
          {lastSavedAt && <span className="level-status-pill">{t('lastSave')} {new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="level-status-pill level-coordinate-pill">X {cursorCell.x} · Y {cursorCell.y}</span>
          <span className="level-status-pill">Zoom {Math.round(cellPx / Math.max(1, tileSize) * 100)}%</span>
          {levelNotice && <span className="level-status-pill level-status-notice">{levelNotice}</span>}
        </div>
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Hide panel' : 'Show panel'}>
          {sidebarOpen ? '>' : '<'}
        </button>
        <div className="level-navigation-panel">
          <div className="level-navigation-actions">
            <button onClick={onFit} title={t('fit')}><Icon name="fit" size={13} />{t('fit')}</button>
            <button onClick={zoomToSelection} disabled={!areaRect} title={t('zoomSelection')}><Icon name="select" size={13} />{t('zoomSelection')}</button>
            <button onClick={addBookmark} title={`${t('addMarker')} ${cursorCell.x}, ${cursorCell.y}`}><Icon name="plus" size={13} />{t('addMarker')}</button>
          </div>
          {bookmarks.length > 0 && <div className="level-bookmark-strip">
            {bookmarks.map((bookmark, index) => (
              <span key={bookmark.id}>
                <button onClick={() => navigateToCell(bookmark.x, bookmark.y)} title={`${bookmark.name} · Alt+${index + 1}`}>{index + 1}</button>
                <button className="remove" onClick={() => updateBookmarks(prev => prev.filter(item => item.id !== bookmark.id))} title={t('delete')} aria-label={t('delete')}><Icon name="trash" size={12} /></button>
              </span>
            ))}
          </div>}
          <small>{t('panHint')}</small>
        </div>
        <LevelMinimap layers={level.layers} placedProps={level.placedProps} width={level.width} height={level.height}
          cellPx={cellPx} containerRef={levelCanvasAreaRef} bookmarks={bookmarks} />
        <div className="level-canvas-area" ref={levelCanvasAreaRef}>
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
            selectMode={selectMode}
            areaSelection={areaRect}
            areaLayerCount={areaLayerIds.length}
            areaPropCount={areaRect && includeAreaProps ? level.placedProps.filter(p => pointInRegion(p.x, p.y, areaRect)).length : 0}
            placement={placement}
            pasteMode={pasteMode}
            onAreaSelect={(rect) => {
              if (!areaLayerIds.length && activeLayer) setAreaLayerIds([activeLayer.id])
              setAreaRect(rect)
            }}
            onAreaMove={moveArea}
            onAreaTransform={transformArea}
            onAreaHover={(x, y) => setLastAreaCell(prev => prev?.x === x && prev?.y === y ? prev : { x, y })}
            onPlacementCommit={(x, y) => commitPayload(placement.payload, x, y)}
            onCancelPlacement={() => setPlacement(null)}
            onCursorCell={(x, y) => setCursorCell(prev => prev.x === x && prev.y === y ? prev : { x, y })}
            readOnly={playtestMode}
            terrainLocked={!!activeLayer?.locked}
            active={active}
            smooth={smooth}
          />
        ) : (
          <div className="level-empty">Generate a tileset first in the Editor view.</div>
        )}
        </div>
      </section>
    </div>
    </div>
    <SafetyConfirm key={safetyRequest?.id || 'closed'} request={safetyRequest}
      onCancel={() => setSafetyRequest(null)} onAccept={acceptSafety} />
    </>
  )
}
