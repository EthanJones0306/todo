'use client'

import { Category, CATEGORY_ORDER, Mode, MODE_ORDER, RecurrenceDays, Todo } from '@/types'
import { addDays, getTodayString, parseDate, periodBounds, toDateString } from '@/lib/date'
import { repeatPrefixOf, withParsedTitle } from '@/lib/priority'

const TODOS_KEY = (mode: Mode) => `arcade-todos-${mode}`
const MODE_KEY = 'arcade-mode'

function normalizeCategory(value: unknown): Category {
  return CATEGORY_ORDER.includes(value as Category) ? (value as Category) : 'once'
}

export function loadMode(): Mode {
  if (typeof window === 'undefined') return 'personal'
  const saved = localStorage.getItem(MODE_KEY)
  return MODE_ORDER.includes(saved as Mode) ? (saved as Mode) : 'personal'
}

export function saveMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export function loadTodos(mode: Mode): Todo[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(TODOS_KEY(mode)) || '[]')
    // Titles pulled from To Do before prefixes were understood ("1_Call bank") are normalised here.
    return parsed.map((t: any) => withParsedTitle({ ...t, category: normalizeCategory(t.category) }))
  } catch {
    return []
  }
}

export const LOCAL_CHANGE_EVENT = 'arcade-local-change'
export const DATA_CHANGE_EVENT = 'arcade-data-change'
const DELETED_KEY = (mode: Mode) => `arcade-sync-deleted-${mode}`

/** What To Do sees: the title (name plus priority/repeat prefixes) and done state. */
export function syncKey(t: Todo): string {
  return JSON.stringify([t.text, t.done, t.rank ?? null, t.priority ?? null, repeatPrefixOf(t.category) ?? null])
}

/**
 * Save todos edited by the UI. Storage owns the sync metadata (remoteId, dirty), so it is
 * carried over from what is stored rather than trusted from possibly stale UI state.
 */
export function saveTodos(mode: Mode, todos: Todo[]): void {
  const stored = new Map(loadTodos(mode).map(t => [t.id, t]))
  const seenRemote = new Set<string>()
  let changed = false
  const next = todos.map(t => {
    const old = stored.get(t.id)
    let remoteId = old ? old.remoteId ?? t.remoteId : t.remoteId
    // A brand-new todo copied from a synced one must not claim the same remote task.
    if (remoteId && (seenRemote.has(remoteId) || (!old && todos.some(o => o !== t && o.remoteId === remoteId)))) {
      remoteId = undefined
    }
    if (remoteId) seenRemote.add(remoteId)
    const edited = !old || syncKey(old) !== syncKey(t)
    if (edited) changed = true
    return {
      ...t,
      remoteId,
      remoteModified: remoteId ? old?.remoteModified ?? t.remoteModified : undefined,
      dirty: remoteId ? edited || !!old?.dirty : undefined,
      doneChanged: remoteId ? !!old && (!!old.doneChanged || old.done !== t.done) : undefined,
    }
  })

  // Restoring a deleted task (undo) cancels its pending remote delete.
  const pending = loadDeleted(mode)
  const kept = pending.filter(id => !seenRemote.has(id))
  if (kept.length !== pending.length) saveDeleted(mode, kept)

  localStorage.setItem(TODOS_KEY(mode), JSON.stringify(next))
  if (changed) window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, { detail: { mode } }))
}

/** Save todos as-is, without marking anything for upload. Used by sync and imports. */
export function saveTodosRaw(mode: Mode, todos: Todo[]): void {
  localStorage.setItem(TODOS_KEY(mode), JSON.stringify(todos))
}

export function loadDeleted(mode: Mode): string[] {
  try {
    return JSON.parse(localStorage.getItem(DELETED_KEY(mode)) || '[]')
  } catch {
    return []
  }
}

export function saveDeleted(mode: Mode, ids: string[]): void {
  localStorage.setItem(DELETED_KEY(mode), JSON.stringify(Array.from(new Set(ids))))
}

/** Queue remote deletion for todos the user removed. */
export function markDeleted(mode: Mode, todos: Todo[]): void {
  const ids = todos.map(t => t.remoteId).filter((id): id is string => !!id)
  if (ids.length === 0) return
  saveDeleted(mode, [...loadDeleted(mode), ...ids])
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, { detail: { mode } }))
}

/** Whether a task belongs in the "Today" view. */
export function shouldShowToday(dueDate?: string, recurrenceDays?: RecurrenceDays): boolean {
  if (!dueDate) return true
  const today = getTodayString()
  if (dueDate > today) return false
  if (!recurrenceDays || recurrenceDays.length === 0) return true
  return recurrenceDays.includes(parseDate(today).getDay())
}

/** The week-start setting, read directly so sync code doesn't need the React settings hook. */
function weekStart(): 0 | 1 {
  try {
    return JSON.parse(localStorage.getItem('arcade-settings') || '{}').weekStartsOn === 0 ? 0 : 1
  } catch {
    return 1
  }
}

/**
 * Each new day, week or month — or straight away when an overdue one is ticked — daily/weekly/monthly
 * tasks created in this app start fresh for the current period. Completed tasks are never re-opened in To Do:
 * - not synced: the task is simply un-ticked;
 * - synced and created here: To Do keeps the completed copy, and a new copy is added for the new period
 *   (sent to To Do as a new task on the next sync);
 * - anything that came from To Do is left alone — its repeats roll forward in To Do itself.
 * Returns the same array when nothing changes.
 */
export function resetRepeatingTasks(todos: Todo[], today = getTodayString(), weekStartsOn: 0 | 1 = weekStart()): Todo[] {
  let changed = false
  const fresh: Todo[] = []
  const next = todos.map(t => {
    const period = t.category === 'daily' || t.category === 'weekly' || t.category === 'monthly' ? t.category : null
    if (!period || !t.done || !t.completedAt || t.remoteSeries || t.rolledOver) return t
    const { start } = periodBounds(period, weekStartsOn, today)
    // Ticked in an earlier period, or ticked now but for an earlier period's occurrence (overdue):
    // either way this period's is still to do.
    const tickedForEarlier = !!t.dueDate && t.dueDate < start
    if (toDateString(new Date(t.completedAt)) >= start && !tickedForEarlier) return t
    if (!t.remoteId) {
      changed = true
      return { ...t, done: false, completedAt: undefined, dueDate: t.dueDate ? today : undefined }
    }
    if (!t.createdHere) return t
    changed = true
    fresh.push({
      ...t,
      id: crypto.randomUUID(),
      done: false,
      completedAt: undefined,
      dueDate: t.dueDate ? today : undefined,
      remoteId: undefined,
      remoteModified: undefined,
      remoteDue: undefined,
      dirty: undefined,
      doneChanged: undefined,
      lastCompletedAt: undefined,
      lastCompletedDue: undefined,
      isProject: false,
      projectId: undefined,
    })
    return { ...t, rolledOver: true }
  })
  return changed ? [...next, ...fresh] : todos
}

export function getNextDueDate(currentDueDate: string | undefined, recurrenceDays: RecurrenceDays): string {
  let date = addDays(currentDueDate || getTodayString(), 1)
  for (let i = 0; i < 7; i++) {
    if (recurrenceDays.includes(parseDate(date).getDay())) return date
    date = addDays(date, 1)
  }
  return date
}

export { toDateString }

/**
 * Tick or untick a task. Ticking a custom-days task also adds its next occurrence; unticking takes that
 * copy back again. Returns the new list and the copies removed (to delete in To Do if they got there).
 */
export function toggleDone(todos: Todo[], id: string, now = new Date().toISOString()): { next: Todo[]; removed: Todo[] } {
  const todo = todos.find(t => t.id === id)
  if (!todo) return { next: todos, removed: [] }
  const newDone = !todo.done
  if (newDone && todo.category !== 'once' && todo.recurrenceDays && todo.recurrenceDays.length > 0) {
    const nextTodo: Todo = {
      ...todo,
      id: crypto.randomUUID(),
      createdHere: true,
      done: false,
      dueDate: getNextDueDate(todo.dueDate, todo.recurrenceDays),
      completedAt: undefined,
      originalId: todo.originalId || todo.id,
      spawnedBy: todo.id,
      remoteId: undefined,
      remoteModified: undefined,
      remoteDue: undefined,
      dirty: undefined,
      doneChanged: undefined,
    }
    return { next: todos.map(t => (t.id === id ? { ...t, done: true, completedAt: now } : t)).concat(nextTodo), removed: [] }
  }
  const removed = newDone ? [] : todos.filter(t => t.spawnedBy === id && !t.done)
  return {
    next: todos
      .filter(t => !removed.includes(t))
      .map(t => (t.id === id ? { ...t, done: newDone, completedAt: newDone ? now : undefined } : t)),
    removed,
  }
}

/** A fresh, independent copy of a task: same wording and settings, none of the original's sync history. */
export function duplicateOf(todo: Todo): Todo {
  return {
    ...todo,
    id: crypto.randomUUID(),
    createdHere: true,
    done: false,
    completedAt: undefined,
    isProject: false,
    projectId: undefined,
    remoteId: undefined,
    remoteModified: undefined,
    remoteDue: undefined,
    remoteSeries: undefined,
    dirty: undefined,
    doneChanged: undefined,
    lastCompletedAt: undefined,
    lastCompletedDue: undefined,
    rolledOver: undefined,
    originalId: undefined,
    spawnedBy: undefined,
  }
}

/**
 * Whether "Clear completed" may remove a task from the app: never a daily one (they come back), and
 * never a tick that hasn't reached To Do yet — clearing it would bring it back open on the next sync.
 */
export function isClearable(t: Todo, synced: boolean): boolean {
  return t.done && t.category !== 'daily' && !t.dirty && !(synced && !t.remoteId)
}
