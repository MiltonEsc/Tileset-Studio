import { useCallback, useEffect, useRef, useState } from 'react'
import { listStamps, saveStamp, removeStamp } from '../lib/db.js'

export function useStamps() {
  const [stamps, setStamps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const ref = useRef(stamps)
  ref.current = stamps

  useEffect(() => {
    let cancelled = false
    listStamps()
      .then(rows => { if (!cancelled) setStamps(rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async ({ name, payload }) => {
    setError('')
    try {
      const row = await saveStamp({
        name: name || 'Stamp', width: payload.width, height: payload.height,
        tileSize: payload.tileSize, payload,
      })
      setStamps(prev => [...prev, row])
      return row
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  const remove = useCallback(async (id) => {
    setError('')
    const index = ref.current.findIndex(s => s.id === id)
    if (index < 0) return
    const removed = ref.current[index]
    setStamps(prev => prev.filter(s => s.id !== id))
    try {
      await removeStamp(id)
    } catch (e) {
      setError(e.message)
      setStamps(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, removed)
        return next
      })
    }
  }, [])

  return { stamps, loading, error, save, remove }
}
