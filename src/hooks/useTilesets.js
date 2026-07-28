import { useState, useEffect, useCallback, useRef } from 'react'
import { listTilesets, saveTileset, removeTileset } from '../lib/db.js'

// Saved tilesets persisted in Supabase. A tileset row stores the DEFINITION that
// regenerates its 48 tiles (cheap), not the rendered pixels:
//   { mode:'procedural', biomeId, colors } | { mode:'draw', basePixels:base64 }
export function useTilesets() {
  const [tilesets, setTilesets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const tilesetsRef = useRef(tilesets)
  tilesetsRef.current = tilesets

  useEffect(() => {
    let cancelled = false
    listTilesets()
      .then(rows => { if (!cancelled) setTilesets(rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async ({ name, tileSize, definition }) => {
    setError('')
    try {
      const row = await saveTileset({ name, tileSize, definition })
      setTilesets(prev => [...prev, row])
      return row
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  const remove = useCallback(async (id) => {
    setError('')
    const index = tilesetsRef.current.findIndex(t => t.id === id)
    if (index < 0) return
    const removed = tilesetsRef.current[index]
    setTilesets(prev => prev.filter(t => t.id !== id))
    try {
      await removeTileset(id)
    } catch (e) {
      setError(e.message)
      setTilesets(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, removed)
        return next
      })
    }
  }, [])

  return { tilesets, loading, error, save, remove }
}
