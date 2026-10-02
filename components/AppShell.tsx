'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Mode } from '@/types'
import { loadProjects } from '@/lib/storage'
import { useSettings } from '@/lib/settings'
import Sidebar, { SidebarProject, View } from '@/components/Sidebar'
import SettingsModal, { SettingsTab } from '@/components/SettingsModal'
import Icon from '@/components/Icon'

interface Props {
  mode: Mode
  onModeChange: (m: Mode) => void
  activeView: View | null
  onSelectView: (v: View) => void
  counts: Partial<Record<View, number>>
  activeProjectId?: string
  /** Bump to make the shell re-read projects from storage. */
  refreshKey?: unknown
  onDataChanged: () => void
  topbarTitle: string
  children: ReactNode
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export default function AppShell({
  mode,
  onModeChange,
  activeView,
  onSelectView,
  counts,
  activeProjectId,
  refreshKey,
  onDataChanged,
  topbarTitle,
  children,
}: Props) {
  const [settings, updateSettings] = useSettings()
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [projectsVersion, setProjectsVersion] = useState(0)

  const [projects, setProjects] = useState<SidebarProject[]>([])

  useEffect(() => {
    setProjects(
      loadProjects(mode).map(p => ({
        id: p.id,
        title: p.title,
        done: p.phases.filter(ph => ph.status === 'done').length,
        total: p.phases.length,
      }))
    )
  }, [mode, refreshKey, projectsVersion])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || settingsTab) {
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
          e.preventDefault()
          setSettingsTab('appearance')
        }
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        setSettingsTab('appearance')
      } else if (e.key === '?') {
        e.preventDefault()
        setSettingsTab('shortcuts')
      } else if (e.key === '[') {
        e.preventDefault()
        updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsTab, settings.sidebarCollapsed, updateSettings])

  return (
    <div className={`app ${settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        mode={mode}
        onModeChange={onModeChange}
        activeView={activeView}
        onSelectView={onSelectView}
        counts={counts}
        projects={projects}
        activeProjectId={activeProjectId}
        onOpenSettings={() => setSettingsTab('appearance')}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="main">
        <div className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Icon name="sidebar" />
          </button>
          <button
            className="icon-btn desktop-only"
            onClick={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            aria-label={settings.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title="Toggle sidebar ( [ )"
          >
            <Icon name="sidebar" />
          </button>
          <span className="topbar-title">{topbarTitle}</span>
          <div className="topbar-spacer" />
          <button className="icon-btn" onClick={() => setSettingsTab('appearance')} aria-label="Settings" title="Settings ( , )">
            <Icon name="settings" />
          </button>
        </div>
        {children}
      </div>

      {settingsTab && (
        <SettingsModal
          initialTab={settingsTab}
          settings={settings}
          onChange={updateSettings}
          mode={mode}
          onModeChange={onModeChange}
          onDataChanged={() => {
            setProjectsVersion(v => v + 1)
            onDataChanged()
          }}
          onClose={() => setSettingsTab(null)}
        />
      )}
    </div>
  )
}
