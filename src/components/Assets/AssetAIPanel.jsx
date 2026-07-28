import { useState } from 'react'
import { generateAssetWithAI } from '../../core/aiAsset.js'
import { useAIModel } from '../../hooks/useAIModel.js'
import { STORAGE_KEYS } from '../../constants/storageKeys.js'

const QUALITY_OPTIONS = [
  { value: 'low',    label: 'Low',    desc: 'Fastest / cheapest' },
  { value: 'medium', label: 'Medium', desc: 'Balanced' },
  { value: 'high',   label: 'High',   desc: 'Best detail / slower' },
]

const ASSET_PRESETS = [
  'oak tree', 'pine tree', 'palm tree',
  'wooden barrel', 'stone pillar', 'treasure chest',
  'campfire', 'wooden fence', 'stone well',
  'cactus', 'mushroom cluster', 'tent',
  'wooden house', 'stone tower', 'windmill',
  'bush', 'flower patch', 'hay bale',
]

export function AssetAIPanel({ pxW, pxH, onGenerated }) {
  const [prompt, setPrompt] = useState('')
  const { model, setModel, loading, error, run, models } = useAIModel()
  const [quality, setQuality] = useState(() => localStorage.getItem(STORAGE_KEYS.AI_IMAGE_QUALITY) || 'low')

  const handleQualityChange = (v) => { setQuality(v); localStorage.setItem(STORAGE_KEYS.AI_IMAGE_QUALITY, v) }

  const handleGenerate = async () => {
    const pixels = await run(() => generateAssetWithAI({ prompt, model, quality, pxW, pxH }))
    if (pixels) onGenerated(pixels)
  }

  return (
    <div className="ai-panel generator-panel">
      <div className="sidebar-card-title">Asset prompt</div>
      <div className="ai-hint">Generate a transparent prop at {pxW}x{pxH}px. Edit it with the drawing tools after generation.</div>

      <textarea
        className="ai-prompt generator-textarea"
        placeholder="oak tree, wooden barrel, stone tower..."
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={4}
        disabled={loading}
      />

      <div className="preset-chips">
        {ASSET_PRESETS.map(p => (
          <button
            key={p}
            className={`preset-chip ${prompt === p ? 'on' : ''}`}
            onClick={() => setPrompt(p)}
            disabled={loading}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="sidebar-inline-label">
        <span className="brush-label">Model</span>
      </div>
      <select className="ai-model" value={model} onChange={e => setModel(e.target.value)} disabled={loading}>
        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>

      <div className="sidebar-inline-label" style={{ marginTop: 6 }}>
        <span className="brush-label">Quality</span>
        <span className="tool-meta">{QUALITY_OPTIONS.find(q => q.value === quality)?.desc}</span>
      </div>
      <div className="ai-quality-row">
        {QUALITY_OPTIONS.map(q => (
          <button
            key={q.value}
            className={`ai-quality-btn ${quality === q.value ? 'on' : ''}`}
            onClick={() => handleQualityChange(q.value)}
            disabled={loading}
          >
            {q.label}
          </button>
        ))}
      </div>

      <button
        className="ai-generate-btn generator-submit-btn"
        onClick={handleGenerate}
        disabled={loading || !prompt.trim()}
      >
        {loading ? 'Generating...' : 'Generate Asset'}
      </button>

      {error && <div className="ai-error">{error}</div>}
    </div>
  )
}
