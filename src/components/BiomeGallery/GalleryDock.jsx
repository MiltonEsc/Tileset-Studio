import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { Segmented } from '../ui/Segmented.jsx'
import { Btn }       from '../ui/Btn.jsx'
import { tilesFromDefinition } from '../../core/tilesetDefinition.js'
import { composeNativeSheet } from '../../core/composeSheet.js'
import { useInView } from '../../hooks/useInView.js'
import { getThumb, setThumb, pruneThumbs } from '../../lib/thumbCache.js'
import { decodeRegionPlane } from '../../core/levelSelection.js'
import { Icon } from '../ui/Icon.jsx'
import { useI18n } from '../../i18n.jsx'

// Run a one-off task during browser idle time (falling back to a microtask-ish
// timeout) so a burst of cards scrolling into view doesn't generate their 48-tile
// previews all in the same frame and stutter the scroll.
const scheduleIdle = typeof requestIdleCallback !== 'undefined'
  ? (cb) => requestIdleCallback(cb, { timeout: 500 })
  : (cb) => setTimeout(cb, 1)
const cancelIdle = typeof cancelIdleCallback !== 'undefined'
  ? (id) => cancelIdleCallback(id)
  : (id) => clearTimeout(id)

const LIB_META_KEY = 'ts.assetLibraryMeta.v1'
const itemKey = (type, id) => `${type}:${id}`

function CardActions({ favorite, onFavorite, onEdit }) {
  const { t } = useI18n()
  return <div className="lib-card-actions">
    <button className={favorite ? 'favorite' : ''} title={favorite ? t('removeFavorite') : t('addFavorite')}
      onClick={e => { e.stopPropagation(); onFavorite() }}><Icon name="star" size={14} /></button>
    <button title={t('editMeta')} onClick={e => { e.stopPropagation(); onEdit() }}><Icon name="more" size={15} /></button>
  </div>
}

function MetaBadges({ meta }) {
  if (!meta?.category && !meta?.tags?.length) return null
  return <div className="lib-meta-badges">
    {meta.category && <span>{meta.category}</span>}
    {meta.tags?.slice(0, 1).map(tag => <span key={tag}>#{tag}</span>)}
  </div>
}

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
const GroundCard = memo(function GroundCard({ template, active, onSelect, meta, onFavorite, onEdit }) {
  const [ref, inView] = useInView()
  const def = useMemo(() => ({ mode: 'procedural', biomeId: template.id, colors: template.colors }), [template])
  return (
    <div ref={ref} className={`lib-card ${active ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => onSelect(template)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(template) }}>
      <CardActions favorite={meta?.favorite} onFavorite={onFavorite} onEdit={onEdit} />
      <MetaBadges meta={meta} />
      <div className="lib-thumb">{inView && <CachedTileThumb definition={def} tileSize={32} keyBase={`gt:${template.id}`} />}</div>
      <div className="lib-card-foot"><span className="lib-card-name">{template.label}</span></div>
    </div>
  )
})

// Saved-tileset card. Memoized + viewport-gated: the expensive 48-tile preview
// only builds once the card scrolls into the rail, and the card skips re-render
// when only sibling state (search/tab) changes (props are stable refs).
const SavedCard = memo(function SavedCard({ tileset, active, onLoad, onRemove, meta, onFavorite, onEdit }) {
  const [ref, inView] = useInView()
  const { t } = useI18n()
  return (
    <div
      ref={ref}
      className={`lib-card ${active ? 'on' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onLoad(tileset)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLoad(tileset) } }}
    >
      <CardActions favorite={meta?.favorite} onFavorite={onFavorite} onEdit={onEdit} />
      <MetaBadges meta={meta} />
      <div className="lib-thumb">
        {inView && <CachedTileThumb definition={tileset.definition} tileSize={tileset.tile_size}
          keyBase={`ts:${tileset.id}`} smooth={tileset.definition?.smooth || false} />}
      </div>
      <div className="lib-card-foot lib-card-foot--saved">
        <div className="lib-card-foot-row">
          <span className="lib-card-name">{tileset.name}</span>
          <button className="lib-card-del" title={t('delete')} aria-label={t('delete')} onClick={(e) => { e.stopPropagation(); onRemove(tileset.id) }}><Icon name="trash" size={14} /></button>
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
const PropCard = memo(function PropCard({ asset, selected, onSelect, meta, onFavorite, onEdit }) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} className={`lib-card ${selected ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => onSelect(asset.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(asset.id) }}>
      <CardActions favorite={meta?.favorite} onFavorite={onFavorite} onEdit={onEdit} />
      <MetaBadges meta={meta} />
      <div className="lib-thumb checker-bg">{inView && <PropThumb asset={asset} />}</div>
      <div className="lib-card-foot"><span className="lib-card-name">{asset.name}</span><span className="lib-tag">{asset.cols}×{asset.rows}</span></div>
    </div>
  )
})

const stampThumbCache = new Map()
function StampThumb({ stamp }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = 100; canvas.height = 100
    const cached = stampThumbCache.get(stamp.id)
    if (cached) {
      const img = new Image()
      img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0)
      img.src = cached
      return
    }
    const payload = stamp.payload
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#141a20'; ctx.fillRect(0, 0, 100, 100)
    if (!payload?.width || !payload?.height) return
    const scale = Math.min(88 / payload.width, 88 / payload.height)
    const ox = (100 - payload.width * scale) / 2
    const oy = (100 - payload.height * scale) / 2
    const colors = ['#2fd6a6', '#6ea8fe', '#e8b84a', '#c084fc', '#fb7185']
    payload.planes?.forEach((plane, planeIdx) => {
      let data
      try { data = decodeRegionPlane(plane, payload.width, payload.height) } catch { return }
      ctx.fillStyle = colors[planeIdx % colors.length]
      for (let y = 0; y < payload.height; y++) for (let x = 0; x < payload.width; x++) {
        const i = y * payload.width + x
        if (data.grid[i] || data.manualTiles[i] >= 0) {
          ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(1, scale), Math.max(1, scale))
        }
      }
    })
    ctx.fillStyle = '#fff'
    payload.props?.forEach(p => ctx.fillRect(ox + p.dx * scale, oy + p.dy * scale, Math.max(2, scale), Math.max(2, scale)))
    stampThumbCache.set(stamp.id, canvas.toDataURL('image/png'))
  }, [stamp])
  return <canvas ref={ref} />
}

const StampCard = memo(function StampCard({ stamp, onSelect, onRemove, meta, onFavorite, onEdit }) {
  const { t } = useI18n()
  return (
    <div className="lib-card" role="button" tabIndex={0} onClick={() => onSelect(stamp)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(stamp) }}>
      <CardActions favorite={meta?.favorite} onFavorite={onFavorite} onEdit={onEdit} />
      <MetaBadges meta={meta} />
      <div className="lib-thumb"><StampThumb stamp={stamp} /></div>
      <div className="lib-card-foot lib-card-foot--saved">
        <div className="lib-card-foot-row">
          <span className="lib-card-name">{stamp.name}</span>
          <button className="lib-card-del" title={t('delete')} aria-label={t('delete')} onClick={e => { e.stopPropagation(); onRemove(stamp.id) }}><Icon name="trash" size={14} /></button>
        </div>
        <div className="lib-card-foot-meta"><span className="lib-card-size">{stamp.width}×{stamp.height}</span><span className="lib-tag">{stamp.payload?.planes?.length || 0}L</span><span className="lib-tag">{stamp.payload?.props?.length || 0}P</span></div>
      </div>
    </div>
  )
})

// Bottom library drawer: Tilesets (biome presets + cloud-saved) and Props.
export function GalleryDock({
  biomes, groundTemplates = [], context = '', activeBiomeId, activeSavedTilesetId, onSelectBiome,
  tilesets, defaultName, onSaveTileset, onLoadTileset, onRemoveTileset,
  assets, selectedAssetId, onSelectAsset,
  tilesetsLoading = false, tilesetsError = '', propsLoading = false, propsError = '',
  showStamps = false, stamps = [], onSelectStamp, onRemoveStamp,
  stampsLoading = false, stampsError = '',
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState('tilesets')
  const [scope, setScope] = useState('all')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editingMeta, setEditingMeta] = useState(null)
  const [libraryMeta, setLibraryMeta] = useState(() => {
    try { const parsed = JSON.parse(localStorage.getItem(LIB_META_KEY)); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
  })

  const updateMeta = (key, patch) => setLibraryMeta(prev => {
    const next = { ...prev, [key]: { ...prev[key], ...patch } }
    try { localStorage.setItem(LIB_META_KEY, JSON.stringify(next)) } catch { /* optional */ }
    return next
  })
  const touch = (key) => updateMeta(key, { lastUsed: Date.now() })
  const toggleFavorite = key => updateMeta(key, { favorite: !libraryMeta[key]?.favorite })
  const beginEdit = (key, label) => setEditingMeta({ key, label, category: libraryMeta[key]?.category || '', tags: (libraryMeta[key]?.tags || []).join(', ') })
  const saveEditingMeta = () => {
    if (!editingMeta) return
    updateMeta(editingMeta.key, { category: editingMeta.category.trim(), tags: editingMeta.tags.split(',').map(tag => tag.trim()).filter(Boolean) })
    setEditingMeta(null)
  }

  // Cloud-storage status for the active tab (props vs tilesets).
  const status = tab === 'props'
    ? { loading: propsLoading, error: propsError }
    : tab === 'stamps'
      ? { loading: stampsLoading, error: stampsError }
      : { loading: tilesetsLoading, error: tilesetsError }

  useEffect(() => {
    if (!showStamps && tab === 'stamps') setTab('tilesets')
  }, [showStamps, tab])

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
  const accepts = (key, text, defaultCategory = '') => {
    const meta = libraryMeta[key] || {}
    const category = meta.category || defaultCategory
    if (libraryFilter === 'favorites' && !meta.favorite) return false
    if (libraryFilter === 'recent' && !meta.lastUsed) return false
    if (categoryFilter !== 'all' && category.toLowerCase() !== categoryFilter.toLowerCase()) return false
    return !q || `${text} ${category} ${(meta.tags || []).join(' ')}`.toLowerCase().includes(q)
  }
  const recentSort = (type) => (a, b) => libraryFilter === 'recent'
    ? (libraryMeta[itemKey(type, b.id)]?.lastUsed || 0) - (libraryMeta[itemKey(type, a.id)]?.lastUsed || 0) : 0
  const biomeList = biomes.filter(b => accepts(itemKey('biome', b.id), `${b.label} ${b.id} biome procedural`, b.label))
  const groundList = groundTemplates.filter(t => accepts(itemKey('ground', t.id), `${t.label} ${t.id} ground terrain 32px`, t.label))
  const savedList = tilesets.filter(t => {
    const biomeId = t.definition?.biomeId
    const collection = biomes.find(b => b.id === biomeId)?.label || biomeId || 'Saved'
    return accepts(itemKey('tileset', t.id), `${t.name} ${t.tile_size || 16}px tileset saved ${biomeId || ''} ${collection}`, collection)
  }).sort(recentSort('tileset'))
  const propList = assets.filter(a => accepts(itemKey('prop', a.id), `${a.name} ${a.cols}x${a.rows} ${a.tileSize || 16}px prop asset`, 'Props')).sort(recentSort('prop'))
  const stampList = stamps.filter(s => accepts(itemKey('stamp', s.id), `${s.name} ${s.width}x${s.height} stamp terrain props ${s.payload?.planes?.length || 0} layers ${s.payload?.props?.length || 0} props`, 'Stamps')).sort(recentSort('stamp'))
  const categories = [...new Set([
    ...Object.values(libraryMeta).map(meta => meta.category).filter(Boolean),
    ...tilesets.map(t => t.definition?.biomeId).filter(Boolean), ...biomes.map(b => b.label), ...groundTemplates.map(t => t.label),
    'Saved', 'Props', 'Stamps',
  ])].sort((a, b) => a.localeCompare(b))

  const handleSave = () => { onSaveTileset(name.trim() || defaultName); setName('') }

  const showBiomes = tab === 'tilesets' && (scope === 'all' || scope === 'biomes')
  const showGround = tab === 'tilesets' && (scope === 'all' || scope === 'ground')
  const showSaved  = tab === 'tilesets' && (scope === 'all' || scope === 'saved')

  return (
    <footer className="library">
      <div className="lib-head">
        <Segmented size="sm" value={tab} onChange={setTab}
          options={[
            { value: 'tilesets', label: t('tilesets') },
            { value: 'props', label: `${t('props')} · ${assets.length}` },
            ...(showStamps ? [{ value: 'stamps', label: `${t('stamps')} · ${stamps.length}` }] : []),
          ]} />
        {tab === 'tilesets' && (
          <div className="lib-filters">
            {[['all', t('all')], ['biomes', t('biomes')], ['ground', t('ground')], ['saved', t('saved')]].map(([v, l]) => (
              <button key={v} className={`filter-chip ${scope === v ? 'on' : ''}`} onClick={() => setScope(v)}>{l}</button>
            ))}
          </div>
        )}
        {tab === 'tilesets' && context && <span className="lib-context">{context}</span>}
        <div className="lib-smart-filters">
          {[['all', t('all')], ['favorites', t('favorites')], ['recent', t('recent')]].map(([value, label]) => (
            <button key={value} className={`filter-chip ${libraryFilter === value ? 'on' : ''}`} onClick={() => setLibraryFilter(value)}>{label}</button>
          ))}
          <select className="text-input lib-category-filter" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">{t('collections')}</option>
            {categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        <div className="spacer" />
        <input className="text-input lib-search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('search')} />
        {tab === 'tilesets' && (
          <>
            <input className="text-input lib-name" value={name} onChange={e => setName(e.target.value)} placeholder={defaultName} />
            <Btn variant="primary" size="sm" icon="save" onClick={handleSave}>{t('save')}</Btn>
          </>
        )}
      </div>

      {editingMeta && <div className="lib-meta-editor">
        <b>{editingMeta.label}</b>
        <input className="text-input" value={editingMeta.category} placeholder="Category / biome collection"
          onChange={e => setEditingMeta(prev => ({ ...prev, category: e.target.value }))} />
        <input className="text-input" value={editingMeta.tags} placeholder="Tags separated by commas"
          onChange={e => setEditingMeta(prev => ({ ...prev, tags: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveEditingMeta() }} />
        <button className="filter-chip on" onClick={saveEditingMeta}>{t('apply')}</button>
        <button className="filter-chip" onClick={() => setEditingMeta(null)}>{t('cancel')}</button>
      </div>}

      <div className="lib-rail">
        {status.error
          ? <div className="lib-empty lib-error">Cloud storage error: {status.error}</div>
          : status.loading
            ? <div className="lib-empty">Loading saved items…</div>
            : null}
        {tab === 'tilesets' ? (
          <>
            {showBiomes && biomeList.map(b => (
              <div key={b.id} className={`lib-card ${b.id === activeBiomeId ? 'on' : ''}`} role="button" tabIndex={0}
                onClick={() => { touch(itemKey('biome', b.id)); onSelectBiome(b) }}>
                <CardActions favorite={libraryMeta[itemKey('biome', b.id)]?.favorite}
                  onFavorite={() => toggleFavorite(itemKey('biome', b.id))} onEdit={() => beginEdit(itemKey('biome', b.id), b.label)} />
                <MetaBadges meta={libraryMeta[itemKey('biome', b.id)]} />
                <div className="lib-thumb"><PaletteThumb colors={b.colors} /></div>
                <div className="lib-card-foot"><span className="lib-card-name">{b.label}</span></div>
              </div>
            ))}
            {showGround && groundList.map(t => (
              <GroundCard key={t.id} template={t} active={t.id === activeBiomeId}
                meta={libraryMeta[itemKey('ground', t.id)]}
                onFavorite={() => toggleFavorite(itemKey('ground', t.id))} onEdit={() => beginEdit(itemKey('ground', t.id), t.label)}
                onSelect={item => { touch(itemKey('ground', item.id)); onSelectBiome(item) }} />
            ))}
            {showSaved && savedList.map(t => (
              <SavedCard
                key={t.id}
                tileset={t}
                active={t.id === activeSavedTilesetId}
                onRemove={onRemoveTileset}
                meta={libraryMeta[itemKey('tileset', t.id)]}
                onFavorite={() => toggleFavorite(itemKey('tileset', t.id))}
                onEdit={() => beginEdit(itemKey('tileset', t.id), t.name)}
                onLoad={item => { touch(itemKey('tileset', item.id)); onLoadTileset(item) }}
              />
            ))}
            {showBiomes && showSaved && biomeList.length === 0 && savedList.length === 0 && <div className="lib-empty">No matches.</div>}
            {scope === 'saved' && savedList.length === 0 && <div className="lib-empty">No saved tilesets.</div>}
            {scope === 'biomes' && biomeList.length === 0 && <div className="lib-empty">No biome presets match.</div>}
          </>
        ) : tab === 'props' ? (
          propList.length === 0
            ? <div className="lib-empty">No props yet. Create them in the Assets view.</div>
            : propList.map(a => (
              <PropCard key={a.id} asset={a} selected={selectedAssetId === a.id}
                meta={libraryMeta[itemKey('prop', a.id)]}
                onFavorite={() => toggleFavorite(itemKey('prop', a.id))} onEdit={() => beginEdit(itemKey('prop', a.id), a.name)}
                onSelect={id => { touch(itemKey('prop', id)); onSelectAsset(id) }} />
            ))
        ) : (
          stampList.length === 0
            ? <div className="lib-empty">No stamps yet. Select an area and save it as a stamp.</div>
            : stampList.map(stamp => (
              <StampCard key={stamp.id} stamp={stamp} onRemove={onRemoveStamp}
                meta={libraryMeta[itemKey('stamp', stamp.id)]}
                onFavorite={() => toggleFavorite(itemKey('stamp', stamp.id))} onEdit={() => beginEdit(itemKey('stamp', stamp.id), stamp.name)}
                onSelect={item => { touch(itemKey('stamp', item.id)); onSelectStamp(item) }} />
            ))
        )}
      </div>
    </footer>
  )
}
