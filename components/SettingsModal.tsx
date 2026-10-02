'use client'

import { ReactNode, useRef, useState } from 'react'
import { CATEGORY_LABEL, CATEGORY_ORDER, Category, Mode, MODE_LABEL } from '@/types'
import { Settings, ThemeChoice } from '@/lib/settings'
import { THEMES } from '@/lib/themes'
import { loadTodos, saveTodos } from '@/lib/todos'
import Icon, { IconName } from '@/components/Icon'
import { ConfirmDialog, Kbd, Modal, Segmented, Switch } from '@/components/ui'

export type SettingsTab = 'appearance' | 'tasks' | 'data' | 'shortcuts' | 'about'

const TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'tasks', label: 'Tasks', icon: 'listChecks' },
  { id: 'data', label: 'Data', icon: 'database' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
  { id: 'about', label: 'About', icon: 'info' },
]

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['N'], label: 'New task' },
  { keys: ['/'], label: 'Search tasks' },
  { keys: ['1', '–', '8'], label: 'Jump to view' },
  { keys: ['['], label: 'Toggle sidebar' },
  { keys: [','], label: 'Open settings' },
  { keys: ['?'], label: 'Keyboard shortcuts' },
  { keys: ['Enter'], label: 'Save task or edit' },
  { keys: ['Esc'], label: 'Cancel, close or clear' },
  { keys: ['Double-click'], label: 'Edit a task inline' },
]

const STORAGE_PREFIX = 'arcade-'

interface Props {
  initialTab?: SettingsTab
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  mode: Mode
  onModeChange: (m: Mode) => void
  onDataChanged: () => void
  onClose: () => void
}

export default function SettingsModal({ initialTab = 'appearance', settings, onChange, mode, onModeChange, onDataChanged, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [confirm, setConfirm] = useState<null | 'clear' | 'reset' | { importData: Record<string, string> }>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3000)
  }

  const exportData = () => {
    const data: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) data[key] = localStorage.getItem(key) ?? ''
    }
    const blob = new Blob([JSON.stringify({ app: 'arcade-todo', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arcade-tasks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    flash('Backup downloaded')
  }

  const readImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      const data = parsed?.data
      if (!data || typeof data !== 'object') throw new Error()
      const entries = Object.entries(data).filter(([k, v]) => k.startsWith(STORAGE_PREFIX) && typeof v === 'string')
      if (entries.length === 0) throw new Error()
      setConfirm({ importData: Object.fromEntries(entries) as Record<string, string> })
    } catch {
      flash('That file is not an Arcade backup')
    }
  }

  const completedCount = loadTodos(mode).filter(t => t.done).length

  const runConfirm = () => {
    if (confirm === 'clear') {
      saveTodos(mode, loadTodos(mode).filter(t => !t.done))
      onDataChanged()
      flash('Completed tasks cleared')
    } else if (confirm === 'reset') {
      Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX)).forEach(k => localStorage.removeItem(k))
      window.location.href = '/'
      return
    } else if (confirm && 'importData' in confirm) {
      Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX)).forEach(k => localStorage.removeItem(k))
      Object.entries(confirm.importData).forEach(([k, v]) => localStorage.setItem(k, v))
      window.location.href = '/'
      return
    }
    setConfirm(null)
  }

  return (
    <Modal onClose={onClose} labelledBy="settings-title" className="dialog-settings">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <h2 id="settings-title" className="settings-title">Settings</h2>
          {TABS.map(t => (
            <button key={t.id} className={`settings-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-body">
          <button className="icon-btn settings-close" onClick={onClose} aria-label="Close settings">
            <Icon name="x" />
          </button>

          {tab === 'appearance' && (
            <Section title="Appearance" subtitle="Make the app feel like yours.">
              <Group label="Theme">
                <div className="theme-grid">
                  <ThemeCard
                    active={settings.theme === 'system'}
                    label="System"
                    onClick={() => onChange({ theme: 'system' })}
                    preview={
                      <div className="theme-split">
                        <ThemePreview swatch={THEMES[0].swatch} />
                        <ThemePreview swatch={THEMES.find(t => t.id === 'midnight')!.swatch} />
                      </div>
                    }
                  />
                  {THEMES.map(t => (
                    <ThemeCard
                      key={t.id}
                      active={settings.theme === t.id}
                      label={t.label}
                      onClick={() => onChange({ theme: t.id as ThemeChoice })}
                      preview={<ThemePreview swatch={t.swatch} />}
                    />
                  ))}
                </div>
              </Group>
              <Row label="Density" hint="Compact fits more tasks on screen.">
                <Segmented
                  label="Density"
                  value={settings.density}
                  onChange={density => onChange({ density })}
                  options={[
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                />
              </Row>
              <Row label="Text size">
                <Segmented
                  label="Text size"
                  value={settings.fontScale}
                  onChange={fontScale => onChange({ fontScale })}
                  options={[
                    { value: 'sm', label: <span style={{ fontSize: 12 }}>Aa</span> },
                    { value: 'md', label: <span style={{ fontSize: 14 }}>Aa</span> },
                    { value: 'lg', label: <span style={{ fontSize: 16 }}>Aa</span> },
                  ]}
                />
              </Row>
              <Row label="Reduce motion" hint="Turn off animations and transitions.">
                <Switch label="Reduce motion" checked={settings.reduceMotion} onChange={reduceMotion => onChange({ reduceMotion })} />
              </Row>
            </Section>
          )}

          {tab === 'tasks' && (
            <Section title="Tasks" subtitle="Defaults and how lists behave.">
              <Row label="Your name" hint="Used in the greeting on the Today view.">
                <input
                  className="field"
                  value={settings.name}
                  onChange={e => onChange({ name: e.target.value })}
                  placeholder="Optional"
                  maxLength={40}
                />
              </Row>
              <Row label="Default repeat" hint="Applied to new tasks.">
                <select
                  className="field"
                  value={settings.defaultCategory}
                  onChange={e => onChange({ defaultCategory: e.target.value as Category })}
                >
                  {CATEGORY_ORDER.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c].replace('...', '')}</option>
                  ))}
                </select>
              </Row>
              <Row label="Sort tasks by">
                <Segmented
                  label="Sort tasks by"
                  value={settings.sort}
                  onChange={sort => onChange({ sort })}
                  options={[
                    { value: 'manual', label: 'Manual' },
                    { value: 'due', label: 'Due date' },
                    { value: 'alpha', label: 'A–Z' },
                  ]}
                />
              </Row>
              <Row label="Week starts on">
                <Segmented
                  label="Week starts on"
                  value={settings.weekStartsOn}
                  onChange={weekStartsOn => onChange({ weekStartsOn })}
                  options={[
                    { value: 1, label: 'Monday' },
                    { value: 0, label: 'Sunday' },
                  ]}
                />
              </Row>
              <Row label="Show completed tasks" hint="Keep finished tasks visible below your list.">
                <Switch label="Show completed tasks" checked={settings.showCompleted} onChange={showCompleted => onChange({ showCompleted })} />
              </Row>
              <Row label="Confirm before deleting" hint="Otherwise you can undo from the toast.">
                <Switch label="Confirm before deleting" checked={settings.confirmDelete} onChange={confirmDelete => onChange({ confirmDelete })} />
              </Row>
            </Section>
          )}

          {tab === 'data' && (
            <Section title="Data" subtitle="Everything is stored locally in this browser.">
              <Row label="Workspace" hint="Personal and Work keep separate tasks and projects.">
                <Segmented
                  label="Workspace"
                  value={mode}
                  onChange={onModeChange}
                  options={(['personal', 'work'] as Mode[]).map(m => ({ value: m, label: MODE_LABEL[m] }))}
                />
              </Row>
              <Row label="Export backup" hint="Download all tasks, projects and settings as JSON.">
                <button className="btn btn-secondary" onClick={exportData}>
                  <Icon name="download" size={14} /> Export
                </button>
              </Row>
              <Row label="Import backup" hint="Replaces everything with the contents of a backup file.">
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={14} /> Import
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) readImport(f)
                    e.target.value = ''
                  }}
                />
              </Row>
              <div className="danger-zone">
                <div className="danger-zone-title">Danger zone</div>
                <Row label="Clear completed" hint={`Remove ${completedCount} completed task${completedCount === 1 ? '' : 's'} from ${MODE_LABEL[mode]}.`}>
                  <button className="btn btn-secondary" disabled={completedCount === 0} onClick={() => setConfirm('clear')}>
                    Clear
                  </button>
                </Row>
                <Row label="Reset everything" hint="Delete all tasks, projects and settings in both workspaces.">
                  <button className="btn btn-danger" onClick={() => setConfirm('reset')}>
                    Reset
                  </button>
                </Row>
              </div>
            </Section>
          )}

          {tab === 'shortcuts' && (
            <Section title="Keyboard shortcuts" subtitle="Move fast without leaving the keyboard.">
              <div className="shortcut-list">
                {SHORTCUTS.map(s => (
                  <div className="shortcut" key={s.label}>
                    <span>{s.label}</span>
                    <span className="shortcut-keys">
                      {s.keys.map((k, i) => (k === '–' ? <span key={i} className="muted">–</span> : <Kbd key={i}>{k}</Kbd>))}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {tab === 'about' && (
            <Section title="About" subtitle="">
              <div className="about">
                <div className="brand-mark brand-mark-lg">
                  <Icon name="check" size={26} />
                </div>
                <div>
                  <div className="about-name">Arcade Tasks</div>
                  <div className="muted">Version 1.0 · Local-first, no account required</div>
                </div>
              </div>
              <p className="about-copy">
                Plan your day with smart views, recurring tasks, and projects broken into phases. Your data never leaves this
                browser — use Export to keep a backup or move to another device.
              </p>
            </Section>
          )}

          {notice && <div className="settings-notice" role="status"><Icon name="check" size={14} /> {notice}</div>}
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          danger
          title={confirm === 'clear' ? 'Clear completed tasks?' : confirm === 'reset' ? 'Reset everything?' : 'Import backup?'}
          body={
            confirm === 'clear'
              ? `This permanently removes ${completedCount} completed task${completedCount === 1 ? '' : 's'} from ${MODE_LABEL[mode]}.`
              : confirm === 'reset'
              ? 'All tasks, projects and settings will be permanently deleted. Export a backup first if you might need them.'
              : 'Your current tasks, projects and settings will be replaced by the backup.'
          }
          confirmLabel={confirm === 'clear' ? 'Clear' : confirm === 'reset' ? 'Reset everything' : 'Replace data'}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Modal>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      <div className="settings-row-label">{label}</div>
      {children}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function ThemeCard({ active, label, onClick, preview }: { active: boolean; label: string; onClick: () => void; preview: ReactNode }) {
  return (
    <button className={`theme-card ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      <div className="theme-card-preview">{preview}</div>
      <div className="theme-card-label">
        {label}
        {active && <Icon name="check" size={12} />}
      </div>
    </button>
  )
}

function ThemePreview({ swatch: [bg, surface, accent, text] }: { swatch: [string, string, string, string] }) {
  return (
    <div className="theme-preview" style={{ background: bg }}>
      <div className="tp-side" style={{ background: surface }}>
        <span style={{ background: accent }} />
        <span style={{ background: text, opacity: 0.25 }} />
        <span style={{ background: text, opacity: 0.25 }} />
      </div>
      <div className="tp-main">
        <span className="tp-line" style={{ background: text, opacity: 0.85, width: '55%' }} />
        <span className="tp-card" style={{ background: surface }}>
          <i style={{ borderColor: accent }} />
          <b style={{ background: text, opacity: 0.3 }} />
        </span>
        <span className="tp-card" style={{ background: surface }}>
          <i style={{ borderColor: accent, background: accent }} />
          <b style={{ background: text, opacity: 0.2 }} />
        </span>
      </div>
    </div>
  )
}
