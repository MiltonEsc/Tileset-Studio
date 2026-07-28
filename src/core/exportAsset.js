// Export scenery props as transparent PNGs.

function triggerDownload(canvas, filename) {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // Revoking synchronously can abort the download in some browsers; give the
    // fetch a moment (same pattern as exportLevel.js).
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

function assetToCanvas(asset) {
  const pxW = asset.cols * asset.tileSize
  const pxH = asset.rows * asset.tileSize
  const c = document.createElement('canvas')
  c.width = pxW
  c.height = pxH
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(asset.pixels), pxW, pxH), 0, 0)
  return c
}

// Export a single prop at native resolution, preserving transparency.
export function exportAsset(asset, filename) {
  const name = filename || `${(asset.name || 'prop').replace(/\s+/g, '_')}.png`
  triggerDownload(assetToCanvas(asset), name)
}

// Pack every prop into a single grid atlas PNG (cells sized to the largest prop).
export function exportAllAssets(assets, filename = 'props_atlas.png') {
  if (!assets.length) return
  const cellW = Math.max(...assets.map(a => a.cols * a.tileSize))
  const cellH = Math.max(...assets.map(a => a.rows * a.tileSize))
  const cols = Math.ceil(Math.sqrt(assets.length))
  const rows = Math.ceil(assets.length / cols)

  const canvas = document.createElement('canvas')
  canvas.width  = cols * cellW
  canvas.height = rows * cellH
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  assets.forEach((a, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    ctx.drawImage(assetToCanvas(a), col * cellW, row * cellH)
  })

  triggerDownload(canvas, filename)
}
