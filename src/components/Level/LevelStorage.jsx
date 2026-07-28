import { useState } from 'react'

// Save the current level to the cloud and load/delete saved ones.
export function LevelStorage({ levels, onSave, onLoad, onRemove }) {
  const [name, setName] = useState('')

  const handleSave = () => {
    onSave(name.trim() || 'level')
    setName('')
  }

  return (
    <div className="level-section level-storage">
      <div className="level-section-label">Saved levels ({levels.length})</div>
      <div className="level-save-row">
        <input
          className="level-name-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="level name"
        />
        <button className="level-save-btn" onClick={handleSave} title="Save current level">Save</button>
      </div>
      {levels.length > 0 && (
        <div className="level-list">
          {levels.map(l => (
            <div key={l.id} className="level-list-item">
              <button className="level-list-load" onClick={() => onLoad(l)} title={`Load ${l.name} (${l.width}×${l.height})`}>
                {l.name} <span className="level-list-dim">{l.width}×{l.height}</span>
              </button>
              <button className="level-list-del" onClick={() => onRemove(l.id)} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
