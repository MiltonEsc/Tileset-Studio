import { useState } from 'react'
import { generateBaseTileWithAI, processImageToTile, DITHER_OPTIONS } from '../../core/aiTile.js'
import { fileToRgba } from '../../core/imageImport.js'
import { rawToPreview } from '../../core/exportRaw.js'
import { useAIModel } from '../../hooks/useAIModel.js'
import { RawAIPreview } from './RawAIPreview.jsx'

const TEXTURE_PRESETS = [
  { label: 'Frozen cavern',    prompt: 'dark cave rock with patches of snow and ice' },
  { label: 'Desert ruins',     prompt: 'sun-baked sandstone floor with cracks' },
  { label: 'Corrupted forest', prompt: 'muddy forest ground with roots and glowing toxic moss' },
]

// Generates ONE terrain texture from a single prompt (or an imported image),
// then hands it to the tilesheet to compose all 48 autotiles. Borders are
// synthesized from the texture itself (darkened edges), so no second prompt is
// needed — one image becomes a full autotiled set with edges and all.
export function AIProceduralPanel({ tileSize, paletteHint, onGenerated, onRecolor, canRecolor = false }) {
  const [prompt, setPrompt] = useState('')
  const [dither, setDither] = useState(DITHER_OPTIONS[0].value)
  const [preview, setPreview] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [smooth, setSmooth] = useState(false)
  const { model, setModel, loading, error, run, models } = useAIModel()

  // Shared sink for both AI generation and image import. `recolor` decides what
  // the image does to the active template:
  //   • recolor (a procedural form is active): extract only the palette and repaint
  //     the form — keeps the shape (cobble/brick/cracks…), does NOT make a new set.
  //   • replace: compose the 48 autotiles straight from the image (a texture set).
  // edge is always null: generateTilesFromTextures synthesizes the border from the
  // center texture. We keep only the lightweight preview descriptor in state.
  const applyResult = (centerResult, recolor) => {
    setPreview(rawToPreview(centerResult))
    if (recolor && canRecolor && onRecolor) onRecolor(centerResult.pixels)
    else onGenerated(centerResult.pixels, null, { center: centerResult, edge: null })
  }

  // Two explicit actions (mirrors the image-import buttons below):
  //   • recolor=false: compose a full texture tileset from the AI center texture.
  //   • recolor=true: only repaint the active procedural form with the AI palette.
  const handleGenerate = async (recolor = false) => {
    const result = await run(() => generateBaseTileWithAI({
      prompt,
      model,
      tileSize,
      role: 'center',
      paletteHint,
      dither,
    }))
    if (result) applyResult(result, recolor)
  }

  // Import your own image. Two distinct actions:
  //   • recolor=false (default): run the downscale + quantize pipeline and compose a
  //     full texture tileset FROM the image — turns a photo into pixel-art autotiles.
  //   • recolor=true: only extract the image's palette and repaint the active
  //     procedural form, keeping its shape (cobble/brick/cracks…). Separate feature.
  // `smooth` only affects the pixelize step (keep full colour vs. pixel art).
  const handleImport = async (recolor = false) => {
    if (!imageFile) return
    const result = await run(async () => {
      const rgba = await fileToRgba(imageFile)
      return processImageToTile({ ...rgba, tileSize, role: 'center', dither, smooth })
    })
    if (result) applyResult(result, recolor)
  }

  return (
    <div className="ai-panel">
      <div className="panel-label">AI textures</div>
      <div className="ai-hint" style={{ marginTop: 0 }}>
        {canRecolor
          ? 'Generate builds a new autotiled set. Recolor keeps the active shape and only repaints it.'
          : 'Describe one texture; the app builds the full autotiled set.'}
      </div>

      <div className="ai-preset-stack">
        {TEXTURE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="ai-preset-block"
            type="button"
            onClick={() => setPrompt(preset.prompt)}
            disabled={loading}
          >
            <span className="ai-preset-title">{preset.label}</span>
            <span className="ai-preset-copy">{preset.prompt}</span>
          </button>
        ))}
      </div>

      <textarea
        className="ai-prompt"
        rows={3}
        placeholder="e.g. dark cave rock with moss"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        disabled={loading}
      />

      <select className="ai-model" value={model} onChange={e => setModel(e.target.value)} disabled={loading}>
        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <select className="ai-model" value={dither} onChange={e => setDither(e.target.value)} disabled={loading} title="Dithering">
        {DITHER_OPTIONS.map(d => <option key={d.value} value={d.value}>Dither: {d.label}</option>)}
      </select>

      <button className="ai-generate-btn" onClick={() => handleGenerate(false)} disabled={loading || !prompt.trim()}>
        {loading ? 'Generating...' : 'Generate tileset from prompt'}
      </button>
      {canRecolor && (
        <button
          className="ai-generate-btn ai-generate-soft"
          onClick={() => handleGenerate(true)}
          disabled={loading || !prompt.trim()}
          title="Keep the active template's shape (cobblestone, bricks, cracks…) and only repaint it with the AI palette"
        >
          {loading ? 'Generating...' : 'Recolor form with AI'}
        </button>
      )}

      <div className="ai-import">
        <div className="ai-hint" style={{ marginTop: 12 }}>
          Import an image to turn it into a tileset.
        </div>
        <div className="ai-file">
          <span className="ai-file-title">Texture image</span>
          <div className="ai-file-row">
            <label className="ai-file-btn">
              Choose image
              <input type="file" accept="image/*" disabled={loading}
                onChange={e => setImageFile(e.target.files?.[0] || null)} />
            </label>
            <span className="ai-file-name">{imageFile ? imageFile.name : 'No file selected'}</span>
          </div>
        </div>
        <label className="ai-smooth-toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={smooth} disabled={loading}
            onChange={e => setSmooth(e.target.checked)} />
          <span>Smooth (no pixelizing)</span>
        </label>
        {smooth && (
          <div className="ai-hint">Tip: Use 64px Grid for maximum crisp detail.</div>
        )}
        <button className="ai-generate-btn" onClick={() => handleImport(false)} disabled={loading || !imageFile}>
          {loading ? 'Processing...' : 'Generate tileset from image'}
        </button>
        {canRecolor && (
          <>
            <button
              className="ai-generate-btn ai-generate-soft"
              onClick={() => handleImport(true)}
              disabled={loading || !imageFile}
              title="Keep the active template's shape (cobblestone, bricks, cracks…) and only repaint it with the image's palette"
            >
              {loading ? 'Processing...' : 'Recolor form from image'}
            </button>
            <div className="ai-hint">Recolor keeps the active shape, repainting it with the image's colors.</div>
          </>
        )}
      </div>

      {error && <div className="ai-error">{error}</div>}

      <RawAIPreview items={[{ label: 'Texture', preview }]} />
    </div>
  )
}
