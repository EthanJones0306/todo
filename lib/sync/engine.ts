'use client'

import { Mode, MODE_ORDER, Todo } from '@/types'
import { loadProjects, saveProjects } from '@/lib/storage'
import { DATA_CHANGE_EVENT, loadDeleted, resetDailyTasks, saveTodos, syncKey, loadTodos, saveDeleted, saveTodosRaw } from '@/lib/todos'
import { getAccount, getToken, ReauthRequired } from '@/lib/sync/msal'
import { createTask, deleteTask, GraphError, GraphTask, listTasks, updateTask } from '@/lib/sync/graph'
import { newTaskFromGraph, syncedFieldsFromGraph, toGraphTask } from '@/lib/sync/mapping'
import { parseTitle, repeatPrefixOf } from '@/lib/priority'

/* ---------- Linked lists ---------- */

export interface ListLink {
  listId: string
  listName: string
  lastSync?: string
}

const LINKS_KEY = 'arcade-sync'

export function loadLinks(): Partial<Record<Mode, ListLink>> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveLinks(links: Partial<Record<Mode, ListLink>>): void {
  localStorage.setItem(LINKS_KEY, JSON.stringify(links))
}

export function getLink(mode: Mode): ListLink | undefined {
  return loadLinks()[mode]
}

/** Point a workspace at a To Do list (or none). Old remote ids are dropped so nothing leaks into the new list. */
export function setLink(mode: Mode, link: ListLink | null): void {
  const links = loadLinks()
  if (links[mode]?.listId === link?.listId) return
  if (link) links[mode] = link
  else delete links[mode]
  saveLinks(links)

  saveTodosRaw(
    mode,
    loadTodos(mode).map(t => ({ ...t, remoteId: undefined, remoteModified: undefined, dirty: undefined }))
  )
  saveDeleted(mode, [])
  setStatus({ ...status, lastSync: undefined, error: undefined })
}

/** Number of local changes in a linked workspace that haven't been sent to To Do yet. */
export function pendingCount(mode: Mode): number {
  if (!loadLinks()[mode]) return 0
  return (
    loadTodos(mode).filter(t => !t.remoteId || t.dirty).length + loadDeleted(mode).length
  )
}

/** True if a linked workspace has edits that haven't reached To Do yet. */
export function hasPendingChanges(): boolean {
  const links = loadLinks()
  return MODE_ORDER.some(
    mode =>
      links[mode] &&
      (loadTodos(mode).some(t => !t.remoteId || t.dirty) || loadDeleted(mode).length > 0)
  )
}

/**
 * Remove every synced workspace's tasks and projects from this device. Task names stay safe in
 * Microsoft To Do and come back after signing in again — work data shouldn't linger locally.
 */
export function forgetSyncedData(): void {
  const links = loadLinks()
  for (const mode of MODE_ORDER) {
    if (!links[mode]) continue
    saveTodosRaw(mode, [])
    localStorage.removeItem(`arcade-projects-${mode}`)
    saveDeleted(mode, [])
  }
  window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
}

/* ---------- Status ---------- */

export type SyncPhase = 'unconfigured' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncStatus {
  phase: SyncPhase
  lastSync?: string
  error?: string
}

export const STATUS_EVENT = 'arcade-sync-status'
let status: SyncStatus = { phase: 'idle' }

export function getStatus(): SyncStatus {
  return status
}

export function setStatus(next: SyncStatus): void {
  status = next
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_EVENT))
}

/* ---------- Sync ---------- */

function patchStoredTodo(mode: Mode, id: string, patch: (t: Todo) => Partial<Todo>): void {
  saveTodosRaw(
    mode,
    loadTodos(mode).map(t => (t.id === id ? { ...t, ...patch(t) } : t))
  )
}

// Only the title (with priority prefixes) and done state go to To Do; everything else stays here.
const contentKey = syncKey

async function pushTodos(mode: Mode, listId: string, token: string): Promise<void> {
  for (const todo of loadTodos(mode)) {
    if (todo.remoteId && !todo.dirty) continue
    const key = contentKey(todo)
    let remote: GraphTask
    const body = toGraphTask(todo)
    try {
      remote = todo.remoteId
        ? await updateTask(token, listId, todo.remoteId, body)
        : await createTask(token, listId, body)
    } catch (e) {
      // Edited here but deleted in To Do: bring it back rather than lose the edit.
      if (!(e instanceof GraphError && e.status === 404 && todo.remoteId)) throw e
      remote = await createTask(token, listId, body)
    }
    patchStoredTodo(mode, todo.id, current => ({
      remoteId: remote.id,
      remoteModified: remote.lastModifiedDateTime,
      // Only clear the flag if nothing changed while the request was in flight.
      dirty: contentKey(current) !== key,
    }))
  }
}

async function pushDeletions(mode: Mode, listId: string, token: string): Promise<void> {
  for (const id of loadDeleted(mode)) {
    try {
      await deleteTask(token, listId, id)
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
    }
    saveDeleted(
      mode,
      loadDeleted(mode).filter(x => x !== id)
    )
  }
}

// Bump when the meaning of title prefixes changes, or the re-read itself is fixed.
// v2: z_ daily, zz_ weekly, zzz_ monthly. v3: re-read before pushing, and for tasks with pending edits too.
const PREFIX_RULES_VERSION = '3'
const PREFIX_RULES_KEY = (mode: Mode) => `arcade-sync-prefix-rules-${mode}`

function prefixRulesOutdated(mode: Mode): boolean {
  return localStorage.getItem(PREFIX_RULES_KEY(mode)) !== PREFIX_RULES_VERSION
}

/**
 * Re-read the repeat (daily/weekly/monthly) of every synced task from its To Do title under the current
 * prefix rules. Runs before anything is pushed, so a task whose repeat was mis-read earlier can't be
 * written back to To Do with the wrong prefix. Tasks without pending edits are fully re-read afterwards.
 */
function rereadPrefixRules(mode: Mode, remote: GraphTask[]): void {
  const byId = new Map(remote.map(r => [r.id, r]))
  saveTodosRaw(
    mode,
    loadTodos(mode).map(t => {
      const r = t.remoteId ? byId.get(t.remoteId) : undefined
      if (!r) return t
      const repeat = parseTitle(r.title).repeat
      const category = repeat ?? (repeatPrefixOf(t.category) ? 'once' : t.category)
      return { ...t, category, recurrenceDays: repeat ? undefined : t.recurrenceDays, remoteModified: t.dirty ? t.remoteModified : undefined }
    })
  )
  localStorage.setItem(PREFIX_RULES_KEY(mode), PREFIX_RULES_VERSION)
}

/** Un-tick daily tasks completed before today (marked as changes to send). Returns whether any were reset. */
function resetStaleDailyTasks(mode: Mode): boolean {
  const todos = loadTodos(mode)
  const reset = resetDailyTasks(todos)
  if (reset === todos) return false
  saveTodos(mode, reset)
  return true
}

function applyRemote(mode: Mode, remote: GraphTask[]): void {
  const pendingDelete = new Set(loadDeleted(mode))
  const remoteById = new Map(remote.map(r => [r.id, r]))
  let todos = loadTodos(mode)
  const localByRemote = new Map(todos.filter(t => t.remoteId).map(t => [t.remoteId!, t]))

  // Removed in To Do (and not edited here since) → remove here too, along with any project made from it.
  const removed = new Set(todos.filter(t => t.remoteId && !t.dirty && !remoteById.has(t.remoteId)).map(t => t.id))
  todos = todos.filter(t => !removed.has(t.id))
  if (removed.size) saveProjects(mode, loadProjects(mode).filter(p => !removed.has(p.sourceTodoId)))

  for (const r of remote) {
    if (pendingDelete.has(r.id)) continue
    const local = localByRemote.get(r.id)
    if (!local) {
      todos.push({ id: crypto.randomUUID(), ...newTaskFromGraph(r) })
    } else if (!local.dirty && local.remoteModified !== r.lastModifiedDateTime) {
      // Only the name and done state come back; repeats, due dates and order are kept from here.
      todos = todos.map(t => (t.id === local.id ? { ...t, ...syncedFieldsFromGraph(r, t), dirty: false } : t))
    }
  }

  saveTodosRaw(mode, todos)
}

let running: Promise<void> | null = null
let rerun = false

async function syncOnce(): Promise<void> {
  const links = loadLinks()
  const modes = MODE_ORDER.filter(m => links[m])
  if (modes.length === 0) return
  if (!(await getAccount())) {
    setStatus({ phase: 'signed-out' })
    return
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus({ ...status, phase: 'offline' })
    return
  }

  setStatus({ ...status, phase: 'syncing', error: undefined })
  try {
    const token = await getToken()
    for (const mode of modes) {
      const link = links[mode]!
      if (prefixRulesOutdated(mode)) rereadPrefixRules(mode, await listTasks(token, link.listId))
      resetStaleDailyTasks(mode)
      await pushDeletions(mode, link.listId, token)
      await pushTodos(mode, link.listId, token)
      applyRemote(mode, await listTasks(token, link.listId))
      // Daily tasks ticked off in To Do on an earlier day come back done; reset and un-tick them now,
      // so a single sync leaves both sides fresh for today.
      if (resetStaleDailyTasks(mode)) await pushTodos(mode, link.listId, token)
      const latest = loadLinks()
      if (latest[mode]?.listId === link.listId) {
        latest[mode] = { ...latest[mode]!, lastSync: new Date().toISOString() }
        saveLinks(latest)
      }
    }
    window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
    setStatus({ phase: 'idle', lastSync: new Date().toISOString() })
  } catch (e) {
    window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
    const message =
      e instanceof ReauthRequired
        ? e.message
        : e instanceof GraphError && e.status === 403
        ? 'Access denied — your organisation may need to approve this app.'
        : e instanceof GraphError && e.status === 404
        ? 'The linked To Do list no longer exists. Pick another in Settings → Sync.'
        : e instanceof Error
        ? e.message
        : 'Sync failed'
    setStatus({ ...status, phase: e instanceof ReauthRequired ? 'signed-out' : 'error', error: message })
  }
}

/** Sync every linked workspace. Calls made while a sync is running are coalesced into one follow-up run. */
export function requestSync(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      await syncOnce()
    } while (rerun)
    running = null
  })()
  return running
}
