// Pixel icon: draws from a string grid. '#'=fill, '.'=empty. Crisp, scalable.
export function PixIcon({ grid, color = 'currentColor', px = 2, style }) {
  if (!grid) return null
  const rows = grid.trim().split('\n').map((r) => r.trim())
  const h = rows.length, w = rows[0].length
  return (
    <span
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${w}, ${px}px)`,
        gridAutoRows: `${px}px`,
        lineHeight: 0,
        ...style,
      }}
      aria-hidden="true"
    >
      {rows.flatMap((r, y) => r.split('').map((c, x) => (
        <span key={y + '-' + x} style={{ width: px, height: px, background: c === '#' ? color : 'transparent' }} />
      )))}
    </span>
  )
}
