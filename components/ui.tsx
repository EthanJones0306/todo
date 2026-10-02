'use client'

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { IconName } from '@/components/Icon'

/* ---------- Menu ---------- */

interface MenuProps {
  label: string
  icon?: IconName
  triggerClassName?: string
  triggerContent?: ReactNode
  align?: 'start' | 'end'
  width?: number
  children: (close: () => void) => ReactNode
}

export function Menu({ label, icon = 'more', triggerClassName = 'icon-btn', triggerContent, align = 'end', width = 220, children }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setDropUp(window.innerHeight - rect.bottom < 340 && rect.top > 340)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`menu-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        {triggerContent ?? <Icon name={icon} />}
      </button>
      {open && (
        <div
          className={`menu ${align === 'start' ? 'menu-start' : 'menu-end'} ${dropUp ? 'menu-up' : ''}`}
          role="menu"
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

interface MenuItemProps {
  icon?: IconName
  onClick: () => void
  danger?: boolean
  checked?: boolean
  hint?: string
  children: ReactNode
}

export function MenuItem({ icon, onClick, danger, checked, hint, children }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={`menu-item ${danger ? 'danger' : ''}`}
      onClick={onClick}
    >
      <span className="menu-item-icon">{icon ? <Icon name={icon} /> : null}</span>
      <span className="menu-item-label">{children}</span>
      {hint && <span className="menu-item-hint">{hint}</span>}
      {checked && <Icon name="check" className="menu-item-check" />}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />
}

/* ---------- Modal ---------- */

interface ModalProps {
  onClose: () => void
  labelledBy: string
  className?: string
  children: ReactNode
}

export function Modal({ onClose, labelledBy, className = '', children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-title" className="dialog-sm">
      <div className="confirm">
        <div className={`confirm-icon ${danger ? 'danger' : ''}`}>
          <Icon name={danger ? 'alert' : 'info'} size={20} />
        </div>
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{body}</div>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- Toast ---------- */

export interface ToastData {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.onAction && (
        <button
          className="toast-action"
          onClick={() => {
            toast.onAction?.()
            onDismiss()
          }}
        >
          <Icon name="undo" size={14} />
          {toast.actionLabel ?? 'Undo'}
        </button>
      )}
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}

/* ---------- Small bits ---------- */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function ProgressRing({ value, size = 40, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value))
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      <circle
        className="ring-value"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
