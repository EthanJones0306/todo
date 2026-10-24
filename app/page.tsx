'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Category, CATEGORY_LABEL, CATEGORY_ORDER, DAY_LABELS, Mode, RecurrenceDays, Todo } from '@/types'
import { createProjectFromTodo, loadProjects } from '@/lib/storage'
import { DATA_CHANGE_EVENT, loadMode, loadTodos, markDeleted, resetDailyTasks, saveMode, saveTodos, getNextDueDate } from '@/lib/todos'
import { addDays, formatLongToday, formatRelativeDate, getTodayString, greeting, isDueToday, isOverdue } from '@/lib/date'
import { Settings, useSettings } from '@/lib/settings'
import { canReprioritise, Priority, priorityCompare, priorityLabel, reprioritise, withParsedTitle } from '@/lib/priority'
import AppShell, { isTypingTarget } from '@/components/AppShell'
import { ALL_VIEWS, View, VIEW_LABEL } from '@/components/Sidebar'
import Icon from '@/components/Icon'
import { buildViewContext, inView, isPeriodCategory, PeriodCategory } from '@/lib/views'
import { ConfirmDialog, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, Toast, ToastData } from '@/components/ui'

const REPEAT_LABEL: Record<Category, string> = { ...CATEGORY_LABEL, custom: 'Custom days' }

function orderedDays(weekStartsOn: 0 | 1): number[] {
  return weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
}


function sortTodos(list: Todo[], sort: Settings['sort']): Todo[] {
  // Array.prototype.sort is stable, so equal priorities keep their manual order.
  if (sort === 'priority') return [...list].sort(priorityCompare)
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
  const [newPriority, setNewPriority] = useState<PriorityValue>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [completedOpenByView, setCompletedOpenByView] = useState<Partial<Record<View, boolean>>>({})
  // Done tasks leave the Daily list for the day (folded away); other lists show them open.
  const completedOpen = completedOpenByView[view] ?? view !== 'daily'
  const setCompletedOpen = (fn: (open: boolean) => boolean) => setCompletedOpenByView(prev => ({ ...prev, [view]: fn(completedOpen) }))
  const [justCompleted, setJustCompleted] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; todo: Todo } | { kind: 'clear' }>(null)

  const composerRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const composerDateRef = useRef<HTMLInputElement>(null)

  const modeRef = useRef(mode)
  modeRef.current = mode

  /**
   * The only way the page changes tasks: apply the change to the latest stored tasks (never to this
   * page's copy, which a sync may have overtaken), save, and show the result. A stale copy can never be
   * written back, so a sync result is never undone and nothing is sent to To Do by mistake.
   */
  const commit = useCallback((change: (current: Todo[]) => Todo[]) => {
    const m = modeRef.current
    const current = loadTodos(m)
    const next = change(current)
    if (next !== current) saveTodos(m, next)
    setTodos(loadTodos(m))
  }, [])

  useEffect(() => {
    const m = loadMode()
    setMode(m)
    modeRef.current = m
    const stored = loadTodos(m)
    const reset = resetDailyTasks(stored)
    if (reset !== stored) saveTodos(m, reset)
    setTodos(loadTodos(m))
    const param = new URLSearchParams(window.location.search).get('view') as View | null
    if (param && ALL_VIEWS.includes(param)) setView(param)
    setMounted(true)
  }, [])

  // Show changes made by sync, or by this app in another tab.
  useEffect(() => {
    const reload = () => setTodos(loadTodos(modeRef.current))
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith('arcade-todos-')) reload()
    }
    window.addEventListener(DATA_CHANGE_EVENT, reload)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(DATA_CHANGE_EVENT, reload)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // A new day refreshes daily tasks created here — checked when the app is opened, refocused, or left open past midnight.
  useEffect(() => {
    const check = () => commit(current => resetDailyTasks(current))
    const onVisible = () => document.visibilityState === 'visible' && check()
    const tick = setInterval(check, 60000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tick)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [commit])

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
    modeRef.current = next
    commit(current => resetDailyTasks(current))
    setEditingId(null)
  }

  const showToast = (message: string, onAction?: () => void) => setToast({ id: Date.now(), message, onAction })
  const dismissToast = useCallback(() => setToast(null), [])

  /* ---------- Actions ---------- */

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    const dueDate = newDueDate || (view === 'upcoming' ? addDays(getTodayString(), 1) : undefined)
    // Prefixes typed into the name ("H_Call bank", "zz_Standup") work the same as in To Do.
    const todo: Todo = withParsedTitle({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdHere: true,
      category: newCategory,
      dueDate,
      recurrenceDays: newCategory === 'custom' && newRecurrenceDays.length > 0 ? newRecurrenceDays : undefined,
      ...newPriority,
    })
    commit(current => [...current, todo])
    setInput('')
    setNewDueDate('')
    setNewPriority({})
  }

  const toggleTodo = (id: string) => {
    const todo = todos.find(t => t.id === id)
    if (todo && !todo.done) {
      setJustCompleted(id)
      setTimeout(() => setJustCompleted(c => (c === id ? null : c)), 600)
    }
    commit(prev => {
      const todo = prev.find(t => t.id === id)
      if (!todo) return prev
      const newDone = !todo.done
      const now = new Date().toISOString()
      if (newDone && todo.category !== 'once' && todo.recurrenceDays && todo.recurrenceDays.length > 0) {
        const nextTodo: Todo = {
          ...todo,
          id: crypto.randomUUID(),
          createdHere: true,
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
    commit(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  const performDelete = (todo: Todo) => {
    const index = todos.findIndex(t => t.id === todo.id)
    markDeleted(mode, [todo])
    commit(prev => prev.filter(t => t.id !== todo.id))
    showToast('Task deleted', () =>
      commit(prev => {
        if (prev.some(t => t.id === todo.id)) return prev
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
    const copy: Todo = {
      ...todo,
      id: crypto.randomUUID(),
      createdHere: true,
      remoteSeries: undefined,
      done: false,
      completedAt: undefined,
      isProject: false,
      projectId: undefined,
      remoteId: undefined,
      remoteModified: undefined,
      dirty: undefined,
    }
    commit(prev => {
      const i = prev.findIndex(t => t.id === todo.id)
      const next = [...prev]
      next.splice(i + 1, 0, copy)
      return next
    })
  }

  const moveToTop = (id: string) => {
    commit(prev => {
      const item = prev.find(t => t.id === id)
      return item ? [item, ...prev.filter(t => t.id !== id)] : prev
    })
  }

  const moveBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    commit(prev => {
      const from = prev.findIndex(t => t.id === sourceId)
      if (from === -1) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      const to = next.findIndex(t => t.id === targetId)
      next.splice(to === -1 ? next.length : to + (from <= to ? 1 : 0), 0, item)
      return next
    })
  }

  /** Priority sort: dropping a task onto another takes that task's place and priority, then tells you what changed. */
  const moveByPriority = (movedId: string, targetId: string) => {
    const before = loadTodos(modeRef.current)
    const after = reprioritise(before, movedId, targetId)
    if (after === before) return
    commit(() => after)
    const moved = after.find(t => t.id === movedId)!
    const wasLabel = priorityLabel(before.find(t => t.id === movedId)!)
    const nowLabel = priorityLabel(moved)
    const oldRank = new Map(before.map(t => [t.id, t.rank]))
    const others = after.filter(t => t.id !== movedId && t.rank !== oldRank.get(t.id)).length
    // Reordering within the same level (e.g. two High tasks) changes nothing in To Do, so stay quiet.
    if (wasLabel === nowLabel && others === 0) return
    const renumbered = others ? ` · ${others} other${others === 1 ? '' : 's'} renumbered` : ''
    // Undo puts back only the priorities this move changed, on top of whatever has happened since.
    const oldLevel = new Map(before.map(t => [t.id, { rank: t.rank, priority: t.priority }]))
    const touched = new Set(after.filter(t => t !== before.find(b => b.id === t.id)).map(t => t.id))
    showToast(`“${moved.text}” → ${nowLabel ?? 'no priority'}${renumbered}`, () =>
      commit(prev => prev.map(t => (touched.has(t.id) ? { ...t, ...oldLevel.get(t.id) } : t)))
    )
  }

  const convertToProject = (todo: Todo) => {
    const project = createProjectFromTodo(mode, todo)
    commit(prev => prev.map(t => (t.id === todo.id ? { ...t, isProject: true, projectId: project.id } : t)))
    router.push(`/project/${project.id}`)
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const saveEdit = (id: string) => {
    const text = editText.trim()
    const todo = todos.find(t => t.id === id)
    if (text && todo) {
      const parsed = withParsedTitle({ ...todo, text })
      patchTodo(id, { text: parsed.text, rank: parsed.rank, priority: parsed.priority, category: parsed.category })
    }
    setEditingId(null)
  }

  /** Removes completed tasks from this app only — To Do keeps its history. */
  const clearCompleted = () => {
    const removed = completedTodos.filter(t => t.category !== 'daily')
    const ids = new Set(removed.map(t => t.id))
    commit(prev => prev.filter(t => !ids.has(t.id)))
    showToast(`Cleared ${removed.length} completed`, () =>
      commit(prev => [...prev, ...removed.filter(r => !prev.some(t => t.id === r.id))])
    )
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

  const viewCtx = useMemo(() => buildViewContext(todos, settings.weekStartsOn), [todos, settings.weekStartsOn])

  const counts = useMemo(() => {
    const c: Partial<Record<View, number>> = {}
    for (const v of ALL_VIEWS) c[v] = todos.filter(t => !t.done && inView(t, v, viewCtx)).length
    return c
  }, [todos, viewCtx])

  const query = search.trim().toLowerCase()
  const periodView = isPeriodCategory(view)
  const shown = todos.filter(t => inView(t, view, viewCtx) && (!query || t.text.toLowerCase().includes(query)))
  const activeTodos = sortTodos(shown.filter(t => !t.done), view === 'upcoming' ? 'due' : settings.sort)
  // Daily/Weekly/Monthly are "what's left" lists: ticked tasks leave and don't come back until next period.
  const completedTodos = periodView
    ? []
    : shown.filter(t => t.done).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  const overdueCount = activeTodos.filter(t => isOverdue(t.dueDate)).length
  const clearableCount = completedTodos.filter(t => t.category !== 'daily').length
  const periodDone = periodView ? viewCtx.doneInPeriod[view as PeriodCategory] : 0
  const periodTotal = periodDone + activeTodos.length
  const progress = periodTotal ? periodDone / periodTotal : 0
  const viewTotal = activeTodos.length + completedTodos.length
  const prioritySort = settings.sort === 'priority' && view !== 'upcoming'
  const canDrag = (settings.sort === 'manual' || prioritySort) && view !== 'upcoming' && !query
  const dragIndex = draggingId ? activeTodos.findIndex(t => t.id === draggingId) : -1

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
          // Moving down lands below the target, so draw the drop line there.
          dragOverId === todo.id && dragIndex > -1 && dragIndex < activeTodos.indexOf(todo) && 'drag-below',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragStart={() => setDraggingId(todo.id)}
        onDragEnd={() => {
          setDraggingId(null)
          setDragOverId(null)
        }}
        onDragOver={() => {
          const allowed = !prioritySort || canReprioritise(todos.find(t => t.id === draggingId), todo)
          setDragOverId(allowed ? todo.id : null)
          return allowed
        }}
        onDrop={() => {
          if (draggingId) {
            if (prioritySort) moveByPriority(draggingId, todo.id)
            else moveBefore(draggingId, todo.id)
          }
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
        onSetPriority={value => patchTodo(todo.id, { rank: value.rank, priority: value.priority })}
        onSetCategory={category =>
          patchTodo(todo.id, { category, recurrenceDays: category === 'custom' ? todo.recurrenceDays : undefined })
        }
        onConvert={() => convertToProject(todo)}
        onOpenProject={() => router.push(`/project/${todo.projectId}`)}
        onMoveToTop={() => moveToTop(todo.id)}
        onMoveUp={(() => {
          const i = activeTodos.indexOf(todo)
          const target = activeTodos[i - 1]
          return prioritySort && !query && canReprioritise(todo, target) ? () => moveByPriority(todo.id, target.id) : undefined
        })()}
        onMoveDown={(() => {
          const i = activeTodos.indexOf(todo)
          const target = activeTodos[i + 1]
          return prioritySort && !query && canReprioritise(todo, target) ? () => moveByPriority(todo.id, target.id) : undefined
        })()}
        onDuplicate={() => duplicateTodo(todo)}
        onDelete={() => requestDelete(todo)}
        canMove={settings.sort === 'manual'}
        meta={
          <>
            {priorityLabel(todo) && (
              <span className={`chip chip-priority is-${todo.rank ? 'rank' : todo.priority}`}>
                {todo.priority === 'high' && !todo.rank && <Icon name="arrowUp" size={12} />}
                {priorityLabel(todo)}
              </span>
            )}
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
  const periodWord = view === 'daily' ? 'today' : view === 'weekly' ? 'this week' : 'this month'
  const subtitle =
    activeTodos.length === 0
      ? view === 'today'
        ? 'Nothing left for today. Enjoy it.'
        : periodView && periodDone > 0
        ? `All done ${periodWord}.`
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
      onDataChanged={() => setTodos(loadTodos(modeRef.current))}
      topbarTitle={VIEW_LABEL[view]}
    >
      <div className="content">
        <header className="page-head">
          <div className="page-head-text">
            {view === 'today' && <div className="eyebrow">{mounted ? formatLongToday() : '\u00a0'}</div>}
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{mounted ? subtitle : ' '}</p>
          </div>
          {periodView && periodTotal > 0 && (
            <div className="daily-progress">
              <div className="daily-progress-bar" aria-hidden="true">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              <span>
                {periodDone} of {periodTotal} done {view === 'daily' ? 'today' : view === 'weekly' ? 'this week' : 'this month'}
              </span>
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
              label="Priority"
              align="start"
              width={232}
              triggerClassName={`pill ${priorityLabel(newPriority) ? 'pill-set' : ''}`}
              triggerContent={
                <>
                  <Icon name="flag" size={14} />
                  {priorityLabel(newPriority) ?? 'Priority'}
                </>
              }
            >
              {close => (
                <>
                  <MenuLabel>Priority</MenuLabel>
                  <PriorityPicker
                    value={newPriority}
                    onPick={v => {
                      setNewPriority(v)
                      close()
                    }}
                  />
                </>
              )}
            </Menu>
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

        {!mounted ? null : periodView && activeTodos.length === 0 && periodDone > 0 && !query ? (
          <div className="all-done">
            <div className="all-done-icon">
              <Icon name="sparkles" size={18} />
            </div>
            <div>
              <div className="all-done-title">All done {periodWord}</div>
              <div className="muted">
                {periodDone} {view} task{periodDone === 1 ? '' : 's'} ticked off. They’ll be back {view === 'daily' ? 'tomorrow' : view === 'weekly' ? 'next week' : 'next month'}.
              </div>
            </div>
          </div>
        ) : activeTodos.length === 0 && completedTodos.length === 0 ? (
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
                  {clearableCount > 0 && (
                    <button className="text-btn" onClick={() => setConfirm({ kind: 'clear' })}>
                      Clear
                    </button>
                  )}
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
          body={`${clearableCount} completed task${clearableCount === 1 ? '' : 's'} in ${VIEW_LABEL[view]} will be removed. Daily tasks are kept — they reset tomorrow. You can undo right after.`}
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
  /** Returns whether the dragged task may be dropped here. */
  onDragOver: () => boolean
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
  onSetPriority: (v: PriorityValue) => void
  onConvert: () => void
  onOpenProject: () => void
  onMoveToTop: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
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
        if (p.onDragOver()) e.preventDefault()
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
                {p.onMoveUp && <MenuItem icon="arrowUp" onClick={run(p.onMoveUp)}>Move up</MenuItem>}
                {p.onMoveDown && <MenuItem icon="chevronDown" onClick={run(p.onMoveDown)}>Move down</MenuItem>}
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
                <MenuLabel>Priority</MenuLabel>
                <PriorityPicker value={todo} onPick={v => run(() => p.onSetPriority(v))()} />
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

/* ---------- Priority picker ---------- */

type PriorityValue = { rank?: number; priority?: Priority }

/** 1–5 ranks plus any other number, High, Low or none — shown inside a menu. */
function PriorityPicker({ value, onPick }: { value: PriorityValue; onPick: (v: PriorityValue) => void }) {
  const [custom, setCustom] = useState(value.rank && value.rank > 5 ? String(value.rank) : '')
  return (
    <>
      <div className="menu-quick">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} className={value.rank === n ? 'active' : ''} onClick={() => onPick({ rank: n })}>
            {n}
          </button>
        ))}
        <input
          className="menu-num"
          type="number"
          min={1}
          placeholder="#"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => {
            const n = parseInt(custom, 10)
            if (e.key === 'Enter' && n > 0) onPick({ rank: n })
          }}
          aria-label="Priority number"
        />
      </div>
      <div className="menu-quick">
        <button className={!value.rank && value.priority === 'high' ? 'active' : ''} onClick={() => onPick({ priority: 'high' })}>
          High
        </button>
        <button className={!value.rank && value.priority === 'low' ? 'active' : ''} onClick={() => onPick({ priority: 'low' })}>
          Low
        </button>
        <button className={!value.rank && !value.priority ? 'active' : ''} onClick={() => onPick({})}>
          None
        </button>
      </div>
    </>
  )
}
