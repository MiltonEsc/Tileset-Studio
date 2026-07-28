import { BiomeCard } from './BiomeCard.jsx'

export function BiomeGallery({ biomes, activeBiomeId, tileSize, onSelectBiome }) {
  return (
    <div className="biome-gallery">
      <div className="biome-gallery-label">🗺️ Biome Gallery</div>
      <div className="biome-gallery-row">
        {biomes.map(biome => (
          <BiomeCard
            key={biome.id}
            biome={biome}
            tileSize={tileSize}
            isActive={biome.id === activeBiomeId}
            onClick={() => onSelectBiome(biome)}
          />
        ))}
      </div>
    </div>
  )
}
