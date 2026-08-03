import { useCallback, useRef, useState } from 'react'
import { editImageWithAI } from '../../core/aiTile.js'
import { downscaleRgba } from '../../core/imageResize.js'
import { bytesToBase64 } from '../../lib/serialize.js'

const VENDOR_URL = '/vendor/spritecook-tileset-gen/index.html'
const DEFAULT_PROMPT = 'lush fantasy grass with small natural blades, subtle soil details, cohesive top-down pixel art'

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Could not encode the tileset image.')),
    'image/png',
  ))
}

function copyCanvas(source) {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  out.getContext('2d').drawImage(source, 0, 0)
  return out
}

function keyMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const distance = Math.hypot(r - 255, g, b - 255)
    if (distance < 105 || (r > 185 && b > 185 && g < 125)) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0
    } else {
      // Remove a thin magenta spill without changing the painted alpha.
      const spill = Math.max(0, Math.min(r, b) - g)
      if (spill > 20) {
        data[i] = Math.max(g, r - spill * 0.55)
        data[i + 2] = Math.max(g, b - spill * 0.55)
      }
    }
  }
  return data
}

function imageToDefinition({ data, width, height, columns, tileSize, layout, colored, prompt }) {
  const tiles = []
  const preview = document.createElement('canvas')
  preview.width = columns * tileSize
  preview.height = columns * tileSize
  const previewCtx = preview.getContext('2d')

  for (let row = 0; row < columns; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = Math.round(col * width / columns)
      const x1 = Math.round((col + 1) * width / columns)
      const y0 = Math.round(row * height / columns)
      const y1 = Math.round((row + 1) * height / columns)
      const cropW = Math.max(1, x1 - x0)
      const cropH = Math.max(1, y1 - y0)
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
      mode: 'manual-sheet',
      source: 'spritecook-tileset-gen',
      layout,
      autotile: layout === 'topdown-15' ? 'dual-grid-15' : 'cardinal-17',
      columns,
      tileCount: columns * columns,
      sourceTileSize: tileSize,
      tiles,
      ...(colored ? { ai: { provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1024x1024', prompt } } : {}),
    },
    previewUrl: preview.toDataURL('image/png'),
  }
}

export function SpriteCookWorkspace({ onSave, onUseInLevel }) {
  const iframeRef = useRef(null)
  const [name, setName] = useState('SpriteCook tileset')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [prepared, setPrepared] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Adjust the original generator, then capture the base or color it with GPT Image 2.')
  const [error, setError] = useState('')

  const snapshotGenerator = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const preview = doc?.querySelector('#preview')
    if (!doc || !preview) throw new Error('The SpriteCook generator is still loading.')

    const grid = doc.querySelector('#showGrid')
    const white = doc.querySelector('#whiteBackground')
    const upscale = doc.querySelector('#providerSize')
    const previous = { grid: grid.checked, white: white.checked, upscale: upscale.checked }
    grid.checked = false
    white.checked = false
    upscale.checked = false
    grid.dispatchEvent(new Event('input', { bubbles: true }))

    const canvas = copyCanvas(preview)
    const layout = doc.querySelector('#tilesetType').value
    const columns = layout === 'topdown-17' ? 5 : 4
    const activeSize = doc.querySelector('[data-setting="tileSize"] button[aria-pressed="true"]')
    const tileSize = Number(activeSize?.dataset.value) || Math.round(canvas.width / columns)

    grid.checked = previous.grid
    white.checked = previous.white
    upscale.checked = previous.upscale
    grid.dispatchEvent(new Event('input', { bubbles: true }))
    return { canvas, layout, columns, tileSize }
  }, [])

  const captureBase = useCallback(() => {
    setError('')
    try {
      const shot = snapshotGenerator()
      const image = shot.canvas.getContext('2d').getImageData(0, 0, shot.canvas.width, shot.canvas.height)
      const result = imageToDefinition({ ...image, ...shot, colored: false })
      const next = { ...result, tileSize: shot.tileSize, layout: shot.layout }
      setPrepared(next)
      setStatus(`Base captured: ${shot.layout === 'topdown-17' ? 17 : 15}-piece, ${shot.tileSize}px tiles.`)
      return next
    } catch (e) {
      setError(e.message || 'Could not capture the generator output.')
      return null
    }
  }, [snapshotGenerator])

  const colorWithGPT = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const shot = snapshotGenerator()
      const input = document.createElement('canvas')
      input.width = 1024; input.height = 1024
      const ctx = input.getContext('2d')
      ctx.fillStyle = '#ff00ff'
      ctx.fillRect(0, 0, 1024, 1024)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(shot.canvas, 0, 0, 1024, 1024)

      const structurePrompt = [
        `Repaint only the terrain shapes in this exact ${shot.columns} by ${shot.columns} top-down tileset sheet as ${prompt.trim()}.`,
        'Preserve the exact canvas, cell boundaries, tile positions, silhouettes, connectivity, padding, and empty areas from the input.',
        'Keep the flat solid #FF00FF background perfectly unchanged and do not use magenta in the terrain.',
        'Each cell must remain an independent seamless game tile. Crisp top-down pixel art, consistent scale and palette.',
        'Do not add text, labels, borders, grid lines, shadows outside the terrain, perspective, objects, or rearrange any tile.',
      ].join(' ')
      const edited = await editImageWithAI({
        imageBlob: await canvasBlob(input),
        prompt: structurePrompt,
        model: 'gpt-image-2',
        quality: 'low',
        size: '1024x1024',
      })
      const result = imageToDefinition({
        data: edited.data,
        width: edited.width,
        height: edited.height,
        columns: shot.columns,
        tileSize: shot.tileSize,
        layout: shot.layout,
        colored: true,
        prompt: prompt.trim(),
      })
      setPrepared({ ...result, tileSize: shot.tileSize, layout: shot.layout })
      setStatus(`Colored with GPT Image 2 · low · 1024×1024, then sliced to ${shot.tileSize}px tiles.`)
    } catch (e) {
      setError(e.message || 'GPT Image coloring failed.')
    } finally {
      setLoading(false)
    }
  }, [prompt, snapshotGenerator])

  const save = useCallback(async () => {
    const current = prepared || captureBase()
    if (!current) return
    setError('')
    const row = await onSave?.({ name: name.trim() || 'SpriteCook tileset', tileSize: current.tileSize, definition: current.definition })
    setStatus(row ? 'Saved to the tileset library.' : 'The tileset could not be saved. Check cloud storage configuration.')
  }, [captureBase, name, onSave, prepared])

  const useInLevel = useCallback(() => {
    const current = prepared || captureBase()
    if (!current) return
    onUseInLevel?.({
      name: name.trim() || 'SpriteCook tileset',
      tileSize: current.tileSize,
      definition: current.definition,
    })
  }, [captureBase, name, onUseInLevel, prepared])

  return (
    <div className="spritecook-workspace">
      <div className="spritecook-hostbar">
        <div className="spritecook-host-copy">
          <b>SpriteCook Tileset Base Generator</b>
          <span>Original MIT editor, embedded unchanged. GPT coloring is applied as a separate image-edit pass.</span>
        </div>
        <label>
          <span>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} disabled={loading} />
        </label>
        <label className="spritecook-prompt">
          <span>GPT Image color / material prompt</span>
          <input value={prompt} onChange={e => setPrompt(e.target.value)} disabled={loading} />
        </label>
        <div className="spritecook-actions">
          <button onClick={captureBase} disabled={loading}>Capture base</button>
          <button className="primary" onClick={colorWithGPT} disabled={loading || !prompt.trim()}>
            {loading ? 'Coloring…' : 'Color with GPT Image 2 · Low'}
          </button>
          <button onClick={save} disabled={loading}>Save to library</button>
          <button className="primary" onClick={useInLevel} disabled={loading}>Use in level editor</button>
        </div>
        <div className="spritecook-status">{error ? <span className="error">{error}</span> : status}</div>
        {prepared?.previewUrl && <img className="spritecook-result-preview" src={prepared.previewUrl} alt="Prepared tileset preview" />}
      </div>
      <iframe
        ref={iframeRef}
        className="spritecook-frame"
        src={VENDOR_URL}
        title="SpriteCook Tileset Base Generator"
      />
    </div>
  )
}
