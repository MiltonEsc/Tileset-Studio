import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Section } from '../ui/Section.jsx'
import { Btn } from '../ui/Btn.jsx'
import { ColorRow } from '../ui/ColorRow.jsx'
import { Icon } from '../ui/Icon.jsx'
import { AssetCanvas } from './AssetCanvas.jsx'
import { SizeSelector } from './SizeSelector.jsx'
import { AssetGallery } from './AssetGallery.jsx'
import { useAssetEditor } from '../../hooks/useAssetEditor.js'
import { useI18n } from '../../i18n.jsx'

// Loads the Gemini/OpenAI request code only when the Assets view is shown.
const AssetAIPanel = lazy(() => import('./AssetAIPanel.jsx').then(m => ({ default: m.AssetAIPanel })))
import { exportAsset, exportAllAssets } from '../../core/exportAsset.js'

const ATOOLS = [
  { id: 'move',       icon: 'move',   label: 'Move' },
  { id: 'pencil',     icon: 'brush',  label: 'Pencil' },
  { id: 'eraser',     icon: 'eraser', label: 'Eraser' },
  { id: 'fill',       icon: 'bucket', label: 'Fill' },
  { id: 'line',       icon: 'rect',   label: 'Line' },
  { id: 'rect',       icon: 'rect',   label: 'Rect' },
  { id: 'rectFill',   icon: 'rect',   label: 'RectF' },
  { id: 'eyedropper', icon: 'picker', label: 'Pick' },
]
const QUICK_SWATCHES = [
  '#ef6f6f','#e84d4d','#e8902f','#f2c94c','#5fc96a','#3fd6a0',
  '#3fc7d6','#4d8de8','#a06be0','#9aa0a8','#3a3f47','#f4f6f8',
]

const MIN_ZOOM = 1
const MAX_ZOOM = 32

function fitZoom(pxW, pxH) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(340 / Math.max(pxW, pxH))))
}

export function AssetsView({ tileSize, gallery, active = true }) {
  const { t } = useI18n()
  const [cols, setCols] = useState(2)
  const [rows, setRows] = useState(2)
  const [workTileSize, setWorkTileSize] = useState(tileSize)
  const [name, setName] = useState('prop')
  const [solidThreshold, setSolidThreshold] = useState(128)
  const [zoom, setZoom] = useState(() => fitZoom(2 * tileSize, 2 * tileSize))

  const pxW = cols * workTileSize
  const pxH = rows * workTileSize
  const editor = useAssetEditor(pxW, pxH)

  useEffect(() => {
    setWorkTileSize(tileSize)
    editor.resetCanvas(cols * tileSize, rows * tileSize)
    setZoom(fitZoom(cols * tileSize, rows * tileSize))
  }, [tileSize]) // eslint-disable-line

  const handleSizeChange = useCallback((c, r) => {
    setCols(c); setRows(r)
    editor.resetCanvas(c * workTileSize, r * workTileSize)
    setZoom(fitZoom(c * workTileSize, r * workTileSize))
  }, [editor, workTileSize])

  const handleGenerated = useCallback((pixels) => {
    editor.loadPixels(pixels, pxW, pxH)
    editor.applySolidify(solidThreshold, true)
  }, [editor, pxW, pxH, solidThreshold])

  const handleSolidPreview = useCallback((v) => { setSolidThreshold(v); editor.applySolidify(v, false) }, [editor])
  const handleSolidCommit  = useCallback(() => { editor.applySolidify(solidThreshold, true) }, [editor, solidThreshold])

  const handleSave = useCallback(() => {
    gallery.add({ name, cols, rows, tileSize: workTileSize, pixels: editor.getPixels() })
  }, [gallery, name, cols, rows, workTileSize, editor])

  const handleLoadToEditor = useCallback((asset) => {
    setCols(asset.cols); setRows(asset.rows); setWorkTileSize(asset.tileSize); setName(asset.name)
    editor.loadPixels(asset.pixels, asset.cols * asset.tileSize, asset.rows * asset.tileSize)
    setZoom(fitZoom(asset.cols * asset.tileSize, asset.rows * asset.tileSize))
  }, [editor])

  const changeZoom = useCallback((delta) => {
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)))
  }, [])

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y (ignored while typing in a field, so
  // the name input keeps its native text undo). Only while the Assets view is
  // active — it stays mounted (hidden) when in the tileset/level view, and a live
  // listener there would hijack Ctrl+Z from those editors.
  useEffect(() => {
    if (!active) return
    const handleKey = (e) => {
      if (!e.ctrlKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if (e.key === 'z') { e.preventDefault(); editor.undo() }
      if (e.key === 'y') { e.preventDefault(); editor.redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, editor])

  return (
    <div className="editor-grid">
      {/* LEFT */}
      <aside className="panel">
        <div className="panel-scroll">
          <Section title={t('tools')} icon="brush">
            <div className="tool-grid">
              {ATOOLS.map(t => (
                <button key={t.id} className={`tool-btn ${editor.tool === t.id ? 'on' : ''}`} onClick={() => editor.setTool(t.id)} title={t.label}>
                  <Icon name={t.icon} size={19} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="asset-brush-row">
              <label className="field-label" style={{ margin: 0 }}>{t('brushSize')}</label>
              <span className="asset-pp-value">{editor.brush}px</span>
            </div>
            <input
              type="range" min="1" max={Math.max(8, Math.floor(Math.max(pxW, pxH) / 4))}
              value={editor.brush} onChange={e => editor.setBrush(+e.target.value)}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
            <div className="row-btns">
              <Btn size="sm" variant="outline" icon="undo" full onClick={editor.undo} disabled={!editor.canUndo}>{t('undo')}</Btn>
              <Btn size="sm" variant="outline" icon="redo" full onClick={editor.redo} disabled={!editor.canRedo}>{t('redo')}</Btn>
            </div>
          </Section>

          <Section title={t('color')} icon="brush">
            <ColorRow label="Active" value={editor.activeColor} onChange={editor.setActiveColor} />
            <div className="swatch-grid">
              {QUICK_SWATCHES.map(c => (
                <button key={c} className={`swatch ${editor.activeColor === c ? 'active' : ''}`}
                  style={{ background: c }} onClick={() => editor.setActiveColor(c)} />
              ))}
            </div>
          </Section>

          <Section title={t('assetSize')} icon="grid">
            <SizeSelector cols={cols} rows={rows} tileSize={workTileSize} onChange={handleSizeChange} />
          </Section>

          <Section title={t('generateAI')} icon="spark">
            <Suspense fallback={<div className="ai-hint">Loading AI…</div>}>
              <AssetAIPanel pxW={pxW} pxH={pxH} onGenerated={handleGenerated} />
            </Suspense>
          </Section>
        </div>
      </aside>

      {/* CENTER */}
      <main className="stage">
        <div className="stage-toolbar">
          <span className="tool-active">
            <Icon name="brush" size={16} /> {pxW}×{pxH}px · {cols}×{rows}
          </span>
          <div className="spacer" />
          <div className="zoom-ctrl">
            <button onClick={() => changeZoom(-1)} disabled={zoom <= MIN_ZOOM} title="Zoom out">−</button>
            <span>{zoom}x</span>
            <button onClick={() => changeZoom(1)} disabled={zoom >= MAX_ZOOM} title="Zoom in">+</button>
            <button onClick={() => setZoom(fitZoom(pxW, pxH))} title="Fit to stage" style={{ fontSize: 10, padding: '0 6px' }}>Fit</button>
          </div>
          <input className="text-input asset-name-input" value={name} onChange={e => setName(e.target.value)} placeholder="Prop name" />
        </div>

        <div className="stage-canvas" style={{ overflow: 'auto', alignItems: 'flex-start' }}>
          <div className="asset-edit-block" style={{ margin: 'auto', paddingBottom: 16 }}>
            <AssetCanvas
              pixels={editor.pixels} width={pxW} height={pxH} zoom={zoom}
              tool={editor.tool}
              onStartStroke={editor.startStroke}
              onContinueStroke={editor.continueStroke}
              onEndStroke={editor.endStroke}
              onStartErase={editor.startErase}
              onContinueErase={editor.continueErase}
              onZoomChange={changeZoom}
            />
            <div className="asset-postprocess">
              <div className="asset-pp-label">Edge solidity</div>
              <div className="asset-pp-row">
                <input type="range" min="1" max="255" value={solidThreshold}
                  onChange={e => handleSolidPreview(+e.target.value)}
                  onPointerUp={handleSolidCommit} onKeyUp={handleSolidCommit} />
                <span className="asset-pp-value">{solidThreshold}</span>
                <Btn size="sm" variant="outline" onClick={handleSolidCommit}>Solidify</Btn>
              </div>
              <div className="asset-pp-hint">Slide to adjust edge transparency. Right-click on canvas to erase.</div>
            </div>
          </div>
        </div>

        <div className="stage-actions">
          <Btn variant="danger" icon="trash" onClick={editor.clear}>{t('clear')}</Btn>
          <Btn variant="primary" size="lg" icon="save" onClick={handleSave}>{t('saveGallery')}</Btn>
        </div>
      </main>

      {/* RIGHT */}
      <aside className="panel">
        <div className="panel-scroll" style={{ padding: 0 }}>
          <AssetGallery
            assets={gallery.assets} selectedId={gallery.selectedId}
            onSelect={gallery.select} onRemove={gallery.remove}
            onExport={(a) => exportAsset(a)} onExportAll={() => exportAllAssets(gallery.assets)}
            onLoadToEditor={handleLoadToEditor}
            loading={gallery.loading} error={gallery.error}
          />
        </div>
      </aside>
    </div>
  )
}
