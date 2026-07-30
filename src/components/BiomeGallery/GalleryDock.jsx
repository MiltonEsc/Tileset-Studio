import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { Segmented } from '../ui/Segmented.jsx'
import { Btn }       from '../ui/Btn.jsx'
import { tilesFromDefinition } from '../../core/tilesetDefinition.js'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { useInView } from '../../hooks/useInView.js'
import { getThumb, setThumb, pruneThumbs } from '../../lib/thumbCache.js'

// Run a one-off task during browser idle time (falling back to a microtask-ish
// timeout) so a burst of cards scrolling into view doesn't generate their 48-tile
// previews all in the same frame and stutter the scroll.
const scheduleIdle = typeof requestIdleCallback !== 'undefined'
  ? (cb) => requestIdleCallback(cb, { timeout: 500 })
  : (cb) => setTimeout(cb, 1)
const cancelIdle = typeof cancelIdleCallback !== 'undefined'
  ? (id) => cancelIdleCallback(id)
  : (id) => clearTimeout(id)

// Palette-stripe thumbnail for a tileset/biome (hero color + stacked rest).
function PaletteThumb({ colors }) {
  const c = colors || {}
  const hero = c.primary || '#3a3f47'
  const rest = [c.secondary, c.border, c.highlight, c.shadow].filter(Boolean)
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div style={{ flex: 2, background: hero }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {rest.map((col, i) => <div key={i} style={{ flex: 1, background: col }} />)}
      </div>
    </div>
  )
}

// Transparent-aware prop thumbnail rendered from pixel data.
function PropThumb({ asset }) {
  const ref = useRef(null)
  const pxW = asset.cols * asset.tileSize
  const pxH = asset.rows * asset.tileSize
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const box = 100
    cv.width = box; cv.height = box
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, box, box)
    const scale = Math.min(box / pxW, box / pxH)
    const dW = pxW * scale, dH = pxH * scale
    const tmp = document.createElement('canvas')
    tmp.width = pxW; tmp.height = pxH
    const expected = pxW * pxH * 4; const data = asset.pixels.length === expected ? asset.pixels : new Uint8ClampedArray(expected); data.set(asset.pixels.subarray(0, Math.min(asset.pixels.length, expected))); tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), pxW, pxH), 0, 0)
    ctx.drawImage(tmp, (box - dW) / 2, (box - dH) / 2, dW, dH)
  }, [asset, pxW, pxH])
  return <canvas ref={ref} />
}

// The card only shows a tiny 12-tile preview at 18 px cells, so cap the generation
// size hard — composing 48 tiles at a saved 64/128/256 px is wasteful (cost scales
// with the square of the size). 24 px native is already more than the thumbnail can
// show. Bump THUMB_VERSION to invalidate every cached thumbnail (e.g. if the
// generators or this layout change).
const PREVIEW_MAX = 24
const THUMB_VERSION = 1
const THUMB_COLS = 4
const THUMB_ROWS = 3
const THUMB_CELL = 18

// Compose the first 12 tiles into the mini-preview and return a PNG data-URL.
function tilesToThumbDataURL(tiles, tileSize, smooth) {
  if (!tiles) return null
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_COLS * THUMB_CELL
  canvas.height = THUMB_ROWS * THUMB_CELL
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = smooth
  const native = composeNativeSheet(tiles, tileSize)
  for (let i = 0; i < THUMB_COLS * THUMB_ROWS; i++) {
    const tileIdx = i + 1 // skip the empty tile at 0
    if (!tiles[tileIdx]) continue
    const sx = (tileIdx % 8) * tileSize
    const sy = Math.floor(tileIdx / 8) * tileSize
    const col = i % THUMB_COLS
    const row = Math.floor(i / THUMB_COLS)
    ctx.drawImage(native, sx, sy, tileSize, tileSize, col * THUMB_CELL, row * THUMB_CELL, THUMB_CELL, THUMB_CELL)
  }
  return canvas.toDataURL('image/png')
}

// Tile-preview thumbnail for a tileset definition, cached as a data-URL in
// IndexedDB by `keyBase` (a stable id). On a cache hit the thumbnail shows
// instantly with zero tile generation; on a miss it builds once (during idle
// time, so a burst of cards scrolling in stays smooth) and stores the result.
function CachedTileThumb({ definition, tileSize, keyBase, smooth = false }) {
  const previewSize = Math.min(tileSize || 16, PREVIEW_MAX)
  const cacheKey = `${keyBase}:v${THUMB_VERSION}:${previewSize}`
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    let idleId = null
    getThumb(cacheKey).then((cached) => {
      if (cancelled) return
      if (cached) { setUrl(cached); return }
      idleId = scheduleIdle(() => {
        if (cancelled) return
        try {
          const tiles = tilesFromDefinition(definition, previewSize)
          // Draw-mode tiles ignore the requested size and render at their native
          // basePixels side, so use the tiles' actual width as the source size.
          const actualSize = tiles?.[1]?.width || previewSize
          const dataUrl = tilesToThumbDataURL(tiles, actualSize, smooth)
          if (cancelled || !dataUrl) return
          setUrl(dataUrl)
          setThumb(cacheKey, dataUrl)
        } catch { /* leave the empty placeholder; the gallery still works */ }
      })
    })
    return () => { cancelled = true; if (idleId != null) cancelIdle(idleId) }
  }, [definition, previewSize, cacheKey, smooth])

  if (!url) return null
  return <img className="biome-card-preview" src={url} alt="" style={{ imageRendering: smooth ? 'auto' : 'pixelated' }} />
}

// Ground-template card. Like a biome card but shows the REAL procedural texture
// (so you see the "form"), viewport-gated so it only generates when scrolled in.
const GroundCard = memo(function GroundCard({ template, active, onSelect }) {
  const [ref, inView] = useInView()
  const def = useMemo(() => ({ mode: 'procedural', biomeId: template.id, colors: template.colors }), [template])
  return (
    <button ref={ref} className={`lib-card ${active ? 'on' : ''}`} onClick={() => onSelect(template)}>
      <div className="lib-thumb">{inView && <CachedTileThumb definition={def} tileSize={32} keyBase={`gt:${template.id}`} />}</div>
      <div className="lib-card-foot"><span className="lib-card-name">{template.label}</span></div>
    </button>
  )
})

// Saved-tileset card. Memoized + viewport-gated: the expensive 48-tile preview
// only builds once the card scrolls into the rail, and the card skips re-render
// when only sibling state (search/tab) changes (props are stable refs).
const SavedCard = memo(function SavedCard({ tileset, active, onLoad, onRemove }) {
  const [ref, inView] = useInView()
  return (
    <div
      ref={ref}
      className={`lib-card ${active ? 'on' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onLoad(tileset)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLoad(tileset) } }}
    >
      <div className="lib-thumb">
        {inView && <CachedTileThumb definition={tileset.definition} tileSize={tileset.tile_size}
          keyBase={`ts:${tileset.id}`} smooth={tileset.definition?.smooth || false} />}
      </div>
      <div className="lib-card-foot lib-card-foot--saved">
        <div className="lib-card-foot-row">
          <span className="lib-card-name">{tileset.name}</span>
          <button className="lib-card-del" title="Delete" onClick={(e) => { e.stopPropagation(); onRemove(tileset.id) }}>×</button>
        </div>
        <div className="lib-card-foot-meta">
          <span className="lib-card-size">{tileset.tile_size || 16}px</span>
          <span className="lib-tag">saved</span>
        </div>
      </div>
    </div>
  )
})

// Prop card. Memoized + viewport-gated: the pixel decode + thumbnail draw only
// happen once the card scrolls into view.
const PropCard = memo(function PropCard({ asset, selected, onSelect }) {
  const [ref, inView] = useInView()
  return (
    <button ref={ref} className={`lib-card ${selected ? 'on' : ''}`} onClick={() => onSelect(asset.id)}>
      <div className="lib-thumb checker-bg">{inView && <PropThumb asset={asset} />}</div>
      <div className="lib-card-foot"><span className="lib-card-name">{asset.name}</span><span className="lib-tag">{asset.cols}×{asset.rows}</span></div>
    </button>
  )
})

// Bottom library drawer: Tilesets (biome presets + cloud-saved) and Props.
export function GalleryDock({
  biomes, groundTemplates = [], context = '', activeBiomeId, activeSavedTilesetId, onSelectBiome,
  tilesets, defaultName, onSaveTileset, onLoadTileset, onRemoveTileset,
  assets, selectedAssetId, onSelectAsset,
  tilesetsLoading = false, tilesetsError = '', propsLoading = false, propsError = '',
}) {
  const [tab, setTab] = useState('tilesets')
  const [scope, setScope] = useState('all')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')

  // Cloud-storage status for the active tab (props vs tilesets).
  const status = tab === 'props'
    ? { loading: propsLoading, error: propsError }
    : { loading: tilesetsLoading, error: tilesetsError }

  // Once the saved list is fully loaded, drop cached thumbnails for tilesets that
  // no longer exist (deleted). Guarded so a transient empty/loading/error list
  // never wipes the persistent cache.
  useEffect(() => {
    if (tilesetsLoading || tilesetsError) return
    const valid = new Set()
    for (const t of tilesets) valid.add(`ts:${t.id}:v${THUMB_VERSION}:${Math.min(t.tile_size || 16, PREVIEW_MAX)}`)
    for (const t of groundTemplates) valid.add(`gt:${t.id}:v${THUMB_VERSION}:${Math.min(32, PREVIEW_MAX)}`)
    pruneThumbs(valid)
  }, [tilesets, groundTemplates, tilesetsLoading, tilesetsError])

  const q = search.trim().toLowerCase()
  const matches = (b) => b.label.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)
  const biomeList  = biomes.filter(matches)
  const groundList = groundTemplates.filter(matches)
  const savedList  = tilesets.filter(t => t.name.toLowerCase().includes(q))
  const propList   = assets.filter(a => a.name.toLowerCase().includes(q))

  const handleSave = () => { onSaveTileset(name.trim() || defaultName); setName('') }

  const showBiomes = tab === 'tilesets' && (scope === 'all' || scope === 'biomes')
  const showGround = tab === 'tilesets' && (scope === 'all' || scope === 'ground')
  const showSaved  = tab === 'tilesets' && (scope === 'all' || scope === 'saved')

  return (
    <footer className="library">
      <div className="lib-head">
        <Segmented size="sm" value={tab} onChange={setTab}
          options={[{ value: 'tilesets', label: 'Tilesets' }, { value: 'props', label: `Props · ${assets.length}` }]} />
        {tab === 'tilesets' && (
          <div className="lib-filters">
            {[['all', 'All'], ['biomes', 'Biomes'], ['ground', 'Ground'], ['saved', 'Saved']].map(([v, l]) => (
              <button key={v} className={`filter-chip ${scope === v ? 'on' : ''}`} onClick={() => setScope(v)}>{l}</button>
            ))}
          </div>
        )}
        {tab === 'tilesets' && context && <span className="lib-context">{context}</span>}
        <div className="spacer" />
        <input className="text-input lib-search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'tilesets' ? 'Filter tilesets…' : 'Filter props…'} />
        {tab === 'tilesets' && (
          <>
            <input className="text-input lib-name" value={name} onChange={e => setName(e.target.value)} placeholder={defaultName} />
            <Btn variant="primary" size="sm" icon="save" onClick={handleSave}>Save</Btn>
          </>
        )}
      </div>

      <div className="lib-rail">
        {status.error
          ? <div className="lib-empty lib-error">Cloud storage error: {status.error}</div>
          : status.loading
            ? <div className="lib-empty">Loading saved items…</div>
            : null}
        {tab === 'tilesets' ? (
          <>
            {showBiomes && biomeList.map(b => (
              <button key={b.id} className={`lib-card ${b.id === activeBiomeId ? 'on' : ''}`} onClick={() => onSelectBiome(b)}>
                <div className="lib-thumb"><PaletteThumb colors={b.colors} /></div>
                <div className="lib-card-foot"><span className="lib-card-name">{b.label}</span></div>
              </button>
            ))}
            {showGround && groundList.map(t => (
              <GroundCard key={t.id} template={t} active={t.id === activeBiomeId} onSelect={onSelectBiome} />
            ))}
            {showSaved && savedList.map(t => (
              <SavedCard
                key={t.id}
                tileset={t}
                active={t.id === activeSavedTilesetId}
                onLoad={onLoadTileset}
                onRemove={onRemoveTileset}
              />
            ))}
            {showBiomes && showSaved && biomeList.length === 0 && savedList.length === 0 && <div className="lib-empty">No matches.</div>}
            {scope === 'saved' && savedList.length === 0 && <div className="lib-empty">No saved tilesets.</div>}
            {scope === 'biomes' && biomeList.length === 0 && <div className="lib-empty">No biome presets match.</div>}
          </>
        ) : (
          propList.length === 0
            ? <div className="lib-empty">No props yet. Create them in the Assets view.</div>
            : propList.map(a => (
              <PropCard key={a.id} asset={a} selected={selectedAssetId === a.id} onSelect={onSelectAsset} />
            ))
        )}
      </div>
    </footer>
  )
}
