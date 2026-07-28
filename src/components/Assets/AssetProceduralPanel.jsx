import { useState } from 'react'
import { Btn } from '../ui/Btn.jsx'
import { ColorRow } from '../ui/ColorRow.jsx'
import { PROP_TYPES, defaultPropParams, generateProp } from '../../core/proceduralProps.js'

const TYPE_BY_KEY = Object.fromEntries(PROP_TYPES.map(t => [t.key, t]))

// Parametric prop generator (no AI): pick a type, tune params + 3 colours, and
// the shape is drawn into the asset editor (editable + saveable like any prop).
export function AssetProceduralPanel({ pxW, pxH, onGenerated }) {
  const [type, setType] = useState(PROP_TYPES[0].key)
  const [params, setParams] = useState(() => defaultPropParams(PROP_TYPES[0].key))
  const [colors, setColors] = useState(() => ({ ...PROP_TYPES[0].colors }))

  const spec = TYPE_BY_KEY[type]

  const selectType = (key) => {
    setType(key)
    setParams(defaultPropParams(key))
    setColors({ ...TYPE_BY_KEY[key].colors })
  }
  const setParam = (k, v) => setParams(prev => ({ ...prev, [k]: v }))
  const setColor = (k, v) => setColors(prev => ({ ...prev, [k]: v }))

  const handleGenerate = () => onGenerated(generateProp(type, pxW, pxH, colors, params))

  return (
    <div className="gen-panel">
      <div className="ai-hint">Generate a structural prop ({pxW}x{pxH}px) — edit it with the drawing tools afterwards.</div>

      <div className="tool-grid">
        {PROP_TYPES.map(t => (
          <button key={t.key} className={`tool-btn ${type === t.key ? 'on' : ''}`} onClick={() => selectType(t.key)} title={t.label}>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="gen-params">
        {spec.params.map(s => {
          const isToggle = s.min === 0 && s.max === 1 && s.step === 1
          return isToggle ? (
            <label key={s.key} className="lib-card-foot" style={{ padding: '4px 0', cursor: 'pointer' }}>
              <span className="layer-name">{s.label}</span>
              <input type="checkbox" checked={!!params[s.key]} onChange={e => setParam(s.key, e.target.checked ? 1 : 0)} />
            </label>
          ) : (
            <label key={s.key} className="gen-param">
              <span className="gen-param-head">
                <span className="brush-label">{s.label}</span>
                <span className="tool-meta">{params[s.key]}</span>
              </span>
              <input
                type="range"
                min={s.min} max={s.max} step={s.step}
                value={params[s.key]}
                onChange={e => setParam(s.key, Number(e.target.value))}
              />
            </label>
          )
        })}
      </div>

      <div className="sidebar-inline-label"><span className="brush-label">Colors</span></div>
      <ColorRow label="Main" value={colors.main} onChange={v => setColor('main', v)} />
      <ColorRow label="Dark" value={colors.dark} onChange={v => setColor('dark', v)} />
      <ColorRow label="Light" value={colors.light} onChange={v => setColor('light', v)} />

      <Btn variant="primary" size="lg" icon="grid" full style={{ marginTop: 10 }} onClick={handleGenerate}>
        Generate prop
      </Btn>
    </div>
  )
}
