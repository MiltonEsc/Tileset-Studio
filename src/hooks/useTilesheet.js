import { useState, useCallback } from 'react'
import { generateAllTiles } from '../core/tileGenerator.js'
import { generateBiomeTiles, generateTilesFromTextures } from '../core/proceduralGen.js'

export function useTilesheet() {
  const [tiles, setTiles] = useState(null)
  const [ready, setReady] = useState(false)

  const generateFromBitmap = useCallback((imageData, tileSize) => {
    setReady(false)
    const result = generateAllTiles(imageData, tileSize)
    setTiles(result)
    setReady(true)
  }, [])

  const generateFromBiome = useCallback((biome, tileSize) => {
    setReady(false)
    const result = generateBiomeTiles(biome, tileSize)
    setTiles(result)
    setReady(true)
  }, [])

  // Compose 48 tiles from an AI center texture + optional AI edge texture
  const generateFromTextures = useCallback((centerData, edgeData, tileSize, biomeColors, smooth = false, proceduralParams = {}) => {
    setReady(false)
    const result = generateTilesFromTextures(centerData, edgeData, tileSize, biomeColors, smooth, proceduralParams)
    setTiles(result)
    setReady(true)
  }, [])

  const clear = useCallback(() => {
    setTiles(null)
    setReady(false)
  }, [])

  return { tiles, ready, generateFromBitmap, generateFromBiome, generateFromTextures, clear }
}
