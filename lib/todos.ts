'use client'

import { Category, CATEGORY_ORDER, Mode, MODE_ORDER, RecurrenceDays, Todo } from '@/types'
import { addDays, getTodayString, parseDate, toDateString } from '@/lib/date'
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

/**
 * Daily tasks ticked off on an earlier day come back unticked, so each day starts fresh.
 * Returns the same array when nothing needs resetting.
 */
export function resetDailyTasks(todos: Todo[], today = getTodayString()): Todo[] {
  let changed = false
  const next = todos.map(t => {
    if (t.category !== 'daily' || !t.done || !t.completedAt) return t
    if (toDateString(new Date(t.completedAt)) >= today) return t
    changed = true
    return { ...t, done: false, completedAt: undefined }
  })
  return changed ? next : todos
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
