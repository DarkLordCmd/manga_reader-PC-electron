import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface Props { x: number; y: number; items: MenuItem[]; onClose: () => void }

export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, Math.max(0, window.innerWidth - r.width - 4)),
      top: Math.min(y, Math.max(0, window.innerHeight - r.height - 4))
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {items.map((it, i) => it.separator
        ? <div key={`sep-${i}`} className="context-sep" />
        : (
          <button
            key={`${it.label}-${i}`}
            className={`context-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick() }}
          >
            <span className="context-check">{it.checked ? '✓' : ''}</span>{it.label}
          </button>
        ))}
    </div>
  )
}
