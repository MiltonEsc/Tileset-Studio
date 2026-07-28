import { useState, useEffect, useCallback, useRef } from 'react'
import { listLevels, saveLevel, removeLevel } from '../lib/db.js'

// Saved levels persisted in Supabase. A level row stores the terrain grid
// (base64), placed props, size, the embedded tileset definition, and flags.
export function useLevels() {
  const [levels, setLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const levelsRef = useRef(levels)
  levelsRef.current = levels

  useEffect(() => {
    let cancelled = false
    listLevels()
      .then(rows => { if (!cancelled) setLevels(rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async (payload) => {
    setError('')
    try {
      const row = await saveLevel(payload)
      setLevels(prev => [...prev, row])
      return row
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  const remove = useCallback(async (id) => {
    setError('')
    const index = levelsRef.current.findIndex(l => l.id === id)
    if (index < 0) return
    const removed = levelsRef.current[index]
    setLevels(prev => prev.filter(l => l.id !== id))
    try {
      await removeLevel(id)
    } catch (e) {
      setError(e.message)
      setLevels(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, removed)
        return next
      })
    }
  }, [])

  return { levels, loading, error, save, remove }
}
