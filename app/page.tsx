'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Category, CATEGORY_LABEL, CATEGORY_ORDER, DAY_LABELS, Mode, RecurrenceDays, Todo } from '@/types'
import { createProjectFromTodo, loadProjects } from '@/lib/storage'
import { loadMode, loadTodos, saveMode, saveTodos, shouldShowToday, getNextDueDate } from '@/lib/todos'
import { addDays, formatLongToday, formatRelativeDate, getTodayString, greeting, isDueToday, isOverdue } from '@/lib/date'
import { Settings, useSettings } from '@/lib/settings'
import AppShell, { isTypingTarget } from '@/components/AppShell'
import { ALL_VIEWS, View, VIEW_LABEL } from '@/components/Sidebar'
import Icon from '@/components/Icon'
import { ConfirmDialog, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, ProgressRing, Toast, ToastData } from '@/components/ui'

const REPEAT_LABEL: Record<Category, string> = { ...CATEGORY_LABEL, custom: 'Custom days' }

function orderedDays(weekStartsOn: 0 | 1): number[] {
  return weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
}

function matchesView(t: Todo, view: View): boolean {
  if (view === 'today') return shouldShowToday(t.dueDate, t.recurrenceDays)
  if (view === 'upcoming') return !!t.dueDate && t.dueDate > getTodayString()
  if (view === 'all') return true
  return t.category === view
}

function sortTodos(list: Todo[], sort: Settings['sort']): Todo[] {
  if (sort === 'alpha') return [...list].sort((a, b) => a.text.localeCompare(b.text))
  if (sort === 'due') return [...list].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  return list
}

export default function Home() {
  const router = useRouter()
  const [settings] = useSettings()
  const [todos, setTodos] = useState<Todo[]>([])
  const [mode, setMode] = useState<Mode>('personal')
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState<View>('today')
  const [search, setSearch] = useState('')

  const [input, setInput] = useState('')
  const [newCategory, setNewCategory] = useState<Category>('once')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRecurrenceDays, setNewRecurrenceDays] = useState<RecurrenceDays>([])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [completedOpen, setCompletedOpen] = useState(true)
  const [justCompleted, setJustCompleted] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; todo: Todo } | { kind: 'clear' }>(null)

  const composerRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const composerDateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const m = loadMode()
    setMode(m)
    setTodos(loadTodos(m))
    const param = new URLSearchParams(window.location.search).get('view') as View | null
    if (param && ALL_VIEWS.includes(param)) setView(param)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) saveTodos(mode, todos)
  }, [todos, mode, mounted])

  useEffect(() => {
    setNewCategory(settings.defaultCategory)
  }, [settings.defaultCategory])

  const selectView = useCallback((v: View) => {
    setView(v)
    if (CATEGORY_ORDER.includes(v as Category)) setNewCategory(v as Category)
    const url = new URL(window.location.href)
    if (v === 'today') url.searchParams.delete('view')
    else url.searchParams.set('view', v)
    window.history.replaceState(null, '', url)
  }, [])

  const applyMode = (next: Mode) => {
    if (next === mode) return
    saveMode(next)
    setMode(next)
    setTodos(loadTodos(next))
    setEditingId(null)
  }

  const showToast = (message: string, onAction?: () => void) => setToast({ id: Date.now(), message, onAction })
  const dismissToast = useCallback(() => setToast(null), [])

  /* ---------- Actions ---------- */

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    const dueDate = newDueDate || (view === 'upcoming' ? addDays(getTodayString(), 1) : undefined)
    const todo: Todo = {
      id: crypto.randomUUID(),
      text,
      done: false,
      category: newCategory,
      dueDate,
      recurrenceDays: newCategory === 'custom' && newRecurrenceDays.length > 0 ? newRecurrenceDays : undefined,
    }
    setTodos(prev => [...prev, todo])
    setInput('')
    setNewDueDate('')
  }

  const toggleTodo = (id: string) => {
    const todo = todos.find(t => t.id === id)
    if (todo && !todo.done) {
      setJustCompleted(id)
      setTimeout(() => setJustCompleted(c => (c === id ? null : c)), 600)
    }
    setTodos(prev => {
      const todo = prev.find(t => t.id === id)
      if (!todo) return prev
      const newDone = !todo.done
      const now = new Date().toISOString()
      if (newDone && todo.category !== 'once' && todo.recurrenceDays && todo.recurrenceDays.length > 0) {
        const nextTodo: Todo = {
          ...todo,
          id: crypto.randomUUID(),
          done: false,
          dueDate: getNextDueDate(todo.dueDate, todo.recurrenceDays),
          completedAt: undefined,
          originalId: todo.originalId || todo.id,
        }
        return prev.map(t => (t.id === id ? { ...t, done: true, completedAt: now } : t)).concat(nextTodo)
      }
      return prev.map(t => (t.id === id ? { ...t, done: newDone, completedAt: newDone ? now : undefined } : t))
    })
  }

  const patchTodo = (id: string, patch: Partial<Todo>) => {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  const performDelete = (todo: Todo) => {
    const index = todos.findIndex(t => t.id === todo.id)
    setTodos(prev => prev.filter(t => t.id !== todo.id))
    showToast('Task deleted', () =>
      setTodos(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, todo)
        return next
      })
    )
  }

  const requestDelete = (todo: Todo) => {
    if (settings.confirmDelete) setConfirm({ kind: 'delete', todo })
    else performDelete(todo)
  }

  const duplicateTodo = (todo: Todo) => {
    const copy: Todo = { ...todo, id: crypto.randomUUID(), done: false, completedAt: undefined, isProject: false, projectId: undefined }
    setTodos(prev => {
      const i = prev.findIndex(t => t.id === todo.id)
      const next = [...prev]
      next.splice(i + 1, 0, copy)
      return next
    })
  }

  const moveToTop = (id: string) => {
    setTodos(prev => {
      const item = prev.find(t => t.id === id)
      return item ? [item, ...prev.filter(t => t.id !== id)] : prev
    })
  }

  const moveBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setTodos(prev => {
      const from = prev.findIndex(t => t.id === sourceId)
      if (from === -1) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      const to = next.findIndex(t => t.id === targetId)
      next.splice(to === -1 ? next.length : to + (from <= to ? 1 : 0), 0, item)
      return next
    })
  }

  const convertToProject = (todo: Todo) => {
    const project = createProjectFromTodo(mode, todo)
    const next = todos.map(t => (t.id === todo.id ? { ...t, isProject: true, projectId: project.id } : t))
    saveTodos(mode, next)
    setTodos(next)
    router.push(`/project/${project.id}`)
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const saveEdit = (id: string) => {
    const text = editText.trim()
    if (text) patchTodo(id, { text })
    setEditingId(null)
  }

  const clearCompleted = () => {
    const removed = todos.filter(t => t.done && matchesView(t, view))
    const ids = new Set(removed.map(t => t.id))
    const before = todos
    setTodos(prev => prev.filter(t => !ids.has(t.id)))
    showToast(`Cleared ${removed.length} completed`, () => setTodos(before))
  }

  /* ---------- Keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.overlay')) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        composerRef.current?.focus()
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (/^[1-8]$/.test(e.key)) {
        selectView(ALL_VIEWS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectView])

  /* ---------- Derived ---------- */

  const projectsById = useMemo(
    () => new Map(loadProjects(mode).map(p => [p.id, p])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, todos]
  )

  const counts = useMemo(() => {
    const c: Partial<Record<View, number>> = {}
    for (const v of ALL_VIEWS) c[v] = todos.filter(t => !t.done && matchesView(t, v)).length
    return c
  }, [todos])

  const query = search.trim().toLowerCase()
  const inView = todos.filter(t => matchesView(t, view) && (!query || t.text.toLowerCase().includes(query)))
  const activeTodos = sortTodos(inView.filter(t => !t.done), view === 'upcoming' ? 'due' : settings.sort)
  const completedTodos = inView.filter(t => t.done).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  const overdueCount = activeTodos.filter(t => isOverdue(t.dueDate)).length
  const viewTotal = activeTodos.length + completedTodos.length
  const progress = viewTotal ? completedTodos.length / viewTotal : 0
  const canDrag = settings.sort === 'manual' && view !== 'upcoming' && !query

  const groups: { key: string; label: string; items: Todo[] }[] = (() => {
    if (view !== 'upcoming') return [{ key: 'all', label: '', items: activeTodos }]
    const map = new Map<string, Todo[]>()
    activeTodos.forEach(t => map.set(t.dueDate!, [...(map.get(t.dueDate!) ?? []), t]))
    return Array.from(map.entries()).map(([date, items]) => ({ key: date, label: formatRelativeDate(date), items }))
  })()

  /* ---------- Render ---------- */

  const renderTask = (todo: Todo) => {
    const overdue = !todo.done && isOverdue(todo.dueDate)
    const today = !todo.done && isDueToday(todo.dueDate)
    const project = todo.projectId ? projectsById.get(todo.projectId) : undefined
    const projectDone = project?.phases.filter(p => p.status === 'done').length ?? 0
    return (
      <TaskRow
        key={todo.id}
        todo={todo}
        draggable={canDrag && !todo.done && editingId !== todo.id}
        className={[
          todo.done && 'done',
          justCompleted === todo.id && 'just-completed',
          draggingId === todo.id && 'dragging',
          dragOverId === todo.id && draggingId !== todo.id && 'drag-over',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragStart={() => setDraggingId(todo.id)}
        onDragEnd={() => {
          setDraggingId(null)
          setDragOverId(null)
        }}
        onDragOver={() => setDragOverId(todo.id)}
        onDrop={() => {
          if (draggingId) moveBefore(draggingId, todo.id)
          setDraggingId(null)
          setDragOverId(null)
        }}
        onToggle={() => toggleTodo(todo.id)}
        editing={editingId === todo.id}
        editText={editText}
        setEditText={setEditText}
        onStartEdit={() => startEdit(todo)}
        onSaveEdit={() => saveEdit(todo.id)}
        onCancelEdit={() => setEditingId(null)}
        onSetDue={dueDate => patchTodo(todo.id, { dueDate })}
        onSetCategory={category =>
          patchTodo(todo.id, { category, recurrenceDays: category === 'custom' ? todo.recurrenceDays : undefined })
        }
        onConvert={() => convertToProject(todo)}
        onOpenProject={() => router.push(`/project/${todo.projectId}`)}
        onMoveToTop={() => moveToTop(todo.id)}
        onDuplicate={() => duplicateTodo(todo)}
        onDelete={() => requestDelete(todo)}
        canMove={settings.sort === 'manual'}
        meta={
          <>
            {todo.dueDate && (
              <span className={`chip chip-due ${overdue ? 'is-overdue' : ''} ${today ? 'is-today' : ''}`}>
                <Icon name={overdue ? 'flag' : 'calendar'} size={12} />
                {overdue ? `Overdue · ${formatRelativeDate(todo.dueDate)}` : formatRelativeDate(todo.dueDate)}
              </span>
            )}
            {todo.category !== 'once' && (
              <span className="chip chip-cat" data-category={todo.category}>
                <Icon name="repeat" size={12} />
                {todo.category === 'custom' && todo.recurrenceDays?.length
                  ? orderedDays(settings.weekStartsOn)
                      .filter(d => todo.recurrenceDays!.includes(d))
                      .map(d => DAY_LABELS[d])
                      .join(' · ')
                  : REPEAT_LABEL[todo.category]}
              </span>
            )}
            {project && (
              <Link href={`/project/${project.id}`} className="chip chip-project">
                <Icon name="folder" size={12} />
                Project · {projectDone}/{project.phases.length}
              </Link>
            )}
            {todo.done && todo.completedAt && (
              <span className="chip chip-plain">Completed {formatRelativeDate(todo.completedAt.slice(0, 10)).toLowerCase()}</span>
            )}
          </>
        }
      />
    )
  }

  const title = !mounted ? '\u00a0' : view === 'today' ? `${greeting()}${settings.name ? `, ${settings.name}` : ''}` : VIEW_LABEL[view]
  const subtitle =
    activeTodos.length === 0
      ? view === 'today'
        ? 'Nothing left for today. Enjoy it.'
        : 'Nothing here right now.'
      : `${activeTodos.length} task${activeTodos.length === 1 ? '' : 's'} to go${overdueCount ? ` · ${overdueCount} overdue` : ''}`

  return (
    <AppShell
      mode={mode}
      onModeChange={applyMode}
      activeView={view}
      onSelectView={selectView}
      counts={counts}
      refreshKey={todos}
      onDataChanged={() => setTodos(loadTodos(mode))}
      topbarTitle={VIEW_LABEL[view]}
    >
      <div className="content">
        <header className="page-head">
          <div className="page-head-text">
            {view === 'today' && <div className="eyebrow">{mounted ? formatLongToday() : '\u00a0'}</div>}
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{mounted ? subtitle : ' '}</p>
          </div>
          {viewTotal > 0 && (
            <div className="progress-card" title={`${completedTodos.length} of ${viewTotal} done`}>
              <ProgressRing value={progress} size={44} stroke={4} />
              <div>
                <div className="progress-value">{Math.round(progress * 100)}%</div>
                <div className="progress-label">
                  {completedTodos.length} of {viewTotal} done
                </div>
              </div>
            </div>
          )}
        </header>

        <div className="composer">
          <div className="composer-main">
            <span className="composer-icon">
              <Icon name="plus" size={16} />
            </span>
            <input
              ref={composerRef}
              className="composer-input"
              type="text"
              placeholder="Add a task…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addTodo()
                if (e.key === 'Escape') {
                  setInput('')
                  composerRef.current?.blur()
                }
              }}
              aria-label="New task"
              autoFocus
            />
            <Kbd>N</Kbd>
          </div>
          <div className="composer-bar">
            <div className="date-chip-wrap">
              <button
                type="button"
                className={`pill ${newDueDate ? 'pill-set' : ''}`}
                onClick={() => {
                  const el = composerDateRef.current
                  if (!el) return
                  try {
                    el.showPicker()
                  } catch {
                    el.focus()
                  }
                }}
              >
                <Icon name="calendar" size={14} />
                {newDueDate ? formatRelativeDate(newDueDate) : 'Due date'}
              </button>
              {newDueDate && (
                <button className="pill-clear" onClick={() => setNewDueDate('')} aria-label="Clear due date">
                  <Icon name="x" size={12} />
                </button>
              )}
              <input
                ref={composerDateRef}
                type="date"
                className="hidden-date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                tabIndex={-1}
                aria-label="Due date"
              />
            </div>
            <Menu
              label="Repeat"
              align="start"
              width={200}
              triggerClassName={`pill ${newCategory !== 'once' ? 'pill-set' : ''}`}
              triggerContent={
                <>
                  <Icon name="repeat" size={14} />
                  {newCategory === 'once' ? 'Repeat' : REPEAT_LABEL[newCategory]}
                </>
              }
            >
              {close => (
                <>
                  <MenuLabel>Repeat</MenuLabel>
                  {CATEGORY_ORDER.map(c => (
                    <MenuItem
                      key={c}
                      checked={newCategory === c}
                      onClick={() => {
                        setNewCategory(c)
                        close()
                      }}
                    >
                      <span className="cat-dot" data-category={c} /> {c === 'once' ? 'Does not repeat' : REPEAT_LABEL[c]}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
            {newCategory === 'custom' && (
              <div className="day-picker" role="group" aria-label="Repeat on days">
                {orderedDays(settings.weekStartsOn).map(d => (
                  <button
                    key={d}
                    type="button"
                    className={newRecurrenceDays.includes(d) ? 'active' : ''}
                    aria-pressed={newRecurrenceDays.includes(d)}
                    onClick={() =>
                      setNewRecurrenceDays(prev =>
                        prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)
                      )
                    }
                    title={DAY_LABELS[d]}
                  >
                    {DAY_LABELS[d][0]}
                  </button>
                ))}
              </div>
            )}
            <div className="composer-spacer" />
            <button className="btn btn-primary btn-sm" onClick={addTodo} disabled={!input.trim()}>
              Add task
            </button>
          </div>
        </div>

        <div className="list-toolbar">
          <div className="search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setSearch('')
                  searchRef.current?.blur()
                }
              }}
              aria-label="Search tasks"
            />
            {!search && <Kbd>/</Kbd>}
          </div>
        </div>

        {!mounted ? null : activeTodos.length === 0 && completedTodos.length === 0 ? (
          <EmptyState view={view} searching={!!query} />
        ) : (
          <>
            {activeTodos.length === 0 ? (
              <div className="all-done">
                <div className="all-done-icon">
                  <Icon name="sparkles" size={18} />
                </div>
                <div>
                  <div className="all-done-title">All caught up</div>
                  <div className="muted">Every task in this view is complete.</div>
                </div>
              </div>
            ) : (
              groups.map(g => (
                <section className="task-group" key={g.key}>
                  {g.label && (
                    <div className="group-head">
                      <span>{g.label}</span>
                      <span className="group-count">{g.items.length}</span>
                    </div>
                  )}
                  <div className="task-list">{g.items.map(renderTask)}</div>
                </section>
              ))
            )}

            {settings.showCompleted && completedTodos.length > 0 && (
              <section className="task-group completed-group">
                <div className="group-head">
                  <button className="group-toggle" onClick={() => setCompletedOpen(o => !o)} aria-expanded={completedOpen}>
                    <Icon name={completedOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                    Completed
                    <span className="group-count">{completedTodos.length}</span>
                  </button>
                  <button className="text-btn" onClick={() => setConfirm({ kind: 'clear' })}>
                    Clear
                  </button>
                </div>
                {completedOpen && <div className="task-list">{completedTodos.map(renderTask)}</div>}
              </section>
            )}
          </>
        )}
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          danger
          title="Delete task?"
          body={<>“{confirm.todo.text}” will be removed.</>}
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            performDelete(confirm.todo)
            setConfirm(null)
          }}
        />
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog
          danger
          title="Clear completed tasks?"
          body={`${completedTodos.length} completed task${completedTodos.length === 1 ? '' : 's'} in ${VIEW_LABEL[view]} will be removed. You can undo right after.`}
          confirmLabel="Clear"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            clearCompleted()
            setConfirm(null)
          }}
        />
      )}
    </AppShell>
  )
}

/* ---------- Task row ---------- */

interface TaskRowProps {
  todo: Todo
  className: string
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: () => void
  editing: boolean
  editText: string
  setEditText: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onSetDue: (d: string | undefined) => void
  onSetCategory: (c: Category) => void
  onConvert: () => void
  onOpenProject: () => void
  onMoveToTop: () => void
  onDuplicate: () => void
  onDelete: () => void
  canMove: boolean
  meta: React.ReactNode
}

function TaskRow(p: TaskRowProps) {
  const { todo } = p
  const dateRef = useRef<HTMLInputElement>(null)
  const today = getTodayString()

  const pickDate = () => {
    const el = dateRef.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }

  return (
    <div
      className={`task ${p.className}`}
      draggable={p.draggable}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', todo.id)
        p.onDragStart()
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={e => {
        if (!p.draggable) return
        e.preventDefault()
        p.onDragOver()
      }}
      onDrop={e => {
        e.preventDefault()
        p.onDrop()
      }}
    >
      {p.draggable && (
        <span className="task-grip" aria-hidden="true">
          <Icon name="grip" size={14} />
        </span>
      )}
      <button
        className="check"
        onClick={p.onToggle}
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Mark “${todo.text}” as not done` : `Complete “${todo.text}”`}
      >
        <Icon name="check" size={12} />
      </button>

      <div className="task-body">
        {p.editing ? (
          <input
            className="task-edit"
            value={p.editText}
            onChange={e => p.setEditText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') p.onSaveEdit()
              if (e.key === 'Escape') p.onCancelEdit()
            }}
            onBlur={p.onSaveEdit}
            autoFocus
            aria-label="Edit task"
          />
        ) : (
          <div className="task-text" onDoubleClick={p.onStartEdit}>
            {todo.text}
          </div>
        )}
        <div className="task-meta">{p.meta}</div>
      </div>

      <div className="task-actions">
        <button className="icon-btn icon-btn-sm hover-reveal" onClick={p.onStartEdit} aria-label="Edit task" title="Edit">
          <Icon name="pencil" size={14} />
        </button>
        <Menu label="Task options" triggerClassName="icon-btn icon-btn-sm" width={248}>
          {close => {
            const run = (fn: () => void) => () => {
              fn()
              close()
            }
            return (
              <>
                <MenuItem icon="pencil" onClick={run(p.onStartEdit)}>Edit</MenuItem>
                <MenuItem icon="copy" onClick={run(p.onDuplicate)}>Duplicate</MenuItem>
                {p.canMove && !todo.done && <MenuItem icon="arrowUp" onClick={run(p.onMoveToTop)}>Move to top</MenuItem>}
                {todo.isProject && todo.projectId ? (
                  <MenuItem icon="folder" onClick={run(p.onOpenProject)}>Open project</MenuItem>
                ) : (
                  todo.category === 'once' && <MenuItem icon="layers" onClick={run(p.onConvert)}>Convert to project</MenuItem>
                )}
                <MenuSeparator />
                <MenuLabel>Due date</MenuLabel>
                <div className="menu-quick">
                  <button className={todo.dueDate === today ? 'active' : ''} onClick={run(() => p.onSetDue(today))}>Today</button>
                  <button className={todo.dueDate === addDays(today, 1) ? 'active' : ''} onClick={run(() => p.onSetDue(addDays(today, 1)))}>
                    Tomorrow
                  </button>
                  <button className={todo.dueDate === addDays(today, 7) ? 'active' : ''} onClick={run(() => p.onSetDue(addDays(today, 7)))}>
                    +1 week
                  </button>
                  <button onClick={run(pickDate)} aria-label="Pick a date">
                    <Icon name="calendar" size={14} />
                  </button>
                  {todo.dueDate && (
                    <button onClick={run(() => p.onSetDue(undefined))} aria-label="Remove due date">
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
                <MenuSeparator />
                <MenuLabel>Repeat</MenuLabel>
                {CATEGORY_ORDER.map(c => (
                  <MenuItem key={c} checked={todo.category === c} onClick={run(() => p.onSetCategory(c))}>
                    <span className="cat-dot" data-category={c} /> {c === 'once' ? 'Does not repeat' : REPEAT_LABEL[c]}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem icon="trash" danger onClick={run(p.onDelete)}>Delete</MenuItem>
              </>
            )
          }}
        </Menu>
        <input
          ref={dateRef}
          type="date"
          className="hidden-date"
          value={todo.dueDate ?? ''}
          onChange={e => p.onSetDue(e.target.value || undefined)}
          tabIndex={-1}
          aria-label="Due date"
        />
      </div>
    </div>
  )
}

function EmptyState({ view, searching }: { view: View; searching: boolean }) {
  const copy = searching
    ? { icon: 'search' as const, title: 'No matches', body: 'Try a different search term.' }
    : view === 'today'
    ? { icon: 'sun' as const, title: 'A clear day', body: 'Add a task above to plan what matters today.' }
    : view === 'upcoming'
    ? { icon: 'calendar' as const, title: 'Nothing scheduled', body: 'Tasks with a future due date show up here.' }
    : { icon: 'inbox' as const, title: 'No tasks yet', body: 'Add your first task above — press N anytime.' }
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={copy.icon} size={22} />
      </div>
      <div className="empty-title">{copy.title}</div>
      <p className="empty-body">{copy.body}</p>
    </div>
  )
}
