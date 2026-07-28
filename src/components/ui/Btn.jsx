import { PixIcon } from './PixIcon.jsx'
import { ICONS } from './icons.js'

// Button with pixel-theme variants + optional pixel icon.
export function Btn({ children, variant = 'ghost', size = 'md', active, icon, onClick, title, style, full, disabled }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: 'var(--ui)', fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
    border: 'var(--bw) solid transparent', borderRadius: 'var(--r-btn)',
    transition: 'transform .04s ease, background .15s ease, border-color .15s ease',
    whiteSpace: 'nowrap', userSelect: 'none', width: full ? '100%' : 'auto',
    letterSpacing: '.01em', opacity: disabled ? 0.4 : 1,
  }
  const sizes = {
    sm: { padding: '6px 10px', fontSize: 12 },
    md: { padding: '9px 14px', fontSize: 13 },
    lg: { padding: '12px 18px', fontSize: 14 },
  }
  const variants = {
    primary:    { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)', boxShadow: 'var(--btn-shadow)' },
    accentSoft: { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-line)' },
    solid:      { background: 'var(--surface-3)', color: 'var(--ink)', borderColor: 'var(--line)' },
    ghost:      { background: 'transparent', color: 'var(--ink-dim)', borderColor: 'transparent' },
    outline:    { background: 'transparent', color: 'var(--ink)', borderColor: 'var(--line)' },
    danger:     { background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'var(--danger-line)' },
  }
  const activeStyle = active
    ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)', boxShadow: 'var(--btn-shadow)' }
    : {}
  return (
    <button
      title={title} onClick={disabled ? undefined : onClick} disabled={disabled}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'translateY(1px)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
      style={{ ...base, ...sizes[size], ...variants[variant], ...activeStyle, ...style }}
    >
      {icon && <PixIcon grid={ICONS[icon]} px={size === 'sm' ? 1.5 : 2} />}
      {children}
    </button>
  )
}
