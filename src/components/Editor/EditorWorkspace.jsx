import { usePresets } from "../../hooks/usePresets.js"
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Segmented } from '../ui/Segmented.jsx'
import { Section } from '../ui/Section.jsx'
import { Btn } from '../ui/Btn.jsx'
import { ColorRow } from '../ui/ColorRow.jsx'
import { PixIcon } from '../ui/PixIcon.jsx'
import { ICONS } from '../ui/icons.js'
import { PixelCanvas } from './PixelCanvas.jsx'
import { TilePreviewMosaic } from './TilePreviewMosaic.jsx'
import { JsonImportExport } from './JsonImportExport.jsx'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { exportTilesheet } from '../../core/exportSheet.js'
import { ANIM_FRAME_MS } from '../../core/tilesetDefinition.js'

// AI panels pull in the Gemini/OpenAI request code; load them only when the
// (collapsed-by-default) "AI textures" section is opened.
const AITilePanel = lazy(() => import('../Generator/AITilePanel.jsx').then(m => ({ default: m.AITilePanel })))
const AIProceduralPanel = lazy(() => import('../Generator/AIProceduralPanel.jsx').then(m => ({ default: m.AIProceduralPanel })))

const PAL_KEYS = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['border', 'Border'],
  ['highlight', 'Highlight'],
  ['shadow', 'Shadow'],
]

const QUICK_SWATCHES = ['#ef6f6f', '#e84d4d', '#e8902f', '#f2c94c', '#5fc96a', '#3fd6a0', '#3fc7d6', '#4d8de8', '#a06be0', '#9aa0a8', '#3a3f47', '#f4f6f8']

// Hand-draw tools for the Draw mode sidebar (same set the drawing hook supports).
const DRAW_TOOLS = [
  { id: 'pencil',     icon: 'brush',  label: 'Pencil' },
  { id: 'eraser',     icon: 'eraser', label: 'Eraser' },
  { id: 'fill',       icon: 'bucket', label: 'Fill' },
  { id: 'line',       icon: 'rect',   label: 'Line' },
  { id: 'rect',       icon: 'rect',   label: 'Rect' },
  { id: 'rectFill',   icon: 'rect',   label: 'RectF' },
  { id: 'eyedropper', icon: 'picker', label: 'Pick' },
]


// Zoom bounds — shared by the Manual draw canvas and the Procedural sheet
// (wheel + −/+/Fit), matching the Assets view.
const MIN_ZOOM = 1
const MAX_ZOOM = 32
// Fit a single tile (draw canvas) vs. the full 8×6 sheet (procedural) to the stage.
const fitTileZoom  = (size) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(360 / size)))
const fitSheetZoom = (size) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
  Math.floor(Math.min(540 / (8 * size), 430 / (6 * size)))))

function SheetCanvas({ tiles, tileSize, scale, className, onZoomChange, onSelectTile, markedTiles, frames, active = true, smooth = false }) {
  const ref = useRef(null)
  const nativesRef = useRef([])
  const [frameIdx, setFrameIdx] = useState(0)

  // Compose the native 8×6 sheet(s) only when tiles/frames/tileSize change (the
  // expensive part). Zoom just rescales the cached sheets, so wheel-zoom stays
  // smooth; animation just cycles which cached sheet is drawn.
  useEffect(() => {
    nativesRef.current = tiles
      ? [tiles, ...(frames || [])].map(t => composeNativeSheet(t, tileSize))
      : []
    setFrameIdx(0)
  }, [tiles, frames, tileSize])

  // Cycle animation frames while the sheet has them and the view is active (the
  // tileset editor stays mounted but hidden when in Assets/Levels — no point
  // animating an off-screen canvas).
  useEffect(() => {
    if (!frames?.length || !active) return
    const id = setInterval(() => setFrameIdx(i => i + 1), ANIM_FRAME_MS)
    return () => clearInterval(id)
  }, [frames, active])

  useEffect(() => {
    const cv = ref.current
    const natives = nativesRef.current
    const native = natives.length ? natives[frameIdx % natives.length] : null
    if (!cv || !native) return
    cv.width = native.width * scale
    cv.height = native.height * scale
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = smooth
    ctx.drawImage(native, 0, 0, native.width, native.height, 0, 0, cv.width, cv.height)
    // Corner markers on hand-edited (overridden) tiles.
    if (markedTiles?.length) {
      ctx.fillStyle = '#2fd6a6'
      const cellW = cv.width / 8
      const cellH = cv.height / 6
      for (const idx of markedTiles) {
        ctx.fillRect((idx % 8) * cellW + 1, Math.floor(idx / 8) * cellH + 1, 5, 5)
      }
    }
  }, [tiles, tileSize, scale, markedTiles, frames, frameIdx, smooth])

  // Non-passive wheel zoom (only when interactive — the preview sheet omits it).
  const handleWheel = useCallback((e) => {
    if (!onZoomChange) return
    e.preventDefault()
    onZoomChange(e.deltaY < 0 ? 1 : -1)
  }, [onZoomChange])

  useEffect(() => {
    const el = ref.current
    if (!el || !onZoomChange) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel, onZoomChange])

  // Click → sheet index (8×6 grid), for the per-tile override editor.
  const handleClick = useCallback((e) => {
    if (!onSelectTile) return
    const rect = ref.current.getBoundingClientRect()
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * 8)
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * 6)
    if (col >= 0 && col < 8 && row >= 0 && row < 6) onSelectTile(row * 8 + col)
  }, [onSelectTile])

  return (
    <canvas
      ref={ref}
      className={className}
      onClick={handleClick}
      style={{ imageRendering: smooth ? 'auto' : 'pixelated', ...(onSelectTile ? { cursor: 'pointer' } : {}) }}
      title={onSelectTile ? 'Click a tile to edit it' : undefined}
    />
  )
}

const OVERRIDE_TOOLS = [
  ['pencil', 'Pencil'],
  ['eraser', 'Eraser'],
  ['fill', 'Fill'],
  ['eyedropper', 'Pick'],
]

export function EditorWorkspace({
  mode, setMode, tileSize, setTileSize, biome, onColorChange, onProceduralParamChange, onResetColors, onShuffleColors,
  onLoadPreset,
  drawing, tiles, onGenerate, onAITile, onAIProcedural, onAIRecolor, biomeId, savedCount,
  editingTile = null, overrideDraw, overriddenTiles = [],
  onEditTile, onApplyTileEdit, onCancelTileEdit, onResetTileOverride,
  animFrameCount = 1, setAnimFrameCount, canAnimate = false, animFrames = null,
  active = true,
}) {
  const { presets, savePreset, removePreset, importPreset } = usePresets()
  const [zoom, setZoom] = useState(() => fitSheetZoom(tileSize))
  const [exportScale, setExportScale] = useState(1)
  const cols = 8
  const rows = 6
  const isEditingTile = editingTile != null && overrideDraw

  // Keep the procedural sheet fitted when the tile size changes.
  useEffect(() => { setZoom(fitSheetZoom(tileSize)) }, [tileSize])

  const changeZoom = (delta) =>
    drawing.setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)))
  const changeSheetZoom = (delta) =>
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)))
  const changeOverrideZoom = (delta) =>
    overrideDraw?.setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)))

  const [exportFormat, setExportFormat] = useState('48')

  const handleExport = () => {
    if (!tiles) return
    exportTilesheet(tiles, tileSize, `tileset_${biomeId || 'custom'}_${tileSize}px.png`, exportScale, animFrames, exportFormat)
  }

  return (
    <div className="editor-grid">
      <aside className="panel">
        <div className="panel-scroll">
          <Section title="Mode" icon="layers">
            <Segmented
              full
              size="sm"
              value={mode}
              onChange={setMode}
              options={[{ value: 'procedural', label: 'Procedural' }, { value: 'draw', label: 'Draw' }]}
            />
          </Section>

          {mode === 'procedural' && (
            <>
              <Section
                title={`Palette · ${biome.label || biome.name || 'Custom'}`}
                icon="brush"
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {PAL_KEYS.map(([k, label]) => (
                    <ColorRow key={k} label={label} value={biome.colors[k]} onChange={(v) => onColorChange(k, v)} />
                  ))}
                </div>
                <div className="row-btns">
                  <Btn size="sm" variant="accentSoft" icon="dice" full onClick={onShuffleColors}>Shuffle</Btn>
                  <Btn size="sm" variant="outline" icon="reset" full onClick={onResetColors}>Reset</Btn>
                </div>
              </Section>
              <Section title="Generator Settings" icon="grid">
                <label className="field-label">Engine</label>
                <Segmented
                  full
                  size="sm"
                  value={biome.proceduralParams?.engine ?? 'default'}
                  onChange={v => onProceduralParamChange?.('engine', v)}
                  options={[{ value: 'default', label: 'Default' }, { value: 'spritecook', label: 'SpriteCook' }]}
                />
                
                {biome.proceduralParams?.engine === 'spritecook' ? (
                  <>
                    <label className="field-label" style={{ marginTop: 12 }}>Padding</label>
                    <input type="range" min="0" max={Math.floor(tileSize / 3)} value={biome.proceduralParams?.padding ?? 1} onChange={e => onProceduralParamChange?.('padding', parseInt(e.target.value, 10))} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Corner Radius</label>
                    <input type="range" min="0" max={Math.floor(tileSize / 2)} value={biome.proceduralParams?.cornerRadius ?? Math.floor(tileSize * 0.2)} onChange={e => onProceduralParamChange?.('cornerRadius', parseInt(e.target.value, 10))} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Edge Noise</label>
                    <input type="range" min="0" max="100" value={Math.round((biome.proceduralParams?.edgeNoise ?? 2.0) * 20)} onChange={e => onProceduralParamChange?.('edgeNoise', parseInt(e.target.value, 10) / 20)} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Texture Noise</label>
                    <input type="range" min="0" max="100" value={Math.round((biome.proceduralParams?.textureNoise ?? 0.1) * 200)} onChange={e => onProceduralParamChange?.('textureNoise', parseInt(e.target.value, 10) / 200)} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Flecks</label>
                    <input type="range" min="0" max="100" value={Math.round((biome.proceduralParams?.flecks ?? 0.05) * 400)} onChange={e => onProceduralParamChange?.('flecks', parseInt(e.target.value, 10) / 400)} className="slider" />
                  </>
                ) : (
                  <>
                    <label className="field-label" style={{ marginTop: 12 }}>Edge Thickness</label>
                    <input type="range" min="1" max={Math.max(4, Math.floor(tileSize / 2))} value={biome.proceduralParams?.edgeWidth ?? Math.max(2, Math.round(tileSize / 6))} onChange={e => onProceduralParamChange?.('edgeWidth', parseInt(e.target.value, 10))} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Edge Noise</label>
                    <input type="range" min="0" max="200" value={Math.round((biome.proceduralParams?.edgeNoise ?? 1.0) * 100)} onChange={e => onProceduralParamChange?.('edgeNoise', parseInt(e.target.value, 10) / 100)} className="slider" />
                    
                    <label className="field-label" style={{ marginTop: 12 }}>Edge Jitter</label>
                    <input type="range" min="0" max="300" value={Math.round((biome.proceduralParams?.edgeJitter ?? 1.0) * 100)} onChange={e => onProceduralParamChange?.('edgeJitter', parseInt(e.target.value, 10) / 100)} className="slider" />
                    
                    {!biome.isCustom && (
                      <>
                        <label className="field-label" style={{ marginTop: 12 }}>Corner Style</label>
                        <Segmented full size="sm" value={biome.proceduralParams?.cornerStyle ?? 'sharp'} onChange={v => onProceduralParamChange?.('cornerStyle', v)} options={[{ value: 'sharp', label: 'Sharp' }, { value: 'rounded', label: 'Round' }, { value: 'organic', label: 'Organic' }]} />
                      </>
                    )}
                  </>
                )}
              </Section>

            <Section title="Preset Library" icon="folder">
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <Btn size="sm" variant="outline" full onClick={() => {
                  const name = prompt('Preset name:')
                  if (name) {
                    savePreset({ name, biomeId: biome.biomeId || biomeId || biome.id, colors: biome.colors, proceduralParams: biome.proceduralParams })
                  }
                }}>Save Current</Btn>
                <Btn size="sm" variant="outline" full onClick={() => {
                  const data = prompt('Paste preset JSON:')
                  if (data) {
                    try {
                      const p = JSON.parse(data)
                      if (p.colors) importPreset(p)
                    } catch (e) {
                      alert('Invalid preset data')
                    }
                  }
                }}>Import</Btn>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
                {presets.map(p => (
                  <div key={p.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Btn size="sm" variant="outline" style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => onLoadPreset && onLoadPreset(p)}>
                      {p.name || 'Untitled'}
                    </Btn>
                    <Btn size="sm" variant="outline" onClick={() => {
                      const data = JSON.stringify(p)
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(data).then(() => alert('Copied to clipboard!'))
                      } else {
                        prompt('Copy this JSON to share:', data)
                      }
                    }} title="Copy JSON">Share</Btn>
                    <Btn size="sm" variant="outline" onClick={() => {
                      if (confirm('Delete preset?')) removePreset(p.id)
                    }} title="Delete">X</Btn>
                  </div>
                ))}
                {presets.length === 0 && <div className="hint" style={{ textAlign: 'center' }}>No presets saved.</div>}
              </div>
            </Section>
            </>
          )}

          {mode === 'draw' && (
            <>
              <Section title="Draw tools" icon="brush">
                <div className="tool-grid">
                  {DRAW_TOOLS.map((t) => (
                    <button
                      key={t.id}
                      className={`tool-btn ${drawing.tool === t.id ? 'on' : ''}`}
                      onClick={() => drawing.setTool(t.id)}
                      title={t.label}
                    >
                      <PixIcon grid={ICONS[t.icon]} px={2.5} color={drawing.tool === t.id ? 'var(--accent-ink)' : 'var(--ink-dim)'} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <label className="field-label" style={{ margin: 0 }}>Size</label>
                  <div style={{ flex: 1 }}>
                    <Segmented
                      full
                      size="sm"
                      value={drawing.brush}
                      onChange={drawing.setBrush}
                      options={[{ value: 1, label: '1px' }, { value: 2, label: '2px' }, { value: 3, label: '3px' }]}
                    />
                  </div>
                </div>

                <div className="row-btns">
                  <Btn size="sm" variant="outline" icon="undo" full onClick={drawing.undo} disabled={!drawing.canUndo}>Undo</Btn>
                  <Btn size="sm" variant="outline" icon="redo" full onClick={drawing.redo} disabled={!drawing.canRedo}>Redo</Btn>
                  <Btn size="sm" variant="outline" icon="trash" full onClick={drawing.clear}>Clear</Btn>
                </div>
              </Section>

              <Section title="Color" icon="picker">
                <ColorRow label="Active" value={drawing.activeColor} onChange={drawing.setActiveColor} />
                <div className="swatch-grid" style={{ marginTop: 8 }}>
                  {QUICK_SWATCHES.map((c) => (
                    <button
                      key={c}
                      className={`swatch ${drawing.activeColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      title={c}
                      onClick={() => drawing.setActiveColor(c)}
                    />
                  ))}
                </div>
              </Section>

              <Section title="Tiling guide" icon="grid" defaultOpen={false}>
                <ul className="tiling-tips" style={{ marginTop: 0 }}>
                  <li>Make opposite edges match.</li>
                  <li>Keep features away from borders.</li>
                  <li>Avoid big centered shapes.</li>
                  <li>Check the <b>Tiled preview 3×3</b>.</li>
                </ul>
              </Section>
              
              <JsonImportExport drawing={drawing} tileSize={tileSize} setTileSize={setTileSize} />
            </>
          )}

          <Section title="AI Generator" icon="spark" defaultOpen={false}>
            <Suspense fallback={<div className="ai-hint">Loading AI…</div>}>
              {mode === 'draw'
                ? <AITilePanel tileSize={tileSize} paletteHint={biome.colors} onGenerated={onAITile} />
                : <AIProceduralPanel tileSize={tileSize} paletteHint={biome.colors}
                    onGenerated={onAIProcedural} onRecolor={onAIRecolor} canRecolor={!!biomeId} />}
            </Suspense>
          </Section>
        </div>
      </aside>

      <main className="stage">
        <div className="stage-toolbar">
          <div className="biome-pill"><span className="dot" style={{ background: biome.colors.primary }} /> {biome.label}</div>
          <div className="spacer" />
          <span className="tool-meta">
            {isEditingTile ? `Editing tile #${editingTile}` : `${cols} × ${rows} · ${tileSize}px`}
          </span>
          <div className="zoom-ctrl">
            {isEditingTile ? (
              <>
                <button onClick={() => changeOverrideZoom(-1)} disabled={overrideDraw.zoom <= MIN_ZOOM} title="Zoom out">−</button>
                <span>{overrideDraw.zoom}×</span>
                <button onClick={() => changeOverrideZoom(1)} disabled={overrideDraw.zoom >= MAX_ZOOM} title="Zoom in">+</button>
                <button onClick={() => overrideDraw.setZoom(fitTileZoom(tileSize))} title="Fit to stage" style={{ fontSize: 10, padding: '0 6px' }}>Fit</button>
              </>
            ) : mode === 'draw' ? (
              <>
                <button onClick={() => changeZoom(-1)} disabled={drawing.zoom <= MIN_ZOOM} title="Zoom out">−</button>
                <span>{drawing.zoom}×</span>
                <button onClick={() => changeZoom(1)} disabled={drawing.zoom >= MAX_ZOOM} title="Zoom in">+</button>
                <button onClick={() => drawing.setZoom(fitTileZoom(tileSize))} title="Fit to stage" style={{ fontSize: 10, padding: '0 6px' }}>Fit</button>
              </>
            ) : (
              <>
                <button onClick={() => changeSheetZoom(-1)} disabled={zoom <= MIN_ZOOM} title="Zoom out">−</button>
                <span>{zoom}×</span>
                <button onClick={() => changeSheetZoom(1)} disabled={zoom >= MAX_ZOOM} title="Zoom in">+</button>
                <button onClick={() => setZoom(fitSheetZoom(tileSize))} title="Fit to stage" style={{ fontSize: 10, padding: '0 6px' }}>Fit</button>
              </>
            )}
          </div>
        </div>

        <div className="stage-canvas">
          {isEditingTile ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div className="canvas-frame">
                <PixelCanvas
                  pixels={overrideDraw.pixels}
                  tileSize={tileSize}
                  zoom={overrideDraw.zoom}
                  onStartStroke={overrideDraw.startStroke}
                  onContinueStroke={overrideDraw.continueStroke}
                  onEndStroke={overrideDraw.endStroke}
                  onZoomChange={changeOverrideZoom}
                />
              </div>
              <div style={{ width: 170, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="gen-mini-row">
                  {OVERRIDE_TOOLS.map(([id, label]) => (
                    <button key={id} className={`gen-mini-btn ${overrideDraw.tool === id ? 'on' : ''}`}
                      onClick={() => overrideDraw.setTool(id)} title={label}>{label}</button>
                  ))}
                </div>
                <ColorRow label="Color" value={overrideDraw.activeColor} onChange={overrideDraw.setActiveColor} />
                <div className="swatch-grid">
                  {QUICK_SWATCHES.map((c) => (
                    <button key={c} className={`swatch ${overrideDraw.activeColor === c ? 'active' : ''}`}
                      style={{ background: c }} title={c} onClick={() => overrideDraw.setActiveColor(c)} />
                  ))}
                </div>
                <div className="row-btns">
                  <Btn size="sm" variant="outline" icon="undo" full onClick={overrideDraw.undo} disabled={!overrideDraw.canUndo}>Undo</Btn>
                  <Btn size="sm" variant="outline" icon="redo" full onClick={overrideDraw.redo} disabled={!overrideDraw.canRedo}>Redo</Btn>
                </div>
                <p className="hint">Editing one sheet tile. Apply bakes it as an override on the generated tileset.</p>
              </div>
            </div>
          ) : mode === 'draw' ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div className="canvas-frame">
                <PixelCanvas
                  pixels={drawing.pixels}
                  tileSize={tileSize}
                  zoom={drawing.zoom}
                  onStartStroke={drawing.startStroke}
                  onContinueStroke={drawing.continueStroke}
                  onEndStroke={drawing.endStroke}
                  onZoomChange={changeZoom}
                />
              </div>
              <TilePreviewMosaic pixels={drawing.committedPixels} tileSize={tileSize} />
            </div>
          ) : (
            <div className="canvas-frame">
              <SheetCanvas tiles={tiles} tileSize={tileSize} scale={zoom} className="main-canvas"
                onZoomChange={changeSheetZoom} onSelectTile={onEditTile} markedTiles={overriddenTiles}
                frames={animFrames} active={active} smooth={biome.smooth || false} />
            </div>
          )}
        </div>

        <div className="stage-actions">
          {isEditingTile ? (
            <>
              <Btn variant="outline" icon="reset" onClick={onCancelTileEdit}>Cancel</Btn>
              <Btn variant="danger" icon="trash" onClick={onResetTileOverride}
                disabled={!overriddenTiles.includes(editingTile)}>
                Remove override
              </Btn>
              <Btn variant="primary" size="lg" icon="save" onClick={onApplyTileEdit}>Apply tile</Btn>
            </>
          ) : (
            <Btn variant="primary" size="lg" icon="grid" onClick={onGenerate}>
              {mode === 'draw' ? 'Generate from drawing' : 'Generate procedural'}
            </Btn>
          )}
        </div>
      </main>

      <aside className="panel">
        <div className="panel-scroll">
          <Section title={`Preview · ${cols} × ${rows}`} icon="image">
            <div className="preview-wrap">
              <SheetCanvas tiles={tiles} tileSize={tileSize} scale={3} className="preview-canvas"
                onSelectTile={onEditTile} markedTiles={overriddenTiles} frames={animFrames} active={active} smooth={biome.smooth || false} />
            </div>
            <p className="hint">Click a tile to edit it individually.</p>
            <div className="mini-stats">
              <div className="mini-stat"><b>{tileSize}px</b><span>Tile size</span></div>
              <div className="mini-stat"><b>{cols * rows}</b><span>Tiles</span></div>
              <div className="mini-stat"><b>{savedCount}</b><span>Saved</span></div>
            </div>
          </Section>

          <Section title="Export" icon="download">
            <label className="field-label">Format</label>
            <Segmented
              full
              size="sm"
              value={exportFormat}
              onChange={setExportFormat}
              options={[{ value: '48', label: '48-tile (Blob+Corners)' }, { value: '16', label: '16-tile (Blob)' }]}
            />
            <label className="field-label" style={{ marginTop: 12 }}>Scale</label>
            <Segmented
              full
              size="sm"
              value={exportScale}
              onChange={setExportScale}
              options={[{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]}
            />
            <div className="export-info">
              <span>Output</span>
              <b>{(exportFormat === '16' ? 4 : cols) * tileSize * exportScale} × {(exportFormat === '16' ? 4 : rows) * tileSize * exportScale}px</b>
            </div>
            <Btn variant="primary" icon="download" full style={{ marginTop: 10 }} onClick={handleExport}>Export PNG</Btn>
          </Section>
        </div>
      </aside>
    </div>
  )
}
