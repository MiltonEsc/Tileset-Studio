import { useState, useCallback } from 'react'
import { AI_MODELS } from '../core/aiTile.js'
import { STORAGE_KEYS } from '../constants/storageKeys.js'

// Shared state for any AI panel: the persisted model choice plus the
// loading/error lifecycle and a `run` wrapper that handles the
// try/catch/finally boilerplate around a generation. Defaults to the image
// models; pass a different list + storage key for the text assistant.
export function useAIModel(models = AI_MODELS, storageKey = STORAGE_KEYS.AI_IMAGE_MODEL) {
  const defaultModel = models[0]?.id
  const [model, setModel] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    return models.some(m => m.id === stored) ? stored : defaultModel
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleModelChange = useCallback((v) => {
    setModel(v)
    localStorage.setItem(storageKey, v)
  }, [storageKey])

  // Runs an async generation, managing loading + error state. Returns the
  // generator's result (or undefined on failure, with `error` set).
  const run = useCallback(async (fn) => {
    setError('')
    setLoading(true)
    try {
      return await fn()
    } catch (e) {
      setError(e.message || 'Generation failed.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { model, setModel: handleModelChange, loading, error, run, models }
}
