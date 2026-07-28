import { useState } from 'react'
import { generateBaseTileWithAI, DITHER_OPTIONS } from '../../core/aiTile.js'
import { rawToPreview } from '../../core/exportRaw.js'
import { useAIModel } from '../../hooks/useAIModel.js'
import { RawAIPreview } from './RawAIPreview.jsx'

const PROMPT_PRESETS = [
  'mossy stone floor with crisp pixel edges',
  'volcanic rock with glowing cracks, pixel art',
  'snowy ground with subtle icy texture, pixel art',
]

export function AITilePanel({ tileSize, paletteHint, onGenerated }) {
  const [prompt, setPrompt] = useState('')
  const [dither, setDither] = useState(DITHER_OPTIONS[0].value)
  const [preview, setPreview] = useState(null)
  const { model, setModel, loading, error, run, models } = useAIModel()

  const handleGenerate = async () => {
    const result = await run(() => generateBaseTileWithAI({
      prompt,
      model,
      tileSize,
      role: 'center',
      paletteHint,
      dither,
    }))
    if (result) {
      setPreview(rawToPreview(result))
      onGenerated(result.pixels, result)
    }
  }

  return (
    <div className="ai-panel generator-panel">
      <div className="sidebar-card-title">Base tile prompt</div>
      <div className="ai-hint" style={{ marginTop: 0 }}>Describe a surface; AI paints one base tile onto the draw canvas.</div>

      <textarea
        className="ai-prompt generator-textarea"
        placeholder="stone brick floor"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={6}
        disabled={loading}
      />

      <div className="ai-preset-row">
        {PROMPT_PRESETS.map((preset) => (
          <button
            key={preset}
            className="ai-preset-chip"
            type="button"
            onClick={() => setPrompt(preset)}
            disabled={loading}
            title={preset}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="sidebar-inline-label">
        <span className="brush-label">Style</span>
      </div>
      <select className="ai-model" value={model} onChange={e => setModel(e.target.value)} disabled={loading}>
        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>

      <div className="sidebar-inline-label">
        <span className="brush-label">Dithering</span>
      </div>
      <select className="ai-model" value={dither} onChange={e => setDither(e.target.value)} disabled={loading}>
        {DITHER_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>

      <button className="ai-generate-btn generator-submit-btn" onClick={handleGenerate} disabled={loading || !prompt.trim()}>
        {loading ? 'Generating...' : 'Generate base tile'}
      </button>

      {error && <div className="ai-error">{error}</div>}

      <RawAIPreview items={[{ label: 'Tile', preview }]} />
    </div>
  )
}
