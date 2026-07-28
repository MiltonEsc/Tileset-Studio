import { useState } from 'react'
import { PixIcon } from './PixIcon.jsx'
import { ICONS } from './icons.js'

// Collapsible section with a pixel-font eyebrow header.
export function Section({ title, icon, right, children, defaultOpen = true, dense }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid var(--line-soft)' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: dense ? '11px 18px' : '14px 18px', cursor: 'pointer', userSelect: 'none' }}
      >
        {icon && <PixIcon grid={ICONS[icon]} px={2} color="var(--accent)" />}
        <span style={{ fontFamily: 'var(--pixel)', fontSize: 9.5, letterSpacing: '.06em', color: 'var(--ink-dim)', textTransform: 'uppercase', flex: 1 }}>
          {title}
        </span>
        {right}
        <span style={{ color: 'var(--ink-faint)', fontSize: 11, transform: open ? 'rotate(90deg)' : '', transition: 'transform .15s', fontFamily: 'var(--ui)' }}>
          ▶
        </span>
      </div>
      {open && <div style={{ padding: dense ? '0 18px 14px' : '2px 18px 18px' }}>{children}</div>}
    </div>
  )
}
