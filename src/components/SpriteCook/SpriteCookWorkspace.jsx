import { useCallback, useEffect, useRef, useState } from 'react'
import { editImageWithAI } from '../../core/aiTile.js'
import { downscaleRgba } from '../../core/imageResize.js'
import {
  renderSpriteCookSheet,
  scaleSpriteCookCanvas,
  spriteCookSheetInfo,
  SPRITECOOK_DEFAULTS,
} from '../../core/spriteCookBaseGenerator.js'
import { spriteCookLayoutInfo } from '../../core/spriteCookLayout.js'
import { bytesToBase64 } from '../../lib/serialize.js'
import { Btn } from '../ui/Btn.jsx'
import { ColorRow } from '../ui/ColorRow.jsx'
import { Section } from '../ui/Section.jsx'
import { Segmented } from '../ui/Segmented.jsx'

const DEFAULT_PROMPT = 'lush fantasy grass with small natural blades, subtle soil details, cohesive top-down pixel art'
const COLOR_PRESETS = [
  ['#73ad38', '#2f662d'], ['#8a8f8b', '#565b5f'], ['#a67844', '#5a3f2c'],
  ['#447d9a', '#244a62'], ['#c6b376', '#796537'],
]

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Could not encode the tileset image.')),
    'image/png',
  ))
}

function keyMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const distance = Math.hypot(r - 255, g, b - 255)
    if (distance < 105 || (r > 185 && b > 185 && g < 125)) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0
    } else {
      const spill = Math.max(0, Math.min(r, b) - g)
      if (spill > 20) {
        data[i] = Math.max(g, r - spill * 0.55)
        data[i + 2] = Math.max(g, b - spill * 0.55)
      }
    }
  }
  return data
}

function imageToDefinition({ data, width, height, columns, rows, tileSize, layout, colored, prompt }) {
  const tiles = []
  const preview = document.createElement('canvas')
  preview.width = columns * tileSize
  preview.height = rows * tileSize
  const previewCtx = preview.getContext('2d')

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = Math.round(col * width / columns), x1 = Math.round((col + 1) * width / columns)
      const y0 = Math.round(row * height / rows), y1 = Math.round((row + 1) * height / rows)
      const cropW = Math.max(1, x1 - x0), cropH = Math.max(1, y1 - y0)
      const crop = new Uint8ClampedArray(cropW * cropH * 4)
      for (let y = 0; y < cropH; y++) {
        const start = ((y0 + y) * width + x0) * 4
        crop.set(data.subarray(start, start + cropW * 4), y * cropW * 4)
      }
      const pixels = downscaleRgba(crop, cropW, cropH, tileSize, tileSize)
      if (colored) keyMagenta(pixels)
      tiles.push(bytesToBase64(pixels))
      previewCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), tileSize, tileSize), col * tileSize, row * tileSize)
    }
  }

  return {
    definition: {
      mode: 'manual-sheet', source: 'spritecook-tileset-gen', layout,
      autotile: spriteCookLayoutInfo(layout).autotile,
      columns, rows, tileCount: columns * rows, sourceTileSize: tileSize, tiles,
      ...(colored ? { ai: { provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1024x1024', prompt } } : {}),
    },
    previewUrl: preview.toDataURL('image/png'),
  }
}

function RangeField({ label, value, min, max, step = 1, onChange, hint }) {
  return (
    <label className="spritecook-field spritecook-range-field">
      <span>{label}<output>{value}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="spritecook-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function SpriteCookWorkspace({ onSave, onUseInLevel }) {
  const canvasRef = useRef(null)
  const renderedRef = useRef(null)
  const [settings, setSettings] = useState(() => ({ ...SPRITECOOK_DEFAULTS }))
  const [name, setName] = useState('SpriteCook tileset')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [prepared, setPrepared] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Adjust the native generator, then capture the base or color it with GPT Image 2.')
  const [error, setError] = useState('')

  const info = spriteCookSheetInfo(settings.layout, settings.tileSize, settings.showGrid)
  const update = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setPrepared(null)
    setError('')
  }, [])

  useEffect(() => {
    const rendered = renderSpriteCookSheet(settings)
    renderedRef.current = rendered
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = rendered.width; canvas.height = rendered.height
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(rendered, 0, 0)
  }, [settings])

  const snapshotGenerator = useCallback(() => {
    const layoutInfo = spriteCookLayoutInfo(settings.layout)
    const canvas = renderSpriteCookSheet({ ...settings, showGrid: false, whiteBackground: false, providerSize: false })
    return { canvas, layout: settings.layout, columns: layoutInfo.columns, rows: layoutInfo.rows, tileSize: settings.tileSize }
  }, [settings])

  const captureBase = useCallback(() => {
    setError('')
    try {
      const shot = snapshotGenerator()
      const image = shot.canvas.getContext('2d').getImageData(0, 0, shot.canvas.width, shot.canvas.height)
      const result = imageToDefinition({ ...image, ...shot, colored: false })
      const next = { ...result, tileSize: shot.tileSize, layout: shot.layout }
      setPrepared(next)
      setStatus(`Base captured: ${spriteCookLayoutInfo(shot.layout).pieceLabel}, ${shot.tileSize}px tiles.`)
      return next
    } catch (e) {
      setError(e.message || 'Could not capture the generator output.')
      return null
    }
  }, [snapshotGenerator])

  const colorWithGPT = useCallback(async () => {
    setError(''); setLoading(true)
    try {
      const shot = snapshotGenerator()
      const input = document.createElement('canvas'); input.width = 1024; input.height = 1024
      const ctx = input.getContext('2d'); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 1024, 1024); ctx.imageSmoothingEnabled = false
      ctx.drawImage(shot.canvas, 0, 0, 1024, 1024)
      const structurePrompt = [
        `Repaint only the terrain shapes in this exact ${shot.columns} by ${shot.rows} top-down tileset sheet as ${prompt.trim()}.`,
        'Preserve the exact canvas, cell boundaries, tile positions, silhouettes, connectivity, padding, and empty areas from the input.',
        'Keep the flat solid #FF00FF background perfectly unchanged and do not use magenta in the terrain.',
        'Each cell must remain an independent seamless game tile. Crisp top-down pixel art, consistent scale and palette.',
        'Do not add text, labels, borders, grid lines, shadows outside the terrain, perspective, objects, or rearrange any tile.',
      ].join(' ')
      const edited = await editImageWithAI({ imageBlob: await canvasBlob(input), prompt: structurePrompt, model: 'gpt-image-2', quality: 'low', size: '1024x1024' })
      const result = imageToDefinition({ data: edited.data, width: edited.width, height: edited.height, columns: shot.columns, rows: shot.rows, tileSize: shot.tileSize, layout: shot.layout, colored: true, prompt: prompt.trim() })
      setPrepared({ ...result, tileSize: shot.tileSize, layout: shot.layout })
      setStatus(`Colored with GPT Image 2 · low · 1024×1024, then sliced to ${shot.tileSize}px tiles.`)
    } catch (e) { setError(e.message || 'GPT Image coloring failed.') }
    finally { setLoading(false) }
  }, [prompt, snapshotGenerator])

  const save = useCallback(async () => {
    const current = prepared || captureBase(); if (!current) return
    setError('')
    const row = await onSave?.({ name: name.trim() || 'SpriteCook tileset', tileSize: current.tileSize, definition: current.definition })
    setStatus(row ? 'Saved to the tileset library.' : 'The tileset could not be saved. Check cloud storage configuration.')
  }, [captureBase, name, onSave, prepared])

  const useInLevel = useCallback(() => {
    const current = prepared || captureBase(); if (!current) return
    onUseInLevel?.({ name: name.trim() || 'SpriteCook tileset', tileSize: current.tileSize, definition: current.definition })
  }, [captureBase, name, onUseInLevel, prepared])

  const download = useCallback(() => {
    let canvas = renderSpriteCookSheet(settings)
    if (settings.providerSize) canvas = scaleSpriteCookCanvas(canvas, 1024, 1024)
    const link = document.createElement('a')
    link.download = `tileset-base-${settings.layout}-${settings.tileSize}px-${canvas.width}x${canvas.height}-seed-${settings.seed}.png`
    link.href = canvas.toDataURL('image/png'); link.click()
  }, [settings])

  const changeLayout = value => {
    setSettings(prev => ({ ...prev, layout: value, showGrid: value === 'topdown-15' ? prev.showGrid : true }))
    setPrepared(null); setError('')
  }
  const layoutDescription = settings.layout === 'platform-47'
    ? 'Index 0 empty + Blob-47 masks in Tileset Studio order'
    : settings.layout === 'topdown-17' ? 'Single, vertical, horizontal, island and inner-corner pieces' : 'Dual-grid 15-piece corner-mask layout'

  return (
    <div className="spritecook-native-workspace">
      <aside className="panel spritecook-native-sidebar">
        <div className="spritecook-native-brand">
          <span>BASE GEN</span><b>SpriteCook Generator</b><small>Native Tileset Studio integration</small>
        </div>
        <div className="panel-scroll">
          <Section title="Geometry" icon="grid">
            <label className="field-label">Tileset layout</label>
            <select className="text-input" value={settings.layout} onChange={e => changeLayout(e.target.value)}>
              <option value="topdown-15">15-piece · 4×4</option>
              <option value="topdown-17">17-piece · 5×5</option>
              <option value="platform-47">Platform 47+1 · 8×6</option>
            </select>
            <label className="field-label spritecook-field-gap">Tile size</label>
            <Segmented full size="sm" value={settings.tileSize} onChange={v => update('tileSize', v)} options={[16, 32, 64]} />
            <RangeField label="Corner radius" min={0} max={18} value={settings.cornerRadius} onChange={v => update('cornerRadius', v)} />
            {(settings.layout === 'topdown-17' || settings.layout === 'platform-47') && <RangeField label="Tile padding" min={1} max={6} value={settings.edgePadding} onChange={v => update('edgePadding', v)} hint="Distance from an open tile edge" />}
            <label className="field-label spritecook-field-gap">Edge style</label>
            <Segmented full size="sm" value={settings.edgeStyle} onChange={v => update('edgeStyle', v)} options={[{ value: 'rough', label: 'Rough' }, { value: 'clean', label: 'Clean' }]} />
            <RangeField label="Edge noise" min={0} max={14} value={settings.edgeRoughness} onChange={v => update('edgeRoughness', v)} />
            <RangeField label="Noise size" min={2} max={14} value={settings.edgeFrequency} onChange={v => update('edgeFrequency', v)} />
            <Toggle label="Elevation edge" checked={settings.elevationEdge} onChange={v => update('elevationEdge', v)} />
            {settings.elevationEdge && <RangeField label="Elevation depth" min={1} max={16} value={settings.elevationDepth} onChange={v => update('elevationDepth', v)} hint="Vertical face below exposed terrain edges" />}
          </Section>
          <Section title="Color & texture" icon="brush">
            <ColorRow label="Base color" value={settings.baseColor} onChange={v => update('baseColor', v)} />
            <ColorRow label="Edge color" value={settings.edgeColor} onChange={v => update('edgeColor', v)} />
            <RangeField label="Shades" min={2} max={8} value={settings.shades} onChange={v => update('shades', v)} />
            <RangeField label="Edge fade" min={0} max={12} value={settings.edgeFade} onChange={v => update('edgeFade', v)} />
            <RangeField label="Texture noise" min={0} max={42} value={settings.textureNoise} onChange={v => update('textureNoise', v)} />
            <RangeField label="Flecks" min={0} max={24} value={settings.fleckAmount} onChange={v => update('fleckAmount', v)} />
            <label className="field-label spritecook-field-gap">Presets</label>
            <div className="spritecook-color-presets">
              {COLOR_PRESETS.map(([base, edge]) => <button key={base} style={{ '--preset-base': base, '--preset-edge': edge }} onClick={() => { setSettings(prev => ({ ...prev, baseColor: base, edgeColor: edge })); setPrepared(null) }} title={`${base} / ${edge}`} />)}
            </div>
          </Section>
          <Section title="Output" icon="download">
            <label className="spritecook-field"><span>Seed</span><input className="text-input" type="number" min="1" max="999999" value={settings.seed} onChange={e => update('seed', Number(e.target.value) || 1)} /></label>
            <div className="spritecook-toggle-grid">
              <Toggle label="White background" checked={settings.whiteBackground} onChange={v => update('whiteBackground', v)} />
              <Toggle label="Black grid" checked={settings.showGrid} onChange={v => update('showGrid', v)} />
              <Toggle label="1024 upscale" checked={settings.providerSize} onChange={v => update('providerSize', v)} />
              <Toggle label="Pixel clusters" checked={settings.pixelFlecks} onChange={v => update('pixelFlecks', v)} />
            </div>
            <div className="row-btns spritecook-output-actions">
              <Btn size="sm" variant="outline" icon="dice" full onClick={() => update('seed', Math.floor(1 + Math.random() * 999999))}>New seed</Btn>
              <Btn size="sm" variant="solid" icon="download" full onClick={download}>Download PNG</Btn>
            </div>
          </Section>
        </div>
      </aside>

      <main className="spritecook-native-stage">
        <div className="spritecook-native-toolbar">
          <div><b>{info.pieceLabel}</b><span>{settings.tileSize}px tiles · {info.width}×{info.height}px native{settings.providerSize ? ' · export 1024' : ''}</span></div>
          <span>{layoutDescription}</span>
        </div>
        <div className="spritecook-native-canvas-wrap"><canvas ref={canvasRef} className="spritecook-native-canvas" /></div>
        <div className="spritecook-native-credit">
          <span>SpriteCook MIT generator · Native Tileset Studio UI</span>
          <a href="https://github.com/SpriteCook/spritecook-tileset-gen" target="_blank" rel="noreferrer">Source</a>
          <a href="https://www.spritecook.ai" target="_blank" rel="noreferrer">SpriteCook</a>
        </div>
      </main>

      <aside className="panel spritecook-native-integration">
        <div className="spritecook-native-brand">
          <span>PIPELINE</span><b>Prepare & publish</b><small>Capture, color, save and paint</small>
        </div>
        <div className="panel-scroll">
          <Section title="Tileset identity" icon="image">
            <label className="spritecook-field"><span>Name</span><input className="text-input" value={name} onChange={e => setName(e.target.value)} disabled={loading} /></label>
            <label className="spritecook-field"><span>GPT material prompt</span><textarea className="text-input spritecook-prompt-area" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={loading} /></label>
          </Section>
          <Section title="Generation pipeline" icon="spark">
            <div className="spritecook-pipeline-actions">
              <Btn variant="outline" icon="grid" full onClick={captureBase} disabled={loading}>Capture base</Btn>
              <Btn variant="primary" icon="spark" full onClick={colorWithGPT} disabled={loading || !prompt.trim()}>{loading ? 'Coloring…' : 'Color with GPT Image 2 · Low'}</Btn>
              <Btn variant="solid" icon="save" full onClick={save} disabled={loading}>Save to library</Btn>
              <Btn variant="accentSoft" icon="layers" full onClick={useInLevel} disabled={loading}>Use in level editor</Btn>
            </div>
          </Section>
          <Section title="Prepared result" icon="image">
            <div className={`spritecook-prepared-card ${prepared ? 'ready' : ''}`}>
              {prepared?.previewUrl ? <img src={prepared.previewUrl} alt="Prepared tileset preview" /> : <div className="spritecook-prepared-empty">No captured result yet</div>}
              <div><b>{prepared ? spriteCookLayoutInfo(prepared.layout).pieceLabel : 'Waiting for capture'}</b><span>{prepared ? `${prepared.tileSize}px · ${prepared.definition.tileCount} cells` : 'Adjust the controls, then capture or color.'}</span></div>
            </div>
            <div className="spritecook-status">{error ? <span className="error">{error}</span> : status}</div>
          </Section>
          <Section title="What is preserved" icon="layers" defaultOpen={false}>
            <ul className="spritecook-feature-list">
              <li>Exact tile silhouettes and connectivity</li><li>Transparent empty cells</li><li>Native pixel dimensions</li><li>Blob-47 editor ordering</li><li>AI metadata and source layout</li>
            </ul>
          </Section>
        </div>
      </aside>
    </div>
  )
}
