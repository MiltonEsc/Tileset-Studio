import { useState, useEffect, useCallback, useRef } from 'react'
import { bytesToBase64, base64ToBytes } from '../lib/serialize.js'
import { listAssets, addAsset, removeAsset } from '../lib/db.js'

// Maps a Supabase row → in-app asset. `pixels` is decoded from base64 LAZILY on
// first access (and cached), so loading the gallery doesn't synchronously decode
// every prop up front — off-screen thumbnails never touch it until scrolled in.
function rowToAsset(row) {
  let decoded = null
  return {
    id: row.id,
    name: row.name,
    cols: row.cols,
    rows: row.rows,
    tileSize: row.tile_size,
    get pixels() {
      if (decoded === null) decoded = base64ToBytes(row.pixels)
      return decoded
    },
  }
}

// Gallery of saved props, persisted in Supabase (per-user; RLS scopes rows to
// the signed-in account — the app only mounts this behind the AuthGate).
export function useAssets() {
  const [assets, setAssets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const assetsRef = useRef(assets)
  assetsRef.current = assets

  useEffect(() => {
    let cancelled = false
    listAssets()
      .then(rows => { if (!cancelled) setAssets(rows.map(rowToAsset)) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const add = useCallback(async ({ name, cols, rows, tileSize, pixels }) => {
    setError('')
    try {
      const row = await addAsset({ name: name || 'prop', cols, rows, tileSize, pixelsB64: bytesToBase64(pixels) })
      const asset = rowToAsset(row)
      setAssets(prev => [...prev, asset])
      setSelectedId(asset.id)
      return asset.id
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  const remove = useCallback(async (id) => {
    setError('')
    // Optimistic remove, with rollback if the server delete fails so the UI
    // never claims something is gone while it still exists in the DB.
    const index = assetsRef.current.findIndex(a => a.id === id)
    if (index < 0) return
    const removed = assetsRef.current[index]
    setAssets(prev => prev.filter(a => a.id !== id))
    setSelectedId(prev => (prev === id ? null : prev))
    try {
      await removeAsset(id)
    } catch (e) {
      setError(e.message)
      setAssets(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, removed)
        return next
      })
    }
  }, [])

  const select = useCallback((id) => setSelectedId(id), [])
  const getById = useCallback((id) => assets.find(a => a.id === id) || null, [assets])

  return { assets, selectedId, loading, error, add, remove, select, getById }
}
