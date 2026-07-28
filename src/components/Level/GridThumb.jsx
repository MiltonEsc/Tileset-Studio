import { useEffect, useRef } from 'react'

// Paints a generated grid (0/1) as a tiny solid/empty thumbnail — a fast shape
// preview (not a full autotile render), enough to pick a variation or idea.
export function GridThumb({ grid, width, height, color = '#2fd6a6' }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = width
    cv.height = height
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = color
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y * width + x]) ctx.fillRect(x, y, 1, 1)
      }
    }
  }, [grid, width, height, color])
  return <canvas ref={ref} className="gen-thumb-canvas" />
}
