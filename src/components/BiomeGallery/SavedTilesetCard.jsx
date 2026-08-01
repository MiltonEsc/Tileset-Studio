import { useState, useEffect } from 'react'
import { BiomeCardPreview } from './BiomeCardPreview.jsx'
import { tilesFromDefinition } from '../../core/tilesetDefinition.js'
import { Icon } from '../ui/Icon.jsx'
import { useI18n } from '../../i18n.jsx'

export function SavedTilesetCard({ tileset, onLoad, onRemove }) {
  const { t } = useI18n()
  const [tiles, setTiles] = useState(null)
  const size = tileset.tile_size

  useEffect(() => {
    try { setTiles(tilesFromDefinition(tileset.definition, size)) }
    catch { setTiles(null) }
  }, [tileset, size])

  return (
    <button
      className="biome-card saved-tileset-card"
      onClick={() => onLoad(tileset)}
      title={`Load "${tileset.name}" · ${size}px · ${tileset.definition?.mode}`}
    >
      <BiomeCardPreview tiles={tiles} tileSize={size} />
      <span className="biome-card-label">{tileset.name}</span>
      <span
        className="saved-tileset-del"
        onClick={(e) => { e.stopPropagation(); onRemove(tileset.id) }}
        title={t('delete')}
      ><Icon name="trash" size={14} /></span>
    </button>
  )
}
