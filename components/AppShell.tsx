'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Mode } from '@/types'
import { loadProjects } from '@/lib/storage'
import { useSettings } from '@/lib/settings'
import Sidebar, { SidebarProject, View } from '@/components/Sidebar'
import SettingsModal, { SettingsTab } from '@/components/SettingsModal'
import Icon from '@/components/Icon'
import { LOCAL_CHANGE_EVENT, DATA_CHANGE_EVENT } from '@/lib/todos'
import { getMsConfig, getMsal, lastAccountHint, signIn } from '@/lib/sync/msal'
import { loadLinks, pendingCount, requestSync, STATUS_EVENT } from '@/lib/sync/engine'
import { formatAgo, useSyncStatus } from '@/lib/sync/useSync'

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
  const [linked, setLinked] = useState(false)
  const [pending, setPending] = useState(0)
  const syncStatus = useSyncStatus()

  // Always start MSAL so a sign-in redirect gets completed, even when syncing is manual.
  useEffect(() => {
    getMsal()?.catch(() => {})
  }, [])

  // Sign-in renewal: Microsoft caps browser-app sign-ins at about a day. When a synced workspace finds
  // itself signed out on a device that has signed in before, go back through Microsoft once per browser
  // session. With an active Microsoft session that returns straight away, without asking anything.
  useEffect(() => {
    if (syncStatus.phase !== 'signed-out' || !loadLinks()[mode] || !lastAccountHint()) return
    if (sessionStorage.getItem('arcade-auto-signin')) return
    if (isTypingTarget(document.activeElement)) return
    sessionStorage.setItem('arcade-auto-signin', '1')
    signIn().catch(() => {})
  }, [syncStatus.phase, mode])

  // Optional background sync: on load, shortly after local edits, on focus and every minute.
  useEffect(() => {
    if (!getMsConfig() || !settings.autoSync) return
    getMsal()
      ?.then(() => requestSync())
      .catch(() => {})
    let debounce: ReturnType<typeof setTimeout>
    const soon = () => {
      clearTimeout(debounce)
      debounce = setTimeout(requestSync, 1200)
    }
    const now = () => requestSync()
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') requestSync()
    }, 60000)
    window.addEventListener(LOCAL_CHANGE_EVENT, soon)
    window.addEventListener('focus', now)
    window.addEventListener('online', now)
    return () => {
      clearTimeout(debounce)
      clearInterval(tick)
      window.removeEventListener(LOCAL_CHANGE_EVENT, soon)
      window.removeEventListener('focus', now)
      window.removeEventListener('online', now)
    }
  }, [settings.autoSync])

  useEffect(() => {
    const update = () => {
      setLinked(!!loadLinks()[mode])
      setPending(pendingCount(mode))
    }
    update()
    window.addEventListener(STATUS_EVENT, update)
    window.addEventListener(LOCAL_CHANGE_EVENT, update)
    window.addEventListener(DATA_CHANGE_EVENT, update)
    return () => {
      window.removeEventListener(STATUS_EVENT, update)
      window.removeEventListener(LOCAL_CHANGE_EVENT, update)
      window.removeEventListener(DATA_CHANGE_EVENT, update)
    }
  }, [mode])

  useEffect(() => {
    const bump = () => setProjectsVersion(v => v + 1)
    window.addEventListener(DATA_CHANGE_EVENT, bump)
    return () => window.removeEventListener(DATA_CHANGE_EVENT, bump)
  }, [])

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
      } else if ((e.key === 's' || e.key === 'S') && loadLinks()[mode]) {
        e.preventDefault()
        requestSync()
      } else if (e.key === '[') {
        e.preventDefault()
        updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsTab, settings.sidebarCollapsed, updateSettings, mode])

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
          {linked && (
            <button
              className={`sync-btn is-${syncStatus.phase}`}
              onClick={() =>
                syncStatus.phase === 'signed-out'
                  ? signIn()
                  : syncStatus.phase === 'error'
                  ? setSettingsTab('sync')
                  : requestSync()
              }
              disabled={syncStatus.phase === 'syncing'}
              title={
                syncStatus.error ??
                `Sync with Microsoft To Do (S) · last synced ${formatAgo(syncStatus.lastSync ?? loadLinks()[mode]?.lastSync)}`
              }
            >
              <Icon name={syncStatus.phase === 'error' || syncStatus.phase === 'signed-out' ? 'cloudOff' : 'refresh'} size={14} />
              <span>
                {syncStatus.phase === 'syncing'
                  ? 'Syncing…'
                  : syncStatus.phase === 'signed-out'
                  ? 'Sign in to sync'
                  : syncStatus.phase === 'error'
                  ? 'Sync failed'
                  : syncStatus.phase === 'offline'
                  ? 'Offline'
                  : 'Sync'}
              </span>
              {pending > 0 && syncStatus.phase !== 'syncing' && (
                <span className="sync-badge" title={`${pending} change${pending === 1 ? '' : 's'} not yet in To Do`}>
                  {pending}
                </span>
              )}
            </button>
          )}
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
