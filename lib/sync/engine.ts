'use client'

import { Mode, MODE_ORDER, Todo } from '@/types'
import { loadProjects, saveProjects } from '@/lib/storage'
import { DATA_CHANGE_EVENT, loadDeleted, resetDailyTasks, saveTodos, syncKey, loadTodos, saveDeleted, saveTodosRaw } from '@/lib/todos'
import { getAccount, getToken, ReauthRequired } from '@/lib/sync/msal'
import { createTask, deleteTask, getTask, GraphDateTime, GraphError, GraphTask, listOpenTasks, listTasks, updateTask } from '@/lib/sync/graph'
import { getTodayString, toDateString } from '@/lib/date'
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

/** Sends new and changed tasks; returns how many writes were made. */
async function pushTodos(mode: Mode, listId: string, token: string): Promise<number> {
  let writes = 0
  for (const todo of loadTodos(mode)) {
    if (todo.remoteId && !todo.dirty) continue
    writes++
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
  return writes
}

async function pushDeletions(mode: Mode, listId: string, token: string): Promise<number> {
  const ids = loadDeleted(mode)
  for (const id of ids) {
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
  return ids.length
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

/* ---------- Series To Do repeats itself ---------- */

function utcDate(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? toDateString(new Date(value.dateTime.slice(0, 19) + 'Z')) : undefined
}

/** Titles of tasks To Do repeats itself: any copy carrying a recurrence marks the whole series. */
function seriesTitles(remote: GraphTask[]): Set<string> {
  return new Set(remote.filter(r => r.recurrence).map(r => r.title))
}

/**
 * Flag local tasks that belong to a series To Do repeats itself (the flag sticks, since completed copies
 * lose their recurrence). A copy To Do has as completed but the app un-ticked with its daily reset is
 * ticked again, so it isn't sent back as not done.
 */
function markSeries(mode: Mode, remote: GraphTask[]): void {
  const titles = seriesTitles(remote)
  const byId = new Map(remote.map(r => [r.id, r]))
  const todos = loadTodos(mode)
  let changed = false
  const next = todos.map(t => {
    const r = t.remoteId ? byId.get(t.remoteId) : undefined
    if (!r || !(t.remoteSeries || titles.has(r.title))) return t
    if (!t.done && t.dirty && r.status === 'completed') {
      changed = true
      return { ...t, remoteSeries: true, done: true, completedAt: new Date(`${utcDate(r.completedDateTime) ?? getTodayString()}T12:00:00`).toISOString(), dirty: false }
    }
    if (t.remoteSeries) return t
    changed = true
    return { ...t, remoteSeries: true }
  })
  if (changed) saveTodosRaw(mode, next)
}

const SERIES_CLEANUP_KEY = (mode: Mode) => `arcade-sync-series-cleanup-${mode}`

/**
 * One-off repair (Oct 2026): the daily reset used to un-tick completed copies of tasks To Do repeats itself,
 * leaving yesterday's copies open next to To Do's new ones. In each daily series, open copies due before
 * today that aren't the newest are ticked off again. Their recurrence is removed first so To Do doesn't
 * create yet another copy; if that fails, the copy is left alone.
 */
async function cleanUpResetSeriesCopies(mode: Mode, remote: GraphTask[], listId: string, token: string): Promise<number> {
  if (localStorage.getItem(SERIES_CLEANUP_KEY(mode))) return 0
  const today = getTodayString()
  const dailyRemoteIds = new Set(loadTodos(mode).filter(t => t.category === 'daily' && t.remoteId).map(t => t.remoteId!))
  const titles = seriesTitles(remote)
  const groups = new Map<string, GraphTask[]>()
  for (const r of remote) {
    const daily = dailyRemoteIds.has(r.id) || parseTitle(r.title).repeat === 'daily'
    if (r.status === 'completed' || !titles.has(r.title) || !daily || !utcDate(r.dueDateTime)) continue
    groups.set(r.title, [...(groups.get(r.title) ?? []), r])
  }

  const fixed = new Set<string>()
  for (const open of Array.from(groups.values())) {
    if (open.length < 2) continue
    const newest = open.reduce((a, b) => (utcDate(a.dueDateTime)! >= utcDate(b.dueDateTime)! ? a : b))
    for (const r of open) {
      if (r === newest || utcDate(r.dueDateTime)! >= today) continue
      try {
        if (r.recurrence) await updateTask(token, listId, r.id, { recurrence: null })
        await updateTask(token, listId, r.id, { status: 'completed' })
        fixed.add(r.id)
      } catch (e) {
        if (!(e instanceof GraphError)) throw e
      }
    }
  }

  if (fixed.size) {
    saveTodosRaw(
      mode,
      loadTodos(mode).map(t =>
        t.remoteId && fixed.has(t.remoteId)
          ? { ...t, done: true, completedAt: new Date().toISOString(), remoteSeries: true, dirty: false, remoteModified: undefined }
          : t
      )
    )
  }
  localStorage.setItem(SERIES_CLEANUP_KEY(mode), '1')
  return fixed.size
}

// Completed To Do tasks are kept here for this long, then dropped from this browser (they stay in To Do).
const KEEP_COMPLETED_DAYS = 14

/**
 * Bring To Do's state into the app, working from To Do's open tasks. A task that is open here but no
 * longer open in To Do is looked up individually: completed there → completed here, deleted → removed.
 * The completed history is never downloaded. Returns how many tasks changed here.
 */
async function applyRemote(mode: Mode, open: GraphTask[], listId: string, token: string): Promise<number> {
  const pendingDelete = new Set(loadDeleted(mode))
  const openById = new Map(open.map(r => [r.id, r]))

  const lookedUp = new Map<string, GraphTask | null>()
  for (const t of loadTodos(mode)) {
    if (!t.remoteId || t.done || t.dirty || openById.has(t.remoteId) || pendingDelete.has(t.remoteId)) continue
    try {
      lookedUp.set(t.remoteId, await getTask(token, listId, t.remoteId))
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
      lookedUp.set(t.remoteId, null)
    }
  }

  // Re-read after the lookups, so edits made in the page meanwhile aren't lost.
  let todos = loadTodos(mode)
  let changed = 0

  const removed = new Set(todos.filter(t => t.remoteId && !t.dirty && lookedUp.get(t.remoteId) === null).map(t => t.id))
  todos = todos.filter(t => !removed.has(t.id))
  if (removed.size) saveProjects(mode, loadProjects(mode).filter(p => !removed.has(p.sourceTodoId)))
  changed += removed.size

  const known = [...open, ...Array.from(lookedUp.values()).filter((r): r is GraphTask => !!r)]
  const localByRemote = new Map(todos.filter(t => t.remoteId).map(t => [t.remoteId!, t]))
  for (const r of known) {
    if (pendingDelete.has(r.id)) continue
    const local = localByRemote.get(r.id)
    if (!local) {
      todos.push({ id: crypto.randomUUID(), ...newTaskFromGraph(r) })
      changed++
    } else if (!local.dirty && local.remoteModified !== r.lastModifiedDateTime) {
      // A lagging read can return an older version than one this sync just wrote; never step backwards.
      if (local.remoteModified && r.lastModifiedDateTime < local.remoteModified) continue
      todos = todos.map(t => (t.id === local.id ? { ...t, ...syncedFieldsFromGraph(r, t), dirty: false } : t))
      changed++
    }
  }

  // Keep this browser's copy small: old completed To Do tasks are dropped here (they remain in To Do).
  const cutoff = new Date(Date.now() - KEEP_COMPLETED_DAYS * 86400000).toISOString()
  const before = todos.length
  todos = todos.filter(
    t => !(t.remoteId && t.done && !t.dirty && !t.isProject && t.completedAt && t.completedAt < cutoff && !openById.has(t.remoteId))
  )
  changed += before - todos.length

  // Tasks that arrived or changed as part of a series To Do repeats itself keep that flag.
  const titles = seriesTitles(open)
  todos = todos.map(t => {
    const r = t.remoteId ? openById.get(t.remoteId) : undefined
    return r && !t.remoteSeries && titles.has(r.title) ? { ...t, remoteSeries: true } : t
  })

  saveTodosRaw(mode, todos)
  return changed
}

/* ---------- Activity log ---------- */

export interface SyncActivity {
  at: string
  sent: number
  received: number
  error?: string
}

const ACTIVITY_KEY = 'arcade-sync-activity'

export function loadActivity(): SyncActivity[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]')
  } catch {
    return []
  }
}

/** Keeps the last 30 syncs that changed something or failed. */
function logActivity(entry: SyncActivity): void {
  if (!entry.sent && !entry.received && !entry.error) return
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify([entry, ...loadActivity()].slice(0, 30)))
}


/* ---------- Repair: tasks the old daily reset re-opened ---------- */

// The daily reset that could re-open completed To Do tasks shipped on 21 Oct 2026 and was fixed on 22 Oct.
const RESET_SHIPPED = '2026-10-21T00:00:00Z'

export interface ReopenedCandidate {
  mode: Mode
  remoteId: string
  text: string
  due?: string
  created?: string
  /** Pre-selected: To Do still records a completion date for it */
  likely: boolean
  reason: string
}

/**
 * Open To Do tasks the old daily reset may have re-opened: repeat-prefixed (z_/zz_/zzz_) tasks, open, not
 * the copy carrying a To Do series forward, and changed since the reset shipped. Only these could have been
 * touched by it. Nothing is changed here; the person reviews the list first.
 */
export async function findReopenedCandidates(): Promise<ReopenedCandidate[]> {
  const token = await getToken()
  const links = loadLinks()
  const today = getTodayString()
  const found: ReopenedCandidate[] = []
  for (const mode of MODE_ORDER) {
    const link = links[mode]
    if (!link) continue
    for (const r of await listTasks(token, link.listId)) {
      const parsed = parseTitle(r.title)
      if (r.status === 'completed' || r.recurrence || !parsed.repeat || r.lastModifiedDateTime < RESET_SHIPPED) continue
      const due = utcDate(r.dueDateTime)
      const created = r.createdDateTime ? toDateString(new Date(r.createdDateTime)) : undefined
      const hadCompletion = !!r.completedDateTime?.dateTime
      const old = due ? due < today : !!created && created < '2026-10-21'
      if (!hadCompletion && !old) continue
      found.push({
        mode,
        remoteId: r.id,
        text: parsed.text,
        due,
        created,
        likely: hadCompletion,
        reason: hadCompletion ? 'To Do still has a completion date' : due ? 'Old copy, due before today' : 'Created before 21 Oct',
      })
    }
  }
  return found.sort((a, b) => (a.due ?? a.created ?? '').localeCompare(b.due ?? b.created ?? ''))
}

/** Tick the chosen tasks off again in To Do and here. Returns how many were updated. */
export async function markRemoteCompleted(items: { mode: Mode; remoteId: string }[]): Promise<number> {
  const token = await getToken()
  const links = loadLinks()
  let done = 0
  for (const { mode, remoteId } of items) {
    const link = links[mode]
    if (!link) continue
    try {
      // These copies carry no recurrence, so completing them can't make To Do create another copy.
      const updated = await updateTask(token, link.listId, remoteId, { status: 'completed' })
      saveTodosRaw(
        mode,
        loadTodos(mode).map(t =>
          t.remoteId === remoteId
            ? { ...t, done: true, completedAt: new Date().toISOString(), dirty: false, remoteModified: updated.lastModifiedDateTime }
            : t
        )
      )
      done++
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
    }
  }
  window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
  return done
}

let running: Promise<void> | null = null
let rerun = false

async function syncOnce(): Promise<void> {
  const links = loadLinks()
  const modes = MODE_ORDER.filter(m => links[m])
  if (modes.length === 0) return
  let account
  try {
    account = await getAccount()
  } catch (e) {
    setStatus({ phase: 'signed-out', error: e instanceof Error ? e.message : String(e) })
    return
  }
  if (!account) {
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
    let sent = 0
    let received = 0
    for (const mode of modes) {
      const link = links[mode]!
      const before = await listOpenTasks(token, link.listId)
      if (prefixRulesOutdated(mode)) {
        // Tasks about to be sent must be re-read too, even if they're no longer open in To Do.
        const openIds = new Set(before.map(r => r.id))
        const extra: GraphTask[] = []
        for (const t of loadTodos(mode)) {
          if (!t.remoteId || !t.dirty || openIds.has(t.remoteId)) continue
          try {
            extra.push(await getTask(token, link.listId, t.remoteId))
          } catch (e) {
            if (!(e instanceof GraphError && e.status === 404)) throw e
          }
        }
        rereadPrefixRules(mode, [...before, ...extra])
      }
      markSeries(mode, before)
      let writes = await cleanUpResetSeriesCopies(mode, before, link.listId, token)
      resetStaleDailyTasks(mode)
      writes += await pushDeletions(mode, link.listId, token)
      writes += await pushTodos(mode, link.listId, token)
      // Only re-read To Do if this sync changed it.
      received += await applyRemote(mode, writes ? await listOpenTasks(token, link.listId) : before, link.listId, token)
      // A daily task created here that was ticked off on an earlier day (here or in To Do) is reset and
      // un-ticked in To Do in this same sync.
      if (resetStaleDailyTasks(mode)) writes += await pushTodos(mode, link.listId, token)
      sent += writes
      const latest = loadLinks()
      if (latest[mode]?.listId === link.listId) {
        latest[mode] = { ...latest[mode]!, lastSync: new Date().toISOString() }
        saveLinks(latest)
      }
    }
    window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
    logActivity({ at: new Date().toISOString(), sent, received })
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
    logActivity({ at: new Date().toISOString(), sent: 0, received: 0, error: message })
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
    try {
      do {
        rerun = false
        // One tab syncs at a time, so two open tabs can't both create the same new task in To Do.
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
        if (locks) await locks.request('arcade-sync', () => syncOnce())
        else await syncOnce()
      } while (rerun)
    } finally {
      // Whatever happened, the next request can start a fresh sync.
      running = null
    }
  })()
  return running
}
