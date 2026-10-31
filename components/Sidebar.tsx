'use client'

import Link from 'next/link'
import { Category, Mode, MODE_LABEL, MODE_ORDER } from '@/types'
import Icon, { IconName } from '@/components/Icon'
import { Kbd } from '@/components/ui'

export type View = 'today' | 'upcoming' | 'all' | Category

export const SMART_VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar' },
  { id: 'all', label: 'All tasks', icon: 'inbox' },
]

export const LIST_VIEWS: { id: View; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Custom' },
  { id: 'once', label: 'One-off' },
]

export const ALL_VIEWS: View[] = [...SMART_VIEWS, ...LIST_VIEWS].map(v => v.id)

export const VIEW_LABEL: Record<View, string> = Object.fromEntries(
  [...SMART_VIEWS, ...LIST_VIEWS].map(v => [v.id, v.label])
) as Record<View, string>

export interface SidebarProject {
  id: string
  title: string
  done: number
  total: number
}

interface SidebarProps {
  mode: Mode
  onModeChange: (m: Mode) => void
  activeView: View | null
  onSelectView: (v: View) => void
  counts: Partial<Record<View, number>>
  projects: SidebarProject[]
  activeProjectId?: string
  onOpenSettings: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

export default function Sidebar({
  mode,
  onModeChange,
  activeView,
  onSelectView,
  counts,
  projects,
  activeProjectId,
  onOpenSettings,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  // A soft spotlight follows the mouse across whichever item it is over (see .nav-item::before).
  const trackSpotlight = (e: React.PointerEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.nav-item')
    if (!item) return
    const r = item.getBoundingClientRect()
    item.style.setProperty('--mx', `${e.clientX - r.left}px`)
    item.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  const renderItem = (id: View, label: string, leading: React.ReactNode, index: number) => (
    <button
      key={id}
      data-nav={id}
      className={`nav-item ${activeView === id ? 'active' : ''}`}
      onClick={() => {
        onSelectView(id)
        onCloseMobile()
      }}
      aria-current={activeView === id ? 'page' : undefined}
      title={`${label} (${index + 1})`}
    >
      <span className="nav-chip">{leading}</span>
      <span className="nav-label">{label}</span>
      {!!counts[id] && <span className="nav-count">{counts[id]}</span>}
    </button>
  )

  return (
    <>
      <div className={`sidebar-scrim ${mobileOpen ? 'show' : ''}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Navigation" onPointerMove={trackSpotlight}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Icon name="check" size={14} />
          </div>
          <span className="brand-name">Todo</span>
        </div>

        <div className="workspace-switch" role="radiogroup" aria-label="Workspace" data-active={MODE_ORDER.indexOf(mode)}>
          {MODE_ORDER.map(m => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => onModeChange(m)}
            >
              <Icon name={m === 'personal' ? 'user' : 'briefcase'} size={14} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            {SMART_VIEWS.map((v, i) => renderItem(v.id, v.label, <Icon name={v.icon} />, i))}
          </div>

          <div className="nav-group">
            <div className="nav-heading">Lists</div>
            {LIST_VIEWS.map((v, i) =>
              renderItem(v.id, v.label, <span className="cat-dot" data-category={v.id} />, i + SMART_VIEWS.length)
            )}
          </div>

          <div className="nav-group">
            <div className="nav-heading">Projects</div>
            {projects.length === 0 ? (
              <p className="nav-empty">Turn a one-off task into a project from its menu.</p>
            ) : (
              projects.map(p => (
                <Link
                  key={p.id}
                  href={`/project/${p.id}`}
                  data-nav="project"
                  className={`nav-item ${activeProjectId === p.id ? 'active' : ''}`}
                  onClick={onCloseMobile}
                >
                  <span className="nav-chip">
                    <Icon name="folder" />
                  </span>
                  <span className="nav-label">{p.title}</span>
                  <span className="nav-count">
                    {p.done}/{p.total}
                  </span>
                </Link>
              ))
            )}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" data-nav="settings" onClick={onOpenSettings}>
            <span className="nav-chip">
              <Icon name="settings" />
            </span>
            <span className="nav-label">Settings</span>
            <Kbd>,</Kbd>
          </button>
        </div>
      </aside>
    </>
  )
}
