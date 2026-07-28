const OPTIONS = [1, 2, 3, 4]

export function SizeSelector({ cols, rows, onChange, tileSize }) {
  return (
    <div className="sidebar-card size-selector generator-panel">
      <div className="sidebar-card-title">Asset size</div>
      <div className="size-selector-note">Choose the footprint in tiles for the generated asset.</div>

      <div className="size-selector-row">
        <div className="size-selector-group">
          <span className="size-selector-axis">Width</span>
          {OPTIONS.map((n) => (
            <button
              key={n}
              className={`size-cell-btn ${cols === n ? 'active' : ''}`}
              onClick={() => onChange(n, rows)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="size-selector-group">
          <span className="size-selector-axis">Height</span>
          {OPTIONS.map((n) => (
            <button
              key={n}
              className={`size-cell-btn ${rows === n ? 'active' : ''}`}
              onClick={() => onChange(cols, n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="size-selector-info">{cols * tileSize} x {rows * tileSize} px</div>
    </div>
  )
}
