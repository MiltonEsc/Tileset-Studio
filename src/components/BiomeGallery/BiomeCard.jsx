import { useEffect, useState } from 'react'
import { generateAllBiomeTiles } from '../../core/proceduralGen.js'
import { BiomeCardPreview } from './BiomeCardPreview.jsx'

export function BiomeCard({ biome, tileSize, isActive, onClick }) {
  const [tiles, setTiles] = useState(null)

  useEffect(() => {
    const generated = generateAllBiomeTiles(biome, tileSize)
    setTiles(generated)
  }, [biome, tileSize])

  return (
    <button
      className={`biome-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={`Switch to ${biome.label} biome`}
    >
      <BiomeCardPreview tiles={tiles} tileSize={tileSize} />
      <span className="biome-card-label">{biome.label}</span>
      {isActive && <span className="biome-card-active-badge">●</span>}
    </button>
  )
}
