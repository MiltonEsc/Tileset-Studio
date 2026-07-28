import { useState } from 'react'
import { Btn } from '../ui/Btn.jsx'
import { GridThumb } from './GridThumb.jsx'
import {
  GENERATORS, GENERATOR_PARAMS, defaultParams, sanitizeParams, randomSeed,
} from '../../core/levelGenerator.js'

const VARIATION_COUNT = 6

export function GeneratePanel({ level, onSurprise }) {
  const [genType, setGenType] = useState('caves')
  const [params, setParams] = useState(() => defaultParams('caves'))
  const [seed, setSeed] = useState(() => randomSeed())
  const [seedLocked, setSeedLocked] = useState(false)
  const [variations, setVariations] = useState(null)

  const specs = GENERATOR_PARAMS[genType] || []

  // Each apply is one level.generate call → one undo entry. Sliders only stage
  // params; nothing regenerates until an explicit action.
  const apply = (type, p, s) => {
    level.generate(type, { ...sanitizeParams(type, p), seed: s })
    setVariations(null)
  }

  const nextSeed = () => (seedLocked ? seed : randomSeed())

  const selectGenerator = (key) => {
    const p = defaultParams(key)
    const s = nextSeed()
    setGenType(key)
    setParams(p)
    setSeed(s)
    apply(key, p, s)
  }

  const regenerate = () => {
    const s = nextSeed()
    setSeed(s)
    apply(genType, params, s)
  }

  const setParam = (key, value) => setParams(prev => ({ ...prev, [key]: value }))

  const showVariations = () => {
    const w = level.width, h = level.height
    const base = sanitizeParams(genType, params)
    setVariations(Array.from({ length: VARIATION_COUNT }, () => {
      const s = randomSeed()
      return { seed: s, w, h, grid: GENERATORS[genType].fn(w, h, { ...base, seed: s }) }
    }))
  }

  const applyVariation = (v) => {
    setSeed(v.seed)
    apply(genType, params, v.seed)
  }

  return (
    <div className="gen-panel">
      <div className="tool-grid">
        {Object.entries(GENERATORS).map(([key, g]) => (
          <button
            key={key}
            className={`tool-btn ${genType === key ? 'on' : ''}`}
            onClick={() => selectGenerator(key)}
            title={g.label || key}
          >
            <span>{g.label || key}</span>
          </button>
        ))}
      </div>

      {specs.length > 0 && (
        <div className="gen-params">
          {specs.map(s => (
            <label key={s.key} className="gen-param">
              <span className="gen-param-head">
                <span className="brush-label">{s.label}</span>
                <span className="tool-meta">{s.step < 1 ? params[s.key].toFixed(2) : params[s.key]}</span>
              </span>
              <input
                type="range"
                min={s.min} max={s.max} step={s.step}
                value={params[s.key]}
                onChange={e => setParam(s.key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="gen-seed">
        <span className="brush-label">Seed</span>
        <input
          className="text-input gen-seed-input"
          type="number"
          value={seed}
          onChange={e => setSeed(Number(e.target.value) >>> 0)}
        />
        <button className="gen-mini-btn" title="New random seed" onClick={() => setSeed(randomSeed())}>New</button>
        <button
          className={`gen-mini-btn ${seedLocked ? 'on' : ''}`}
          title={seedLocked ? 'Seed locked' : 'Lock seed'}
          onClick={() => setSeedLocked(v => !v)}
        >
          {seedLocked ? 'Locked' : 'Lock'}
        </button>
      </div>

      <div className="row-btns">
        <Btn size="sm" variant="primary" icon="spark" full onClick={regenerate}>Generate</Btn>
        <Btn size="sm" variant="outline" icon="grid" full onClick={showVariations}>Variations</Btn>
      </div>

      {variations && (
        <div className="gen-variations">
          {variations.map((v, i) => (
            <button key={i} className="gen-variation" title={`Seed ${v.seed}`} onClick={() => applyVariation(v)}>
              <GridThumb grid={v.grid} width={v.w} height={v.h} />
            </button>
          ))}
        </div>
      )}

      <div className="row-btns">
        <Btn size="sm" variant="accentSoft" icon="dice" full onClick={onSurprise}>Surprise</Btn>
      </div>
      <div className="row-btns">
        <Btn size="sm" variant="outline" icon="grid" full onClick={level.fillAll}>Fill</Btn>
        <Btn size="sm" variant="danger" icon="trash" full onClick={level.clear}>Clear</Btn>
      </div>
    </div>
  )
}
