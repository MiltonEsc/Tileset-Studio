import { useState, useEffect, useCallback } from 'react'

export function usePresets() {
  const [presets, setPresets] = useState([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('procedural_presets')
      if (saved) {
        setPresets(JSON.parse(saved))
      }
    } catch (e) {
      console.error('Failed to load presets', e)
    }
  }, [])

  const savePreset = useCallback((preset) => {
    setPresets(prev => {
      const next = [...prev, { ...preset, id: Date.now().toString() }]
      try {
        localStorage.setItem('procedural_presets', JSON.stringify(next))
      } catch (e) {
        console.error('Failed to save preset', e)
      }
      return next
    })
  }, [])

  const removePreset = useCallback((id) => {
    setPresets(prev => {
      const next = prev.filter(p => p.id !== id)
      try {
        localStorage.setItem('procedural_presets', JSON.stringify(next))
      } catch (e) {
        console.error('Failed to save presets', e)
      }
      return next
    })
  }, [])

  const importPreset = useCallback((presetData) => {
    setPresets(prev => {
      const next = [...prev, { ...presetData, id: Date.now().toString() }]
      try {
        localStorage.setItem('procedural_presets', JSON.stringify(next))
      } catch (e) {
        console.error('Failed to save preset', e)
      }
      return next
    })
  }, [])

  return { presets, savePreset, removePreset, importPreset }
}
