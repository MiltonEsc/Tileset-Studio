import { useRef, useEffect, memo } from 'react'
import { useInView } from '../../hooks/useInView.js'

// Renders one prop's pixels into a small canvas thumbnail.
function AssetThumb({ asset, size = 56 }) {
  const ref = useRef(null)
  const pxW = asset.cols * asset.tileSize
  const pxH = asset.rows * asset.tileSize

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, size, size)
    // Fit the prop into the square thumb, keeping aspect ratio
    const scale = Math.min(size / pxW, size / pxH)
    const dW = pxW * scale
    const dH = pxH * scale
    const tmp = document.createElement('canvas')
    tmp.width = pxW; tmp.height = pxH
    const expected = pxW * pxH * 4; const data = asset.pixels.length === expected ? asset.pixels : new Uint8ClampedArray(expected); data.set(asset.pixels.subarray(0, Math.min(asset.pixels.length, expected))); tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), pxW, pxH), 0, 0)
    ctx.drawImage(tmp, (size - dW) / 2, (size - dH) / 2, dW, dH)
  }, [asset, pxW, pxH, size])

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="checker-bg"
      style={{ width: size, height: size, imageRendering: 'pixelated', borderRadius: 4 }}
    />
  )
}

// Memoized + viewport-gated card: decode + thumbnail draw only run once the card
// scrolls into view, and the card skips re-render when sibling state changes.
const AssetCard = memo(function AssetCard({ asset, selected, onSelect, onLoadToEditor, onExport, onRemove }) {
  const [ref, inView] = useInView()
  return (
    <div
      ref={ref}
      className={`asset-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(asset.id)}
      title={`${asset.name} · ${asset.cols}×${asset.rows}`}
    >
      {inView
        ? <AssetThumb asset={asset} />
        : <div className="checker-bg" style={{ width: 56, height: 56, borderRadius: 4 }} />}
      <div className="asset-card-name">{asset.name}</div>
      <div className="asset-card-actions">
        <button className="asset-card-btn" onClick={(e) => { e.stopPropagation(); onLoadToEditor(asset) }} title="Edit in canvas">Edit</button>
        <button className="asset-card-btn" onClick={(e) => { e.stopPropagation(); onExport(asset) }} title="Export PNG">PNG</button>
        <button className="asset-card-btn danger" onClick={(e) => { e.stopPropagation(); onRemove(asset.id) }} title="Delete">×</button>
      </div>
    </div>
  )
})

export function AssetGallery({
  assets, selectedId, onSelect, onRemove, onExport, onLoadToEditor, onExportAll,
  loading = false, error = '',
}) {
  return (
    <div className="asset-gallery">
      <div className="asset-gallery-head">
        <span className="asset-gallery-title">Gallery ({assets.length})</span>
        <button
          className="asset-mini-btn"
          onClick={onExportAll}
          disabled={!assets.length}
          title="Export all props as one atlas PNG"
        >
          Atlas PNG
        </button>
      </div>

      {error ? (
        <div className="asset-gallery-empty asset-gallery-error">Cloud storage error: {error}</div>
      ) : loading ? (
        <div className="asset-gallery-empty">Loading saved props…</div>
      ) : assets.length === 0 ? (
        <div className="asset-gallery-empty">No props yet. Generate or draw one, then “Save to gallery”.</div>
      ) : (
        <div className="asset-gallery-grid">
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a}
              selected={selectedId === a.id}
              onSelect={onSelect}
              onLoadToEditor={onLoadToEditor}
              onExport={onExport}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
