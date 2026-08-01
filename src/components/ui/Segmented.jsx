// Segmented control. options: array of { value, label } (or plain values).
import { Icon } from './Icon.jsx'
export function Segmented({ options, value, onChange, size = 'md', full }) {
  return (
    <div
      style={{
        display: 'inline-flex', background: 'var(--surface-1)', border: 'var(--bw) solid var(--line)',
        borderRadius: 'var(--r-btn)', padding: 3, gap: 3, width: full ? '100%' : 'auto',
      }}
    >
      {options.map((o) => {
        const val = typeof o === 'object' ? o.value : o
        const lab = typeof o === 'object' ? o.label : o
        const on = val === value
        return (
          <button
            key={val} onClick={() => onChange(val)}
            style={{
              flex: full ? 1 : 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontFamily: 'var(--ui)', fontWeight: 600, fontSize: size === 'sm' ? 12 : 13,
              padding: size === 'sm' ? '5px 10px' : '7px 14px', borderRadius: 'calc(var(--r-btn) - 3px)',
              background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-ink)' : 'var(--ink-dim)',
              boxShadow: on ? 'var(--btn-shadow)' : 'none', transition: 'all .15s ease', letterSpacing: '.01em',
            }}
          >
            {typeof o === 'object' && o.icon && <Icon name={o.icon} size={15} />}
            {lab}
          </button>
        )
      })}
    </div>
  )
}
