import { useState } from 'react'

const SIZES = [8, 16, 32, 64]

// Startup "New Project" dialog: pick the working tile size (grid) — and a name —
// before generating, so the (expensive at 128/256 px) tileset regen happens once
// up front instead of on every header toggle. The header GRID selector stays
// available, so the size can still be changed later.
export function ProjectModal({ initialName = 'Untitled', initialSize = 32, onConfirm }) {
  const [name, setName] = useState(initialName)
  const [size, setSize] = useState(initialSize)

  return (
    <div className="project-modal-overlay">
      <div className="project-modal">
        <div className="project-modal-title">New Project</div>

        <label className="project-field">
          <span className="project-field-label">Name</span>
          <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="Untitled" />
        </label>

        <div className="project-field">
          <span className="project-field-label">Tile size (grid)</span>
          <div className="project-size-grid">
            {SIZES.map(s => (
              <button
                key={s}
                type="button"
                className={`project-size-btn ${size === s ? 'on' : ''}`}
                onClick={() => setSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="project-hint">Tamaños de grid soportados: 8px, 16px, 32px y 64px. Puedes cambiarlo luego desde la barra superior.</div>
        </div>

        <div className="project-modal-actions">
          <button className="ai-generate-btn" onClick={() => onConfirm({ name: name.trim() || 'Untitled', size })}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
