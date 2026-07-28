import { useState, useEffect, useRef } from 'react'

// Editable color row: swatch + label + hex (click swatch opens native picker).
// Uses local state & 50ms debounce so dragging the native color picker is ultra-responsive
// without locking the thread with heavy 48-tile autotile recalculations on every single pixel move.
export function ColorRow({ label, value, onChange }) {
  const [localValue, setLocalValue] = useState(value)
  const timerRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Keep local value in sync if parent prop changes (e.g. preset pick, shuffle, reset)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleChange = (e) => {
    const newVal = e.target.value
    setLocalValue(newVal)

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      onChangeRef.current(newVal)
    }, 250)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <label
        style={{
          width: 30,
          height: 22,
          borderRadius: 3,
          border: '2px solid var(--line)',
          background: localValue,
          cursor: 'pointer',
          display: 'block',
          position: 'relative',
          flexShrink: 0,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
        }}
      >
        <input
          type="color"
          value={localValue}
          onChange={handleChange}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            cursor: 'pointer',
            width: '100%',
            height: '100%',
          }}
        />
      </label>
      <span style={{ fontSize: 12.5, color: 'var(--ink-dim)', flex: 1, fontFamily: 'var(--ui)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-faint)' }}>
        {String(localValue).toUpperCase()}
      </span>
    </div>
  )
}
