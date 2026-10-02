'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Mode, Phase, PhaseStatus, Project, PHASE_STATUS_LABEL, PHASE_STATUS_ORDER } from '@/types'
import { addPhase, deletePhase, deleteProject, getProject, reorderPhases, updatePhase, updateProject } from '@/lib/storage'
import { loadMode, loadTodos, saveMode, saveTodos, shouldShowToday } from '@/lib/todos'
import { addDays, formatRelativeDate, getTodayString, isOverdue } from '@/lib/date'
import AppShell from '@/components/AppShell'
import { ALL_VIEWS, View } from '@/components/Sidebar'
import Icon, { IconName } from '@/components/Icon'
import { ConfirmDialog, Menu, MenuItem, MenuLabel, MenuSeparator, Toast, ToastData } from '@/components/ui'

const STATUS_ICON: Record<PhaseStatus, IconName> = { pending: 'circle', active: 'play', done: 'check' }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderMarkdown(text: string) {
  const html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<span class="md-li">$1</span>')
    .replace(/\n/g, '<br/>')
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [mode, setMode] = useState<Mode>('personal')
  const [mounted, setMounted] = useState(false)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')

  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null)
  const [phaseTitleDraft, setPhaseTitleDraft] = useState('')
  const [phaseDescDraft, setPhaseDescDraft] = useState('')
  const [newPhaseTitle, setNewPhaseTitle] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    const m = loadMode()
    setMode(m)
    setProject(getProject(m, projectId) ?? null)
    setMounted(true)
  }, [projectId])

  const refresh = () => setProject(getProject(mode, projectId) ?? null)

  const counts = useMemo(() => {
    const todos = mounted ? loadTodos(mode) : []
    const c: Partial<Record<View, number>> = {}
    for (const v of ALL_VIEWS) {
      c[v] = todos.filter(t => {
        if (t.done) return false
        if (v === 'today') return shouldShowToday(t.dueDate, t.recurrenceDays)
        if (v === 'upcoming') return !!t.dueDate && t.dueDate > getTodayString()
        if (v === 'all') return true
        return t.category === v
      }).length
    }
    return c
  }, [mode, mounted])

  const goToView = (v: View) => router.push(v === 'today' ? '/' : `/?view=${v}`)

  const changeMode = (m: Mode) => {
    saveMode(m)
    router.push('/')
  }

  const shell = (title: string, body: React.ReactNode) => (
    <AppShell
      mode={mode}
      onModeChange={changeMode}
      activeView={null}
      onSelectView={goToView}
      counts={counts}
      activeProjectId={projectId}
      refreshKey={project}
      onDataChanged={refresh}
      topbarTitle={title}
    >
      {body}
      <Toast toast={toast} onDismiss={dismissToast} />
    </AppShell>
  )

  if (!mounted) return shell('Project', <div className="content" />)

  if (!project) {
    return shell(
      'Project',
      <div className="content">
        <div className="empty">
          <div className="empty-icon">
            <Icon name="folder" size={22} />
          </div>
          <div className="empty-title">Project not found</div>
          <p className="empty-body">It may have been deleted, or it belongs to the other workspace.</p>
          <Link href="/" className="btn btn-secondary" style={{ marginTop: 16 }}>
            <Icon name="arrowLeft" size={14} /> Back to tasks
          </Link>
        </div>
      </div>
    )
  }

  /* ---------- Actions ---------- */

  const saveProject = (patch: Partial<Project>) => {
    updateProject(mode, { ...project, ...patch })
    refresh()
  }

  const setPhaseStatus = (phase: Phase, status: PhaseStatus) => {
    updatePhase(mode, projectId, { ...phase, status, completedAt: status === 'done' ? new Date().toISOString() : undefined })
    refresh()
  }

  const cycleStatus = (phase: Phase) => {
    const next = PHASE_STATUS_ORDER[(PHASE_STATUS_ORDER.indexOf(phase.status) + 1) % PHASE_STATUS_ORDER.length]
    setPhaseStatus(phase, next)
  }

  const handleAddPhase = () => {
    const title = newPhaseTitle.trim()
    if (!title) return
    addPhase(mode, projectId, title)
    setNewPhaseTitle('')
    refresh()
  }

  const startEditPhase = (phase: Phase) => {
    setEditingPhaseId(phase.id)
    setPhaseTitleDraft(phase.title)
    setPhaseDescDraft(phase.description)
  }

  const saveEditPhase = (phase: Phase) => {
    updatePhase(mode, projectId, { ...phase, title: phaseTitleDraft.trim() || phase.title, description: phaseDescDraft })
    setEditingPhaseId(null)
    refresh()
  }

  const handleDeletePhase = (phase: Phase) => {
    const before = project.phases.map(p => p.id)
    deletePhase(mode, projectId, phase.id)
    refresh()
    setToast({
      id: Date.now(),
      message: `Deleted “${phase.title}”`,
      onAction: () => {
        const current = getProject(mode, projectId)
        if (!current) return
        updateProject(mode, { ...current, phases: [...current.phases, phase] })
        reorderPhases(mode, projectId, before)
        refresh()
      },
    })
  }

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    const ids = project.phases.map(p => p.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    ids.splice(from, 1)
    ids.splice(to, 0, draggingId)
    reorderPhases(mode, projectId, ids)
    refresh()
  }

  const handleDeleteProject = () => {
    deleteProject(mode, projectId)
    saveTodos(
      mode,
      loadTodos(mode).map(t => (t.projectId === projectId ? { ...t, isProject: false, projectId: undefined } : t))
    )
    router.push('/')
  }

  /* ---------- Derived ---------- */

  const total = project.phases.length
  const done = project.phases.filter(p => p.status === 'done').length
  const active = project.phases.filter(p => p.status === 'active').length
  const pct = total ? Math.round((done / total) * 100) : 0
  const created = new Date(project.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

  return shell(
    project.title,
    <div className="content">
      <div className="breadcrumb">
        <Link href="/">Tasks</Link>
        <Icon name="chevronRight" size={12} />
        <span>Projects</span>
      </div>

      <header className="page-head project-head">
        <div className="page-head-text">
          {editingTitle ? (
            <input
              className="title-input"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              onBlur={() => {
                if (titleDraft.trim()) saveProject({ title: titleDraft.trim() })
                setEditingTitle(false)
              }}
              autoFocus
              aria-label="Project title"
            />
          ) : (
            <h1
              className="page-title editable"
              onClick={() => {
                setTitleDraft(project.title)
                setEditingTitle(true)
              }}
              title="Click to rename"
            >
              {project.title}
            </h1>
          )}
          <p className="page-subtitle">
            Created {created} · {total} phase{total === 1 ? '' : 's'}
          </p>
        </div>
        <Menu label="Project options" width={220}>
          {close => (
            <>
              <MenuItem
                icon="pencil"
                onClick={() => {
                  setTitleDraft(project.title)
                  setEditingTitle(true)
                  close()
                }}
              >
                Rename
              </MenuItem>
              <MenuItem
                icon="pencil"
                onClick={() => {
                  setDescDraft(project.description)
                  setEditingDesc(true)
                  close()
                }}
              >
                Edit description
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon="trash"
                danger
                onClick={() => {
                  setConfirmDelete(true)
                  close()
                }}
              >
                Delete project
              </MenuItem>
            </>
          )}
        </Menu>
      </header>

      <div className="project-stats">
        <div className="stat">
          <div className="stat-value">{pct}%</div>
          <div className="stat-label">Complete</div>
        </div>
        <div className="stat">
          <div className="stat-value">{done}</div>
          <div className="stat-label">Done</div>
        </div>
        <div className="stat">
          <div className="stat-value">{active}</div>
          <div className="stat-label">In progress</div>
        </div>
        <div className="stat">
          <div className="stat-value">{total - done - active}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-bar" aria-label={`${pct}% complete`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <section className="card desc-card">
        <div className="card-head">
          <span className="card-title">Overview</span>
          {!editingDesc && (
            <button
              className="text-btn"
              onClick={() => {
                setDescDraft(project.description)
                setEditingDesc(true)
              }}
            >
              {project.description ? 'Edit' : 'Add'}
            </button>
          )}
        </div>
        {editingDesc ? (
          <div className="desc-edit">
            <textarea
              className="field textarea"
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              placeholder="What is this project about? Supports **bold**, *italic*, `code` and - lists."
              rows={6}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Escape') setEditingDesc(false)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  saveProject({ description: descDraft })
                  setEditingDesc(false)
                }
              }}
            />
            <div className="row-end">
              <span className="muted small">⌘ Enter to save</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingDesc(false)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  saveProject({ description: descDraft })
                  setEditingDesc(false)
                }}
              >
                Save
              </button>
            </div>
          </div>
        ) : project.description ? (
          renderMarkdown(project.description)
        ) : (
          <p className="muted">No overview yet. Describe the goal so future-you knows what “done” looks like.</p>
        )}
      </section>

      <div className="group-head phases-head">
        <span>
          Phases <span className="group-count">{total}</span>
        </span>
      </div>

      <ol className="timeline">
        {project.phases.map(phase => {
          const editing = editingPhaseId === phase.id
          const overdue = phase.status !== 'done' && isOverdue(phase.dueDate)
          return (
            <li
              key={phase.id}
              className={`phase is-${phase.status} ${draggingId === phase.id ? 'dragging' : ''} ${
                dragOverId === phase.id && draggingId !== phase.id ? 'drag-over' : ''
              }`}
              draggable={!editing}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', phase.id)
                setDraggingId(phase.id)
              }}
              onDragEnd={() => {
                setDraggingId(null)
                setDragOverId(null)
              }}
              onDragOver={e => {
                e.preventDefault()
                setDragOverId(phase.id)
              }}
              onDrop={e => {
                e.preventDefault()
                handleDrop(phase.id)
                setDraggingId(null)
                setDragOverId(null)
              }}
            >
              <button
                className="phase-node"
                onClick={() => cycleStatus(phase)}
                aria-label={`${phase.title}: ${PHASE_STATUS_LABEL[phase.status]}. Click to change status.`}
                title="Click to change status"
              >
                <Icon name={STATUS_ICON[phase.status]} size={12} />
              </button>

              <div className="phase-card">
                {editing ? (
                  <div className="phase-edit">
                    <input
                      className="field"
                      value={phaseTitleDraft}
                      onChange={e => setPhaseTitleDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEditPhase(phase)
                        if (e.key === 'Escape') setEditingPhaseId(null)
                      }}
                      autoFocus
                      aria-label="Phase title"
                    />
                    <textarea
                      className="field textarea"
                      value={phaseDescDraft}
                      onChange={e => setPhaseDescDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setEditingPhaseId(null)
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEditPhase(phase)
                      }}
                      placeholder="Notes, acceptance criteria, links…"
                      rows={4}
                      aria-label="Phase description"
                    />
                    <div className="row-end">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingPhaseId(null)}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={() => saveEditPhase(phase)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="phase-top">
                      <span className="task-grip" aria-hidden="true">
                        <Icon name="grip" size={14} />
                      </span>
                      <h3 className="phase-title" onDoubleClick={() => startEditPhase(phase)}>
                        {phase.title}
                      </h3>
                      <span className={`status-pill is-${phase.status}`}>{PHASE_STATUS_LABEL[phase.status]}</span>
                      <PhaseMenu
                        phase={phase}
                        onEdit={() => startEditPhase(phase)}
                        onStatus={s => setPhaseStatus(phase, s)}
                        onDue={dueDate => {
                          updatePhase(mode, projectId, { ...phase, dueDate })
                          refresh()
                        }}
                        onDelete={() => handleDeletePhase(phase)}
                      />
                    </div>
                    {phase.description ? (
                      <div className="phase-desc">{renderMarkdown(phase.description)}</div>
                    ) : (
                      <button className="text-btn phase-add-desc" onClick={() => startEditPhase(phase)}>
                        + Add notes
                      </button>
                    )}
                    {(phase.dueDate || phase.completedAt) && (
                      <div className="task-meta">
                        {phase.dueDate && (
                          <span className={`chip chip-due ${overdue ? 'is-overdue' : ''}`}>
                            <Icon name={overdue ? 'flag' : 'calendar'} size={12} />
                            {overdue ? 'Overdue · ' : 'Due '}
                            {formatRelativeDate(phase.dueDate)}
                          </span>
                        )}
                        {phase.completedAt && (
                          <span className="chip chip-plain">
                            Completed {formatRelativeDate(phase.completedAt.slice(0, 10)).toLowerCase()}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}

        <li className="phase phase-new">
          <span className="phase-node">
            <Icon name="plus" size={12} />
          </span>
          <div className="composer composer-inline">
            <div className="composer-main">
              <input
                className="composer-input"
                type="text"
                placeholder="Add a phase…"
                value={newPhaseTitle}
                onChange={e => setNewPhaseTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPhase()}
                aria-label="New phase title"
              />
              <button className="btn btn-primary btn-sm" onClick={handleAddPhase} disabled={!newPhaseTitle.trim()}>
                Add phase
              </button>
            </div>
          </div>
        </li>
      </ol>

      {confirmDelete && (
        <ConfirmDialog
          danger
          title="Delete this project?"
          body={`“${project.title}” and its ${total} phase${total === 1 ? '' : 's'} will be permanently deleted. The original task stays in your list.`}
          confirmLabel="Delete project"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDeleteProject}
        />
      )}
    </div>
  )
}

function PhaseMenu({
  phase,
  onEdit,
  onStatus,
  onDue,
  onDelete,
}: {
  phase: Phase
  onEdit: () => void
  onStatus: (s: PhaseStatus) => void
  onDue: (d: string | undefined) => void
  onDelete: () => void
}) {
  const dateRef = useRef<HTMLInputElement>(null)
  const today = getTodayString()
  return (
    <>
      <Menu label="Phase options" triggerClassName="icon-btn icon-btn-sm" width={248}>
        {close => {
          const run = (fn: () => void) => () => {
            fn()
            close()
          }
          return (
            <>
              <MenuItem icon="pencil" onClick={run(onEdit)}>Edit</MenuItem>
              <MenuSeparator />
              <MenuLabel>Status</MenuLabel>
              {PHASE_STATUS_ORDER.map(s => (
                <MenuItem key={s} icon={STATUS_ICON[s]} checked={phase.status === s} onClick={run(() => onStatus(s))}>
                  {PHASE_STATUS_LABEL[s]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuLabel>Due date</MenuLabel>
              <div className="menu-quick">
                <button className={phase.dueDate === today ? 'active' : ''} onClick={run(() => onDue(today))}>Today</button>
                <button className={phase.dueDate === addDays(today, 7) ? 'active' : ''} onClick={run(() => onDue(addDays(today, 7)))}>
                  +1 week
                </button>
                <button
                  onClick={run(() => {
                    try {
                      dateRef.current?.showPicker()
                    } catch {
                      dateRef.current?.focus()
                    }
                  })}
                  aria-label="Pick a date"
                >
                  <Icon name="calendar" size={14} />
                </button>
                {phase.dueDate && (
                  <button onClick={run(() => onDue(undefined))} aria-label="Remove due date">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              <MenuSeparator />
              <MenuItem icon="trash" danger onClick={run(onDelete)}>Delete phase</MenuItem>
            </>
          )
        }}
      </Menu>
      <input
        ref={dateRef}
        type="date"
        className="hidden-date"
        value={phase.dueDate ?? ''}
        onChange={e => onDue(e.target.value || undefined)}
        tabIndex={-1}
        aria-label="Phase due date"
      />
    </>
  )
}
